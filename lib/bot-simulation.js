const { SUITS, RANKS, cardPoints } = require('../public/shared.js');
const { shuffle } = require('./deck.js');
const { createBotMemory } = require('./bot-memory.js');
const { createBotDecisions } = require('./bot-decisions.js');
const { applyRoundScoring, startingPlayerIndexForNextRound } = require('./game-rules.js');
const { createDeterministicRandom } = require('./deterministic-rng.js');
const { BOT_PROFILES } = require('./bot-profiles.js');

const ROSWELL_STRATEGY_RELEASES = new Map([
  ['1.3.64', '1.3.64'],
  ['1.3.65', '1.3.65'],
  ['1.3.67', '1.3.67'],
  ['1.3.68', '1.3.68']
]);
const ROSWELL_POLICY_RELEASES = new Map([
  ...Array.from(ROSWELL_STRATEGY_RELEASES, ([release]) => ['roswell-' + release, release]),
  // Keep historical tournament logs and callers replayable.
  ['roswell-current', '1.3.68'],
  ['roswell-previous', '1.3.67']
]);
const VERSIONED_ROSWELL_POLICIES = new Set(ROSWELL_POLICY_RELEASES.keys());
const CURRENT_SIMPLE_STRATEGY_RELEASE = '1.3.77';
const BETA_STRATEGY_RELEASES = new Map([
  ['1.3.74', '1.3.74'],
  ['1.3.75', '1.3.75'],
  ['1.3.77', '1.3.77']
]);
const VERSIONED_BOT_STRATEGY_RELEASES = new Map([
  ['roswell', ROSWELL_STRATEGY_RELEASES],
  ['athena', ROSWELL_STRATEGY_RELEASES],
  ['norman', ROSWELL_STRATEGY_RELEASES],
  ['dory', ROSWELL_STRATEGY_RELEASES],
  ['roswell-beta', BETA_STRATEGY_RELEASES],
  ['athena-beta', BETA_STRATEGY_RELEASES],
  ['norman-beta', BETA_STRATEGY_RELEASES],
  ['dory-beta', BETA_STRATEGY_RELEASES]
]);

const SIMPLE_POLICIES = new Set([
  'always-lower-pile',
  'always-draw',
  'aggressive-dutch',
  'conservative-dutch'
]);

function releaseParts(version) {
  const match = String(version || '').match(/^(\d+)\.(\d+)\.(\d+)$/);
  return match ? match.slice(1).map(Number) : null;
}

function compareReleases(left, right) {
  const leftParts = releaseParts(left);
  const rightParts = releaseParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

function resolveBotStrategyRelease(botType, gameVersion) {
  const requested = String(gameVersion || '');
  if (!releaseParts(requested)) throw new Error('Invalid Dutch version: ' + gameVersion);
  const snapshots = VERSIONED_BOT_STRATEGY_RELEASES.get(botType);
  if (!snapshots) {
    throw new Error(
      'No version snapshots are available for ' + botType +
      '. Available versioned bots: ' + Array.from(VERSIONED_BOT_STRATEGY_RELEASES.keys()).join(', ') + '.'
    );
  }
  const releases = Array.from(snapshots.keys()).sort(compareReleases);
  const resolved = releases.filter((release) => compareReleases(release, requested) <= 0).at(-1);
  if (!resolved) {
    throw new Error('No ' + botType + ' strategy snapshot is available for Dutch ' + requested + '.');
  }
  return resolved;
}

function resolveRoswellStrategyRelease(gameVersion) {
  const requested = String(gameVersion || '').replace(/^roswell-/, '');
  return resolveBotStrategyRelease('roswell', requested);
}

function parseVersionedBotSpec(spec) {
  const match = String(spec || '').toLowerCase().match(/^([a-z][a-z0-9-]*)@(\d+\.\d+\.\d+)$/);
  if (!match) {
    throw new Error('Invalid bot version: ' + spec + '. Use bot@version, for example roswell@1.3.68.');
  }
  const botType = match[1];
  if (!BOT_PROFILES[botType]) throw new Error('Unknown bot type: ' + botType + '.');
  const requestedGameVersion = match[2];
  const strategyRelease = resolveBotStrategyRelease(botType, requestedGameVersion);
  return {
    spec: botType + '@' + requestedGameVersion,
    botType,
    requestedGameVersion,
    strategyRelease,
    decisionSystem: BOT_PROFILES[botType].system === 'simple' ? 'simple' : 'legacy'
  };
}

function policyDescriptor(policy) {
  const normalized = String(policy || '').toLowerCase();
  if (normalized.includes('@')) return parseVersionedBotSpec(normalized);
  if (VERSIONED_ROSWELL_POLICIES.has(normalized)) {
    return {
      spec: normalized,
      botType: 'roswell',
      strategyRelease: ROSWELL_POLICY_RELEASES.get(normalized),
      decisionSystem: 'legacy'
    };
  }
  const botType = SIMPLE_POLICIES.has(normalized) ? 'norman' : normalized;
  return {
    spec: normalized,
    botType,
    strategyRelease: '1.3.68',
    simpleStrategyRelease: CURRENT_SIMPLE_STRATEGY_RELEASE,
    decisionSystem: BOT_PROFILES[botType] && BOT_PROFILES[botType].system === 'simple' ? 'simple' : 'legacy'
  };
}

function botTypeForPolicy(policy) {
  return policyDescriptor(policy).botType;
}

function defaultRoswellComparison(gameVersion) {
  const currentRelease = resolveRoswellStrategyRelease(gameVersion || Array.from(ROSWELL_STRATEGY_RELEASES.keys()).at(-1));
  const releases = Array.from(ROSWELL_STRATEGY_RELEASES.keys()).sort(compareReleases);
  const currentIndex = releases.indexOf(currentRelease);
  if (currentIndex <= 0) throw new Error('A second Roswell strategy snapshot is required for comparison.');
  return [currentRelease, releases[currentIndex - 1]];
}

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

function simulationCardLabel(card) {
  return card ? card.rank + '-' + card.suit : 'no card';
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
  const random = createDeterministicRandom(seed);
  const capturePostGameLog = !!options.capturePostGameLog;
  const gameStartedAt = options.gameStartedAt || Date.now();
  let logSequence = 0;
  const gameTarget = options.gameTarget || 100;
  const policies = options.policies || ['roswell', 'athena', 'norman', 'dory'];
  const deckSetting = policies.length > 4 ? 'two' : 'one';
  let cardId = 0;
  const nextId = () => ++cardId;
  const state = {
    phase: 'playing',
    deckSetting,
    gameTarget,
    gameStartedAt,
    log: [],
    scoreHistory: [],
    roundNumber: 0,
    players: policies.map((policy, index) => ({
      id: 'player-' + index,
      name: policy + '-' + index,
      policy,
      botType: botTypeForPolicy(policy),
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

  function addSimulationLog(text, kind = 'game') {
    if (!capturePostGameLog) return;
    state.log.unshift({
      text,
      kind,
      at: new Date(Number(gameStartedAt) + logSequence++ * 1000).toISOString()
    });
  }

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
  const decisionDeps = {
    getState: () => state,
    ensureBotMemory: memory.ensureBotMemory,
    botMemoryEntry: memory.botMemoryEntry,
    effectiveMemory: memory.effectiveMemory,
    activePlayablePlayers: activePlayers,
    isProtectedSpecialTarget: (playerId) => !!(state.round && state.round.dutchCallerId === playerId),
    findActiveIndexFrom,
    randomBetween: (min, max) => min + random() * (max - min),
    random
  };
  const decisionsByRelease = new Map();
  const decisionsFor = (player) => {
    const descriptor = policyDescriptor(player.policy);
    const simpleStrategyRelease = descriptor.decisionSystem === 'simple'
      ? descriptor.simpleStrategyRelease || descriptor.strategyRelease || CURRENT_SIMPLE_STRATEGY_RELEASE
      : CURRENT_SIMPLE_STRATEGY_RELEASE;
    const key = descriptor.strategyRelease + '|' + simpleStrategyRelease;
    if (!decisionsByRelease.has(key)) {
      decisionsByRelease.set(key, createBotDecisions({
        ...decisionDeps,
        strategyRelease: descriptor.strategyRelease,
        simpleStrategyRelease
      }));
    }
    return decisionsByRelease.get(key);
  };

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
    const result = measureDecision(metrics[player.id], 'draw-source', () => decisionsFor(player).evaluateDrawSources(player));
    return result.selected && result.selected.actionType === 'take-pile' ? 'pile' : 'deck';
  }

  function chooseReplacement(player, incoming) {
    if (SIMPLE_POLICIES.has(player.policy)) return simpleHighestIndex(player);
    const target = measureDecision(metrics[player.id], 'replace-card', () => decisionsFor(player).botBestSwapTarget(player, incoming));
    return target ? target.index : highestCardIndex(player);
  }

  function deckCardDecision(player, incoming) {
    if (SIMPLE_POLICIES.has(player.policy)) {
      const index = simpleHighestIndex(player);
      return {
        swapTarget: index >= 0 && cardPoints(incoming) < simpleSlotEstimate(player, index)
          ? { index }
          : null
      };
    }
    return measureDecision(metrics[player.id], 'draw-response', () => decisionsFor(player).botDeckCardDecision(player, incoming));
  }

  function resolveSpecial(actor, discarded) {
    if (!discarded) return;
    if (discarded.rank === 'A') {
      let target;
      if (SIMPLE_POLICIES.has(actor.policy)) {
        target = activePlayers().filter((player) => player.id !== actor.id)
          .sort((a, b) => estimatedPlayerScore(actor, a) - estimatedPlayerScore(actor, b) || a.cards.length - b.cards.length)[0];
      } else {
        const selected = measureDecision(metrics[actor.id], 'ace-target', () => decisionsFor(actor).botAceTarget(actor));
        target = selected && selected.player;
      }
      if (target) {
        const added = drawDeck();
        if (added) {
          memory.addUnknownSlotForAllBots(target.id, 'Ace');
          target.cards.push(added);
          memory.observeAceForAllBots(actor.id, target.id);
          addSimulationLog(actor.name + ' used Ace on ' + target.name + ', adding ' + simulationCardLabel(added));
        }
      }
    } else if (discarded.rank === 'Q') {
      let target;
      if (SIMPLE_POLICIES.has(actor.policy)) {
        const player = activePlayers().sort((a, b) => estimatedPlayerScore(actor, a) - estimatedPlayerScore(actor, b))[0];
        target = player && { player, index: 0 };
      } else {
        target = measureDecision(metrics[actor.id], 'queen-target', () => decisionsFor(actor).botQueenTarget(actor));
      }
      if (target && target.player.cards[target.index]) {
        memory.rememberSlotForBot(actor, target.player.id, target.index, target.player.cards[target.index], 'Queen peek', 1);
        addSimulationLog(actor.name + ' used Queen on ' + target.player.name + ' position ' + (target.index + 1));
      }
    } else if (discarded.rank === 'J') {
      if (SIMPLE_POLICIES.has(actor.policy)) return;
      const candidates = measureDecision(metrics[actor.id], 'jack-target', () => decisionsFor(actor).botJackCandidates(actor));
      const selected = candidates[0];
      if (selected && selected.utility > 0) {
        const a = selected.a;
        const b = selected.b;
        [a.player.cards[a.index], b.player.cards[b.index]] = [b.player.cards[b.index], a.player.cards[a.index]];
        memory.moveSlotMemoryForAllBots(a.player.id, a.index, b.player.id, b.index, 'Jack swap');
        addSimulationLog(actor.name + ' used Jack to swap ' + a.player.name + ' position ' + (a.index + 1) +
          ' with ' + b.player.name + ' position ' + (b.index + 1));
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
          return decisionsFor(player).botThrowInCandidate(player);
        });
        index = candidate ? candidate.index : -1;
      }
      state.round.throwIn = null;
      if (index < 0) continue;
      metrics[player.id].throwAttempts += 1;
      const thrown = player.cards[index];
      if (thrown.rank !== top.rank) {
        addSimulationLog(player.name + ' attempted a wrong throw-in with ' + simulationCardLabel(thrown));
        const penalty = drawDeck();
        if (penalty) {
          memory.addUnknownSlotForAllBots(player.id, 'wrong throw-in penalty');
          player.cards.push(penalty);
        }
        continue;
      }
      metrics[player.id].throwSuccesses += 1;
      addSimulationLog(player.name + ' threw in ' + simulationCardLabel(thrown));
      memory.rememberSlotForAllBots(player.id, index, thrown, 'throw-in', 1);
      memory.removeSlotForAllBots(player.id, index, 'throw-in');
      player.cards.splice(index, 1);
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
      addSimulationLog(player.name + ' took ' + simulationCardLabel(incoming) + ' from the discard pile');
      memory.observePileTakeForAllBots(player.id, incoming);
      const index = chooseReplacement(player, incoming);
      const old = player.cards[index];
      player.cards[index] = incoming;
      memory.rememberSlotForAllBots(player.id, index, incoming, 'pile observation', 1);
      memory.rememberSlotForBot(player, player.id, index, incoming, 'pile observation', 1);
      pushDiscard(old, player.id);
      addSimulationLog(player.name + ' replaced position ' + (index + 1) + ' and discarded ' + simulationCardLabel(old));
      resolveSpecial(player, old);
      tryThrowIn(player);
    } else {
      bucket.deckChoices += 1;
      incoming = drawDeck();
      if (!incoming) return;
      addSimulationLog(player.name + ' drew ' + simulationCardLabel(incoming) + ' from the deck');
      const response = deckCardDecision(player, incoming);
      if (response.swapTarget) {
        const index = response.swapTarget.index;
        const old = player.cards[index];
        player.cards[index] = incoming;
        memory.forgetSlotForAllBots(player.id, index, 'deck swap');
        memory.rememberSlotForBot(player, player.id, index, incoming, 'deck draw', 1);
        pushDiscard(old, player.id);
        addSimulationLog(player.name + ' replaced position ' + (index + 1) + ' and discarded ' + simulationCardLabel(old));
        resolveSpecial(player, old);
        tryThrowIn(player);
      } else {
        pushDiscard(incoming, player.id);
        addSimulationLog(player.name + ' discarded the drawn ' + simulationCardLabel(incoming));
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
    return measureDecision(metrics[player.id], 'dutch', () => decisionsFor(player).botShouldCallDutch(player));
  }

  let gameResult = null;
  for (let roundGuard = 0; roundGuard < (options.maxRounds || 30) && !gameResult; roundGuard += 1) {
    const starter = startingPlayerIndexForNextRound(state.players, state.roundNumber);
    state.roundNumber += 1;
    const shuffledDeckOrder = makeDeck(deckSetting, random, nextId);
    state.round = {
      stage: 'turn',
      deck: shuffledDeckOrder,
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
    addSimulationLog('round ' + state.roundNumber + ' started', 'system');
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
        addSimulationLog(player.name + ' called Dutch');
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
      addSimulationLog(forced.name + ' was selected as the forced Dutch caller after the turn limit');
    }

    const caller = state.players.find((player) => player.id === state.round.dutchCallerId);
    const callerRaw = actualScore(caller);
    const scoring = applyRoundScoring(state.players, {
      callerId: state.round.dutchCallerId,
      gameTarget
    });
    state.scoreHistory.push({
      round: state.roundNumber,
      players: scoring.scoreHistoryPlayers
    });
    addSimulationLog('round ended. ' + scoring.pointChanges.join(', '), 'system');
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
  const winningPlayer = state.players.find((player) => player.id === gameResult.winnerId);
  addSimulationLog('game ended. ' + (winningPlayer ? winningPlayer.name : gameResult.winnerName) + ' won' +
    (gameResult.truncated ? ' after the simulation round limit' : ''), 'system');
  for (const player of state.players) {
    const bucket = metrics[player.id];
    bucket.games = 1;
    bucket.wins = gameResult.winnerId === player.id ? 1 : 0;
    bucket.finalGameScore = player.total;
  }
  const result = {
    seed,
    winnerId: gameResult.winnerId,
    winnerPolicy: state.players.find((player) => player.id === gameResult.winnerId).policy,
    truncated: !!gameResult.truncated,
    players: state.players.map((player) => ({ id: player.id, policy: player.policy, total: player.total })),
    metrics
  };
  if (capturePostGameLog) {
    result.postGameLog = {
      gameVersion: options.gameVersion || '',
      gameSeed: seed,
      winnerName: winningPlayer ? winningPlayer.name : gameResult.winnerName,
      gameStartedAt: state.gameStartedAt,
      gameTarget: state.gameTarget,
      roundNumber: state.roundNumber,
      scoreHistory: state.scoreHistory,
      log: state.log
    };
  }
  return result;
}

function runTournament(options = {}) {
  const seeds = options.seeds || Array.from({ length: 10 }, (_, index) => index + 1);
  const tournamentStartedAt = options.tournamentStartedAt
    ? new Date(options.tournamentStartedAt).getTime()
    : Date.now();
  const lineups = options.lineups || [
    ['roswell', 'athena'],
    ['roswell', 'norman'],
    ['roswell', 'dory'],
    ['roswell', 'always-lower-pile'],
    ['roswell', 'always-draw'],
    ['roswell', 'aggressive-dutch'],
    ['roswell', 'conservative-dutch'],
    ['roswell', 'roswell', 'roswell']
  ];
  const totals = {};
  const games = [];
  let gameNumber = 0;
  for (const lineup of lineups) {
    for (const seed of seeds) {
      gameNumber += 1;
      const result = simulateGame({
        ...options,
        seed,
        policies: lineup,
        gameStartedAt: tournamentStartedAt + gameNumber
      });
      if (typeof options.onGameComplete === 'function') {
        options.onGameComplete(result, gameNumber, lineup.slice());
        delete result.postGameLog;
      }
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

function comparisonDifference(candidatePolicy, baselinePolicy, candidate, baseline) {
  const metricDelta = (field) => (candidate[field] || 0) - (baseline[field] || 0);
  return {
    from: baselinePolicy,
    to: candidatePolicy,
    metrics: {
      gameWinRate: metricDelta('gameWinRate'),
      averageFinalGameScore: metricDelta('averageFinalGameScore'),
      roundWinRate: metricDelta('roundWinRate'),
      dutchCalls: metricDelta('dutchCalls'),
      successfulDutchRate: metricDelta('successfulDutchRate'),
      failedDutchRate: metricDelta('failedDutchRate'),
      failedDutchCost: metricDelta('failedDutchCost'),
      throwAttempts: metricDelta('throwAttempts'),
      throwInSuccessRate: metricDelta('throwInSuccessRate'),
      averageDecisionLatencyMs: metricDelta('averageDecisionLatencyMs')
    }
  };
}

function runVersionedBotTournament(options = {}) {
  const requestedCompetitors = (options.competitors || []).map(String);
  if (requestedCompetitors.length !== 2) {
    throw new Error(
      'Choose exactly two bot versions, for example roswell@1.3.68 and norman-beta@1.3.74.'
    );
  }
  const competitors = requestedCompetitors.map(parseVersionedBotSpec);
  if (competitors[0].spec === competitors[1].spec) {
    throw new Error('Choose two different bot versions for the tournament.');
  }
  if (
    competitors[0].botType === competitors[1].botType &&
    competitors[0].strategyRelease === competitors[1].strategyRelease
  ) {
    throw new Error(
      competitors[0].spec + ' and ' + competitors[1].spec + ' both use the same ' +
      competitors[0].botType + ' strategy snapshot (' + competitors[0].strategyRelease + ').'
    );
  }

  let seeds = options.seeds;
  let totalGames;
  if (seeds && seeds.length) {
    seeds = seeds.map(Number);
    totalGames = seeds.length * 2;
  } else {
    totalGames = options.totalGames === undefined ? 100 : Number(options.totalGames);
    if (!Number.isInteger(totalGames) || totalGames < 2 || totalGames % 2 !== 0) {
      throw new Error('The tournament game count must be an even whole number of at least 2.');
    }
    seeds = Array.from({ length: totalGames / 2 }, (_, index) => 1001 + index);
  }

  const maxRounds = options.maxRounds === undefined ? 100 : options.maxRounds;
  const candidatePolicy = competitors[0].spec;
  const baselinePolicy = competitors[1].spec;
  const lineups = [
    [candidatePolicy, baselinePolicy],
    [baselinePolicy, candidatePolicy]
  ];
  const result = runTournament({
    ...options,
    seeds,
    maxRounds,
    lineups
  });
  const candidate = result.summary[candidatePolicy];
  const baseline = result.summary[baselinePolicy];
  return {
    ...result,
    comparison: {
      format: 'paired randomized complete games with both seat orders',
      totalGames,
      gamesPerSeat: seeds.length,
      gamesPerCompetitor: candidate.games,
      maxRounds,
      randomizedHands: true,
      seatsRotated: true,
      requestedCompetitors,
      policies: [candidatePolicy, baselinePolicy],
      competitors: Object.fromEntries(competitors.map((entry) => [entry.spec, {
        botType: entry.botType,
        requestedGameVersion: entry.requestedGameVersion,
        strategyRelease: entry.strategyRelease,
        metrics: result.summary[entry.spec]
      }])),
      difference: comparisonDifference(candidatePolicy, baselinePolicy, candidate, baseline),
      winner: candidate.gameWinRate === baseline.gameWinRate
        ? null
        : (candidate.gameWinRate > baseline.gameWinRate ? candidatePolicy : baselinePolicy)
    }
  };
}

function runVersionedRoswellTournament(options = {}) {
  const gamesPerSeat = Math.max(1, Number(options.gamesPerSeat) || 10);
  const seeds = options.seeds || Array.from({ length: gamesPerSeat }, (_, index) => 1001 + index);
  const maxRounds = options.maxRounds === undefined ? 100 : options.maxRounds;
  const requestedGameVersions = options.versions && options.versions.length
    ? options.versions.map(String)
    : defaultRoswellComparison(options.gameVersion);
  if (requestedGameVersions.length !== 2) {
    throw new Error('Choose exactly two Dutch versions for a Roswell comparison.');
  }
  const strategyReleases = requestedGameVersions.map(resolveRoswellStrategyRelease);
  if (strategyReleases[0] === strategyReleases[1]) {
    throw new Error(
      'Dutch ' + requestedGameVersions[0] + ' and ' + requestedGameVersions[1] +
      ' both use Roswell ' + strategyReleases[0] + '; choose two different strategy releases.'
    );
  }
  const candidatePolicy = 'roswell-' + strategyReleases[0];
  const baselinePolicy = 'roswell-' + strategyReleases[1];
  const lineups = [
    [candidatePolicy, baselinePolicy],
    [baselinePolicy, candidatePolicy]
  ];
  const result = runTournament({
    ...options,
    seeds,
    maxRounds,
    lineups
  });
  const candidate = result.summary[candidatePolicy];
  const baseline = result.summary[baselinePolicy];
  const metricDelta = (field) => (candidate[field] || 0) - (baseline[field] || 0);
  return {
    ...result,
    comparison: {
      format: 'randomized complete games with both seat orders',
      gamesPerSeat: seeds.length,
      totalGames: result.games.length,
      gamesPerVersion: candidate.games,
      maxRounds,
      randomizedHands: true,
      seatsRotated: true,
      requestedGameVersions,
      strategyReleases,
      policies: [candidatePolicy, baselinePolicy],
      versions: {
        [candidatePolicy]: candidate,
        [baselinePolicy]: baseline
      },
      difference: {
        from: baselinePolicy,
        to: candidatePolicy,
        metrics: {
          gameWinRate: metricDelta('gameWinRate'),
          averageFinalGameScore: metricDelta('averageFinalGameScore'),
          roundWinRate: metricDelta('roundWinRate'),
          dutchCalls: metricDelta('dutchCalls'),
          successfulDutchRate: metricDelta('successfulDutchRate'),
          failedDutchRate: metricDelta('failedDutchRate'),
          failedDutchCost: metricDelta('failedDutchCost'),
          throwAttempts: metricDelta('throwAttempts'),
          throwInSuccessRate: metricDelta('throwInSuccessRate'),
          averageDecisionLatencyMs: metricDelta('averageDecisionLatencyMs')
        }
      },
      winner: candidate.gameWinRate === baseline.gameWinRate
        ? null
        : (candidate.gameWinRate > baseline.gameWinRate ? candidatePolicy : baselinePolicy)
    }
  };
}

module.exports = {
  SIMPLE_POLICIES,
  ROSWELL_STRATEGY_RELEASES,
  VERSIONED_ROSWELL_POLICIES,
  VERSIONED_BOT_STRATEGY_RELEASES,
  resolveBotStrategyRelease,
  resolveRoswellStrategyRelease,
  parseVersionedBotSpec,
  actualScore,
  simulateGame,
  runTournament,
  runVersionedBotTournament,
  runVersionedRoswellTournament
};
