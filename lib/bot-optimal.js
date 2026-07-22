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
  clamp,
  scoreAfterRound,
  probabilityAtLeast,
  probabilityAtMost,
  projectedGameWinProbability,
  gameOutcomeUtility,
  evaluateFinalTurnAction
} = require('./bot-evaluator.js');

const SPECIALS = new Set(SPECIAL_RANKS);
const CONFIRMED_CARD_CONFIDENCE = 0.65;
const SPECULATIVE_THROW_IN_WEIGHT = 0.1;

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
    const effectiveSlotCache = new Map();
    const scoreCache = new Map();
    const withoutSlotCache = new Map();
    const effectiveSlotMemoryFor = (player, index) => {
      const key = player.id + ':' + index;
      if (!effectiveSlotCache.has(key)) {
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
        effectiveSlotCache.set(key, effective);
      }
      return effectiveSlotCache.get(key);
    };
    const storePositionEstimate = (player, index, distribution) => {
      const entry = botMemoryEntry(bot, player.id, index);
      const effective = effectiveSlotMemoryFor(player, index);
      const estimate = {
        ownerId: player.id,
        index,
        expectedValue: distributionMoments(distribution).mean,
        knownRank: effective.card && effective.card.rank || effective.knownRank || effective.rank || null,
        confidence: effective.confidence || 0,
        source: effective.source || entry.source || 'unknown',
        lastChangedEvent: entry.lastChangedEvent || entry.source || 'unknown',
        lastChangedTick: Number.isFinite(entry.lastChangedTick)
          ? entry.lastChangedTick
          : (entry.updatedTick || 0)
      };
      if (memory) {
        if (!memory.positionEstimates) memory.positionEstimates = {};
        if (!memory.positionEstimates[player.id]) memory.positionEstimates[player.id] = [];
        memory.positionEstimates[player.id][index] = estimate;
      }
      return estimate;
    };
    const slotDistributionFor = (player, index) => {
      const key = player.id + ':' + index;
      if (!slotCache.has(key)) {
        const distribution = slotPointDistribution(
          effectiveSlotMemoryFor(player, index),
          belief.drawDistribution
        );
        slotCache.set(key, distribution);
        storePositionEstimate(player, index, distribution);
      }
      return slotCache.get(key);
    };
    const slotCardDistributionFor = (player, index) => {
      const key = player.id + ':' + index;
      if (!slotCardCache.has(key)) {
        slotCardCache.set(key, slotCardDistribution(
          effectiveSlotMemoryFor(player, index),
          belief.drawDistribution
        ));
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
    const playablePlayers = activePlayablePlayers();
    const opponents = playablePlayers.filter((player) => player.id !== bot.id);
    for (const player of playablePlayers) {
      for (let index = 0; index < player.cards.length; index += 1) slotDistributionFor(player, index);
    }
    const positionEstimateFor = (player, index) => (
      memory && memory.positionEstimates && memory.positionEstimates[player.id] &&
      memory.positionEstimates[player.id][index]
    ) || storePositionEstimate(player, index, slotDistributionFor(player, index));
    return {
      state,
      bot,
      memory,
      belief,
      slotCardDistributionFor,
      slotDistributionFor,
      positionEstimateFor,
      scoreDistributionFor,
      scoreWithoutSlotFor,
      opponents
    };
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

  function opponentSelfKnowledge(bot, opponent) {
    const humanMemoryEntry = deps.effectiveHumanMemory || (() => ({
      state: 'unknown',
      confidence: 0,
      card: null
    }));
    let knownPositions = 0;
    let knownLowPositions = 0;
    if (!opponent.isBot) {
      for (let index = 0; index < opponent.cards.length; index += 1) {
        const remembered = humanMemoryEntry(bot, opponent.id, opponent.id, index);
        const confidence = remembered.confidence || 0;
        if (!remembered.card || confidence < 0.28) continue;
        knownPositions += confidence;
        if (cardPoints(remembered.card) <= 5) knownLowPositions += confidence;
      }
    } else {
      knownPositions = Math.min(2, opponent.cards.length) * 0.8;
    }
    return {
      knownPositions,
      knownLowPositions,
      knowledgeRatio: opponent.cards.length ? clamp(knownPositions / opponent.cards.length) : 1
    };
  }

  function recentLowActionPressure(ctx, opponent) {
    const inference = ctx.memory && ctx.memory.inference && ctx.memory.inference[opponent.id];
    const actions = inference && Array.isArray(inference.recentActions) ? inference.recentActions : [];
    const tick = ctx.state.round && (ctx.state.round.strategyTick ?? ctx.state.round.botTick) || 0;
    let pressure = 0;
    let consecutive = 0;
    for (let index = actions.length - 1; index >= 0; index -= 1) {
      const action = actions[index];
      const age = Math.max(0, tick - (action.updatedTick || 0));
      if (age > 18) continue;
      if (!action.low) {
        if (consecutive > 0) break;
        continue;
      }
      const recency = Math.pow(0.9, age);
      pressure += recency * (action.type === 'throw-in' ? 0.34 : 0.27);
      consecutive += 1;
    }
    if (consecutive >= 2) pressure += Math.min(0.3, (consecutive - 1) * 0.12);
    return clamp(pressure);
  }

  function opponentThreatState(bot, suppliedContext = null) {
    const ctx = suppliedContext || contextFor(bot);
    if (ctx.opponentThreatState) return ctx.opponentThreatState;
    const profiles = ctx.opponents.map((opponent) => {
      const distribution = ctx.scoreDistributionFor(opponent);
      const moments = distributionMoments(distribution);
      const callableProbability = probabilityAtMost(distribution, 5);
      const nearFiveProbability = probabilityAtMost(distribution, 7);
      const fewCardsPressure = clamp((4 - opponent.cards.length) / 3);
      let confidentlyKnownLowCards = 0;
      for (let index = 0; index < opponent.cards.length; index += 1) {
        const remembered = effectiveMemory(bot, botMemoryEntry(bot, opponent.id, index));
        if (
          remembered.card &&
          (remembered.confidence || 0) >= CONFIRMED_CARD_CONFIDENCE &&
          cardPoints(remembered.card) <= 5
        ) confidentlyKnownLowCards += remembered.confidence;
      }
      const knownLowPressure = clamp(confidentlyKnownLowCards / 2);
      const selfKnowledge = opponentSelfKnowledge(bot, opponent);
      const selfKnownLowPressure = clamp(selfKnowledge.knownLowPositions / 2);
      const recentLowPressure = recentLowActionPressure(ctx, opponent);
      const inference = ctx.memory && ctx.memory.inference && ctx.memory.inference[opponent.id];
      const humanModel = ctx.memory && ctx.memory.humanKnowledge && ctx.memory.humanKnowledge[opponent.id];
      const readiness = Math.max(
        inference && inference.dutchReadiness || 0,
        humanModel && humanModel.dutchReadiness || 0
      );
      const callBeforeNextProbability = clamp(
        callableProbability * 0.66 +
        Math.max(0, nearFiveProbability - callableProbability) * 0.24 +
        fewCardsPressure * 0.12 +
        selfKnowledge.knowledgeRatio * 0.1 +
        selfKnownLowPressure * 0.16 +
        recentLowPressure * 0.18 +
        readiness * 0.12
      );
      const score = clamp(
        fewCardsPressure * 0.14 +
        knownLowPressure * 0.17 +
        nearFiveProbability * 0.17 +
        recentLowPressure * 0.16 +
        callBeforeNextProbability * 0.24 +
        selfKnowledge.knowledgeRatio * 0.05 +
        selfKnownLowPressure * 0.07
      );
      const immediate = callBeforeNextProbability >= 0.58 || score >= 0.52 ||
        (opponent.cards.length <= 2 && nearFiveProbability >= 0.5);
      return {
        player: opponent,
        playerId: opponent.id,
        immediate,
        score,
        expectedHandScore: moments.mean,
        callableProbability,
        nearFiveProbability,
        callBeforeNextProbability,
        fewCardsPressure,
        confidentlyKnownLowCards,
        recentLowPressure,
        selfKnowledge
      };
    }).sort((a, b) => b.score - a.score);
    ctx.opponentThreatState = {
      active: profiles.some((profile) => profile.immediate),
      intensity: profiles.length ? profiles[0].score : 0,
      callBeforeNextProbability: profiles.length
        ? Math.max(...profiles.map((profile) => profile.callBeforeNextProbability))
        : 0,
      primary: profiles[0] || null,
      profiles
    };
    return ctx.opponentThreatState;
  }

  function currentEvaluation(bot, actionType = 'hold', options = {}) {
    const ctx = options.context || contextFor(bot);
    if (isForcedFinalTurn(bot, ctx)) {
      return evaluateFinalTurnAction({
        state: ctx.state,
        bot,
        actionType,
        ownDistribution: options.ownDistribution || ctx.scoreDistributionFor(bot),
        opponentDistributions: options.opponentDistributions || opponentDistributions(ctx),
        callerId: ctx.state.round.dutchCallerId,
        informationValue: options.informationValue || 0,
        opponentBenefit: options.opponentBenefit || 0,
        immediatePointReduction: options.immediatePointReduction || 0,
        futureThrowInScoreSaving: options.futureThrowInScoreSaving || 0,
        extraVariance: options.extraVariance || 0,
        metadata: options.metadata || {}
      });
    }
    const threat = opponentThreatState(bot, ctx);
    const metadata = options.metadata || {};
    const threatRelevantInformation = !!(
      metadata.threatRelevantInformation ||
      (metadata.targetId && threat.profiles.some((profile) => (
        profile.playerId === metadata.targetId && profile.immediate
      )))
    );
    const informationMultiplier = threat.active
      ? (threatRelevantInformation ? 1 + threat.intensity * 0.9 : 0.28)
      : 1;
    const futureThrowInMultiplier = threat.active ? Math.max(0.12, 1 - threat.intensity * 1.35) : 1;
    const immediatePointReduction = options.immediatePointReduction || 0;
    const evaluation = evaluateAction({
      state: ctx.state,
      bot,
      actionType,
      ownDistribution: options.ownDistribution || ctx.scoreDistributionFor(bot),
      opponentDistributions: options.opponentDistributions || opponentDistributions(ctx),
      callerId: options.callerId || null,
      informationValue: (options.informationValue || 0) * informationMultiplier,
      opponentBenefit: options.opponentBenefit || 0,
      immediatePointReduction,
      futureThrowInScoreSaving: (options.futureThrowInScoreSaving || 0) * futureThrowInMultiplier,
      extraVariance: options.extraVariance || 0,
      turnsRemaining: options.turnsRemaining,
      metadata: {
        ...metadata,
        opponentThreatMode: {
          active: threat.active,
          intensity: threat.intensity,
          primaryPlayerId: threat.primary && threat.primary.playerId || null,
          callBeforeNextProbability: threat.callBeforeNextProbability,
          informationMultiplier,
          futureThrowInMultiplier
        }
      }
    });
    if (threat.active) {
      const immediateReductionBonus = Math.max(0, immediatePointReduction) * (0.65 + threat.intensity);
      const smallImprovementPenalty = immediatePointReduction > 0 && immediatePointReduction < 1.5
        ? (1.5 - immediatePointReduction) * threat.intensity * 0.45
        : 0;
      evaluation.actionValue += immediateReductionBonus - smallImprovementPenalty;
      evaluation.finalActionValue = evaluation.actionValue;
      evaluation.metadata.opponentThreatMode.immediateReductionBonus = immediateReductionBonus;
      evaluation.metadata.opponentThreatMode.smallImprovementPenalty = smallImprovementPenalty;
    }
    return evaluation;
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
      expectedPostRoundTotal: rounded(action.expectedPostRoundTotal),
      expectedThresholdAdjustedTotal: rounded(action.expectedThresholdAdjustedTotal),
      expectedThresholdAdjustment: rounded(action.expectedThresholdAdjustment),
      probabilityCrossingTarget: rounded(action.probabilityCrossingTarget),
      probabilityGameEnds: rounded(action.probabilityGameEnds),
      estimatedWinProbability: rounded(action.estimatedWinProbability),
      estimatedGameWinProbability: rounded(action.estimatedGameWinProbability),
      gameOutcomeValue: rounded(action.gameOutcomeValue),
      opponentTotalEstimates: (action.opponentTotalEstimates || []).map((estimate) => ({
        playerId: estimate.playerId,
        expectedPostRoundTotal: rounded(estimate.expectedPostRoundTotal),
        expectedThresholdAdjustedTotal: rounded(estimate.expectedThresholdAdjustedTotal),
        probabilityCrossingTarget: rounded(estimate.probabilityCrossingTarget)
      })),
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
      finalTurnOutcome: metadata.finalTurnOutcome ? {
        dedicated: !!metadata.finalTurnOutcome.dedicated,
        callerId: metadata.finalTurnOutcome.callerId || null,
        expectedOwnTotal: rounded(metadata.finalTurnOutcome.expectedOwnTotal),
        ownExactThresholdProbability: rounded(metadata.finalTurnOutcome.ownExactThresholdProbability),
        ownThresholdSaving: rounded(metadata.finalTurnOutcome.ownThresholdSaving),
        normalLossProbability: rounded(metadata.finalTurnOutcome.normalLossProbability),
        callerSuccessProbability: rounded(metadata.finalTurnOutcome.callerSuccessProbability),
        callerFailureProbability: rounded(metadata.finalTurnOutcome.callerFailureProbability),
        callerExpectedTotal: rounded(metadata.finalTurnOutcome.callerExpectedTotal),
        callerExactThresholdProbability: rounded(metadata.finalTurnOutcome.callerExactThresholdProbability)
      } : null,
      opponentThreatMode: metadata.opponentThreatMode ? {
        active: !!metadata.opponentThreatMode.active,
        intensity: rounded(metadata.opponentThreatMode.intensity),
        primaryPlayerId: metadata.opponentThreatMode.primaryPlayerId ||
          metadata.opponentThreatMode.primary && metadata.opponentThreatMode.primary.playerId || null,
        callBeforeNextProbability: rounded(metadata.opponentThreatMode.callBeforeNextProbability)
      } : null,
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
    return chance * Math.min(1, futureTurns / 4) *
      (0.4 + cardPoints(card) * 0.12) * SPECULATIVE_THROW_IN_WEIGHT;
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

  function discardTurnOrder(bot, ctx) {
    const round = ctx.state.round;
    if (round && round.dutchCallerId && Array.isArray(round.dutchQueue)) {
      const queued = round.dutchQueue.map((playerId) => (
        ctx.state.players.find((player) => player.id === playerId)
      )).filter((player) => player && player.id !== bot.id && !player.left && !player.isSpectator);
      return queued;
    }
    return activePlayersAfter(ctx, bot.id);
  }

  function matchingThrowInBenefitFor(ctx, player, rank) {
    return expectedHighestMatchingPoints(
      player.cards.map((_, index) => ctx.slotCardDistributionFor(player, index)),
      rank
    );
  }

  function knownHighReplacementValue(bot, player, incomingPoints) {
    let best = 0;
    for (let index = 0; index < player.cards.length; index += 1) {
      const entry = effectiveMemory(bot, botMemoryEntry(bot, player.id, index));
      if (!entry.card || (entry.confidence || 0) < CONFIRMED_CARD_CONFIDENCE) continue;
      best = Math.max(best, Math.max(0, cardPoints(entry.card) - incomingPoints) * (entry.confidence || 0));
    }
    return best;
  }

  function discardCardClassPenalty(card) {
    const points = cardPoints(card);
    if (card.rank === 'A') return 2.6;
    if (card.rank === 'K' && points === 0) return 3.4;
    if (points >= 2 && points <= 5) return (6 - points) * 0.55;
    return 0;
  }

  function discardGiftAssessment(bot, card, suppliedContext = null) {
    if (!card) return { totalPenalty: 0, targets: [] };
    const ctx = suppliedContext || contextFor(bot);
    const order = discardTurnOrder(bot, ctx);
    const threat = opponentThreatState(bot, ctx);
    const points = cardPoints(card);
    const cardClassPenalty = discardCardClassPenalty(card);
    const targets = order.map((player, orderIndex) => {
      const distance = orderIndex + 1;
      const pileSurvivalProbability = distance === 1 ? 1 : Math.pow(0.38, distance - 1);
      const profile = threat.profiles.find((item) => item.playerId === player.id);
      const expectedScore = distributionMoments(ctx.scoreDistributionFor(player)).mean;
      const averageReplaceable = player.cards.length ? expectedScore / player.cards.length * 1.35 : 0;
      const averageReplacementValue = Math.max(0, averageReplaceable - points);
      const knownHighValue = knownHighReplacementValue(bot, player, points);
      const replacementValue = Math.max(averageReplacementValue, knownHighValue);
      const matchingThrowInValue = matchingThrowInBenefitFor(ctx, player, card.rank);
      const knownLowPressure = profile ? clamp(
        (profile.confidentlyKnownLowCards + profile.selfKnowledge.knownLowPositions) / 2
      ) : 0;
      const fewCardsPressure = profile ? profile.fewCardsPressure : clamp((4 - player.cards.length) / 3);
      const callProbability = profile ? profile.callBeforeNextProbability : 0;
      const threatMultiplier = 1 + fewCardsPressure * 0.55 + knownLowPressure * 0.45 +
        callProbability * 0.75 + (profile && profile.immediate ? 0.3 : 0);
      const replacementOpportunity = clamp(
        0.4 + replacementValue / 8 + fewCardsPressure * 0.18
      );
      const classGiftValue = cardClassPenalty * replacementOpportunity;
      const callableGiftValue = callProbability * Math.max(0, 6 - points) * 0.4;
      const pileTakeValue = (
        replacementValue * 0.52 + classGiftValue + callableGiftValue
      ) * pileSurvivalProbability;
      const throwInSeatWeight = distance === 1
        ? 0.95
        : 0.25 * Math.pow(0.65, distance - 2);
      const throwInValue = matchingThrowInValue * throwInSeatWeight;
      const penalty = (pileTakeValue + throwInValue) * threatMultiplier;
      return {
        playerId: player.id,
        distance,
        actsNext: distance === 1,
        pileSurvivalProbability,
        cardClassPenalty,
        expectedScore,
        averageReplacementValue,
        knownHighReplacementValue: knownHighValue,
        replacementValue,
        matchingThrowInValue,
        throwInSeatWeight,
        fewCardsPressure,
        knownLowPressure,
        callProbability,
        immediateThreat: !!(profile && profile.immediate),
        threatMultiplier,
        classGiftValue,
        callableGiftValue,
        pileTakeValue,
        throwInValue,
        penalty
      };
    });
    return {
      card: publicMemoryCard(card),
      cardClassPenalty,
      totalPenalty: targets.reduce((sum, target) => sum + target.penalty, 0),
      targets
    };
  }

  function discardGiftPenalty(bot, card, suppliedContext = null) {
    return discardGiftAssessment(bot, card, suppliedContext).totalPenalty;
  }

  function cardStrategicCost(bot, card) {
    if (!card) return unknownExpectedPoints(bot);
    return cardPoints(card) - throwInPotentialValue(bot, card);
  }

  function botOwnSlots(bot) {
    ensureBotMemory(bot);
    return bot.cards.map((_, index) => {
      const memory = botMemoryEntry(bot, bot.id, index);
      return {
        player: bot,
        index,
        card: effectiveMemory(bot, memory).card || null,
        memory
      };
    });
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

  function expectedHalvingBonus(bot, distribution) {
    return (distribution || []).reduce((sum, item) => (
      sum + (item.probability || 0) * totalHalvingBonus(bot, item.value)
    ), 0);
  }

  function exactThresholdProbability(bot, distribution) {
    return (distribution || []).reduce((sum, item) => {
      const rawTotal = bot.total + item.value;
      return sum + (rawTotal === 50 || rawTotal === 100 ? item.probability || 0 : 0);
    }, 0);
  }

  function deliberateDutchFailureOutcome(bot, distribution, ctx) {
    if (ctx.state.round && ctx.state.round.dutchCallerId) return { benefit: 0, probability: 0 };
    return (distribution || []).reduce((outcome, item) => {
      if (item.value > 5) return outcome;
      const ordinaryTotal = scoreAfterRound(bot.total, item.value);
      const failedCallTotal = scoreAfterRound(bot.total, item.value * 2);
      const benefit = Math.max(0, ordinaryTotal - failedCallTotal);
      if (benefit <= 0) return outcome;
      outcome.benefit += (item.probability || 0) * benefit;
      outcome.probability += item.probability || 0;
      return outcome;
    }, { benefit: 0, probability: 0 });
  }

  function isForcedFinalTurn(bot, ctx) {
    const round = ctx.state.round;
    return !!(round && round.dutchCallerId && round.dutchCallerId !== bot.id);
  }

  function finalTurnOutcomeFor(action) {
    return action && action.metadata && action.metadata.finalTurnOutcome || null;
  }

  function finalTurnMateriallyImproves(action, baseline) {
    const candidate = finalTurnOutcomeFor(action);
    const current = finalTurnOutcomeFor(baseline);
    if (!candidate || !current) return false;
    return candidate.expectedOwnTotal < current.expectedOwnTotal - 1e-9 ||
      candidate.ownThresholdSaving > current.ownThresholdSaving + 1e-9 ||
      candidate.callerExpectedTotal > current.callerExpectedTotal + 0.25 ||
      action.estimatedWinProbability > baseline.estimatedWinProbability + 0.01 ||
      action.roundWinProbability > baseline.roundWinProbability + 0.02;
  }

  function finalTurnPileAssessment(bot, incomingCard, replacement, ctx) {
    const entry = effectiveMemory(bot, botMemoryEntry(bot, bot.id, replacement.index));
    const protection = replacement.metadata && replacement.metadata.protection || {};
    const confirmed = isConfirmedCard(entry);
    const knownPoints = confirmed ? cardPoints(entry.card) : null;
    const incomingPoints = cardPoints(incomingCard);
    const guaranteedScoreReduction = confirmed && incomingPoints < knownPoints;
    const protectedKnownLow = confirmed && knownPoints <= 5 && incomingPoints > knownPoints;
    const immediateThrowIn = !!protection.reliableImmediateThrowIn;
    const exactThresholdBenefit = !!protection.exactThresholdBenefit;
    const baseline = currentEvaluation(bot, 'hold-final-turn', { context: ctx });
    const materialRoundImpact = finalTurnMateriallyImproves(replacement, baseline);
    const discardedSpecial = replacement.metadata && replacement.metadata.discarded &&
      SPECIALS.has(replacement.metadata.discarded.rank);
    const specialAltersOutcome = !!(discardedSpecial && materialRoundImpact);
    const eligible = !protectedKnownLow && (
      guaranteedScoreReduction ||
      immediateThrowIn && materialRoundImpact ||
      exactThresholdBenefit ||
      specialAltersOutcome
    );
    return {
      eligible,
      confirmed,
      knownPoints,
      incomingPoints,
      guaranteedScoreReduction,
      protectedKnownLow,
      immediateThrowIn,
      exactThresholdBenefit,
      specialAltersOutcome,
      materialRoundImpact
    };
  }

  function isConfirmedCard(entry) {
    return !!(entry && entry.card && (entry.confidence || 0) >= CONFIRMED_CARD_CONFIDENCE);
  }

  function isRedKing(card) {
    return !!(card && card.rank === 'K' && card.red);
  }

  function botDeliberateDutchHalving(bot) {
    const result = evaluateDutch(bot);
    return result.call.actionValue > result.continue.actionValue;
  }

  function playerRoundWinProbability(ctx, player, distribution) {
    const others = [ctx.bot, ...ctx.opponents].filter((item) => item.id !== player.id);
    return (distribution || []).reduce((sum, outcome) => {
      const noOtherLower = others.reduce((product, other) => (
        product * probabilityAtLeast(ctx.scoreDistributionFor(other), outcome.value)
      ), 1);
      return sum + (outcome.probability || 0) * noOtherLower;
    }, 0);
  }

  function mixDistributions(base, added, addedRetentionProbability) {
    const retained = clamp(addedRetentionProbability);
    return [
      ...base.map((item) => ({ ...item, probability: (item.probability || 0) * (1 - retained) })),
      ...added.map((item) => ({ ...item, probability: (item.probability || 0) * retained }))
    ].filter((item) => item.probability > 0);
  }

  function aceTargetImpact(bot, player, suppliedContext = null) {
    const ctx = suppliedContext || contextFor(bot);
    if (!player || isProtectedSpecialTarget(player.id)) return null;
    const base = ctx.scoreDistributionFor(player);
    const drawPoints = ctx.belief.drawDistribution.map((item) => ({
      value: cardPoints(item.card),
      probability: item.probability
    }));
    const added = addPointDistributions(base, drawPoints);
    const threatProfile = opponentThreatState(bot, ctx).profiles.find((profile) => profile.playerId === player.id);
    const selfKnowledge = threatProfile ? threatProfile.selfKnowledge : opponentSelfKnowledge(bot, player);
    const afterCardCount = player.cards.length + 1;
    const unknownSlotSelectionChance = clamp(
      (0.65 + selfKnowledge.knowledgeRatio * 0.75) / Math.max(1, afterCardCount)
    );
    const top = ctx.state.round && ctx.state.round.discard && ctx.state.round.discard.at(-1);
    const matchingTopChance = top ? ctx.belief.probabilityOfRank(top.rank) : 0;
    const discardAddedChance = clamp(
      unknownSlotSelectionChance * 0.78 +
      matchingTopChance * unknownSlotSelectionChance * 0.12,
      0,
      0.65
    );
    const retainedDistribution = mixDistributions(base, added, 1 - discardAddedChance);
    const beforeMean = distributionMoments(base).mean;
    const afterMean = distributionMoments(retainedDistribution).mean;
    const callProbabilityBefore = probabilityAtMost(base, 5);
    const callProbabilityAfter = probabilityAtMost(retainedDistribution, 5);
    const callProbabilityReduction = Math.max(0, callProbabilityBefore - callProbabilityAfter);
    const roundWinBefore = playerRoundWinProbability(ctx, player, base);
    const roundWinAfter = playerRoundWinProbability(ctx, player, retainedDistribution);
    const roundWinProbabilityReduction = Math.max(0, roundWinBefore - roundWinAfter);
    const knownBefore = player.cards.length
      ? selfKnowledge.knownPositions / player.cards.length
      : 1;
    const knownAfter = selfKnowledge.knownPositions / Math.max(1, afterCardCount);
    const knowledgePositionReduction = Math.max(0, knownBefore - knownAfter);
    const expectedScoreIncrease = Math.max(0, afterMean - beforeMean);
    const expectedDisadvantage = expectedScoreIncrease +
      callProbabilityReduction * 7 +
      roundWinProbabilityReduction * 9 +
      knowledgePositionReduction * 2.5;
    const materialRoundImpact = callProbabilityReduction >= 0.05 ||
      roundWinProbabilityReduction >= 0.05;
    const memory = ensureBotMemory(bot);
    const priorRetaliations = memory && memory.aceAttackers && memory.aceAttackers[player.id] || 0;
    const aceDrawChance = ctx.belief.probabilityOfRank('A');
    const retaliationChance = clamp(
      aceDrawChance * 0.45 * (0.55 + Math.min(0.35, priorRetaliations * 0.1))
    );
    const retaliationCost = retaliationChance * ctx.belief.expectedDrawPoints;

    return {
      player,
      threatProfile: threatProfile || null,
      baseDistribution: base,
      addedDistribution: added,
      retainedDistribution,
      discardAddedChance,
      retainedProbability: 1 - discardAddedChance,
      expectedScoreIncrease,
      callProbabilityBefore,
      callProbabilityAfter,
      callProbabilityReduction,
      roundWinBefore,
      roundWinAfter,
      roundWinProbabilityReduction,
      knowledgePositionReduction,
      expectedDisadvantage,
      materialRoundImpact,
      retaliationChance,
      retaliationCost
    };
  }

  function acePileExposureAssessment(bot, ctx) {
    return discardGiftAssessment(bot, { rank: 'A', suit: 'spades' }, ctx);
  }

  function aceDiscardAssessment(bot, ctx, options = {}) {
    const impacts = ctx.opponents.map((player) => aceTargetImpact(bot, player, ctx)).filter(Boolean);
    const bestTarget = impacts.sort((a, b) => (
      (b.expectedDisadvantage - b.retaliationCost) -
      (a.expectedDisadvantage - a.retaliationCost)
    ))[0] || null;
    const guaranteedScoreIncrease = Math.max(0, options.afterMean - options.beforeMean);
    const aceLowCardRetentionValue = options.aceWasOwned ? 1 : 0;
    const pileExposureAssessment = acePileExposureAssessment(bot, ctx);
    const pileExposureCost = pileExposureAssessment.totalPenalty;
    const retaliationCost = bestTarget ? bestTarget.retaliationCost : 0;
    const opponentExpectedDisadvantage = bestTarget ? bestTarget.expectedDisadvantage : 0;
    const additionalStrategicCost = aceLowCardRetentionValue * 0.35 +
      pileExposureCost + retaliationCost;
    const eligible = guaranteedScoreIncrease <= opponentExpectedDisadvantage + 1e-9;
    return {
      eligible,
      incomingCard: publicMemoryCard(options.incomingCard),
      guaranteedScoreIncrease,
      aceLowCardRetentionValue,
      opponentExpectedDisadvantage,
      pileExposureCost,
      pileExposureAssessment,
      retaliationCost,
      additionalStrategicCost,
      netValue: opponentExpectedDisadvantage - guaranteedScoreIncrease - additionalStrategicCost,
      bestTargetId: bestTarget && bestTarget.player.id || null,
      targets: impacts.map((impact) => ({
        playerId: impact.player.id,
        expectedDisadvantage: impact.expectedDisadvantage,
        expectedScoreIncrease: impact.expectedScoreIncrease,
        discardAddedChance: impact.discardAddedChance,
        callProbabilityReduction: impact.callProbabilityReduction,
        roundWinProbabilityReduction: impact.roundWinProbabilityReduction,
        knowledgePositionReduction: impact.knowledgePositionReduction,
        retaliationChance: impact.retaliationChance,
        retaliationCost: impact.retaliationCost,
        immediateThreat: !!(impact.threatProfile && impact.threatProfile.immediate),
        materialRoundImpact: impact.materialRoundImpact
      }))
    };
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
      return Math.max(0, ...ctx.opponents.map((player) => {
        const impact = aceTargetImpact(bot, player, ctx);
        return impact ? impact.expectedDisadvantage - impact.retaliationCost : 0;
      }));
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

  function discardSpecialEffects(bot, discarded, ctx, aceAssessment = null) {
    if (!discarded || !SPECIALS.has(discarded.rank)) return { informationValue: 0, opponentBenefit: 0 };
    if (discarded.rank === 'Q') return { informationValue: specialStateValue(bot, discarded, ctx), opponentBenefit: 0 };
    if (discarded.rank === 'A') {
      const assessment = aceAssessment || aceDiscardAssessment(bot, ctx, {
        beforeMean: distributionMoments(ctx.scoreDistributionFor(bot)).mean,
        afterMean: distributionMoments(ctx.scoreDistributionFor(bot)).mean,
        incomingCard: null,
        aceWasOwned: false
      });
      return {
        informationValue: 0,
        opponentBenefit: assessment.additionalStrategicCost - assessment.opponentExpectedDisadvantage,
        aceAssessment: assessment
      };
    }
    if (discarded.rank === 'J') return { informationValue: specialStateValue(bot, discarded, ctx) * 0.65, opponentBenefit: -specialStateValue(bot, discarded, ctx) * 0.35 };
    return { informationValue: 0, opponentBenefit: 0 };
  }

  function rankProbability(distribution, rank) {
    return (distribution || []).reduce((sum, item) => (
      sum + (item.card && item.card.rank === rank ? item.probability || 0 : 0)
    ), 0);
  }

  function immediateThrowInReliability(bot, ctx, rank, cardConfidence) {
    const noOpponentMatch = ctx.opponents.reduce((noneAcrossPlayers, player) => (
      noneAcrossPlayers * player.cards.reduce((noneInHand, _, index) => (
        noneInHand * (1 - rankProbability(ctx.slotCardDistributionFor(player, index), rank))
      ), 1)
    ), 1);
    const contentionProbability = Math.max(0, Math.min(1, 1 - noOpponentMatch));
    const profile = botProfile(bot);
    const raceLossShare = Math.max(0.25, Math.min(0.65, 0.65 - (profile.fast || 0) * 0.35));
    const executionProbability = Math.max(
      0,
      Math.min(cardConfidence, cardConfidence * (1 - contentionProbability * raceLossShare))
    );
    let reliability = 'speculative';
    if (cardConfidence >= 0.999 && contentionProbability <= 0.001) {
      reliability = 'guaranteed-current-action';
    } else if (executionProbability >= 0.8) {
      reliability = 'likely-before-interference';
    }
    return { contentionProbability, executionProbability, reliability };
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
    return duplicateRankRetainValue(distributions) * releaseProbability * SPECULATIVE_THROW_IN_WEIGHT;
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
    return matchingPoints * releaseProbability * SPECULATIVE_THROW_IN_WEIGHT;
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
      const throwIn = immediateThrowInReliability(bot, ctx, rank, candidate.confidence);
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
        { probability: throwIn.executionProbability, evaluation: success },
        { probability: 1 - candidate.confidence, evaluation: failure },
        { probability: candidate.confidence - throwIn.executionProbability, evaluation: base }
      ], {
        ...metadata,
        throwInFollowUp: {
          index: candidate.index,
          rank,
          confidence: candidate.confidence,
          expectedMatchingPoints: candidate.expectedMatchingPoints,
          reliability: throwIn.reliability,
          executionProbability: throwIn.executionProbability,
          contentionProbability: throwIn.contentionProbability
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
    const aceAssessment = discarded && discarded.rank === 'A'
      ? aceDiscardAssessment(bot, ctx, {
        beforeMean,
        afterMean,
        incomingCard,
        aceWasOwned: true
      })
      : null;
    const special = discardSpecialEffects(bot, discarded, ctx, aceAssessment);
    const giftAssessment = discarded
      ? (discarded.rank === 'A'
        ? aceAssessment && aceAssessment.pileExposureAssessment
        : discardGiftAssessment(bot, discarded, ctx))
      : null;
    const gift = discarded
      ? (discarded.rank === 'A' ? 0 : giftAssessment.totalPenalty)
      : 0.35;
    const actionType = options.actionType || 'replace';
    const metadata = {
      index,
      incomingCard: publicMemoryCard(incomingCard),
      discarded,
      source: options.source || '',
      aceDiscardAssessment: aceAssessment,
      discardGiftAssessment: giftAssessment
    };
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
    const throwInFollowUp = evaluation.metadata && evaluation.metadata.throwInFollowUp;
    const guaranteedThrowIn = !!(
      throwInFollowUp && throwInFollowUp.reliability === 'guaranteed-current-action'
    );
    const reliableImmediateThrowIn = !!(
      throwInFollowUp && throwInFollowUp.executionProbability >= 0.8
    );
    const specialActionValue = discarded && (discarded.rank === 'A' || discarded.rank === 'J')
      ? specialStateValue(bot, discarded, ctx)
      : 0;
    const thresholdBenefit = Math.max(
      0,
      expectedHalvingBonus(bot, ownDistribution) - expectedHalvingBonus(bot, before)
    );
    const thresholdProbability = exactThresholdProbability(bot, ownDistribution);
    const exactThresholdBenefit = thresholdBenefit > 0 && thresholdProbability >= 0.9;
    const dutchFailure = deliberateDutchFailureOutcome(bot, ownDistribution, ctx);
    const deliberateDutchFailure = dutchFailure.benefit > 0 && dutchFailure.probability >= 0.9;
    const finalTurn = isForcedFinalTurn(bot, ctx);
    const finalTurnMaterialBenefit = finalTurn && finalTurnMateriallyImproves(evaluation, hold);
    const confirmed = isConfirmedCard(entry);
    const confirmedLow = confirmed && cardPoints(entry.card) <= 5;
    const worsensConfirmedCard = confirmed && cardPoints(incomingCard) > cardPoints(entry.card);
    const forcedFinalDefense = finalTurn && finalTurnMaterialBenefit && !confirmedLow;
    const replacingRedKing = worsensConfirmedCard && isRedKing(entry.card);
    const aceActionRejected = !!(aceAssessment && !aceAssessment.eligible);
    const worthwhileSpecial = specialActionValue >= 0.75 && !aceActionRejected &&
      (!finalTurn || finalTurnMaterialBenefit);
    const reliableFinalThrowIn = reliableImmediateThrowIn &&
      (!finalTurn || finalTurnMaterialBenefit);
    const exception = replacingRedKing
      ? (exactThresholdBenefit || deliberateDutchFailure)
      : (reliableFinalThrowIn || worthwhileSpecial || exactThresholdBenefit ||
        deliberateDutchFailure || forcedFinalDefense);
    const eligible = (!worsensConfirmedCard || exception) && !aceActionRejected;
    const pileConcreteBenefit = afterMean < beforeMean - 1e-9 ||
      reliableImmediateThrowIn || worthwhileSpecial || exactThresholdBenefit;
    evaluation.metadata = {
      ...(evaluation.metadata || metadata),
      protection: {
        confirmed,
        confirmedLow,
        worsensConfirmedCard,
        replacingRedKing,
        aceActionRejected,
        eligible,
        guaranteedThrowIn,
        reliableImmediateThrowIn,
        worthwhileSpecial,
        thresholdBenefit,
        thresholdProbability,
        exactThresholdBenefit,
        dutchFailureBenefit: dutchFailure.benefit,
        dutchFailureProbability: dutchFailure.probability,
        deliberateDutchFailure,
        finalTurnMaterialBenefit,
        forcedFinalDefense
      },
      pileConcreteBenefit
    };
    return {
      player: bot,
      index,
      card: entry.card || null,
      memory: botMemoryEntry(bot, bot.id, index),
      expected: distributionMoments(ctx.slotDistributionFor(bot, index)).mean,
      improvement: evaluation.actionValue - hold.actionValue,
      confidence: entry.confidence || 0,
      eligible,
      pileConcreteBenefit,
      rejectionReason: eligible
        ? null
        : (aceActionRejected
          ? 'ace-cost-exceeds-opponent-disadvantage'
          : (replacingRedKing ? 'protected-red-king' : 'protected-confirmed-low-card')),
      ...evaluation
    };
  }

  function botSwapTargets(bot, incomingCard, options = {}) {
    if (!incomingCard) return [];
    const ctx = options.context || contextFor(bot);
    return bot.cards.map((_, index) => evaluateReplacement(bot, incomingCard, index, { ...options, context: ctx }))
      .sort((a, b) => b.actionValue - a.actionValue || a.index - b.index);
  }

  function botBestSwapTarget(bot, incomingCard, options = {}) {
    const targets = botSwapTargets(bot, incomingCard, options);
    const eligibleTargets = targets.filter((target) => target.eligible);
    const selectableTargets = eligibleTargets.length || !options.required ? eligibleTargets : targets;
    const selected = chooseCharacterAction(bot, selectableTargets, random);
    if (selected && ensureBotMemory(bot)) {
      const memory = ensureBotMemory(bot);
      memory.lastDecision = { type: 'replace', actions: targets, selected };
      memory.pendingAceDiscardAssessment = selected.metadata && selected.metadata.aceDiscardAssessment || null;
    }
    return selected;
  }

  function evaluateDeckDiscard(bot, drawnCard, ctx) {
    const before = ctx.scoreDistributionFor(bot);
    const beforeMean = distributionMoments(before).mean;
    const aceAssessment = drawnCard.rank === 'A'
      ? aceDiscardAssessment(bot, ctx, {
        beforeMean,
        afterMean: beforeMean,
        incomingCard: null,
        aceWasOwned: false
      })
      : null;
    const special = discardSpecialEffects(bot, drawnCard, ctx, aceAssessment);
    const giftAssessment = drawnCard.rank === 'A'
      ? aceAssessment && aceAssessment.pileExposureAssessment
      : discardGiftAssessment(bot, drawnCard, ctx);
    const gift = drawnCard.rank === 'A' ? 0 : giftAssessment.totalPenalty;
    const opponentBenefit = gift + special.opponentBenefit;
    const metadata = {
      drawnCard: publicMemoryCard(drawnCard),
      response: 'discard',
      aceDiscardAssessment: aceAssessment,
      discardGiftAssessment: giftAssessment
    };
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

  function projectedFinalTurnImprovement(ctx, player) {
    if (!player.cards.length) return 0;
    const highest = Math.max(...player.cards.map((_, index) => (
      distributionMoments(ctx.slotDistributionFor(player, index)).mean
    )));
    const top = ctx.state.round && ctx.state.round.discard.at(-1);
    const incoming = top ? Math.min(cardPoints(top), ctx.belief.expectedDrawPoints) : ctx.belief.expectedDrawPoints;
    return Math.max(0, highest - incoming);
  }

  function dutchFreezeState(bot, suppliedContext = null) {
    const ctx = suppliedContext || contextFor(bot);
    const round = ctx.state.round;
    const ownDistribution = ctx.scoreDistributionFor(bot);
    const ownAtMostFiveProbability = probabilityAtMost(ownDistribution, 5);
    const confidence = botRoundScoreConfidence(bot);
    let projectedSuccessProbability = 0;
    for (const own of ownDistribution) {
      if (own.value > 5) continue;
      let noOpponentLower = 1;
      for (const opponent of ctx.opponents) {
        const improvement = projectedFinalTurnImprovement(ctx, opponent);
        const projected = ctx.scoreDistributionFor(opponent).map((item) => ({
          value: Math.max(0, item.value - improvement),
          probability: item.probability
        }));
        noOpponentLower *= probabilityAtLeast(projected, own.value);
      }
      projectedSuccessProbability += (own.probability || 0) * noOpponentLower;
    }
    const successfulCallTotal = scoreAfterRound(bot.total, 0);
    const ordinaryExpectedTotal = ownDistribution.reduce((sum, item) => (
      sum + (item.probability || 0) * scoreAfterRound(bot.total, item.value)
    ), 0);
    const gameTotalAlternative = ordinaryExpectedTotal + 0.25 < successfulCallTotal;
    const active = !!(
      round && !round.dutchCallerId && ownAtMostFiveProbability >= 0.9 &&
      confidence >= 0.85 && projectedSuccessProbability >= 0.7 &&
      !gameTotalAlternative
    );
    return {
      active,
      confidence,
      ownAtMostFiveProbability,
      projectedSuccessProbability,
      successfulCallTotal,
      ordinaryExpectedTotal,
      gameTotalAlternative
    };
  }

  function bestResponseToDeckCard(bot, drawnCard, ctx, options = {}) {
    const discard = evaluateDeckDiscard(bot, drawnCard, ctx);
    if (options.freeze && options.freeze.active) return discard;
    const swaps = botSwapTargets(bot, drawnCard, { context: ctx, actionType: 'swap-drawn', source: 'deck' });
    return [discard, ...swaps.filter((swap) => swap.eligible)]
      .sort((a, b) => b.actionValue - a.actionValue)[0];
  }

  function evaluateDrawSources(bot) {
    const ctx = contextFor(bot);
    const round = ctx.state.round;
    const top = round && round.discard[round.discard.length - 1];
    const freeze = dutchFreezeState(bot, ctx);
    let pile = null;
    if (top && bot.cards.length) {
      const replacements = botSwapTargets(bot, top, { context: ctx, actionType: 'take-pile', source: 'pile' });
      if (isForcedFinalTurn(bot, ctx)) {
        for (const replacement of replacements) {
          replacement.metadata.finalTurnPile = finalTurnPileAssessment(bot, top, replacement, ctx);
        }
        pile = replacements.find((replacement) => (
          replacement.eligible && replacement.metadata.finalTurnPile.eligible
        )) || null;
      } else {
        pile = replacements.find((replacement) => replacement.eligible && replacement.pileConcreteBenefit) || null;
      }
      if (pile) pile.metadata = { ...pile.metadata, source: 'pile', replacements };
    }
    const branches = ctx.belief.drawDistribution.map((item) => ({
      probability: item.probability,
      card: item.card,
      evaluation: bestResponseToDeckCard(bot, item.card, ctx, { freeze })
    }));
    const deck = mixActionEvaluations('draw-deck', branches, { source: 'deck', dutchFreeze: freeze });
    const actions = [pile, deck].filter(Boolean);
    const pendingRecovery = ctx.memory && ctx.memory.pendingRedKingRecovery;
    const recoveringRedKing = !!(
      pendingRecovery && pile && top && isRedKing(publicMemoryCard(top)) &&
      (!pendingRecovery.cardId || pendingRecovery.cardId === top.id)
    );
    const selected = recoveringRedKing
      ? pile
      : (freeze.active ? deck : chooseCharacterAction(bot, actions, random));
    if (recoveringRedKing) pile.metadata = { ...pile.metadata, guaranteedRedKingRecovery: true };
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
    const freeze = dutchFreezeState(bot, ctx);
    if (freeze.active) {
      if (ctx.memory) {
        ctx.memory.lastDecision = { type: 'draw-response', actions: [discard], selected: discard, dutchFreeze: freeze };
        ctx.memory.pendingAceDiscardAssessment =
          discard.metadata && discard.metadata.aceDiscardAssessment || null;
      }
      return false;
    }
    const swaps = botSwapTargets(bot, drawnCard, { context: ctx, actionType: 'swap-drawn', source: 'deck' });
    const selected = chooseCharacterAction(bot, [discard, ...swaps.filter((swap) => swap.eligible)], random);
    if (ctx.memory) {
      ctx.memory.lastDecision = { type: 'draw-response', actions: [discard, ...swaps], selected };
      ctx.memory.pendingAceDiscardAssessment =
        selected && selected.metadata && selected.metadata.aceDiscardAssessment || null;
    }
    return !!selected && selected.actionType === 'swap-drawn';
  }

  function botBestOwnSlot(bot, mode = 'highest') {
    const ctx = contextFor(bot);
    const slots = bot.cards.map((_, index) => {
      const memory = effectiveMemory(bot, botMemoryEntry(bot, bot.id, index));
      return {
        player: bot,
        index,
        card: memory.card || null,
        memory,
        expected: distributionMoments(ctx.slotDistributionFor(bot, index)).mean
      };
    });
    return slots.sort((a, b) => mode === 'lowest' ? a.expected - b.expected : b.expected - a.expected)[0] || null;
  }

  function botLowOpponentSlot(bot) {
    const ctx = contextFor(bot);
    return ctx.opponents.flatMap((player) => player.cards.map((_, index) => {
      const memory = effectiveMemory(bot, botMemoryEntry(bot, player.id, index));
      return {
        player,
        index,
        card: memory.card || null,
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

  function conditionalProbabilityRange(ctx, player, index, threshold) {
    const slot = ctx.slotDistributionFor(player, index);
    const rest = ctx.scoreWithoutSlotFor(player, index);
    const values = Array.from(new Set(slot.map((item) => item.value)));
    if (values.length <= 1) return 0;
    const probabilities = values.map((value) => probabilityAtMost(
      addPointDistributions(rest, deterministicPointDistribution(value)),
      threshold
    ));
    return Math.max(...probabilities) - Math.min(...probabilities);
  }

  function conditionalThresholdRange(ctx, player, index) {
    const slot = ctx.slotDistributionFor(player, index);
    const rest = ctx.scoreWithoutSlotFor(player, index);
    const values = Array.from(new Set(slot.map((item) => item.value)));
    if (values.length <= 1) return 0;
    const exactProbability = (distribution, value) => distribution.reduce((sum, item) => (
      sum + (Math.abs(item.value - value) < 1e-9 ? item.probability || 0 : 0)
    ), 0);
    let largestRange = 0;
    for (const threshold of [50, 100]) {
      const ordinary = values.map((value) => exactProbability(rest, threshold - player.total - value));
      largestRange = Math.max(largestRange, Math.max(...ordinary) - Math.min(...ordinary));
      if (player.id === ctx.bot.id) {
        const failedDutch = values.map((value) => exactProbability(rest, (threshold - player.total) / 2 - value));
        largestRange = Math.max(largestRange, Math.max(...failedDutch) - Math.min(...failedDutch));
      }
    }
    return largestRange;
  }

  function queenDecisionWindow(bot, ctx) {
    const round = ctx.state.round || {};
    const queue = Array.isArray(round.specialQueue) ? round.specialQueue : [];
    const currentQueenIndex = queue.findIndex((special) => special.type === 'Q' && special.actorId === bot.id);
    const later = currentQueenIndex >= 0 ? queue.slice(currentQueenIndex + 1) : queue.slice(1);
    const queuedJack = later.some((special) => special.type === 'J' && special.actorId === bot.id);
    const queuedAce = later.some((special) => special.type === 'A' && special.actorId === bot.id);
    const forcedFinalTurn = !!(round.dutchCallerId && round.dutchCallerId !== bot.id);
    const committedDutch = round.dutchCallerId === bot.id || bot.cards.length === 0 ||
      dutchFreezeState(bot, ctx).active;
    const throwInRank = round.throwIn && round.throwIn.open ? round.throwIn.rank : null;
    return {
      committedDutch,
      forcedFinalTurn,
      futureTurn: !round.dutchCallerId,
      queuedJack,
      queuedAce,
      throwInRank
    };
  }

  function evaluateQueenTarget(bot, player, index, suppliedContext = null, suppliedWindow = null) {
    const ctx = suppliedContext || contextFor(bot);
    const window = suppliedWindow || queenDecisionWindow(bot, ctx);
    if (!player || isProtectedSpecialTarget(player.id) || !player.cards[index]) return null;
    const pointDistribution = ctx.slotDistributionFor(player, index);
    const cardDistribution = ctx.slotCardDistributionFor(player, index);
    const moments = distributionMoments(pointDistribution);
    const memory = effectiveMemory(bot, botMemoryEntry(bot, player.id, index));
    const uncertainty = Math.max(
      entropy(pointDistribution),
      entropy(cardDistribution) * 0.45
    ) * (1 - (memory.confidence || 0) * 0.7);
    const alreadyKnown = (memory.confidence || 0) >= 0.999 ||
      (moments.variance <= 1e-9 && entropy(cardDistribution) <= 0.01);
    const ownCard = player.id === bot.id;
    const humanOpponent = !ownCard && !player.isBot;
    const threatProfile = opponentThreatState(bot, ctx).profiles.find((profile) => profile.playerId === player.id);
    const highCardProbability = pointDistribution.reduce((sum, item) => (
      sum + (item.value >= 8 ? item.probability || 0 : 0)
    ), 0);
    const highCardExposure = pointDistribution.reduce((sum, item) => (
      sum + (item.probability || 0) * Math.max(0, item.value - 6)
    ), 0);
    const callSwing = conditionalProbabilityRange(ctx, player, index, 5);
    const nearFiveSwing = conditionalProbabilityRange(ctx, player, index, 7);
    const thresholdSwing = conditionalThresholdRange(ctx, player, index);
    const matchingThrowInProbability = ownCard && window.throwInRank
      ? rankProbability(cardDistribution, window.throwInRank)
      : 0;
    const replacementValue = ownCard && window.futureTurn
      ? uncertainty * (0.35 + highCardExposure * 0.42 + highCardProbability * 0.9)
      : 0;
    const jackTargetValue = (window.queuedJack || window.futureTurn)
      ? uncertainty * (Math.sqrt(Math.max(0, moments.variance)) * 0.22 + Math.abs(moments.mean - 6) * 0.08) *
        (window.queuedJack ? 1.35 : 0.24)
      : 0;
    const aceTargetValue = !ownCard && (window.queuedAce || window.futureTurn)
      ? uncertainty * (callSwing * 4 + nearFiveSwing * 1.4 + (threatProfile && threatProfile.score || 0) * 0.45) *
        (window.queuedAce ? 1.45 : 0.22)
      : 0;
    const throwInValue = matchingThrowInProbability > 0
      ? matchingThrowInProbability * (0.5 + Math.max(0, moments.mean) * 0.22) * uncertainty
      : 0;
    const dutchCallValue = !ctx.state.round.dutchCallerId
      ? uncertainty * callSwing * (ownCard ? 7 : 5.2) *
        (1 + (threatProfile && threatProfile.score || 0))
      : 0;
    const threatClassificationValue = humanOpponent
      ? uncertainty * (callSwing * 4.8 + nearFiveSwing * 2.2) *
        (1 + (threatProfile && threatProfile.score || 0) * 1.5)
      : 0;
    const thresholdValue = uncertainty * thresholdSwing * 7;
    const impacts = {
      replacement: replacementValue,
      jackTarget: jackTargetValue,
      aceTarget: aceTargetValue,
      throwIn: throwInValue,
      dutchCall: dutchCallValue,
      threatClassification: threatClassificationValue,
      scoreThreshold: thresholdValue
    };
    const reasons = Object.entries(impacts)
      .filter(([, value]) => value >= 0.12)
      .map(([reason]) => reason);
    const laterChoiceCanUseInformation = !window.forcedFinalTurn ||
      throwInValue >= 0.12 || window.queuedJack || window.queuedAce;
    const eligible = !alreadyKnown && !window.committedDutch &&
      laterChoiceCanUseInformation && reasons.length > 0;
    const informationValue = eligible
      ? Object.values(impacts).reduce((sum, value) => sum + value, 0)
      : 0;
    return {
      player,
      index,
      memory,
      expected: moments.mean,
      informationValue,
      eligible,
      rejectionReason: eligible ? null : (
        alreadyKnown ? 'queen-card-already-known' :
          window.committedDutch ? 'queen-dutch-committed' :
            !laterChoiceCanUseInformation ? 'queen-final-turn-no-usable-choice' :
              'queen-information-cannot-change-decision'
      ),
      queenDecisionImpact: {
        ...impacts,
        reasons,
        uncertainty,
        highCardProbability,
        highCardExposure,
        callSwing,
        nearFiveSwing,
        thresholdSwing,
        matchingThrowInProbability,
        humanOpponent,
        immediateThreat: !!(threatProfile && threatProfile.immediate),
        ...window
      }
    };
  }

  function allSlotTargets(bot, suppliedContext = null) {
    const ctx = suppliedContext || contextFor(bot);
    const window = queenDecisionWindow(bot, ctx);
    const targets = [];
    for (const player of [bot, ...ctx.opponents]) {
      if (isProtectedSpecialTarget(player.id)) continue;
      for (let index = 0; index < player.cards.length; index += 1) {
        const target = evaluateQueenTarget(bot, player, index, ctx, window);
        if (target) targets.push(target);
      }
    }
    return targets;
  }

  function botQueenTargets(bot) {
    const all = allSlotTargets(bot).filter((target) => target.eligible);
    return {
      ownUnknown: all.filter((target) => target.player.id === bot.id)
        .sort((a, b) => b.informationValue - a.informationValue),
      opponentUnknown: all.filter((target) => target.player.id !== bot.id)
        .sort((a, b) => b.informationValue - a.informationValue)
    };
  }

  function botQueenTarget(bot) {
    const ctx = contextFor(bot);
    const freeze = dutchFreezeState(bot, ctx);
    const targets = allSlotTargets(bot, ctx);
    if (freeze.active) {
      recordDecisionDiagnostic(bot, 'queen-target', targets, null, { dutchFreeze: freeze });
      return null;
    }
    const actions = targets.map((target) => ({
      ...target,
      ...currentEvaluation(bot, 'queen-peek', {
        context: ctx,
        informationValue: target.informationValue,
        metadata: {
          targetId: target.player.id,
          index: target.index,
          threatRelevantInformation: target.queenDecisionImpact.humanOpponent &&
            target.queenDecisionImpact.immediateThreat,
          queenDecisionImpact: target.queenDecisionImpact,
          eligible: target.eligible,
          rejectionReason: target.rejectionReason
        }
      })
    }));
    const selected = chooseCharacterAction(bot, actions.filter((action) => action.eligible), random);
    recordDecisionDiagnostic(bot, 'queen-target', actions, selected);
    return selected;
  }

  function botAceTargetScore(bot, estimate) {
    const target = evaluateAceTarget(bot, estimate.player);
    return target ? target.actionValue : -Infinity;
  }

  function evaluateAceTarget(bot, player, suppliedContext = null) {
    const ctx = suppliedContext || contextFor(bot);
    const impact = aceTargetImpact(bot, player, ctx);
    if (!impact) return null;
    const overrides = new Map([[player.id, impact.retainedDistribution]]);
    const memory = ensureBotMemory(bot);
    const pending = memory && memory.pendingAceDiscardAssessment;
    const guaranteedBotIncrease = pending && pending.guaranteedScoreIncrease || 0;
    const costExceedsDisadvantage = guaranteedBotIncrease > impact.expectedDisadvantage + 1e-9;
    const immediateThreat = !!(impact.threatProfile && impact.threatProfile.immediate);
    const strongThreatBonus = immediateThreat && impact.materialRoundImpact
      ? impact.callProbabilityReduction * 18 +
        impact.roundWinProbabilityReduction * 24 +
        impact.knowledgePositionReduction * 6
      : 0;
    const finalTurn = isForcedFinalTurn(bot, ctx);
    const nonThreatPenalty = finalTurn || immediateThreat ? 0 : 2.25;
    const weakImpactPenalty = finalTurn || impact.materialRoundImpact ? 0 : 1.25;
    const evaluation = currentEvaluation(bot, 'ace-add', {
      context: ctx,
      opponentDistributions: opponentDistributions(ctx, overrides),
      opponentBenefit: finalTurn ? 0 : impact.retaliationCost - impact.expectedScoreIncrease,
      metadata: { targetId: player.id, threatRelevantInformation: true }
    });
    if (!finalTurn) {
      evaluation.actionValue += strongThreatBonus - nonThreatPenalty - weakImpactPenalty;
      evaluation.finalActionValue = evaluation.actionValue;
    }
    const finalBaseline = finalTurn
      ? currentEvaluation(bot, 'skip-ace-final-turn', { context: ctx })
      : null;
    const finalTurnMaterialImpact = finalTurn &&
      finalTurnMateriallyImproves(evaluation, finalBaseline);
    const eligible = !costExceedsDisadvantage &&
      impact.expectedDisadvantage > impact.retaliationCost + 0.05 &&
      (!finalTurn || finalTurnMaterialImpact);
    evaluation.metadata.aceImpact = {
      expectedScoreIncrease: impact.expectedScoreIncrease,
      discardAddedChance: impact.discardAddedChance,
      retainedProbability: impact.retainedProbability,
      callProbabilityReduction: impact.callProbabilityReduction,
      roundWinProbabilityReduction: impact.roundWinProbabilityReduction,
      knowledgePositionReduction: impact.knowledgePositionReduction,
      expectedDisadvantage: impact.expectedDisadvantage,
      materialRoundImpact: impact.materialRoundImpact,
      retaliationChance: impact.retaliationChance,
      retaliationCost: impact.retaliationCost,
      guaranteedBotIncrease,
      costExceedsDisadvantage,
      immediateThreat,
      strongThreatBonus,
      nonThreatPenalty,
      weakImpactPenalty,
      finalTurn,
      finalTurnMaterialImpact,
      eligible
    };
    evaluation.metadata.threatAttackBonus = strongThreatBonus;
    evaluation.metadata.targetThreat = impact.threatProfile || null;
    return {
      player,
      expected: distributionMoments(impact.baseDistribution).mean,
      cards: player.cards.length,
      total: player.total,
      aceScore: evaluation.actionValue,
      eligible,
      rejectionReason: eligible ? null : (
        costExceedsDisadvantage
          ? 'ace-cost-exceeds-opponent-disadvantage'
          : (finalTurn && !finalTurnMaterialImpact
            ? 'ace-does-not-alter-final-outcome'
            : 'ace-impact-too-weak')
      ),
      ...evaluation
    };
  }

  function botAceTarget(bot) {
    const ctx = contextFor(bot);
    const freeze = dutchFreezeState(bot, ctx);
    const memory = ensureBotMemory(bot);
    if (freeze.active) {
      if (memory) memory.pendingAceDiscardAssessment = null;
      recordDecisionDiagnostic(bot, 'ace-target', [], null, { dutchFreeze: freeze });
      return null;
    }
    const actions = ctx.opponents.map((player) => evaluateAceTarget(bot, player, ctx)).filter(Boolean);
    const eligibleActions = actions.filter((action) => action.eligible);
    const selected = chooseCharacterAction(bot, eligibleActions, random);
    if (memory) memory.pendingAceDiscardAssessment = null;
    recordDecisionDiagnostic(bot, 'ace-target', actions, selected);
    return selected;
  }

  function humanDutchThreat(bot, human, ctx) {
    const profile = opponentThreatState(bot, ctx).profiles.find((item) => item.playerId === human.id);
    if (profile) return 1 + profile.score * 2.7 + profile.callBeforeNextProbability * 1.2;
    return 1;
  }

  function jackHumanDisruption(bot, a, b, ctx) {
    const humanMemoryEntry = deps.effectiveHumanMemory || (() => ({
      state: 'unknown',
      confidence: 0,
      card: null
    }));
    const humans = ctx.opponents.filter((player) => !player.isBot);
    let invalidatedPositions = 0;
    let knowledgeLossValue = 0;
    let knownLowRemovedValue = 0;
    let threatDamageValue = 0;
    const affectedHumans = [];

    for (const human of humans) {
      const threat = humanDutchThreat(bot, human, ctx);
      let humanLoss = 0;
      let humanInvalidated = 0;
      for (const [slot, incoming] of [[a, b], [b, a]]) {
        const remembered = humanMemoryEntry(bot, human.id, slot.player.id, slot.index);
        const confidence = remembered.confidence || 0;
        if (!remembered.card || confidence < 0.28) continue;
        const points = cardPoints(remembered.card);
        const cardKnowledgeValue = 1 + Math.max(0, 7 - points) * 0.2 + Math.max(0, points - 8) * 0.06;
        humanInvalidated += 1;
        humanLoss += confidence * cardKnowledgeValue * threat;
        if (
          slot.player.id === human.id && points <= 5 &&
          incoming.expected > points + 0.5
        ) {
          knownLowRemovedValue += (incoming.expected - points) * confidence * threat * 0.55;
        }
      }
      for (const [slot, incoming] of [[a, b], [b, a]]) {
        if (slot.player.id !== human.id) continue;
        threatDamageValue += Math.max(0, incoming.expected - slot.expected) * threat * 0.48;
      }
      if (humanInvalidated > 0) {
        invalidatedPositions += humanInvalidated;
        knowledgeLossValue += humanLoss;
        affectedHumans.push({
          playerId: human.id,
          invalidatedPositions: humanInvalidated,
          knowledgeLossValue: humanLoss,
          threat
        });
      }
    }

    return {
      invalidatedPositions,
      knowledgeLossValue,
      knownLowRemovedValue,
      threatDamageValue,
      affectedHumans
    };
  }

  function botJackCandidates(bot) {
    const ctx = contextFor(bot);
    if (dutchFreezeState(bot, ctx).active) return [];
    const slots = [];
    for (const player of [bot, ...ctx.opponents]) {
      if (isProtectedSpecialTarget(player.id)) continue;
      for (let index = 0; index < player.cards.length; index += 1) {
        const effective = effectiveMemory(bot, botMemoryEntry(bot, player.id, index));
        slots.push({
          player,
          index,
          card: effective.card || null,
          distribution: ctx.slotDistributionFor(player, index),
          cardDistribution: ctx.slotCardDistributionFor(player, index),
          expected: distributionMoments(ctx.slotDistributionFor(player, index)).mean,
          confidence: effective.confidence || 0,
          effective
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
    const knownOwnSlots = slots.filter((slot) => (
      slot.player.id === bot.id && slot.confidence >= CONFIRMED_CARD_CONFIDENCE
    ));
    const knownOpponentSlots = slots.filter((slot) => (
      slot.player.id !== bot.id && slot.confidence >= CONFIRMED_CARD_CONFIDENCE
    ));
    const highestKnownOwn = knownOwnSlots.sort((a, b) => b.expected - a.expected)[0] || null;
    const lowestKnownOpponent = knownOpponentSlots.sort((a, b) => a.expected - b.expected)[0] || null;
    const memoryRevision = ensureBotMemory(bot).humanKnowledgeRevision || 0;
    for (let first = 0; first < slots.length; first += 1) {
      for (let second = first + 1; second < slots.length; second += 1) {
        const a = slots[first];
        const b = slots[second];
        const disruption = jackHumanDisruption(bot, a, b, ctx);
        if (
          a.player.id === b.player.id &&
          (a.player.isBot || disruption.knowledgeLossValue <= 0)
        ) continue;
        const ownOutgoing = a.player.id === bot.id ? a : (b.player.id === bot.id ? b : null);
        const ownIncoming = ownOutgoing === a ? b : a;
        if (
          ownOutgoing && isConfirmedCard(ownOutgoing.effective) &&
          isRedKing(ownOutgoing.effective.card) && ownIncoming.expected > 0
        ) continue;
        if (
          isForcedFinalTurn(bot, ctx) && ownOutgoing &&
          isConfirmedCard(ownOutgoing.effective) &&
          cardPoints(ownOutgoing.effective.card) <= 5 &&
          ownIncoming.expected > ownOutgoing.expected
        ) continue;
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
        const directHandImprovement = ownOutgoing && ownIncoming &&
          ownOutgoing.confidence >= CONFIRMED_CARD_CONFIDENCE &&
          ownIncoming.confidence >= CONFIRMED_CARD_CONFIDENCE
          ? Math.max(0, ownOutgoing.expected - ownIncoming.expected) *
            Math.min(ownOutgoing.confidence, ownIncoming.confidence)
          : 0;
        const directPriority = !!(
          highestKnownOwn && lowestKnownOpponent && ownOutgoing && ownIncoming &&
          ownOutgoing.player.id === highestKnownOwn.player.id &&
          ownOutgoing.index === highestKnownOwn.index &&
          ownIncoming.player.id === lowestKnownOpponent.player.id &&
          ownIncoming.index === lowestKnownOpponent.index
        );
        const directImprovementValue = directHandImprovement * 2.8 + (directPriority ? 3 : 0);
        const disruptionValue = disruption.knowledgeLossValue * 1.15 +
          disruption.knownLowRemovedValue + disruption.threatDamageValue;
        const jackThreatBonus = [[a, b], [b, a]].reduce((sum, [slot, incoming]) => {
          const profile = opponentThreatState(bot, ctx).profiles.find((item) => item.playerId === slot.player.id);
          if (!profile || !profile.immediate) return sum;
          return sum + Math.max(0, incoming.expected - slot.expected) * (0.75 + profile.score);
        }, 0);
        const dualPurpose = directHandImprovement > 0 && (
          disruption.knowledgeLossValue > 0 ||
          disruption.knownLowRemovedValue > 0 ||
          disruption.threatDamageValue > 0
        );
        const dualPurposeBonus = dualPurpose
          ? 2.5 + directHandImprovement * 0.75 + disruptionValue * 0.45
          : 0;
        const informationValue = (1 - Math.min(a.confidence, b.confidence)) * 0.35 +
          disruption.knowledgeLossValue;
        const evaluation = currentEvaluation(bot, 'jack-swap', {
          context: ctx,
          ownDistribution,
          opponentDistributions: opponentDistributions(ctx, overridesByPlayer),
          informationValue,
          futureThrowInScoreSaving,
          metadata: {
            a: { playerId: a.player.id, index: a.index },
            b: { playerId: b.player.id, index: b.index },
            approximate,
            humanKnowledgeRevision: memoryRevision,
            directHandImprovement,
            directPriority,
            disruption,
            dualPurpose,
            jackThreatBonus
          }
        });
        const finalTurn = isForcedFinalTurn(bot, ctx);
        const finalTurnMaterialImpact = finalTurn &&
          finalTurnMateriallyImproves(evaluation, baseline);
        evaluation.metadata.finalTurnMaterialImpact = finalTurnMaterialImpact;
        if (finalTurn && !finalTurnMaterialImpact) continue;
        if (!finalTurn) {
          evaluation.actionValue += directImprovementValue + disruptionValue + dualPurposeBonus + jackThreatBonus;
          evaluation.finalActionValue = evaluation.actionValue;
        }
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
    const knownThrowRanks = new Map();
    const ownKnownRanks = new Map();
    for (let index = 0; index < ctx.bot.cards.length; index += 1) {
      const entry = effectiveMemory(ctx.bot, botMemoryEntry(ctx.bot, ctx.bot.id, index));
      if (!entry.card || (entry.confidence || 0) < 0.999) continue;
      ownKnownRanks.set(entry.card.rank, (ownKnownRanks.get(entry.card.rank) || 0) + 1);
    }
    knownThrowRanks.set(ctx.bot.id, ownKnownRanks);
    return {
      hands,
      initialScores: new Map(Array.from(hands, ([playerId, cards]) => [playerId, handScore(cards)])),
      callerThrowIns: new Map(),
      knownThrowRanks
    };
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
    const threatProfile = opponentThreatState(ctx.bot, ctx).profiles.find((profile) => profile.playerId === player.id);
    if (threatProfile) probability = Math.max(
      probability,
      threatProfile.callBeforeNextProbability * 0.86
    );
    return probability;
  }

  function probabilityAnyOpponentLower(ctx, ownScore) {
    return 1 - opponentDistributions(ctx).reduce((noOpponentLower, opponent) => (
      noOpponentLower * probabilityAtLeast(opponent.distribution, ownScore)
    ), 1);
  }

  function rolloutBotCalls(bot, world, ctx) {
    const ownScore = handScore(world.hands.get(bot.id));
    if (ownScore > 5) {
      const doubledScore = ownScore * 2;
      const rawFailedTotal = bot.total + doubledScore;
      const failedTotal = scoreAfterRound(bot.total, doubledScore);
      const ordinaryTotal = scoreAfterRound(bot.total, ownScore);
      const successfulTotal = scoreAfterRound(bot.total, 0);
      return (rawFailedTotal === 50 || rawFailedTotal === 100) &&
        failedTotal < ordinaryTotal && failedTotal < successfulTotal;
    }
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

  function simulateCallerFinalThrowIn(world, caller, topCard, ctx) {
    if (!topCard || caller.id !== ctx.bot.id) return topCard;
    const knownRanks = world.knownThrowRanks.get(caller.id);
    if (!knownRanks || (knownRanks.get(topCard.rank) || 0) <= 0) return topCard;
    const hand = world.hands.get(caller.id) || [];
    let bestIndex = -1;
    for (let index = 0; index < hand.length; index += 1) {
      const card = hand[index];
      if (!card || card.rank !== topCard.rank || SPECIALS.has(card.rank) || isRedKing(publicMemoryCard(card))) continue;
      if (bestIndex < 0 || cardPoints(card) > cardPoints(hand[bestIndex])) bestIndex = index;
    }
    if (bestIndex < 0) return topCard;
    const thrown = hand.splice(bestIndex, 1)[0];
    knownRanks.set(thrown.rank, Math.max(0, (knownRanks.get(thrown.rank) || 0) - 1));
    world.callerThrowIns.set(caller.id, (world.callerThrowIns.get(caller.id) || 0) + 1);
    return thrown;
  }

  function simulateFinalQueue(world, caller, ctx, rng, topCard) {
    const initialThrowInOpen = !!(ctx.state.round && ctx.state.round.throwIn && ctx.state.round.throwIn.open);
    let nextTop = initialThrowInOpen
      ? simulateCallerFinalThrowIn(world, caller, topCard, ctx) : topCard;
    for (const player of activePlayersAfter(ctx, caller.id)) {
      nextTop = simulateRolloutTurn(world, player, ctx, rng, nextTop, caller.id);
      nextTop = simulateCallerFinalThrowIn(world, caller, nextTop, ctx);
    }
    return nextTop;
  }

  function addRollout(bucket, world, ctx) {
    bucket.count += 1;
    const ownScore = handScore(world.hands.get(ctx.bot.id));
    bucket.own.set(ownScore, (bucket.own.get(ownScore) || 0) + 1);
    const opponentScores = [];
    for (const opponent of ctx.opponents) {
      const score = handScore(world.hands.get(opponent.id));
      opponentScores.push({ player: opponent, score });
      const counts = bucket.opponents.get(opponent.id);
      counts.set(score, (counts.get(score) || 0) + 1);
    }
    if (bucket.callerId !== ctx.bot.id) return;
    const success = ownScore <= 5 && opponentScores.every((item) => item.score >= ownScore);
    const doubledScore = ownScore * 2;
    const roundScore = success ? 0 : doubledScore;
    const rawTotal = ctx.bot.total + roundScore;
    const resultingTotal = scoreAfterRound(ctx.bot.total, roundScore);
    const winningTotal = scoreAfterRound(ctx.bot.total, 0);
    const ordinaryTotal = scoreAfterRound(ctx.bot.total, ownScore);
    const exactThreshold = rawTotal === 50 || rawTotal === 100;
    const beneficialFailure = !success && exactThreshold &&
      resultingTotal < winningTotal && resultingTotal < ordinaryTotal;
    const opponentTotals = opponentScores.map((item) => ({
      id: item.player.id,
      total: scoreAfterRound(item.player.total, item.score)
    }));
    const gameWinProbability = projectedGameWinProbability(
      ctx.bot,
      resultingTotal,
      opponentTotals,
      ctx.state.gameTarget || 100
    );
    const initialScore = world.initialScores.get(ctx.bot.id);
    const throwInCount = world.callerThrowIns.get(ctx.bot.id) || 0;
    const stats = bucket.callStats;
    stats.finalHandScore += ownScore;
    stats.roundScore += roundScore;
    stats.roundScoreSquared += roundScore * roundScore;
    stats.resultingTotal += resultingTotal;
    stats.gameWinProbability += gameWinProbability;
    if (ownScore <= 5) stats.finalAtMostFive += 1;
    if (success) stats.successes += 1;
    else {
      stats.failures += 1;
      stats.failedDoubledScore += doubledScore;
    }
    if (exactThreshold) stats.exactThresholdOutcomes += 1;
    if (!success && exactThreshold) stats.exactThresholdFailures += 1;
    if (beneficialFailure) stats.beneficialFailures += 1;
    if (initialScore > 5 && ownScore <= 5 && throwInCount > 0) stats.finalThrowInToFive += 1;
    const outcomeKey = [ownScore, success ? 'success' : 'failure', resultingTotal].join(':');
    const outcome = stats.outcomes.get(outcomeKey) || {
      finalHandScore: ownScore,
      success,
      doubledScore,
      rawTotal,
      exactThreshold,
      totalAfterHalving: resultingTotal,
      beneficialFailure,
      count: 0,
      gameWinProbability: 0
    };
    outcome.count += 1;
    outcome.gameWinProbability += gameWinProbability;
    stats.outcomes.set(outcomeKey, outcome);
  }

  function createRolloutBucket(ctx, callerId = null) {
    return {
      callerId,
      count: 0,
      own: new Map(),
      opponents: new Map(ctx.opponents.map((player) => [player.id, new Map()])),
      callStats: {
        finalHandScore: 0,
        finalAtMostFive: 0,
        finalThrowInToFive: 0,
        successes: 0,
        failures: 0,
        failedDoubledScore: 0,
        roundScore: 0,
        roundScoreSquared: 0,
        resultingTotal: 0,
        exactThresholdOutcomes: 0,
        exactThresholdFailures: 0,
        beneficialFailures: 0,
        gameWinProbability: 0,
        outcomes: new Map()
      }
    };
  }

  function dutchCallModel(bucket) {
    const samples = Math.max(1, bucket.count);
    const stats = bucket.callStats;
    return {
      samples: bucket.count,
      expectedFinalHandScore: stats.finalHandScore / samples,
      finalHandAtMostFiveProbability: stats.finalAtMostFive / samples,
      guaranteedFinalThrowInToFiveProbability: stats.finalThrowInToFive / samples,
      successProbability: stats.successes / samples,
      failureProbability: stats.failures / samples,
      expectedFailedDoubledScore: stats.failures ? stats.failedDoubledScore / stats.failures : 0,
      expectedRoundScore: stats.roundScore / samples,
      expectedResultingTotal: stats.resultingTotal / samples,
      exactThresholdOutcomeProbability: stats.exactThresholdOutcomes / samples,
      exactThresholdFailureProbability: stats.exactThresholdFailures / samples,
      beneficialFailureProbability: stats.beneficialFailures / samples,
      estimatedGameWinProbability: stats.gameWinProbability / samples,
      outcomes: Array.from(stats.outcomes.values(), (outcome) => ({
        finalHandScore: outcome.finalHandScore,
        probability: outcome.count / samples,
        success: outcome.success,
        doubledScore: outcome.doubledScore,
        rawTotal: outcome.rawTotal,
        exactThreshold: outcome.exactThreshold,
        totalAfterHalving: outcome.totalAfterHalving,
        beneficialFailure: outcome.beneficialFailure,
        gameWinProbability: outcome.gameWinProbability / outcome.count
      })).sort((a, b) => a.finalHandScore - b.finalHandScore || Number(b.success) - Number(a.success))
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

    const callModel = dutchCallModel(callBucket);
    const call = evaluationFromBucket(bot, ctx, callBucket, 'call-dutch', {
      samples,
      searchDepth: limits.depth,
      simulatedFinalTurns: true,
      finalOpponentExpectedScores: ctx.opponents.map((player) => ({
        playerId: player.id,
        score: distributionMoments(normalizedCounts(callBucket.opponents.get(player.id), callBucket.count)).mean
      })),
      deliberateCallModel: callModel
    });
    const priorStrategicAdjustment = call.actionValue - call.gameOutcomeValue;
    call.dutchSuccessProbability = callModel.successProbability;
    call.expectedRawHandScore = callModel.expectedFinalHandScore;
    call.expectedRoundScore = callModel.expectedRoundScore;
    call.expectedGameScore = callModel.expectedResultingTotal;
    call.expectedPostRoundTotal = callModel.outcomes.reduce((sum, outcome) => (
      sum + outcome.probability * outcome.rawTotal
    ), 0);
    call.expectedThresholdAdjustedTotal = callModel.expectedResultingTotal;
    call.expectedThresholdAdjustment = Math.max(
      0,
      call.expectedPostRoundTotal - call.expectedThresholdAdjustedTotal
    );
    call.probabilityCrossingTarget = callModel.outcomes.reduce((sum, outcome) => (
      sum + (outcome.totalAfterHalving > (ctx.state.gameTarget || 100) ? outcome.probability : 0)
    ), 0);
    call.probabilityGameEnds = 1 - (
      1 - call.probabilityCrossingTarget
    ) * (call.opponentTotalEstimates || []).reduce((product, estimate) => (
      product * (1 - estimate.probabilityCrossingTarget)
    ), 1);
    call.estimatedWinProbability = callModel.estimatedGameWinProbability;
    call.estimatedGameWinProbability = callModel.estimatedGameWinProbability;
    call.actionVariance = Math.max(
      0,
      callBucket.callStats.roundScoreSquared / Math.max(1, callBucket.count) -
      callModel.expectedRoundScore * callModel.expectedRoundScore
    );
    call.gameOutcomeValue = gameOutcomeUtility({
      estimatedGameWinProbability: call.estimatedGameWinProbability,
      ownTotalEstimate: {
        expectedPostRoundTotal: call.expectedPostRoundTotal,
        expectedThresholdAdjustedTotal: call.expectedThresholdAdjustedTotal,
        probabilityCrossingTarget: call.probabilityCrossingTarget
      },
      opponentTotalEstimates: call.opponentTotalEstimates || [],
      probabilityGameEnds: call.probabilityGameEnds,
      gameTarget: ctx.state.gameTarget || 100
    }).value;
    call.strategicAdjustment = priorStrategicAdjustment;
    call.actionValue = call.gameOutcomeValue + priorStrategicAdjustment;
    call.finalActionValue = call.actionValue;
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
    const ownInitialMoments = distributionMoments(ownInitial);
    const initialAtMostFiveProbability = probabilityAtMost(ownInitial, 5);
    const startsAboveFive = ownInitialMoments.mean > 5 || initialAtMostFiveProbability < 0.5;
    const guaranteedFinalThrowIn = callModel.guaranteedFinalThrowInToFiveProbability >= 0.99;
    const beneficialExactFailure = callModel.beneficialFailureProbability >= 0.9;
    const exactGameTotalAlternative = callModel.exactThresholdOutcomeProbability >= 0.9 &&
      call.expectedGameScore + 0.25 < continueAction.expectedGameScore;
    const callEligible = !startsAboveFive || guaranteedFinalThrowIn ||
      beneficialExactFailure || exactGameTotalAlternative;
    const threat = opponentThreatState(bot, ctx);
    const callFirstBonus = callEligible
      ? threat.callBeforeNextProbability * callModel.successProbability * 10
      : 0;
    call.actionValue += callFirstBonus;
    call.finalActionValue = call.actionValue;
    continueAction.actionValue -= threat.active ? threat.callBeforeNextProbability * 1.5 : 0;
    continueAction.finalActionValue = continueAction.actionValue;
    call.metadata.callFirstBonus = callFirstBonus;
    call.metadata.opponentThreatMode = threat;
    continueAction.metadata.opponentThreatMode = threat;
    const strongReadyHand = initialAtMostFiveProbability >= 0.9 &&
      botRoundScoreConfidence(bot) >= 0.85 && callModel.successProbability >= 0.7;
    const continuingImprovesGameTotal = continueAction.expectedGameScore + 0.25 < call.expectedGameScore ||
      continueAction.estimatedWinProbability > call.estimatedWinProbability + 0.03;
    let winningPositionVariancePenalty = 0;
    if (strongReadyHand && !continuingImprovesGameTotal) {
      winningPositionVariancePenalty = Math.max(0, continueAction.actionVariance - call.actionVariance) * 1.25;
      continueAction.actionValue -= winningPositionVariancePenalty;
      continueAction.finalActionValue = continueAction.actionValue;
    }
    call.eligible = callEligible;
    call.metadata = {
      ...call.metadata,
      callEligibility: {
        eligible: callEligible,
        startsAboveFive,
        initialExpectedHandScore: ownInitialMoments.mean,
        initialAtMostFiveProbability,
        guaranteedFinalThrowIn,
        beneficialExactFailure,
        exactGameTotalAlternative
      },
      strongReadyHand,
      continuingImprovesGameTotal
    };
    continueAction.metadata = {
      ...continueAction.metadata,
      strongReadyHand,
      continuingImprovesGameTotal,
      winningPositionVariancePenalty
    };
    return { call, continue: continueAction };
  }

  function botShouldCallDutch(bot) {
    const result = evaluateDutch(bot);
    let selected;
    if (result.call.eligible && result.call.metadata.strongReadyHand && !result.call.metadata.continuingImprovesGameTotal) {
      selected = result.call;
    } else {
      selected = chooseCharacterAction(bot, [result.call.eligible ? result.call : null, result.continue], random);
    }
    const memory = ensureBotMemory(bot);
    recordDecisionDiagnostic(bot, 'dutch', [result.call, result.continue], selected);
    if (memory) memory.lastDecision = { type: 'dutch', actions: [result.call, result.continue], selected };
    return !!selected && selected.actionType === 'call-dutch';
  }

  function guaranteedRedKingRecoveryPlan(bot, ctx, entry, index) {
    const round = ctx.state.round;
    const top = round && round.discard && round.discard.at(-1);
    if (
      !round || !round.throwIn || !round.throwIn.open || !round.turnComplete ||
      round.drawn || (round.stage && round.stage !== 'turn') ||
      (Array.isArray(round.specialQueue) && round.specialQueue.length > 0) ||
      !isConfirmedCard(entry) || (entry.confidence || 0) < 0.999 ||
      !isRedKing(entry.card) || !top || top.rank !== 'K' || cardPoints(top) !== 13
    ) return null;
    const current = ctx.state.players[round.currentPlayerIndex];
    if (!current || current.id === bot.id) return null;
    const nextId = round.dutchCallerId
      ? (round.dutchQueue || [])[0]
      : (nextPlayer(bot) && nextPlayer(bot).id);
    if (nextId !== bot.id) return null;
    const replacement = bot.cards.map((_, candidateIndex) => ({
      index: candidateIndex,
      expected: distributionMoments(ctx.slotDistributionFor(bot, candidateIndex)).mean
    })).filter((candidate) => candidate.index !== index)
      .sort((a, b) => b.expected - a.expected)[0];
    if (!replacement || replacement.expected <= 0) return null;
    return {
      cardId: bot.cards[index] && bot.cards[index].id,
      replacementIndex: replacement.index,
      expectedHandImprovement: replacement.expected,
      reliability: 'guaranteed-next-action'
    };
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
      const redKingRecoveryPlan = isRedKing(entry.card)
        ? guaranteedRedKingRecoveryPlan(bot, ctx, entry, index)
        : null;
      if (isRedKing(entry.card) && !redKingRecoveryPlan) continue;
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
      const futureOpportunity = isForcedFinalTurn(bot, ctx)
        ? 0
        : ctx.belief.probabilityOfRank(round.throwIn.rank) * Math.min(1, mixed.turnsRemaining / 4);
      mixed.actionValue -= futureOpportunity * Math.max(0, success.immediatePointReduction) * 0.12;
      mixed.finalActionValue = mixed.actionValue;
      const certainSafeThrow = confidence >= 0.999 &&
        !(entry.card && (SPECIALS.has(entry.card.rank) || isRedKing(entry.card)));
      if (mixed.actionValue > wait.actionValue || certainSafeThrow || redKingRecoveryPlan) {
        candidates.push({
          index,
          confidence,
          expected: distributionMoments(ctx.slotDistributionFor(bot, index)).mean,
          expectedValue: redKingRecoveryPlan
            ? redKingRecoveryPlan.expectedHandImprovement
            : mixed.actionValue - wait.actionValue,
          recoveryPlan: redKingRecoveryPlan,
          throwInReliability: redKingRecoveryPlan ? 'guaranteed-next-action' : 'guaranteed-current-action',
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
    opponentThreatState,
    aceTargetImpact,
    aceDiscardAssessment,
    evaluateAceTarget,
    evaluateDutch,
    unknownExpectedPoints,
    rankStatsForBot,
    rankDiscardPressure,
    throwInPotentialValue,
    opponentThrowInBenefit,
    discardGiftAssessment,
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
    evaluateQueenTarget,
    botQueenTargets,
    botQueenTarget,
    botJackCandidates,
    estimatedTurnImprovement,
    botShouldCallDutch,
    botThrowInCandidate
  };
}

module.exports = { createOptimalDecisionLayer, seedFromText, seededRandom };
