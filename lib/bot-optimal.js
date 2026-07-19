const { cardPoints, SPECIAL_RANKS } = require('../public/shared.js');
const { publicMemoryCard, botProfile } = require('./bot-strategy.js');
const { chooseCharacterAction, strategyLimits } = require('./bot-character.js');
const {
  buildBeliefState,
  slotCardDistribution,
  slotPointDistribution,
  convolveScoreDistributions,
  distributionMoments
} = require('./bot-belief-state.js');
const {
  evaluateAction,
  mixActionEvaluations,
  scoreAfterRound,
  probabilityAtLeast,
  probabilityAtMost
} = require('./bot-evaluator.js');

const SPECIALS = new Set(SPECIAL_RANKS);

function seedFromText(text) {
  let hash = 2166136261;
  for (const character of String(text)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let next = value;
    next = Math.imul(next ^ next >>> 15, next | 1);
    next ^= next + Math.imul(next ^ next >>> 7, next | 61);
    return ((next ^ next >>> 14) >>> 0) / 4294967296;
  };
}

function entropy(distribution) {
  return (distribution || []).reduce((sum, item) => {
    const probability = item.probability || 0;
    return probability > 0 ? sum - probability * Math.log2(probability) : sum;
  }, 0);
}

function deterministicPointDistribution(points) {
  return [{ value: points, probability: 1 }];
}

function addPointDistributions(base, added) {
  return convolveScoreDistributions(base, added);
}

function createOptimalDecisionLayer(deps) {
  const {
    getState,
    ensureBotMemory,
    botMemoryEntry,
    effectiveMemory,
    activePlayablePlayers,
    isProtectedSpecialTarget,
    findActiveIndexFrom,
    randomBetween
  } = deps;
  const random = deps.random || Math.random;

  function contextFor(bot) {
    const state = getState();
    const memory = ensureBotMemory(bot);
    const belief = buildBeliefState({ state, bot, memory, effectiveMemory });
    const slotCardCache = new Map();
    const slotCache = new Map();
    const scoreCache = new Map();
    const withoutSlotCache = new Map();
    const slotDistributionFor = (player, index) => {
      const key = player.id + ':' + index;
      if (!slotCache.has(key)) {
        const entry = botMemoryEntry(bot, player.id, index);
        let effective = effectiveMemory(bot, entry);
        if (player.id !== bot.id) {
          const accuracy = botProfile(bot).opponentModelAccuracy ?? 1;
          effective = {
            ...effective,
            confidence: (effective.confidence || 0) * accuracy,
            distribution: (effective.distribution || []).map((candidate) => ({
              ...candidate,
              probability: candidate.probability * accuracy
            }))
          };
        }
        slotCache.set(key, slotPointDistribution(effective, belief.drawDistribution));
      }
      return slotCache.get(key);
    };
    const slotCardDistributionFor = (player, index) => {
      const key = player.id + ':' + index;
      if (!slotCardCache.has(key)) {
        const entry = botMemoryEntry(bot, player.id, index);
        let effective = effectiveMemory(bot, entry);
        if (player.id !== bot.id) {
          const accuracy = botProfile(bot).opponentModelAccuracy ?? 1;
          effective = {
            ...effective,
            confidence: (effective.confidence || 0) * accuracy,
            distribution: (effective.distribution || []).map((candidate) => ({
              ...candidate,
              probability: candidate.probability * accuracy
            }))
          };
        }
        slotCardCache.set(key, slotCardDistribution(effective, belief.drawDistribution));
      }
      return slotCardCache.get(key);
    };
    const scoreDistributionFor = (player, overrides = new Map()) => {
      if (overrides.size === 0 && scoreCache.has(player.id)) return scoreCache.get(player.id);
      let distribution = [{ value: 0, probability: 1 }];
      for (let index = 0; index < player.cards.length; index += 1) {
        if (overrides.has(index) && overrides.get(index) === null) continue;
        const slot = overrides.has(index) ? overrides.get(index) : slotDistributionFor(player, index);
        distribution = convolveScoreDistributions(distribution, slot);
      }
      if (overrides.size === 0) scoreCache.set(player.id, distribution);
      return distribution;
    };
    const scoreWithoutSlotFor = (player, removedIndex) => {
      const key = player.id + ':' + removedIndex;
      if (!withoutSlotCache.has(key)) {
        let distribution = [{ value: 0, probability: 1 }];
        for (let index = 0; index < player.cards.length; index += 1) {
          if (index !== removedIndex) distribution = convolveScoreDistributions(distribution, slotDistributionFor(player, index));
        }
        withoutSlotCache.set(key, distribution);
      }
      return withoutSlotCache.get(key);
    };
    const opponents = activePlayablePlayers().filter((player) => player.id !== bot.id);
    return { state, bot, memory, belief, slotCardDistributionFor, slotDistributionFor, scoreDistributionFor, scoreWithoutSlotFor, opponents };
  }

  function opponentDistributions(ctx, overrides = new Map()) {
    return ctx.opponents.map((player) => {
      const base = overrides.get(player.id) || ctx.scoreDistributionFor(player);
      const inference = ctx.memory && ctx.memory.inference && ctx.memory.inference[player.id];
      const accuracy = botProfile(ctx.bot).opponentModelAccuracy ?? 1;
      const shift = inference
        ? Math.max(-1.5, Math.min(3, (inference.lowCardBelief || 0) + (inference.dutchReadiness || 0) * 2)) * accuracy
        : 0;
      const distribution = shift
        ? base.map((item) => ({ ...item, value: Math.max(0, item.value - shift) }))
        : base;
      return { player, distribution };
    });
  }

  function currentEvaluation(bot, actionType = 'hold', options = {}) {
    const ctx = options.context || contextFor(bot);
    return evaluateAction({
      state: ctx.state,
      bot,
      actionType,
      ownDistribution: options.ownDistribution || ctx.scoreDistributionFor(bot),
      opponentDistributions: options.opponentDistributions || opponentDistributions(ctx),
      callerId: options.callerId || null,
      informationValue: options.informationValue || 0,
      opponentBenefit: options.opponentBenefit || 0,
      immediatePointReduction: options.immediatePointReduction || 0,
      futureThrowInScoreSaving: options.futureThrowInScoreSaving || 0,
      extraVariance: options.extraVariance || 0,
      turnsRemaining: options.turnsRemaining,
      metadata: options.metadata || {}
    });
  }

  function rounded(value) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
  }

  function compactEvaluation(action) {
    if (!action) return null;
    const metadata = action.metadata || {};
    return {
      actionType: action.actionType,
      value: rounded(action.actionValue),
      expectedRoundScore: rounded(action.expectedRoundScore),
      expectedRawHandScore: rounded(action.expectedRawHandScore),
      expectedGameScore: rounded(action.expectedGameScore),
      estimatedWinProbability: rounded(action.estimatedWinProbability),
      roundWinProbability: rounded(action.roundWinProbability),
      dutchSuccessProbability: rounded(action.dutchSuccessProbability),
      opponentCallFirstProbability: rounded(action.opponentCallFirstProbability),
      opponentCallCost: rounded(action.opponentCallCost),
      immediateDutchOptionValue: rounded(action.immediateDutchOptionValue),
      futureThrowInScoreSaving: rounded(action.futureThrowInScoreSaving),
      actionVariance: rounded(action.actionVariance),
      index: Number.isInteger(metadata.index) ? metadata.index : null,
      source: metadata.source || null,
      callerId: metadata.callerId || null,
      samples: metadata.samples || null,
      searchDepth: metadata.searchDepth || null,
      opponentCallBeforeNextProbability: rounded(metadata.opponentCallBeforeNextProbability),
      branchProbabilities: metadata.branchProbabilities || null
    };
  }

  function diagnosticCard(card) {
    return card ? {
      rank: card.rank,
      suit: card.suit,
      points: cardPoints(card)
    } : null;
  }

  function recordDecisionDiagnostic(bot, type, actions, selected, details = {}) {
    const state = getState();
    if (!state || !state.round || !bot) return;
    if (!Array.isArray(state.botDiagnostics)) state.botDiagnostics = [];
    if (state.botDiagnostics.length >= 5000) {
      state.botDiagnostics.shift();
      state.botDiagnosticsDropped = (state.botDiagnosticsDropped || 0) + 1;
    }
    state.botDiagnostics.push({
      round: state.roundNumber,
      strategyTick: state.round.strategyTick ?? state.round.botTick ?? 0,
      botId: bot.id,
      botName: bot.name,
      botType: bot.botType,
      decision: type,
      selected: selected ? selected.actionType : null,
      actualHands: activePlayablePlayers().map((player) => ({
        playerId: player.id,
        playerName: player.name,
        total: player.total,
        score: handScore(player.cards),
        cards: player.cards.map(diagnosticCard)
      })),
      topDiscard: diagnosticCard(state.round.discard && state.round.discard.at(-1)),
      actions: (actions || []).map(compactEvaluation),
      ...details
    });
  }

  function unknownExpectedPoints(bot = null) {
    if (!bot || !getState().round) return 6.4;
    return contextFor(bot).belief.expectedDrawPoints || 6.4;
  }

  function rankStatsForBot(bot, rank) {
    const state = getState();
    const total = (state.deckSetting === 'two' ? 2 : 1) * 4;
    const remaining = contextFor(bot).belief.rankRemaining[rank] || 0;
    return { seen: Math.max(0, total - remaining), total, remaining };
  }

  function rankDiscardPressure(bot, rank) {
    const ctx = contextFor(bot);
    let pressure = 0;
    for (const player of ctx.opponents) {
      for (let index = 0; index < player.cards.length; index += 1) {
        const memory = effectiveMemory(bot, botMemoryEntry(bot, player.id, index));
        const rankProbability = memory.card && memory.card.rank === rank
          ? memory.confidence
          : (memory.distribution || []).reduce((sum, item) => sum + (item.card.rank === rank ? item.probability : 0), 0);
        pressure += rankProbability * (0.25 + Math.min(1, distributionMoments(ctx.slotDistributionFor(player, index)).mean / 10));
      }
    }
    return pressure;
  }

  function throwInPotentialValue(bot, card) {
    if (!card || !card.rank) return 0;
    const ctx = contextFor(bot);
    const chance = ctx.belief.probabilityOfRank(card.rank);
    const futureTurns = Math.max(1, currentEvaluation(bot, 'future-throw', { context: ctx }).turnsRemaining);
    return chance * Math.min(1, futureTurns / 4) * (0.4 + cardPoints(card) * 0.12);
  }

  function nextPlayer(bot) {
    const state = getState();
    if (!state.round || !state.players.length) return null;
    const index = findActiveIndexFrom((state.round.currentPlayerIndex + 1) % state.players.length);
    return index >= 0 ? state.players[index] : null;
  }

  function expectedHighestMatchingPoints(distributions, rank) {
    const candidates = (distributions || []).map((distribution) => {
      let probability = 0;
      let weightedPoints = 0;
      for (const item of distribution || []) {
        if (!item.card || item.card.rank !== rank) continue;
        probability += item.probability || 0;
        weightedPoints += (item.probability || 0) * cardPoints(item.card);
      }
      return {
        probability: Math.max(0, Math.min(1, probability)),
        points: probability > 0 ? weightedPoints / probability : 0
      };
    }).filter((candidate) => candidate.probability > 0)
      .sort((a, b) => b.points - a.points);
    let noneHigherMatched = 1;
    let expected = 0;
    for (const candidate of candidates) {
      expected += noneHigherMatched * candidate.probability * candidate.points;
      noneHigherMatched *= 1 - candidate.probability;
    }
    return expected;
  }

  function opponentThrowInBenefit(bot, card, suppliedContext = null) {
    if (!card || !card.rank) return 0;
    const ctx = suppliedContext || contextFor(bot);
    const distributions = ctx.opponents.flatMap((player) => (
      player.cards.map((_, index) => ctx.slotCardDistributionFor(player, index))
    ));
    return expectedHighestMatchingPoints(distributions, card.rank);
  }

  function discardGiftPenalty(bot, card, suppliedContext = null) {
    if (!card) return 0;
    const next = nextPlayer(bot);
    if (!next || next.id === bot.id) return 0;
    const ctx = suppliedContext || contextFor(bot);
    const points = cardPoints(card);
    const nextScore = distributionMoments(ctx.scoreDistributionFor(next)).mean;
    const replaceable = next.cards.length ? nextScore / next.cards.length * 1.35 : 0;
    const direct = Math.max(0, replaceable - points);
    const callable = nextScore <= 8 ? Math.max(0, 5 - points) * 0.28 : 0;
    const special = SPECIALS.has(card.rank) ? specialStateValue(bot, card, ctx) * 0.12 : 0;
    const throwIn = opponentThrowInBenefit(bot, card, ctx);
    return direct * 0.45 + callable + special + throwIn;
  }

  function cardStrategicCost(bot, card) {
    if (!card) return unknownExpectedPoints(bot);
    return cardPoints(card) - throwInPotentialValue(bot, card);
  }

  function botOwnSlots(bot) {
    ensureBotMemory(bot);
    return bot.cards.map((card, index) => ({ player: bot, index, card, memory: botMemoryEntry(bot, bot.id, index) }));
  }

  function expectedEntryRawPoints(bot, entry) {
    const ctx = contextFor(bot);
    return distributionMoments(slotPointDistribution(effectiveMemory(bot, entry), ctx.belief.drawDistribution)).mean;
  }

  function expectedEntryPoints(bot, entry) {
    return expectedEntryRawPoints(bot, entry);
  }

  function botExpectedRoundScore(bot, player) {
    return distributionMoments(contextFor(bot).scoreDistributionFor(player)).mean;
  }

  function botExpectedScore(bot, player) {
    return botExpectedRoundScore(bot, player);
  }

  function botRoundScoreConfidence(bot) {
    const slots = botOwnSlots(bot);
    if (!slots.length) return 1;
    return slots.reduce((sum, slot) => sum + (effectiveMemory(bot, slot.memory).confidence || 0), 0) / slots.length;
  }

  function totalHalvingBonus(bot, projectedRoundScore) {
    const ordinary = bot.total + projectedRoundScore;
    const scored = scoreAfterRound(bot.total, projectedRoundScore);
    return Math.max(0, ordinary - scored);
  }

  function botDeliberateDutchHalving(bot) {
    const result = evaluateDutch(bot);
    return result.call.actionValue > result.continue.actionValue;
  }

  function specialStateValue(bot, card, suppliedContext = null) {
    if (!card || !SPECIALS.has(card.rank)) return 0;
    const ctx = suppliedContext || contextFor(bot);
    if (card.rank === 'Q') {
      const targets = allSlotTargets(bot, ctx);
      return targets.length ? Math.max(...targets.map((target) => target.informationValue)) : 0;
    }
    if (card.rank === 'A') {
      if (!ctx.opponents.length) return 0;
      return ctx.belief.expectedDrawPoints * Math.max(...ctx.opponents.map((player) => 1 / Math.max(1, player.cards.length)));
    }
    if (card.rank === 'J') {
      const own = bot.cards.map((_, index) => distributionMoments(ctx.slotDistributionFor(bot, index)).mean);
      const opponent = ctx.opponents.flatMap((player) => player.cards.map((_, index) => distributionMoments(ctx.slotDistributionFor(player, index)).mean));
      return own.length && opponent.length ? Math.max(0, Math.max(...own) - Math.min(...opponent)) : 0;
    }
    return 0;
  }

  function specialActionValue(bot, card) {
    return specialStateValue(bot, card);
  }

  function knownOwnCardUtility(bot, effective) {
    if (!effective || (!effective.card && !(effective.distribution || []).length)) return 0;
    return (effective.confidence || 0) * entropy(effective.distribution || []);
  }

  function discardSpecialEffects(bot, discarded, ctx) {
    if (!discarded || !SPECIALS.has(discarded.rank)) return { informationValue: 0, opponentBenefit: 0 };
    if (discarded.rank === 'Q') return { informationValue: specialStateValue(bot, discarded, ctx), opponentBenefit: 0 };
    if (discarded.rank === 'A') return { informationValue: 0, opponentBenefit: -specialStateValue(bot, discarded, ctx) };
    if (discarded.rank === 'J') return { informationValue: specialStateValue(bot, discarded, ctx) * 0.65, opponentBenefit: -specialStateValue(bot, discarded, ctx) * 0.35 };
    return { informationValue: 0, opponentBenefit: 0 };
  }

  function rankProbability(distribution, rank) {
    return (distribution || []).reduce((sum, item) => (
      sum + (item.card && item.card.rank === rank ? item.probability || 0 : 0)
    ), 0);
  }

  function drawPointDistribution(ctx) {
    return ctx.belief.drawDistribution.map((item) => ({
      value: cardPoints(item.card),
      probability: item.probability
    }));
  }

  function replacementThrowInCandidates(bot, incomingCard, replacementIndex, rank, ctx) {
    const incomingPoints = deterministicPointDistribution(cardPoints(incomingCard));
    return bot.cards.map((_, index) => {
      const cardDistribution = index === replacementIndex
        ? [{ card: publicMemoryCard(incomingCard), probability: 1 }]
        : ctx.slotCardDistributionFor(bot, index);
      const confidence = rankProbability(cardDistribution, rank);
      return {
        index,
        confidence,
        expectedMatchingPoints: cardDistribution.reduce((sum, item) => (
          sum + (item.card && item.card.rank === rank ? (item.probability || 0) * cardPoints(item.card) : 0)
        ), 0)
      };
    }).filter((candidate) => (
      candidate.confidence >= 0.999 ||
      candidate.expectedMatchingPoints > (1 - candidate.confidence) * ctx.belief.expectedDrawPoints
    )).map((candidate) => {
      const overrides = new Map([[replacementIndex, incomingPoints]]);
      overrides.set(candidate.index, null);
      return {
        ...candidate,
        successDistribution: ctx.scoreDistributionFor(bot, overrides)
      };
    });
  }

  function deckDiscardThrowInCandidates(bot, rank, ctx) {
    return bot.cards.map((_, index) => {
      const cardDistribution = ctx.slotCardDistributionFor(bot, index);
      return {
        index,
        confidence: rankProbability(cardDistribution, rank),
        expectedMatchingPoints: cardDistribution.reduce((sum, item) => (
          sum + (item.card && item.card.rank === rank ? (item.probability || 0) * cardPoints(item.card) : 0)
        ), 0)
      };
    }).filter((candidate) => (
      candidate.confidence >= 0.999 ||
      candidate.expectedMatchingPoints > (1 - candidate.confidence) * ctx.belief.expectedDrawPoints
    )).map((candidate) => ({
      ...candidate,
      successDistribution: ctx.scoreWithoutSlotFor(bot, candidate.index)
    }));
  }

  function duplicateRankRetainValue(distributions) {
    let pairedValue = 0;
    for (let index = 0; index < distributions.length; index += 1) {
      const otherSlots = distributions.filter((_, candidate) => candidate !== index);
      for (const item of distributions[index] || []) {
        if (!item.card || (item.probability || 0) <= 0) continue;
        pairedValue += (item.probability || 0) *
          expectedHighestMatchingPoints(otherSlots, item.card.rank);
      }
    }
    // Each pair is encountered once from each side.
    return pairedValue / 2;
  }

  function futureHandPairSaving(bot, distributions, turnsRemaining) {
    if (distributions.length <= 1) return 0;
    const botTurns = Math.max(0, turnsRemaining / Math.max(1, activePlayablePlayers().length));
    const releaseProbability = 1 - Math.pow(
      1 - 1 / distributions.length,
      botTurns
    );
    return duplicateRankRetainValue(distributions) * releaseProbability;
  }

  function futureReplacementThrowInSaving(bot, incomingCard, replacementIndex, ctx, turnsRemaining) {
    const matchingDistributions = bot.cards
      .map((_, index) => index === replacementIndex ? null : ctx.slotCardDistributionFor(bot, index))
      .filter(Boolean);
    const matchingPoints = expectedHighestMatchingPoints(matchingDistributions, incomingCard.rank);
    if (matchingPoints <= 0 || bot.cards.length <= 1) return 0;
    const afterMean = distributionMoments(ctx.scoreDistributionFor(
      bot,
      new Map([[replacementIndex, deterministicPointDistribution(cardPoints(incomingCard))]])
    )).mean;
    const replacementShare = Math.max(0, Math.min(
      1,
      (cardPoints(incomingCard) + 1) / Math.max(1, afterMean + bot.cards.length)
    ));
    const botTurns = Math.max(0, turnsRemaining / Math.max(1, activePlayablePlayers().length));
    const releaseProbability = 1 - Math.pow(1 - replacementShare, botTurns);
    return matchingPoints * releaseProbability;
  }

  function evaluateImmediateThrowInFollowUp(bot, ctx, options) {
    const {
      actionType,
      rank,
      base,
      baseOwnDistribution,
      beforeMean,
      candidates,
      informationValue,
      opponentBenefit,
      futureThrowInScoreSaving,
      metadata
    } = options;
    if (!rank || !candidates.length) return base;
    const penaltyPoints = drawPointDistribution(ctx);
    const failureDistribution = addPointDistributions(baseOwnDistribution, penaltyPoints);
    let best = base;
    for (const candidate of candidates) {
      const success = currentEvaluation(bot, actionType + '-throw-success', {
        context: ctx,
        ownDistribution: candidate.successDistribution,
        informationValue,
        opponentBenefit,
        immediatePointReduction: beforeMean - distributionMoments(candidate.successDistribution).mean,
        futureThrowInScoreSaving
      });
      const failure = currentEvaluation(bot, actionType + '-throw-failure', {
        context: ctx,
        ownDistribution: failureDistribution,
        informationValue,
        opponentBenefit,
        immediatePointReduction: beforeMean - distributionMoments(failureDistribution).mean,
        futureThrowInScoreSaving,
        extraVariance: distributionMoments(penaltyPoints).variance
      });
      const mixed = mixActionEvaluations(actionType, [
        { probability: candidate.confidence, evaluation: success },
        { probability: 1 - candidate.confidence, evaluation: failure }
      ], {
        ...metadata,
        throwInFollowUp: {
          index: candidate.index,
          rank,
          confidence: candidate.confidence,
          expectedMatchingPoints: candidate.expectedMatchingPoints
        }
      });
      if (mixed.actionValue > best.actionValue) best = mixed;
    }
    return best;
  }

  function evaluateReplacement(bot, incomingCard, index, options = {}) {
    const ctx = options.context || contextFor(bot);
    const before = ctx.scoreDistributionFor(bot);
    const beforeMean = distributionMoments(before).mean;
    const ownDistribution = convolveScoreDistributions(
      ctx.scoreWithoutSlotFor(bot, index),
      deterministicPointDistribution(cardPoints(incomingCard))
    );
    const afterMean = distributionMoments(ownDistribution).mean;
    const entry = effectiveMemory(bot, botMemoryEntry(bot, bot.id, index));
    const discarded = entry.card || null;
    const special = discardSpecialEffects(bot, discarded, ctx);
    const gift = discarded ? discardGiftPenalty(bot, discarded, ctx) : 0.35;
    const actionType = options.actionType || 'replace';
    const metadata = { index, incomingCard: publicMemoryCard(incomingCard), discarded, source: options.source || '' };
    const hold = currentEvaluation(bot, 'hold', { context: ctx });
    const futureThrowInScoreSaving = futureReplacementThrowInSaving(
      bot,
      incomingCard,
      index,
      ctx,
      hold.turnsRemaining
    );
    const base = currentEvaluation(bot, actionType, {
      context: ctx,
      ownDistribution,
      informationValue: special.informationValue,
      opponentBenefit: gift + special.opponentBenefit,
      immediatePointReduction: beforeMean - afterMean,
      futureThrowInScoreSaving,
      metadata
    });
    const evaluation = discarded
      ? evaluateImmediateThrowInFollowUp(bot, ctx, {
        actionType,
        rank: discarded.rank,
        base,
        baseOwnDistribution: ownDistribution,
        beforeMean,
        candidates: replacementThrowInCandidates(bot, incomingCard, index, discarded.rank, ctx),
        informationValue: special.informationValue,
        opponentBenefit: gift + special.opponentBenefit,
        futureThrowInScoreSaving,
        metadata
      })
      : base;
    return {
      player: bot,
      index,
      card: bot.cards[index],
      memory: botMemoryEntry(bot, bot.id, index),
      expected: distributionMoments(ctx.slotDistributionFor(bot, index)).mean,
      improvement: evaluation.actionValue - hold.actionValue,
      confidence: entry.confidence || 0,
      ...evaluation
    };
  }

  function botSwapTargets(bot, incomingCard, options = {}) {
    if (!incomingCard) return [];
    const ctx = options.context || contextFor(bot);
    return bot.cards.map((_, index) => evaluateReplacement(bot, incomingCard, index, { ...options, context: ctx }))
      .sort((a, b) => b.actionValue - a.actionValue || a.index - b.index);
  }

  function botBestSwapTarget(bot, incomingCard) {
    const targets = botSwapTargets(bot, incomingCard);
    const selected = chooseCharacterAction(bot, targets, random);
    if (selected && ensureBotMemory(bot)) ensureBotMemory(bot).lastDecision = { type: 'replace', actions: targets, selected };
    return selected;
  }

  function evaluateDeckDiscard(bot, drawnCard, ctx) {
    const special = discardSpecialEffects(bot, drawnCard, ctx);
    const before = ctx.scoreDistributionFor(bot);
    const beforeMean = distributionMoments(before).mean;
    const opponentBenefit = discardGiftPenalty(bot, drawnCard, ctx) + special.opponentBenefit;
    const metadata = { drawnCard: publicMemoryCard(drawnCard), response: 'discard' };
    const base = currentEvaluation(bot, 'discard-drawn', {
      context: ctx,
      informationValue: special.informationValue,
      opponentBenefit,
      metadata
    });
    return evaluateImmediateThrowInFollowUp(bot, ctx, {
      actionType: 'discard-drawn',
      rank: drawnCard.rank,
      base,
      baseOwnDistribution: before,
      beforeMean,
      candidates: deckDiscardThrowInCandidates(bot, drawnCard.rank, ctx),
      informationValue: special.informationValue,
      opponentBenefit,
      futureThrowInScoreSaving: 0,
      metadata
    });
  }

  function bestResponseToDeckCard(bot, drawnCard, ctx) {
    const discard = evaluateDeckDiscard(bot, drawnCard, ctx);
    const swaps = botSwapTargets(bot, drawnCard, { context: ctx, actionType: 'swap-drawn', source: 'deck' });
    return [discard, ...swaps].sort((a, b) => b.actionValue - a.actionValue)[0];
  }

  function evaluateDrawSources(bot) {
    const ctx = contextFor(bot);
    const round = ctx.state.round;
    const top = round && round.discard[round.discard.length - 1];
    let pile = null;
    if (top && bot.cards.length) {
      const replacements = botSwapTargets(bot, top, { context: ctx, actionType: 'take-pile', source: 'pile' });
      pile = replacements[0] || null;
      if (pile) pile.metadata = { ...pile.metadata, source: 'pile', replacements };
    }
    const branches = ctx.belief.drawDistribution.map((item) => ({
      probability: item.probability,
      card: item.card,
      evaluation: bestResponseToDeckCard(bot, item.card, ctx)
    }));
    const deck = mixActionEvaluations('draw-deck', branches, { source: 'deck' });
    const actions = [pile, deck].filter(Boolean);
    const selected = chooseCharacterAction(bot, actions, random);
    recordDecisionDiagnostic(bot, 'draw-source', actions, selected);
    if (ctx.memory) ctx.memory.lastDecision = { type: 'draw-source', actions, selected };
    return { pile, deck, selected, belief: ctx.belief };
  }

  function shouldBotTakePile(bot) {
    const result = evaluateDrawSources(bot);
    return !!(result.selected && result.selected.actionType === 'take-pile');
  }

  function shouldBotSwapDrawn(bot, drawnCard) {
    const ctx = contextFor(bot);
    const discard = evaluateDeckDiscard(bot, drawnCard, ctx);
    const swaps = botSwapTargets(bot, drawnCard, { context: ctx, actionType: 'swap-drawn', source: 'deck' });
    const selected = chooseCharacterAction(bot, [discard, ...swaps], random);
    if (ctx.memory) ctx.memory.lastDecision = { type: 'draw-response', actions: [discard, ...swaps], selected };
    return !!selected && selected.actionType === 'swap-drawn';
  }

  function botBestOwnSlot(bot, mode = 'highest') {
    const ctx = contextFor(bot);
    const slots = bot.cards.map((card, index) => ({
      player: bot,
      index,
      card,
      memory: botMemoryEntry(bot, bot.id, index),
      expected: distributionMoments(ctx.slotDistributionFor(bot, index)).mean
    }));
    return slots.sort((a, b) => mode === 'lowest' ? a.expected - b.expected : b.expected - a.expected)[0] || null;
  }

  function botLowOpponentSlot(bot) {
    const ctx = contextFor(bot);
    return ctx.opponents.flatMap((player) => player.cards.map((card, index) => {
      const memory = effectiveMemory(bot, botMemoryEntry(bot, player.id, index));
      return {
        player,
        index,
        card,
        memory,
        expected: distributionMoments(ctx.slotDistributionFor(player, index)).mean,
        confidence: memory.confidence || 0
      };
    })).filter((slot) => slot.confidence > 0)
      .sort((a, b) => a.expected - b.expected || b.confidence - a.confidence)[0] || null;
  }

  function botOpponentEstimates(bot) {
    const ctx = contextFor(bot);
    return ctx.opponents.map((player) => ({
      player,
      expected: distributionMoments(ctx.scoreDistributionFor(player)).mean,
      cards: player.cards.length,
      total: player.total
    })).sort((a, b) => a.expected - b.expected);
  }

  function botRiskMode(bot) {
    const ctx = contextFor(bot);
    const own = distributionMoments(ctx.scoreDistributionFor(bot)).mean;
    const opponents = ctx.opponents.map((player) => ({
      score: distributionMoments(ctx.scoreDistributionFor(player)).mean,
      cards: player.cards.length,
      total: player.total
    }));
    const imminent = opponents.some((item) => item.cards <= 2 || item.score <= 6);
    const bestRound = opponents.length ? Math.min(...opponents.map((item) => item.score)) : own;
    const bestTotal = opponents.length ? Math.min(...opponents.map((item) => item.total)) : bot.total;
    const worstTotal = opponents.length ? Math.max(...opponents.map((item) => item.total)) : bot.total;
    if (bot.total <= bestTotal + 3 && worstTotal > bot.total + 8) return 'ahead';
    if (bot.total >= worstTotal - 3 && bot.total > bestTotal + 10) return 'behind';
    if (own <= bestRound && !imminent) return 'ahead';
    if (own > bestRound + 3 || imminent) return 'behind';
    return 'middle';
  }

  function botThrowThreshold(bot) {
    const mode = botRiskMode(bot);
    return mode === 'ahead' ? 0.76 : mode === 'behind' ? 0.52 : 0.64;
  }

  function botReactionDelay(bot, confidence) {
    const profile = require('./bot-strategy.js').botProfile(bot);
    return Math.round(450 + profile.slow * 1200 - profile.fast * 260 + (1 - confidence) * 1100 + randomBetween(0, 850));
  }

  function allSlotTargets(bot, suppliedContext = null) {
    const ctx = suppliedContext || contextFor(bot);
    const targets = [];
    for (const player of [bot, ...ctx.opponents]) {
      if (isProtectedSpecialTarget(player.id)) continue;
      for (let index = 0; index < player.cards.length; index += 1) {
        const slot = ctx.slotDistributionFor(player, index);
        const moments = distributionMoments(slot);
        const memory = effectiveMemory(bot, botMemoryEntry(bot, player.id, index));
        const uncertainty = entropy(slot) * (1 - (memory.confidence || 0) * 0.65);
        const score = distributionMoments(ctx.scoreDistributionFor(player)).mean;
        const changesDutch = Math.max(0, 9 - Math.abs(score - 5)) * 0.12;
        const changesSwap = moments.variance > 0 ? Math.sqrt(moments.variance) * 0.18 : 0;
        const opponentThreat = player.id === bot.id ? 1 : (player.cards.length <= 2 ? 1.35 : 0.72);
        targets.push({
          player,
          index,
          memory,
          expected: moments.mean,
          informationValue: uncertainty * opponentThreat + changesDutch + changesSwap
        });
      }
    }
    return targets;
  }

  function botQueenTargets(bot) {
    const all = allSlotTargets(bot);
    return {
      ownUnknown: all.filter((target) => target.player.id === bot.id && target.memory.confidence < 0.99)
        .sort((a, b) => b.informationValue - a.informationValue),
      opponentUnknown: all.filter((target) => target.player.id !== bot.id && target.memory.confidence < 0.99)
        .sort((a, b) => b.informationValue - a.informationValue)
    };
  }

  function botQueenTarget(bot) {
    const ctx = contextFor(bot);
    const targets = allSlotTargets(bot, ctx).filter((target) => target.memory.confidence < 0.999);
    const actions = targets.map((target) => ({
      ...target,
      ...currentEvaluation(bot, 'queen-peek', {
        context: ctx,
        informationValue: target.informationValue,
        metadata: { targetId: target.player.id, index: target.index }
      })
    }));
    const selected = chooseCharacterAction(bot, actions, random);
    recordDecisionDiagnostic(bot, 'queen-target', actions, selected);
    return selected;
  }

  function botAceTargetScore(bot, estimate) {
    const target = evaluateAceTarget(bot, estimate.player);
    return target ? target.actionValue : -Infinity;
  }

  function evaluateAceTarget(bot, player, suppliedContext = null) {
    const ctx = suppliedContext || contextFor(bot);
    if (!player || isProtectedSpecialTarget(player.id)) return null;
    const base = ctx.scoreDistributionFor(player);
    const drawPoints = ctx.belief.drawDistribution.map((item) => ({ value: item.card.points, probability: item.probability }));
    const added = addPointDistributions(base, drawPoints);
    const overrides = new Map([[player.id, added]]);
    const evaluation = currentEvaluation(bot, 'ace-add', {
      context: ctx,
      opponentDistributions: opponentDistributions(ctx, overrides),
      opponentBenefit: distributionMoments(base).mean - distributionMoments(added).mean,
      metadata: { targetId: player.id }
    });
    return { player, expected: distributionMoments(base).mean, cards: player.cards.length, total: player.total, aceScore: evaluation.actionValue, ...evaluation };
  }

  function botAceTarget(bot) {
    const ctx = contextFor(bot);
    const actions = ctx.opponents.map((player) => evaluateAceTarget(bot, player, ctx)).filter(Boolean);
    const selected = chooseCharacterAction(bot, actions, random);
    recordDecisionDiagnostic(bot, 'ace-target', actions, selected);
    return selected;
  }

  function botJackCandidates(bot) {
    const ctx = contextFor(bot);
    const slots = [];
    for (const player of [bot, ...ctx.opponents]) {
      if (isProtectedSpecialTarget(player.id)) continue;
      for (let index = 0; index < player.cards.length; index += 1) {
        slots.push({
          player,
          index,
          card: player.cards[index],
          distribution: ctx.slotDistributionFor(player, index),
          cardDistribution: ctx.slotCardDistributionFor(player, index),
          expected: distributionMoments(ctx.slotDistributionFor(player, index)).mean,
          confidence: effectiveMemory(bot, botMemoryEntry(bot, player.id, index)).confidence || 0
        });
      }
    }
    const candidates = [];
    const pairCount = slots.length * (slots.length - 1) / 2;
    const limits = strategyLimits(bot, false);
    const exactPairBudget = Math.min(120, Math.max(36, Math.floor(limits.operationBudget / 150)));
    const approximate = pairCount > exactPairBudget;
    const baseMeans = new Map([bot, ...ctx.opponents].map((player) => [
      player.id,
      distributionMoments(ctx.scoreDistributionFor(player)).mean
    ]));
    const baseline = currentEvaluation(bot, 'skip-jack', { context: ctx });
    const baselineOwnCards = bot.cards.map((_, index) => ctx.slotCardDistributionFor(bot, index));
    const baselinePairSaving = futureHandPairSaving(
      bot, baselineOwnCards, baseline.turnsRemaining
    );
    for (let first = 0; first < slots.length; first += 1) {
      for (let second = first + 1; second < slots.length; second += 1) {
        const a = slots[first];
        const b = slots[second];
        if (a.player.id === b.player.id) continue;
        const overridesByPlayer = new Map();
        if (a.player.id !== b.player.id) {
          if (approximate) {
            overridesByPlayer.set(a.player.id, deterministicPointDistribution(
              baseMeans.get(a.player.id) - a.expected + b.expected
            ));
            overridesByPlayer.set(b.player.id, deterministicPointDistribution(
              baseMeans.get(b.player.id) - b.expected + a.expected
            ));
          } else {
            overridesByPlayer.set(a.player.id, convolveScoreDistributions(
              ctx.scoreWithoutSlotFor(a.player, a.index),
              b.distribution
            ));
            overridesByPlayer.set(b.player.id, convolveScoreDistributions(
              ctx.scoreWithoutSlotFor(b.player, b.index),
              a.distribution
            ));
          }
        }
        const ownDistribution = overridesByPlayer.get(bot.id) || ctx.scoreDistributionFor(bot);
        const postOwnCards = baselineOwnCards.slice();
        if (a.player.id === bot.id) postOwnCards[a.index] = b.cardDistribution;
        if (b.player.id === bot.id) postOwnCards[b.index] = a.cardDistribution;
        const futureThrowInScoreSaving =
          a.player.id === bot.id || b.player.id === bot.id
            ? futureHandPairSaving(bot, postOwnCards, baseline.turnsRemaining) - baselinePairSaving
            : 0;
        const evaluation = currentEvaluation(bot, 'jack-swap', {
          context: ctx,
          ownDistribution,
          opponentDistributions: opponentDistributions(ctx, overridesByPlayer),
          informationValue: (1 - Math.min(a.confidence, b.confidence)) * 0.35,
          futureThrowInScoreSaving,
          metadata: {
            a: { playerId: a.player.id, index: a.index },
            b: { playerId: b.player.id, index: b.index },
            approximate
          }
        });
        candidates.push({
          type: a.player.id === bot.id || b.player.id === bot.id ? 'self' : 'sabotage',
          a,
          b,
          utility: evaluation.actionValue - baseline.actionValue,
          ...evaluation
        });
      }
    }
    return candidates.sort((a, b) => b.actionValue - a.actionValue);
  }

  function estimatedTurnImprovement(bot, player) {
    const ctx = contextFor(bot);
    const current = distributionMoments(ctx.scoreDistributionFor(player)).mean;
    if (!player.cards.length) return 0;
    const highest = Math.max(...player.cards.map((_, index) => distributionMoments(ctx.slotDistributionFor(player, index)).mean));
    const top = ctx.state.round && ctx.state.round.discard.at(-1);
    const incoming = top ? Math.min(cardPoints(top), ctx.belief.expectedDrawPoints) : ctx.belief.expectedDrawPoints;
    return Math.max(0, highest - incoming);
  }

  function sampleCard(distribution, rng) {
    let roll = rng();
    for (const item of distribution || []) {
      roll -= item.probability || 0;
      if (roll <= 0) return item.card;
    }
    return distribution && distribution.length ? distribution[distribution.length - 1].card : null;
  }

  function handScore(cards) {
    return (cards || []).reduce((sum, card) => sum + cardPoints(card), 0);
  }

  function sampleRolloutWorld(ctx, rng) {
    const hands = new Map();
    for (const player of [ctx.bot, ...ctx.opponents]) {
      hands.set(player.id, player.cards.map((_, index) => sampleCard(ctx.slotCardDistributionFor(player, index), rng))
        .filter(Boolean));
    }
    return { hands };
  }

  function activePlayersAfter(ctx, playerId) {
    const players = activePlayablePlayers();
    const index = players.findIndex((player) => player.id === playerId);
    if (index < 0) return players.filter((player) => player.id !== playerId);
    const ordered = [];
    for (let offset = 1; offset < players.length; offset += 1) {
      ordered.push(players[(index + offset) % players.length]);
    }
    return ordered;
  }

  function simulateCardTurn(hand, ctx, rng, topCard, otherScores) {
    if (!hand.length) return { hand: [], topCard, source: 'none', discarded: null };
    const currentScore = handScore(hand);
    const highestIndex = hand.reduce((best, card, index) => (
      best < 0 || cardPoints(card) > cardPoints(hand[best]) ? index : best
    ), -1);
    const highestPoints = cardPoints(hand[highestIndex]);
    const pileScore = topCard
      ? currentScore - highestPoints + cardPoints(topCard)
      : Infinity;
    let deckMean = 0;
    let deckVariance = 0;
    const deckOutcomes = [];
    for (const item of ctx.belief.drawDistribution) {
      const score = currentScore - Math.max(0, highestPoints - cardPoints(item.card));
      deckMean += item.probability * score;
      deckOutcomes.push({ score, probability: item.probability });
    }
    for (const outcome of deckOutcomes) {
      deckVariance += outcome.probability * Math.pow(outcome.score - deckMean, 2);
    }
    const bestOther = otherScores.length ? Math.min(...otherScores) : currentScore;
    const leading = currentScore <= bestOther;
    const safePileWindow = leading ? Math.sqrt(deckVariance) * 0.12 : 0;
    const takePile = !!topCard && pileScore <= deckMean + safePileWindow;
    const incoming = takePile ? topCard : sampleCard(ctx.belief.drawDistribution, rng);
    if (!incoming) return { hand: hand.slice(), topCard, source: 'none', discarded: null };
    const nextHand = hand.slice();
    let discarded = incoming;
    if (takePile || cardPoints(incoming) < highestPoints) {
      discarded = nextHand[highestIndex];
      nextHand[highestIndex] = incoming;
    }
    return {
      hand: nextHand,
      topCard: discarded,
      source: takePile ? 'pile' : 'deck',
      discarded
    };
  }

  function applyRolloutSpecial(world, actor, discarded, protectedCallerId, ctx, rng) {
    if (!discarded || !SPECIALS.has(discarded.rank)) return;
    const legalOthers = [ctx.bot, ...ctx.opponents]
      .filter((player) => player.id !== actor.id && player.id !== protectedCallerId);
    if (discarded.rank === 'A' && legalOthers.length) {
      const target = legalOthers.slice().sort((a, b) => (
        handScore(world.hands.get(a.id)) - handScore(world.hands.get(b.id)) ||
        (world.hands.get(a.id) || []).length - (world.hands.get(b.id) || []).length
      ))[0];
      const added = sampleCard(ctx.belief.drawDistribution, rng);
      if (target && added) world.hands.get(target.id).push(added);
      return;
    }
    if (discarded.rank !== 'J' || actor.id === protectedCallerId) return;
    const own = world.hands.get(actor.id) || [];
    if (!own.length) return;
    const ownIndex = own.reduce((best, card, index) => (
      best < 0 || cardPoints(card) > cardPoints(own[best]) ? index : best
    ), -1);
    let bestTarget = null;
    for (const player of legalOthers) {
      const cards = world.hands.get(player.id) || [];
      cards.forEach((card, index) => {
        if (!bestTarget || cardPoints(card) < cardPoints(bestTarget.card)) {
          bestTarget = { cards, index, card };
        }
      });
    }
    if (bestTarget && cardPoints(bestTarget.card) < cardPoints(own[ownIndex])) {
      [own[ownIndex], bestTarget.cards[bestTarget.index]] = [bestTarget.cards[bestTarget.index], own[ownIndex]];
    }
  }

  function simulateRolloutTurn(world, player, ctx, rng, topCard, protectedCallerId = null) {
    const hand = world.hands.get(player.id) || [];
    const otherScores = [ctx.bot, ...ctx.opponents]
      .filter((item) => item.id !== player.id)
      .map((item) => handScore(world.hands.get(item.id)));
    const result = simulateCardTurn(hand, ctx, rng, topCard, otherScores);
    world.hands.set(player.id, result.hand);
    applyRolloutSpecial(world, player, result.discarded, protectedCallerId, ctx, rng);
    return result.topCard;
  }

  function rolloutCallProbability(player, world, ctx) {
    const score = handScore(world.hands.get(player.id));
    let probability;
    if (score <= 2) probability = 0.995;
    else if (score === 3) probability = 0.98;
    else if (score === 4) probability = 0.95;
    else if (score === 5) probability = 0.9;
    else if (score === 6) probability = 0.08;
    else if (score === 7) probability = 0.02;
    else probability = 0;
    const bestOther = Math.min(...[ctx.bot, ...ctx.opponents]
      .filter((item) => item.id !== player.id)
      .map((item) => handScore(world.hands.get(item.id))));
    if (bestOther + 2 < score) probability *= 0.72;
    const inference = ctx.memory && ctx.memory.inference && ctx.memory.inference[player.id];
    if (inference) probability = Math.min(1, probability + (inference.dutchReadiness || 0) * 0.08);
    if ((world.hands.get(player.id) || []).length <= 2) probability = Math.min(1, probability + 0.04);
    return probability;
  }

  function probabilityAnyOpponentLower(ctx, ownScore) {
    return 1 - opponentDistributions(ctx).reduce((noOpponentLower, opponent) => (
      noOpponentLower * probabilityAtLeast(opponent.distribution, ownScore)
    ), 1);
  }

  function rolloutBotCalls(bot, world, ctx) {
    const ownScore = handScore(world.hands.get(bot.id));
    if (ownScore > 5) return false;
    // A sampled rollout measures outcomes; it is not hidden information that the
    // bot may use to decide whether to call.
    const lowerProbability = probabilityAnyOpponentLower(ctx, ownScore);
    const successfulTotal = scoreAfterRound(bot.total, 0);
    const failedTotal = scoreAfterRound(bot.total, ownScore * 2);
    const expectedCallTotal =
      (1 - lowerProbability) * successfulTotal +
      lowerProbability * failedTotal;
    const continueTotal = scoreAfterRound(bot.total, ownScore);
    return expectedCallTotal <= continueTotal;
  }

  function simulateFinalQueue(world, caller, ctx, rng, topCard) {
    let nextTop = topCard;
    for (const player of activePlayersAfter(ctx, caller.id)) {
      nextTop = simulateRolloutTurn(world, player, ctx, rng, nextTop, caller.id);
    }
    return nextTop;
  }

  function addRollout(bucket, world, ctx) {
    bucket.count += 1;
    const ownScore = handScore(world.hands.get(ctx.bot.id));
    bucket.own.set(ownScore, (bucket.own.get(ownScore) || 0) + 1);
    for (const opponent of ctx.opponents) {
      const score = handScore(world.hands.get(opponent.id));
      const counts = bucket.opponents.get(opponent.id);
      counts.set(score, (counts.get(score) || 0) + 1);
    }
  }

  function createRolloutBucket(ctx, callerId = null) {
    return {
      callerId,
      count: 0,
      own: new Map(),
      opponents: new Map(ctx.opponents.map((player) => [player.id, new Map()]))
    };
  }

  function normalizedCounts(counts, total) {
    return Array.from(counts, ([value, count]) => ({ value, probability: count / Math.max(1, total) }));
  }

  function evaluationFromBucket(bot, ctx, bucket, actionType, metadata = {}) {
    const ownDistribution = normalizedCounts(bucket.own, bucket.count);
    const finalOpponents = ctx.opponents.map((player) => ({
      player,
      distribution: normalizedCounts(bucket.opponents.get(player.id), bucket.count)
    }));
    return currentEvaluation(bot, actionType, {
      context: ctx,
      ownDistribution,
      opponentDistributions: finalOpponents,
      callerId: bucket.callerId,
      turnsRemaining: bucket.callerId ? 0 : undefined,
      metadata: { ...metadata, callerId: bucket.callerId, rollouts: bucket.count }
    });
  }

  function evaluateDutch(bot) {
    const ctx = contextFor(bot);
    const ownInitial = ctx.scoreDistributionFor(bot);
    const decisive = bot.cards.length <= 2 || ctx.opponents.some((player) => player.cards.length <= 2) ||
      probabilityAtMost(ownInitial, 5) > 0.25 || (ctx.state.round && Array.isArray(ctx.state.round.deck) && ctx.state.round.deck.length <= ctx.state.players.length + 2);
    const limits = strategyLimits(bot, decisive);
    const samples = Math.max(24, Math.min(limits.samples, Math.floor(limits.operationBudget / Math.max(1, ctx.opponents.length * 3))));
    const rng = seededRandom(seedFromText([bot.id, ctx.state.roundNumber, ctx.state.round && (ctx.state.round.strategyTick ?? ctx.state.round.botTick), 'dutch'].join(':')));
    const callBucket = createRolloutBucket(ctx, bot.id);
    const continueBuckets = new Map();
    const bucketFor = (callerId) => {
      const key = callerId || 'no-caller';
      if (!continueBuckets.has(key)) continueBuckets.set(key, createRolloutBucket(ctx, callerId));
      return continueBuckets.get(key);
    };
    const initialTop = ctx.state.round && ctx.state.round.discard.at(-1);
    const opponentsInOrder = activePlayersAfter(ctx, bot.id);
    for (let sample = 0; sample < samples; sample += 1) {
      const callWorld = sampleRolloutWorld(ctx, rng);
      simulateFinalQueue(callWorld, bot, ctx, rng, initialTop);
      addRollout(callBucket, callWorld, ctx);

      const continueWorld = sampleRolloutWorld(ctx, rng);
      let topCard = initialTop;
      let caller = null;
      for (const opponent of opponentsInOrder) {
        topCard = simulateRolloutTurn(continueWorld, opponent, ctx, rng, topCard);
        if (rng() < rolloutCallProbability(opponent, continueWorld, ctx)) {
          caller = opponent;
          break;
        }
      }
      if (caller) {
        simulateFinalQueue(continueWorld, caller, ctx, rng, topCard);
      } else {
        topCard = simulateRolloutTurn(continueWorld, bot, ctx, rng, topCard);
        if (rolloutBotCalls(bot, continueWorld, ctx)) {
          caller = bot;
          simulateFinalQueue(continueWorld, bot, ctx, rng, topCard);
        }
      }
      addRollout(bucketFor(caller && caller.id), continueWorld, ctx);
    }

    const call = evaluationFromBucket(bot, ctx, callBucket, 'call-dutch', {
      samples,
      searchDepth: limits.depth,
      simulatedFinalTurns: true
    });
    const branchEvaluations = Array.from(continueBuckets.values()).map((bucket) => ({
      probability: bucket.count / samples,
      evaluation: evaluationFromBucket(
        bot,
        ctx,
        bucket,
        bucket.callerId === bot.id ? 'continue-and-call' : (bucket.callerId ? 'continue-opponent-called' : 'continue-next-cycle'),
        { samples, searchDepth: limits.depth }
      )
    }));
    const branchProbabilities = {};
    for (const branch of branchEvaluations) {
      const callerId = branch.evaluation.metadata.callerId;
      const key = callerId === bot.id ? 'bot-calls-next' : (callerId ? 'opponent-' + callerId : 'no-call-next-cycle');
      branchProbabilities[key] = branch.probability;
    }
    const opponentCallBeforeNextProbability = branchEvaluations.reduce((sum, branch) => {
      const callerId = branch.evaluation.metadata.callerId;
      return sum + (callerId && callerId !== bot.id ? branch.probability : 0);
    }, 0);
    const continueAction = mixActionEvaluations('continue', branchEvaluations, {
      samples,
      searchDepth: limits.depth,
      branchProbabilities,
      opponentCallBeforeNextProbability,
      simulatedToNextDecision: true
    });
    return { call, continue: continueAction };
  }

  function botShouldCallDutch(bot) {
    const result = evaluateDutch(bot);
    const selected = chooseCharacterAction(bot, [result.call, result.continue], random);
    const memory = ensureBotMemory(bot);
    recordDecisionDiagnostic(bot, 'dutch', [result.call, result.continue], selected);
    if (memory) memory.lastDecision = { type: 'dutch', actions: [result.call, result.continue], selected };
    return !!selected && selected.actionType === 'call-dutch';
  }

  function botThrowInCandidate(bot) {
    const ctx = contextFor(bot);
    const round = ctx.state.round;
    if (!round || !round.throwIn || !round.throwIn.open) return null;
    const wait = currentEvaluation(bot, 'wait-throw-in', { context: ctx });
    const drawPoints = drawPointDistribution(ctx);
    const candidates = [];
    for (let index = 0; index < bot.cards.length; index += 1) {
      const entry = effectiveMemory(bot, botMemoryEntry(bot, bot.id, index));
      const rememberedRank = entry.card && entry.card.rank || entry.rank;
      const matchingDistribution = (entry.distribution || []).reduce((sum, item) => sum + (item.card.rank === round.throwIn.rank ? item.probability : 0), 0);
      const confidence = rememberedRank === round.throwIn.rank ? Math.max(entry.confidence || 0, matchingDistribution) : matchingDistribution;
      if (confidence <= 0) continue;
      const successDistribution = ctx.scoreWithoutSlotFor(bot, index);
      const failureDistribution = addPointDistributions(ctx.scoreDistributionFor(bot), drawPoints);
      const success = currentEvaluation(bot, 'throw-in-success', {
        context: ctx,
        ownDistribution: successDistribution,
        immediatePointReduction: distributionMoments(ctx.slotDistributionFor(bot, index)).mean
      });
      const failure = currentEvaluation(bot, 'throw-in-failure', {
        context: ctx,
        ownDistribution: failureDistribution,
        extraVariance: distributionMoments(drawPoints).variance
      });
      const mixed = mixActionEvaluations('throw-in', [
        { probability: confidence, evaluation: success },
        { probability: 1 - confidence, evaluation: failure }
      ], { index, rank: round.throwIn.rank });
      const futureOpportunity = ctx.belief.probabilityOfRank(round.throwIn.rank) * Math.min(1, mixed.turnsRemaining / 4);
      mixed.actionValue -= futureOpportunity * Math.max(0, success.immediatePointReduction) * 0.12;
      mixed.finalActionValue = mixed.actionValue;
      const certainSafeThrow = confidence >= 0.999 &&
        !(entry.card && SPECIALS.has(entry.card.rank));
      if (mixed.actionValue > wait.actionValue || certainSafeThrow) {
        candidates.push({
          index,
          confidence,
          expected: distributionMoments(ctx.slotDistributionFor(bot, index)).mean,
          expectedValue: mixed.actionValue - wait.actionValue,
          ...mixed
        });
      }
    }
    return chooseCharacterAction(bot, candidates, random);
  }

  return {
    contextFor,
    currentEvaluation,
    evaluateDrawSources,
    evaluateReplacement,
    evaluateDutch,
    unknownExpectedPoints,
    rankStatsForBot,
    rankDiscardPressure,
    throwInPotentialValue,
    opponentThrowInBenefit,
    discardGiftPenalty,
    cardStrategicCost,
    evaluateDeckDiscard,
    botSwapTargets,
    botBestSwapTarget,
    knownOwnCardUtility,
    specialActionValue,
    expectedEntryPoints,
    botOwnSlots,
    botExpectedScore,
    expectedEntryRawPoints,
    botExpectedRoundScore,
    botRoundScoreConfidence,
    totalHalvingBonus,
    botDeliberateDutchHalving,
    botBestOwnSlot,
    botLowOpponentSlot,
    botOpponentEstimates,
    botRiskMode,
    shouldBotTakePile,
    shouldBotSwapDrawn,
    botThrowThreshold,
    botReactionDelay,
    botAceTargetScore,
    botAceTarget,
    botQueenTargets,
    botQueenTarget,
    botJackCandidates,
    estimatedTurnImprovement,
    botShouldCallDutch,
    botThrowInCandidate
  };
}

module.exports = { createOptimalDecisionLayer, seedFromText, seededRandom };
