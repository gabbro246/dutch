const {
  HALVING_TOTALS,
  RANKS,
  SUITS,
  cardPoints,
  isRedSuit
} = require('../public/shared.js');
const { botProfile, publicMemoryCard } = require('./bot-strategy.js');

const MEMORY_THRESHOLD = 0.5;
const PILE_MAX_POINTS = 5;
const DUTCH_MAX_POINTS = 5;
const DEFAULT_UNKNOWN_POINTS = 6.4;
const EPSILON = 1e-9;

function createSimpleDecisionLayer(deps) {
  const {
    getState,
    ensureBotMemory,
    botMemoryEntry,
    activePlayablePlayers,
    isProtectedSpecialTarget = () => false
  } = deps;
  const effectiveHumanMemory = deps.effectiveHumanMemory || (() => ({ card: null, confidence: 0 }));
  const randomBetween = deps.randomBetween || ((min, max) => min + Math.random() * (max - min));
  const random = deps.random || Math.random;

  function state() {
    return getState();
  }

  function players() {
    return activePlayablePlayers();
  }

  function opponents(bot) {
    return players().filter((player) => player.id !== bot.id);
  }

  function pickRandom(items) {
    if (!items.length) return null;
    return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
  }

  function pickBest(items, score, direction = 'max') {
    if (!items.length) return null;
    const scored = items.map((item) => ({ item, value: Number(score(item)) || 0 }));
    const target = direction === 'min'
      ? Math.min(...scored.map((entry) => entry.value))
      : Math.max(...scored.map((entry) => entry.value));
    return pickRandom(scored.filter((entry) => Math.abs(entry.value - target) <= EPSILON).map((entry) => entry.item));
  }

  function falseMemoryCard(previous) {
    const candidates = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        if (previous && previous.rank === rank && previous.suit === suit) continue;
        const card = { rank, suit };
        candidates.push({
          rank,
          suit,
          red: isRedSuit(suit),
          points: cardPoints(card)
        });
      }
    }
    return pickRandom(candidates);
  }

  function recallEntry(bot, ownerId, index) {
    ensureBotMemory(bot);
    const entry = botMemoryEntry(bot, ownerId, index);
    if (!entry || !entry.card) {
      return {
        ...(entry || {}),
        state: 'unknown',
        card: null,
        confidence: 0
      };
    }

    const profile = botProfile(bot);
    const round = state().round || {};
    const tick = round.strategyTick ?? round.botTick ?? 0;
    const cycleLength = Math.max(1, players().length);
    const cycles = Math.max(0, tick - (entry.updatedTick || 0)) / cycleLength;
    const decayRate = ownerId === bot.id
      ? profile.memoryCycleDecay
      : profile.memoryOpponentCycleDecay;
    const confidence = Math.max(0, Math.min(1, (entry.confidence || 0) - (decayRate || 0) * cycles));

    if (confidence < MEMORY_THRESHOLD) {
      entry.state = 'stale';
      entry.card = null;
      entry.rank = null;
      entry.knownRank = null;
      entry.confidence = confidence;
      return { ...entry, card: null, confidence };
    }

    if (entry.recallCheckedTick !== tick) {
      entry.recallCheckedTick = tick;
      if (random() > confidence) {
        const mistakenCard = falseMemoryCard(entry.card);
        entry.card = mistakenCard;
        entry.rank = mistakenCard.rank;
        entry.knownRank = mistakenCard.rank;
        entry.expectedValue = mistakenCard.points;
        entry.confidence = confidence;
        entry.updatedTick = tick;
        entry.falseMemory = true;
      }
    }

    return {
      ...entry,
      state: 'known',
      confidence,
      card: entry.card && { ...entry.card }
    };
  }

  function recallObservedEntry(bot, entry) {
    if (!entry || !entry.card) return null;
    if (!Number.isFinite(entry.confidence)) entry.confidence = 1;
    const profile = botProfile(bot);
    const round = state().round || {};
    const tick = round.strategyTick ?? round.botTick ?? 0;
    const cycles = Math.max(0, tick - (entry.updatedTick || 0)) / Math.max(1, players().length);
    const confidence = Math.max(
      0,
      Math.min(1, entry.confidence - (profile.memoryCycleDecay || 0) * cycles)
    );

    if (confidence < MEMORY_THRESHOLD) {
      entry.state = 'stale';
      entry.card = null;
      entry.rank = null;
      entry.confidence = confidence;
      return null;
    }

    if (entry.recallCheckedTick !== tick) {
      entry.recallCheckedTick = tick;
      if (random() > confidence) {
        const mistakenCard = falseMemoryCard(entry.card);
        entry.card = mistakenCard;
        entry.rank = mistakenCard.rank;
        entry.confidence = confidence;
        entry.updatedTick = tick;
        entry.falseMemory = true;
      }
    }
    return { ...entry, confidence, card: { ...entry.card } };
  }

  function ownSlots(bot) {
    return bot.cards.map((physicalCard, index) => {
      const memory = recallEntry(bot, bot.id, index);
      return {
        player: bot,
        index,
        physicalCard,
        card: memory.card || null,
        memory,
        known: !!memory.card,
        expected: memory.card ? cardPoints(memory.card) : unknownExpectedPoints(bot)
      };
    });
  }

  function playerSlots(bot, player) {
    return player.cards.map((physicalCard, index) => {
      const memory = recallEntry(bot, player.id, index);
      return {
        player,
        index,
        physicalCard,
        card: memory.card || null,
        memory,
        known: !!memory.card,
        expected: memory.card ? cardPoints(memory.card) : unknownExpectedPoints(bot)
      };
    });
  }

  function rememberedCardEntries(bot) {
    const memory = ensureBotMemory(bot);
    if (!memory) return [];
    const profile = botProfile(bot);
    const entries = [];
    for (const player of players()) {
      for (let index = 0; index < player.cards.length; index += 1) {
        const recalled = recallEntry(bot, player.id, index);
        if (recalled.card) entries.push({ ...recalled, zone: 'hand' });
      }
    }
    for (const collection of [memory.discards || [], memory.removed || []]) {
      for (const entry of collection) {
        if (!entry || !entry.card) continue;
        if (profile.countDeckCards && ['draw pile', 'moved'].includes(entry.zone)) continue;
        const recalled = recallObservedEntry(bot, entry);
        if (recalled) entries.push(recalled);
      }
    }
    if (memory.drawn && memory.drawn.card) {
      const recalledDrawn = recallObservedEntry(bot, memory.drawn);
      if (recalledDrawn) entries.push({ ...recalledDrawn, zone: 'drawn' });
    }

    const unique = new Map();
    entries.forEach((entry, index) => {
      const key = entry.physicalId || [
        entry.deckColor || '?',
        entry.card.rank,
        entry.card.suit,
        entry.zone || '?',
        index
      ].join(':');
      unique.set(key, entry);
    });
    return Array.from(unique.values());
  }

  function countedUnknownPoints(bot) {
    const currentState = state();
    const colors = currentState.deckSetting === 'two'
      ? ['red', 'blue']
      : [currentState.deckColor === 'red' ? 'red' : 'blue'];
    const remaining = [];
    for (const deckColor of colors) {
      for (const suit of SUITS) {
        for (const rank of RANKS) remaining.push({ rank, suit, deckColor });
      }
    }

    for (const entry of rememberedCardEntries(bot)) {
      const remembered = entry.card;
      let index = remaining.findIndex((card) => (
        card.rank === remembered.rank &&
        card.suit === remembered.suit &&
        (!entry.deckColor || card.deckColor === entry.deckColor)
      ));
      if (index < 0) {
        index = remaining.findIndex((card) => card.rank === remembered.rank && card.suit === remembered.suit);
      }
      if (index >= 0) remaining.splice(index, 1);
    }

    if (!remaining.length) return DEFAULT_UNKNOWN_POINTS;
    return remaining.reduce((sum, card) => sum + cardPoints(card), 0) / remaining.length;
  }

  function unknownExpectedPoints(bot) {
    const configured = botProfile(bot).expectedUnknownValue;
    return configured === 'counted' ? countedUnknownPoints(bot) : Number(configured) || DEFAULT_UNKNOWN_POINTS;
  }

  function botExpectedRoundScore(bot, player) {
    return playerSlots(bot, player).reduce((sum, slot) => sum + slot.expected, 0);
  }

  function botExpectedScore(bot, player) {
    return botExpectedRoundScore(bot, player);
  }

  function botRoundScoreConfidence(bot) {
    const slots = ownSlots(bot);
    return slots.length
      ? slots.reduce((sum, slot) => sum + (slot.memory.confidence || 0), 0) / slots.length
      : 1;
  }

  function knownHand(bot, player = bot) {
    const slots = playerSlots(bot, player);
    const allKnown = slots.every((slot) => slot.known);
    return {
      slots,
      allKnown,
      score: allKnown ? slots.reduce((sum, slot) => sum + cardPoints(slot.card), 0) : null
    };
  }

  function dangerWeights(bot) {
    const targets = opponents(bot);
    if (!targets.length) return [];
    const maxTotal = Math.max(...targets.map((player) => Math.max(0, Number(player.total) || 0)));
    const maxCards = Math.max(...targets.map((player) => player.cards.length));
    const totalWeights = targets.map((player) => maxTotal - Math.max(0, Number(player.total) || 0) + 1);
    const cardWeights = targets.map((player) => maxCards - player.cards.length + 1);
    const totalWeightSum = totalWeights.reduce((sum, value) => sum + value, 0);
    const cardWeightSum = cardWeights.reduce((sum, value) => sum + value, 0);
    return targets.map((player, index) => ({
      player,
      danger: 0.5 * totalWeights[index] / totalWeightSum +
        0.5 * cardWeights[index] / cardWeightSum
    })).sort((a, b) => b.danger - a.danger);
  }

  function dangerousOpponent(bot) {
    return pickBest(dangerWeights(bot), (entry) => entry.danger)?.player || null;
  }

  function halvingPlans(bot) {
    const profile = botProfile(bot);
    if (!profile.scoreHalvingAttempts) return [];
    const hand = knownHand(bot);
    if (!hand.allKnown) return [];
    const plans = [];
    for (const target of HALVING_TOTALS) {
      const halvedTotal = target / 2;
      const requiredRoundScore = target - bot.total;
      if (requiredRoundScore <= 0 || halvedTotal >= bot.total) continue;
      const ordinaryDistance = Math.abs(hand.score - requiredRoundScore);
      plans.push({
        type: 'ordinary',
        target,
        desiredHandScore: requiredRoundScore,
        distance: ordinaryDistance,
        probability: Math.max(0.05, 1 - ordinaryDistance / 14),
        benefit: bot.total - halvedTotal
      });
      if (requiredRoundScore % 2 === 0) {
        const desiredHandScore = requiredRoundScore / 2;
        const distance = Math.abs(hand.score - desiredHandScore);
        plans.push({
          type: 'wrong-dutch',
          target,
          desiredHandScore,
          distance,
          probability: Math.max(0.05, 1 - distance / 14),
          benefit: bot.total - halvedTotal
        });
      }
    }
    return plans.sort((a, b) => (
      b.probability * b.benefit - a.probability * a.benefit ||
      a.distance - b.distance
    ));
  }

  function activeHalvingPlan(bot) {
    const plan = halvingPlans(bot)[0] || null;
    if (!plan) return null;
    const hand = knownHand(bot);
    const normalWinProbability = hand.score <= DUTCH_MAX_POINTS ? 0.8 : Math.max(0.15, (18 - hand.score) / 24);
    const halvingValue = plan.probability * plan.benefit;
    const normalValue = normalWinProbability * Math.max(1, Math.min(hand.score, 10));
    return plan.distance <= 6 && halvingValue > normalValue ? plan : null;
  }

  function replacementTowardHalving(bot, incomingCard) {
    const plan = activeHalvingPlan(bot);
    if (!plan) return null;
    const hand = knownHand(bot);
    if (!hand.allKnown) return null;
    const incomingPoints = cardPoints(incomingCard);
    const candidates = hand.slots.map((slot) => {
      const after = hand.score - cardPoints(slot.card) + incomingPoints;
      return {
        ...slot,
        after,
        progress: Math.abs(hand.score - plan.desiredHandScore) -
          Math.abs(after - plan.desiredHandScore)
      };
    }).filter((slot) => slot.progress > 0);
    return pickBest(candidates, (slot) => slot.progress);
  }

  function standardSwapTarget(bot, incomingCard, options = {}) {
    const slots = ownSlots(bot);
    if (!slots.length) return null;
    const incomingPoints = cardPoints(incomingCard);
    const round = state().round || {};
    const unknown = slots.filter((slot) => !slot.known);

    if (!round.dutchCallerId && unknown.length) {
      const queen = slots.filter((slot) => slot.known && slot.card.rank === 'Q');
      if (queen.length) return pickRandom(queen);
      return pickRandom(unknown);
    }

    const better = slots.filter((slot) => slot.expected > incomingPoints);
    if (better.length) return pickBest(better, (slot) => slot.expected);
    return options.required ? pickBest(slots, (slot) => slot.expected) : null;
  }

  function botBestSwapTarget(bot, incomingCard, options = {}) {
    if (!incomingCard) return null;
    const halvingTarget = replacementTowardHalving(bot, incomingCard);
    const target = halvingTarget || standardSwapTarget(bot, incomingCard, options);
    if (!target) return null;
    return {
      ...target,
      improvement: target.expected - cardPoints(incomingCard),
      actionValue: target.expected - cardPoints(incomingCard),
      utility: target.expected - cardPoints(incomingCard),
      eligible: true
    };
  }

  function botSwapTargets(bot, incomingCard, options = {}) {
    const selected = botBestSwapTarget(bot, incomingCard, options);
    const slots = ownSlots(bot).map((slot) => ({
      ...slot,
      improvement: slot.expected - cardPoints(incomingCard),
      actionValue: slot.expected - cardPoints(incomingCard),
      utility: slot.expected - cardPoints(incomingCard),
      eligible: true
    }));
    return slots.sort((a, b) => (
      (selected && a.index === selected.index ? -1 : 0) -
      (selected && b.index === selected.index ? -1 : 0) ||
      b.actionValue - a.actionValue
    ));
  }

  function shouldBotTakePile(bot) {
    const round = state().round;
    const top = round && round.discard && round.discard.at(-1);
    if (!top) return false;
    if (replacementTowardHalving(bot, top)) return true;
    const points = cardPoints(top);
    if (points > PILE_MAX_POINTS || points >= unknownExpectedPoints(bot)) return false;
    const target = standardSwapTarget(bot, top, { required: false });
    return !!target && target.expected > points;
  }

  function evaluateDrawSources(bot) {
    const takePile = shouldBotTakePile(bot);
    const selected = {
      actionType: takePile ? 'take-pile' : 'take-deck',
      actionValue: takePile ? 1 : 0,
      utility: takePile ? 1 : 0
    };
    return { selected, actions: [selected] };
  }

  function botDeckCardDecision(bot, drawnCard) {
    const swapTarget = botBestSwapTarget(bot, drawnCard, { required: false });
    return {
      actionType: swapTarget ? 'swap-drawn' : 'discard-drawn',
      actionValue: swapTarget ? swapTarget.improvement : 0,
      swapTarget
    };
  }

  function shouldBotSwapDrawn(bot, drawnCard) {
    return !!botDeckCardDecision(bot, drawnCard).swapTarget;
  }

  function botAceTarget(bot) {
    const target = dangerousOpponent(bot);
    return target ? {
      player: target,
      aceScore: dangerWeights(bot).find((entry) => entry.player.id === target.id)?.danger || 0,
      actionValue: 1,
      utility: 1,
      eligible: true
    } : null;
  }

  function botQueenTargets(bot) {
    const ownUnknown = ownSlots(bot).filter((slot) => !slot.known);
    const opponentUnknown = [];
    for (const threat of dangerWeights(bot)) {
      for (const slot of playerSlots(bot, threat.player)) {
        if (!slot.known && !isProtectedSpecialTarget(threat.player.id)) {
          opponentUnknown.push({ ...slot, danger: threat.danger });
        }
      }
    }
    return { ownUnknown, opponentUnknown };
  }

  function botQueenTarget(bot) {
    const targets = botQueenTargets(bot);
    if (targets.ownUnknown.length) return pickRandom(targets.ownUnknown);
    if (!targets.opponentUnknown.length) return null;
    const highestDanger = Math.max(...targets.opponentUnknown.map((slot) => slot.danger));
    return pickRandom(targets.opponentUnknown.filter((slot) => Math.abs(slot.danger - highestDanger) <= EPSILON));
  }

  function knownSlotsForJack(bot, player) {
    return playerSlots(bot, player).filter((slot) => slot.known);
  }

  function jackCandidate(a, b, type, utility) {
    return {
      a,
      b,
      type,
      utility,
      actionValue: utility,
      eligible: true
    };
  }

  function botJackCandidates(bot) {
    const own = ownSlots(bot);
    const ownUnknown = own.filter((slot) => !slot.known);
    const ownKnown = own.filter((slot) => slot.known);
    const opponentKnown = opponents(bot).flatMap((player) => (
      isProtectedSpecialTarget(player.id) ? [] : knownSlotsForJack(bot, player)
    ));
    const lowestOpponent = opponentKnown.length
      ? pickBest(opponentKnown, (slot) => cardPoints(slot.card), 'min')
      : null;

    if (lowestOpponent && ownUnknown.length && cardPoints(lowestOpponent.card) < unknownExpectedPoints(bot)) {
      const ownTarget = pickRandom(ownUnknown);
      return [jackCandidate(ownTarget, lowestOpponent, 'self', unknownExpectedPoints(bot) - cardPoints(lowestOpponent.card))];
    }

    if (lowestOpponent && ownKnown.length) {
      const highestOwn = pickBest(ownKnown, (slot) => cardPoints(slot.card));
      const improvement = cardPoints(highestOwn.card) - cardPoints(lowestOpponent.card);
      if (improvement > 0) return [jackCandidate(highestOwn, lowestOpponent, 'self', improvement)];
    }

    const ranked = dangerWeights(bot).filter((entry) => !isProtectedSpecialTarget(entry.player.id));
    if (ranked.length >= 2) {
      const firstSlots = playerSlots(bot, ranked[0].player);
      const secondSlots = playerSlots(bot, ranked[1].player);
      const preferred = (player, slots) => {
        const humanKnown = slots.filter((slot) => (
          !player.isBot &&
          effectiveHumanMemory(bot, player.id, player.id, slot.index).card
        ));
        const botKnown = slots.filter((slot) => slot.known);
        return pickRandom(humanKnown.length ? humanKnown : (botKnown.length ? botKnown : slots));
      };
      const a = preferred(ranked[0].player, firstSlots);
      const b = preferred(ranked[1].player, secondSlots);
      return a && b ? [jackCandidate(a, b, 'confuse', 1)] : [];
    }

    if (ranked.length === 1) {
      const slots = playerSlots(bot, ranked[0].player);
      const knownToOpponent = slots.filter((slot) => (
        !ranked[0].player.isBot &&
        effectiveHumanMemory(bot, ranked[0].player.id, ranked[0].player.id, slot.index).card
      ));
      const pool = knownToOpponent.length >= 2 ? knownToOpponent : slots;
      if (pool.length >= 2) {
        const a = pickRandom(pool);
        const b = pickRandom(pool.filter((slot) => slot.index !== a.index));
        return [jackCandidate(a, b, 'confuse', 1)];
      }
    }
    return [];
  }

  function opponentKnownScore(bot, player) {
    return knownHand(bot, player);
  }

  function deliberateWrongDutch(bot) {
    const plan = activeHalvingPlan(bot);
    const hand = knownHand(bot);
    if (!plan || plan.type !== 'wrong-dutch' || !hand.allKnown || hand.score !== plan.desiredHandScore) return false;
    if (hand.score > DUTCH_MAX_POINTS) return true;
    return opponents(bot).some((player) => {
      const opponentHand = opponentKnownScore(bot, player);
      return opponentHand.allKnown && opponentHand.score < hand.score;
    });
  }

  function botShouldCallDutch(bot) {
    if (deliberateWrongDutch(bot)) return true;
    const hand = knownHand(bot);
    const plan = activeHalvingPlan(bot);
    if (plan && plan.type === 'ordinary' && hand.score === plan.desiredHandScore) return false;
    return hand.allKnown && hand.score <= DUTCH_MAX_POINTS;
  }

  function botThrowInCandidate(bot) {
    const round = state().round;
    if (!round || !round.throwIn || !round.throwIn.open) return null;
    const candidates = ownSlots(bot).filter((slot) => (
      slot.known &&
      slot.card.rank === round.throwIn.rank &&
      !(slot.card.rank === 'K' && isRedSuit(slot.card.suit))
    ));
    if (!candidates.length) return null;
    const selected = pickBest(candidates, (slot) => cardPoints(slot.card));
    return {
      ...selected,
      confidence: selected.memory.confidence || 1,
      expectedValue: cardPoints(selected.card),
      actionValue: cardPoints(selected.card),
      utility: cardPoints(selected.card),
      eligible: true
    };
  }

  function botReactionDelay(bot, confidence) {
    const profile = botProfile(bot);
    return Math.round(
      450 + (profile.slow || 0) * 1200 - (profile.fast || 0) * 260 +
      (1 - confidence) * 1100 + randomBetween(0, 850)
    );
  }

  function botBestOwnSlot(bot, mode = 'highest') {
    const slots = ownSlots(bot);
    return pickBest(slots, (slot) => slot.expected, mode === 'lowest' ? 'min' : 'max');
  }

  function botLowOpponentSlot(bot) {
    const slots = opponents(bot).flatMap((player) => playerSlots(bot, player)).filter((slot) => slot.known);
    return pickBest(slots, (slot) => slot.expected, 'min');
  }

  function botOpponentEstimates(bot) {
    return opponents(bot).map((player) => ({
      player,
      expected: botExpectedRoundScore(bot, player),
      cards: player.cards.length,
      total: player.total
    })).sort((a, b) => a.expected - b.expected);
  }

  function botRiskMode(bot) {
    const estimates = botOpponentEstimates(bot);
    if (!estimates.length) return 'middle';
    const bestTotal = Math.min(...estimates.map((entry) => entry.total));
    const worstTotal = Math.max(...estimates.map((entry) => entry.total));
    if (bot.total <= bestTotal) return 'ahead';
    if (bot.total >= worstTotal) return 'behind';
    return 'middle';
  }

  function botThrowThreshold() {
    return 1;
  }

  function rankStatsForBot(bot, rank) {
    const total = (state().deckSetting === 'two' ? 2 : 1) * 4;
    const seen = rememberedCardEntries(bot).filter((entry) => entry.card.rank === rank).length;
    return { seen: Math.min(total, seen), total, remaining: Math.max(0, total - seen) };
  }

  function expectedEntryPoints(bot, entry) {
    return entry && entry.card ? cardPoints(entry.card) : unknownExpectedPoints(bot);
  }

  function specialActionValue(bot, card) {
    if (!card) return 0;
    if (card.rank === 'A') return opponents(bot).length ? 1 : 0;
    if (card.rank === 'Q') return botQueenTarget(bot) ? 1 : 0;
    if (card.rank === 'J') return botJackCandidates(bot).length ? 1 : 0;
    return 0;
  }

  return {
    unknownExpectedPoints,
    countedUnknownPoints,
    recallEntry,
    dangerWeights,
    activeHalvingPlan,
    deliberateWrongDutch,
    botOwnSlots: ownSlots,
    botExpectedRoundScore,
    botExpectedScore,
    botRoundScoreConfidence,
    botSwapTargets,
    botBestSwapTarget,
    shouldBotTakePile,
    evaluateDrawSources,
    botDeckCardDecision,
    shouldBotSwapDrawn,
    botAceTarget,
    botQueenTargets,
    botQueenTarget,
    botJackCandidates,
    botShouldCallDutch,
    botThrowInCandidate,
    botReactionDelay,
    botBestOwnSlot,
    botLowOpponentSlot,
    botOpponentEstimates,
    botRiskMode,
    botThrowThreshold,
    rankStatsForBot,
    expectedEntryPoints,
    expectedEntryRawPoints: expectedEntryPoints,
    specialActionValue
  };
}

module.exports = { createSimpleDecisionLayer };
