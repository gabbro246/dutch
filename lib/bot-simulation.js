const { SUITS, RANKS, cardPoints } = require('../public/shared.js');
const { shuffle } = require('./deck.js');
const { createBotMemory } = require('./bot-memory.js');
const { createBotDecisions } = require('./bot-decisions.js');
const { applyRoundScoring, startingPlayerIndexForNextRound } = require('./game-rules.js');
const { seededRandom } = require('./bot-optimal.js');

const SIMPLE_POLICIES = new Set([
  'always-lower-pile',
  'always-draw',
  'aggressive-dutch',
  'conservative-dutch'
]);

function makeDeck(deckSetting, random, nextId) {
  const cards = [];
  const colors = deckSetting === 'two' ? ['red', 'blue'] : ['blue'];
  for (const deckColor of colors) {
    for (const suit of SUITS) {
      for (const rank of RANKS) cards.push({ id: 'sim-' + nextId(), rank, suit, deckColor });
    }
  }
  return shuffle(cards, random);
}

function actualScore(player) {
  return player.cards.reduce((sum, card) => sum + cardPoints(card), 0);
}

function highestCardIndex(player) {
  let best = -1;
  let bestPoints = -Infinity;
  player.cards.forEach((card, index) => {
    const points = cardPoints(card);
    if (points > bestPoints) {
      best = index;
      bestPoints = points;
    }
  });
  return best;
}

function createMetricBucket() {
  return {
    games: 0,
    wins: 0,
    finalGameScore: 0,
    rounds: 0,
    roundWins: 0,
    dutchCalls: 0,
    successfulDutchCalls: 0,
    failedDutchCalls: 0,
    failedDutchCost: 0,
    pileChoices: 0,
    deckChoices: 0,
    throwAttempts: 0,
    throwSuccesses: 0,
    decisionCount: 0,
    decisionTimeMs: 0,
    maxDecisionTimeMs: 0,
    maxDecisionType: null
  };
}

function measureDecision(bucket, actionType, fn) {
  const start = process.hrtime.bigint();
  const result = fn();
  const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
  bucket.decisionCount += 1;
  bucket.decisionTimeMs += elapsed;
  if (elapsed > bucket.maxDecisionTimeMs) {
    bucket.maxDecisionTimeMs = elapsed;
    bucket.maxDecisionType = actionType;
  }
  return result;
}

function simulateGame(options = {}) {
  const seed = Number(options.seed) || 1;
  const random = seededRandom(seed);
  const gameTarget = options.gameTarget || 100;
  const policies = options.policies || ['roswell', 'strategic', 'casual', 'distracted'];
  const deckSetting = policies.length > 4 ? 'two' : 'one';
  let cardId = 0;
  const nextId = () => ++cardId;
  const state = {
    phase: 'playing',
    deckSetting,
    gameTarget,
    roundNumber: 0,
    players: policies.map((policy, index) => ({
      id: 'player-' + index,
      name: policy + '-' + index,
      policy,
      botType: SIMPLE_POLICIES.has(policy) ? 'casual' : policy,
      isBot: true,
      isSpectator: false,
      left: false,
      total: 0,
      roundPoints: null,
      cards: [],
      botMemory: null
    })),
    round: null
  };
  const metrics = Object.fromEntries(state.players.map((player) => [player.id, createMetricBucket()]));
  const activePlayers = () => state.players.filter((player) => !player.left && !player.isSpectator);
  const activeBots = () => activePlayers();
  const memory = createBotMemory({
    getState: () => state,
    activeBots,
    activePlayablePlayers: activePlayers
  });
  const findActiveIndexFrom = (start) => {
    for (let offset = 0; offset < state.players.length; offset += 1) {
      const index = (start + offset) % state.players.length;
      if (!state.players[index].left && !state.players[index].isSpectator) return index;
    }
    return -1;
  };
  const decisions = createBotDecisions({
    getState: () => state,
    ensureBotMemory: memory.ensureBotMemory,
    botMemoryEntry: memory.botMemoryEntry,
    effectiveMemory: memory.effectiveMemory,
    activePlayablePlayers: activePlayers,
    isProtectedSpecialTarget: (playerId) => !!(state.round && state.round.dutchCallerId === playerId),
    findActiveIndexFrom,
    randomBetween: (min, max) => min + random() * (max - min),
    random
  });

  function ensureDeck() {
    if (state.round.deck.length || state.round.discard.length <= 1) return;
    const top = state.round.discard.pop();
    const moved = state.round.discard.splice(0);
    state.round.deck = shuffle(moved, random);
    state.round.discard = [top];
    memory.observeReshuffleForAllBots(moved, top);
  }

  function drawDeck() {
    ensureDeck();
    return state.round.deck.pop() || null;
  }

  function pushDiscard(card, actorId) {
    memory.observeDiscardForAllBots(card, 'simulation discard', actorId);
    state.round.discard.push(card);
  }

  function slotEstimateFor(viewer, owner, index) {
    const entry = memory.effectiveMemory(viewer, memory.botMemoryEntry(viewer, owner.id, index));
    if (entry.card) return entry.card.points * entry.confidence + 6.4 * (1 - entry.confidence);
    const remembered = (entry.distribution || []).reduce((sum, item) => sum + item.card.points * item.probability, 0);
    const mass = (entry.distribution || []).reduce((sum, item) => sum + item.probability, 0);
    return remembered + 6.4 * Math.max(0, 1 - mass);
  }

  function simpleSlotEstimate(player, index) {
    return slotEstimateFor(player, player, index);
  }

  function estimatedPlayerScore(viewer, owner) {
    return owner.cards.reduce((sum, card, index) => sum + slotEstimateFor(viewer, owner, index), 0);
  }

  function simpleHighestIndex(player) {
    let bestIndex = -1;
    let bestEstimate = -Infinity;
    player.cards.forEach((card, index) => {
      const estimate = simpleSlotEstimate(player, index);
      if (estimate > bestEstimate) {
        bestEstimate = estimate;
        bestIndex = index;
      }
    });
    return bestIndex;
  }

  function simpleBelievedScore(player) {
    return player.cards.reduce((sum, card, index) => sum + simpleSlotEstimate(player, index), 0);
  }

  function chooseSimpleSource(player) {
    if (player.policy === 'always-draw') return 'deck';
    const top = state.round.discard.at(-1);
    const highest = simpleHighestIndex(player);
    const replaceable = highest >= 0 ? simpleSlotEstimate(player, highest) : -Infinity;
    if (player.policy === 'always-lower-pile') {
      return cardPoints(top) < replaceable ? 'pile' : 'deck';
    }
    if (player.policy === 'aggressive-dutch') return cardPoints(top) <= Math.max(6, replaceable) ? 'pile' : 'deck';
    return cardPoints(top) <= Math.min(3, replaceable) ? 'pile' : 'deck';
  }

  function chooseSource(player) {
    if (SIMPLE_POLICIES.has(player.policy)) return chooseSimpleSource(player);
    const result = measureDecision(metrics[player.id], 'draw-source', () => decisions.evaluateDrawSources(player));
    return result.selected && result.selected.actionType === 'take-pile' ? 'pile' : 'deck';
  }

  function chooseReplacement(player, incoming) {
    if (SIMPLE_POLICIES.has(player.policy)) return simpleHighestIndex(player);
    const target = measureDecision(metrics[player.id], 'replace-card', () => decisions.botBestSwapTarget(player, incoming));
    return target ? target.index : highestCardIndex(player);
  }

  function shouldSwapDeckCard(player, incoming) {
    if (SIMPLE_POLICIES.has(player.policy)) {
      const index = simpleHighestIndex(player);
      return index >= 0 && cardPoints(incoming) < simpleSlotEstimate(player, index);
    }
    return measureDecision(metrics[player.id], 'draw-response', () => decisions.shouldBotSwapDrawn(player, incoming));
  }

  function resolveSpecial(actor, discarded) {
    if (!discarded) return;
    if (discarded.rank === 'A') {
      let target;
      if (SIMPLE_POLICIES.has(actor.policy)) {
        target = activePlayers().filter((player) => player.id !== actor.id)
          .sort((a, b) => estimatedPlayerScore(actor, a) - estimatedPlayerScore(actor, b) || a.cards.length - b.cards.length)[0];
      } else {
        const selected = measureDecision(metrics[actor.id], 'ace-target', () => decisions.botAceTarget(actor));
        target = selected && selected.player;
      }
      if (target) {
        const added = drawDeck();
        if (added) {
          target.cards.push(added);
          memory.addUnknownSlotForAllBots(target.id, 'Ace');
          memory.observeAceForAllBots(actor.id, target.id);
        }
      }
    } else if (discarded.rank === 'Q') {
      let target;
      if (SIMPLE_POLICIES.has(actor.policy)) {
        const player = activePlayers().sort((a, b) => estimatedPlayerScore(actor, a) - estimatedPlayerScore(actor, b))[0];
        target = player && { player, index: 0 };
      } else {
        target = measureDecision(metrics[actor.id], 'queen-target', () => decisions.botQueenTarget(actor));
      }
      if (target && target.player.cards[target.index]) {
        memory.rememberSlotForBot(actor, target.player.id, target.index, target.player.cards[target.index], 'Queen peek', 1);
      }
    } else if (discarded.rank === 'J') {
      if (SIMPLE_POLICIES.has(actor.policy)) return;
      const candidates = measureDecision(metrics[actor.id], 'jack-target', () => decisions.botJackCandidates(actor));
      const selected = candidates[0];
      if (selected && selected.utility > 0) {
        const a = selected.a;
        const b = selected.b;
        [a.player.cards[a.index], b.player.cards[b.index]] = [b.player.cards[b.index], a.player.cards[a.index]];
        memory.moveSlotMemoryForAllBots(a.player.id, a.index, b.player.id, b.index, 'Jack swap');
      }
    }
  }

  function tryThrowIn(discarder) {
    const top = state.round.discard.at(-1);
    for (const player of activePlayers()) {
      if (!player.cards.length) continue;
      let index = -1;
      if (SIMPLE_POLICIES.has(player.policy)) {
        if (player.policy !== 'always-draw') {
          index = player.cards.reduce((best, card, candidate) => {
            const entry = memory.effectiveMemory(player, memory.botMemoryEntry(player, player.id, candidate));
            const rank = entry.card && entry.card.rank || entry.rank;
            if (rank !== top.rank || (entry.confidence || 0) < 0.65) return best;
            return best < 0 || simpleSlotEstimate(player, candidate) > simpleSlotEstimate(player, best) ? candidate : best;
          }, -1);
        }
      } else {
        const candidate = measureDecision(metrics[player.id], 'throw-in', () => {
          state.round.throwIn = { open: true, rank: top.rank };
          return decisions.botThrowInCandidate(player);
        });
        index = candidate ? candidate.index : -1;
      }
      state.round.throwIn = null;
      if (index < 0) continue;
      metrics[player.id].throwAttempts += 1;
      const thrown = player.cards[index];
      if (thrown.rank !== top.rank) {
        const penalty = drawDeck();
        if (penalty) {
          player.cards.push(penalty);
          memory.addUnknownSlotForAllBots(player.id, 'wrong throw-in penalty');
        }
        continue;
      }
      metrics[player.id].throwSuccesses += 1;
      memory.rememberSlotForAllBots(player.id, index, thrown, 'throw-in', 1);
      player.cards.splice(index, 1);
      memory.removeSlotForAllBots(player.id, index, 'throw-in');
      pushDiscard(thrown, player.id);
      resolveSpecial(player, thrown);
      break;
    }
  }

  function takeTurn(player) {
    const source = chooseSource(player);
    const bucket = metrics[player.id];
    let incoming;
    if (source === 'pile') {
      bucket.pileChoices += 1;
      incoming = state.round.discard.pop();
      memory.observePileTakeForAllBots(player.id, incoming);
      const index = chooseReplacement(player, incoming);
      const old = player.cards[index];
      player.cards[index] = incoming;
      memory.rememberSlotForAllBots(player.id, index, incoming, 'pile observation', 1);
      memory.rememberSlotForBot(player, player.id, index, incoming, 'pile observation', 1);
      pushDiscard(old, player.id);
      resolveSpecial(player, old);
      tryThrowIn(player);
    } else {
      bucket.deckChoices += 1;
      incoming = drawDeck();
      if (!incoming) return;
      if (shouldSwapDeckCard(player, incoming)) {
        const index = chooseReplacement(player, incoming);
        const old = player.cards[index];
        player.cards[index] = incoming;
        memory.forgetSlotForAllBots(player.id, index, 'deck swap');
        memory.rememberSlotForBot(player, player.id, index, incoming, 'deck draw', 1);
        pushDiscard(old, player.id);
        resolveSpecial(player, old);
        tryThrowIn(player);
      } else {
        pushDiscard(incoming, player.id);
        resolveSpecial(player, incoming);
        tryThrowIn(player);
      }
    }
    memory.advanceMemoryTurn();
  }

  function shouldCallDutch(player) {
    if (!player.cards.length) return true;
    if (SIMPLE_POLICIES.has(player.policy)) {
      const score = simpleBelievedScore(player);
      if (player.policy === 'aggressive-dutch') return score <= 7;
      if (player.policy === 'conservative-dutch') return score <= 3;
      return score <= 5;
    }
    return measureDecision(metrics[player.id], 'dutch', () => decisions.botShouldCallDutch(player));
  }

  let gameResult = null;
  for (let roundGuard = 0; roundGuard < (options.maxRounds || 30) && !gameResult; roundGuard += 1) {
    const starter = startingPlayerIndexForNextRound(state.players, state.roundNumber);
    state.roundNumber += 1;
    state.round = {
      stage: 'turn',
      deck: makeDeck(deckSetting, random, nextId),
      discard: [],
      currentPlayerIndex: starter,
      dutchCallerId: null,
      dutchQueue: [],
      strategyTick: 0,
      throwIn: null
    };
    for (const player of state.players) {
      player.cards = [];
      player.roundPoints = null;
      player.botMemory = null;
    }
    for (let count = 0; count < 4; count += 1) {
      for (const player of activePlayers()) player.cards.push(drawDeck());
    }
    memory.syncBotMemories();
    for (const player of activePlayers()) {
      memory.rememberSlotForBot(player, player.id, 0, player.cards[0], 'start peek', 1);
      memory.rememberSlotForBot(player, player.id, 1, player.cards[1], 'start peek', 1);
    }
    pushDiscard(drawDeck(), null);

    let finalTurns = null;
    let turns = 0;
    while (turns < (options.maxTurnsPerRound || 180)) {
      const player = state.players[state.round.currentPlayerIndex];
      takeTurn(player);
      turns += 1;
      if (finalTurns === null && shouldCallDutch(player)) {
        state.round.dutchCallerId = player.id;
        metrics[player.id].dutchCalls += 1;
        finalTurns = state.players.length - 1;
      } else if (finalTurns !== null) {
        finalTurns -= 1;
        if (finalTurns <= 0) break;
      }
      state.round.currentPlayerIndex = findActiveIndexFrom(state.round.currentPlayerIndex + 1);
    }
    if (!state.round.dutchCallerId) {
      const forced = activePlayers().sort((a, b) => actualScore(a) - actualScore(b))[0];
      state.round.dutchCallerId = forced.id;
      metrics[forced.id].dutchCalls += 1;
    }

    const caller = state.players.find((player) => player.id === state.round.dutchCallerId);
    const callerRaw = actualScore(caller);
    const scoring = applyRoundScoring(state.players, {
      callerId: state.round.dutchCallerId,
      gameTarget
    });
    for (const player of state.players) {
      metrics[player.id].rounds += 1;
      if (scoring.roundWinnerIds.includes(player.id)) metrics[player.id].roundWins += 1 / scoring.roundWinnerIds.length;
    }
    if (caller.roundPoints === 0) metrics[caller.id].successfulDutchCalls += 1;
    else {
      metrics[caller.id].failedDutchCalls += 1;
      metrics[caller.id].failedDutchCost += Math.max(0, caller.roundPoints - callerRaw);
    }
    if (scoring.gameEnded) gameResult = scoring;
  }

  if (!gameResult) {
    const winner = state.players.slice().sort((a, b) => a.total - b.total)[0];
    gameResult = { winnerId: winner.id, winnerName: winner.name, gameEnded: true, truncated: true };
  }
  for (const player of state.players) {
    const bucket = metrics[player.id];
    bucket.games = 1;
    bucket.wins = gameResult.winnerId === player.id ? 1 : 0;
    bucket.finalGameScore = player.total;
  }
  return {
    seed,
    winnerId: gameResult.winnerId,
    winnerPolicy: state.players.find((player) => player.id === gameResult.winnerId).policy,
    truncated: !!gameResult.truncated,
    players: state.players.map((player) => ({ id: player.id, policy: player.policy, total: player.total })),
    metrics
  };
}

function runTournament(options = {}) {
  const seeds = options.seeds || Array.from({ length: 10 }, (_, index) => index + 1);
  const lineups = options.lineups || [
    ['roswell', 'strategic'],
    ['roswell', 'casual'],
    ['roswell', 'distracted'],
    ['roswell', 'always-lower-pile'],
    ['roswell', 'always-draw'],
    ['roswell', 'aggressive-dutch'],
    ['roswell', 'conservative-dutch'],
    ['roswell', 'roswell', 'roswell']
  ];
  const totals = {};
  const games = [];
  for (const lineup of lineups) {
    for (const seed of seeds) {
      const result = simulateGame({ ...options, seed, policies: lineup });
      games.push(result);
      result.players.forEach((player) => {
        const key = player.policy;
        if (!totals[key]) totals[key] = createMetricBucket();
        const source = result.metrics[player.id];
        if (source.maxDecisionTimeMs > totals[key].maxDecisionTimeMs) {
          totals[key].maxDecisionTimeMs = source.maxDecisionTimeMs;
          totals[key].maxDecisionType = source.maxDecisionType;
        }
        for (const [field, value] of Object.entries(source)) {
          if (field !== 'maxDecisionTimeMs' && field !== 'maxDecisionType') totals[key][field] += value;
        }
      });
    }
  }
  const summary = {};
  for (const [policy, bucket] of Object.entries(totals)) {
    summary[policy] = {
      games: bucket.games,
      gameWinRate: bucket.games ? bucket.wins / bucket.games : 0,
      averageFinalGameScore: bucket.games ? bucket.finalGameScore / bucket.games : 0,
      rounds: bucket.rounds,
      roundWinRate: bucket.rounds ? bucket.roundWins / bucket.rounds : 0,
      dutchCalls: bucket.dutchCalls,
      successfulDutchRate: bucket.dutchCalls ? bucket.successfulDutchCalls / bucket.dutchCalls : 0,
      failedDutchRate: bucket.dutchCalls ? bucket.failedDutchCalls / bucket.dutchCalls : 0,
      failedDutchCost: bucket.failedDutchCost,
      pileChoices: bucket.pileChoices,
      deckChoices: bucket.deckChoices,
      throwAttempts: bucket.throwAttempts,
      throwInSuccessRate: bucket.throwAttempts ? bucket.throwSuccesses / bucket.throwAttempts : 0,
      averageDecisionLatencyMs: bucket.decisionCount ? bucket.decisionTimeMs / bucket.decisionCount : 0,
      maxDecisionLatencyMs: bucket.maxDecisionTimeMs,
      maxDecisionType: bucket.maxDecisionType
    };
  }
  return { games, summary };
}

module.exports = { SIMPLE_POLICIES, actualScore, simulateGame, runTournament };
