const { cardPoints, SPECIAL_RANKS, HALVING_TOTALS, isHalvingTotal } = require('../public/shared.js');
const { publicMemoryCard, botProfile } = require('./bot-strategy.js');
const { chooseCharacterAction, strategyLimits } = require('./bot-character.js');
const {
  slotPointDistribution,
  convolveScoreDistributions,
  distributionMoments
} = require('./bot-belief-state.js');
const { createDecisionContextFactory } = require('./bot-decision-context.js');
const { createDrawDecisionDomain } = require('./bot-draw-strategy.js');
const { createSpecialDecisionSelectors } = require('./bot-special-strategy.js');
const { createSpecialScoring } = require('./bot-special-scoring.js');
const { createDutchDecisionSelector } = require('./bot-dutch-strategy.js');
const { createDutchRollout } = require('./bot-dutch-rollout.js');
const { createThrowInDecision } = require('./bot-throw-in-strategy.js');
const {
  addPointDistributions,
  deterministicPointDistribution,
  entropy,
  seededRandom,
  seedFromText
} = require('./bot-probability.js');
const {
  evaluateAction,
  mixActionEvaluations,
  clamp,
  scoreAfterRound,
  probabilityAtLeast,
  probabilityAtMost,
  gameOutcomeUtility,
  evaluateFinalTurnAction
} = require('./bot-evaluator.js');

const SPECIALS = new Set(SPECIAL_RANKS);
const CONFIRMED_CARD_CONFIDENCE = 0.65;
const SPECULATIVE_THROW_IN_WEIGHT = 0.1;
const KNOWN_RANK_RETENTION_WEIGHT = 0.22;

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
  const strategyRelease = deps.strategyRelease || '1.3.65';
  const previousStrategy = strategyRelease === '1.3.64';
  const contextFor = createDecisionContextFactory(deps);

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

  function opponentDutchBehavior(bot, opponent) {
    const learned = bot.opponentDutchBehavior && bot.opponentDutchBehavior[opponent.id];
    if (!learned || opponent.isBot) {
      return {
        roundsObserved: 0,
        calls: 0,
        successes: 0,
        callRate: 0.25,
        successRate: 0.5,
        aggressiveness: 0.34,
        callProbabilityAdjustment: 0
      };
    }
    const rounds = Math.max(0, learned.roundsObserved || 0);
    const calls = Math.max(0, learned.calls || 0);
    const callRate = (calls + 1) / (rounds + 4);
    const successRate = ((learned.successes || 0) + 1.5) / (calls + 3);
    const sampleConfidence = clamp((rounds + calls) / 8);
    const aggressiveness = clamp(
      callRate * 0.48 +
      successRate * 0.22 +
      (learned.earlyCallAverage || 0) * 0.12 +
      (learned.uncertaintyCallAverage || 0) * 0.13 +
      clamp((4 - (learned.cardCountAverage || 4)) / 3) * 0.05
    );
    return {
      ...learned,
      callRate,
      successRate,
      aggressiveness,
      sampleConfidence,
      callProbabilityAdjustment: (aggressiveness - 0.34) * (0.3 + sampleConfidence * 0.7)
    };
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
      const learnedDutchBehavior = opponentDutchBehavior(bot, opponent);
      const learnedStateMatch = !previousStrategy && learnedDutchBehavior.calls > 0
        ? learnedDutchBehavior.sampleConfidence * (
          clamp((learnedDutchBehavior.estimatedScoreAverage + 2 - moments.mean) / 6) * 0.12 +
          clamp((learnedDutchBehavior.cardCountAverage + 1 - opponent.cards.length) / 3) * 0.05 +
          (learnedDutchBehavior.uncertaintyCallAverage || 0) *
            (1 - selfKnowledge.knowledgeRatio) * 0.04
        )
        : 0;
      const callBeforeNextProbability = clamp(
        callableProbability * 0.66 +
        Math.max(0, nearFiveProbability - callableProbability) * 0.24 +
        fewCardsPressure * 0.12 +
        selfKnowledge.knowledgeRatio * 0.1 +
        selfKnownLowPressure * 0.16 +
        recentLowPressure * 0.18 +
        readiness * 0.12 +
        (previousStrategy ? 0 : learnedDutchBehavior.callProbabilityAdjustment + learnedStateMatch)
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
        selfKnowledge,
        learnedDutchBehavior,
        learnedStateMatch
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
    const selfInformation = !previousStrategy && !!(metadata.selfInformation || metadata.targetId === bot.id);
    const selfInformationDecisionImpact = selfInformation ? clamp(
      metadata.selfInformationDecisionImpact ??
      metadata.queenDecisionImpact?.selfReadiness?.decisionChangeProbability ??
      0
    ) : 0;
    const threatRelevantInformation = !!(
      selfInformation || metadata.threatRelevantInformation ||
      (metadata.targetId && threat.profiles.some((profile) => (
        profile.playerId === metadata.targetId && profile.immediate
      )))
    );
    const roundEndRisk = clamp((threat.callBeforeNextProbability - 0.45) / 0.45);
    const longHorizonInformationMultiplier = Math.pow(1 - roundEndRisk, 1.4);
    const immediateInformationMultiplier = 1.15 + roundEndRisk * 1.25;
    const selfInformationMultiplier =
      longHorizonInformationMultiplier * (1 - selfInformationDecisionImpact) +
      immediateInformationMultiplier * selfInformationDecisionImpact;
    const informationMultiplier = threat.active
      ? (selfInformation
        ? Math.max(0.12, selfInformationMultiplier)
        : (threatRelevantInformation ? 1 + threat.intensity * 0.9 : 0.28))
      : 1;
    const futureThrowInMultiplier = selfInformation
      ? 1
      : (threat.active ? Math.max(0.12, 1 - threat.intensity * 1.35) : 1);
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
          selfInformation,
          selfInformationDecisionImpact,
          longHorizonInformationMultiplier,
          immediateInformationMultiplier,
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

  function rankPileArrivalState(bot, rank, suppliedContext = null, suppliedTurns = null) {
    const ctx = suppliedContext || contextFor(bot);
    const hold = suppliedTurns === null
      ? currentEvaluation(bot, 'rank-pile-horizon', { context: ctx })
      : null;
    const turnsRemaining = Math.max(0, suppliedTurns === null ? hold.turnsRemaining : suppliedTurns);
    const cacheKey = rank + ':' + turnsRemaining.toFixed(3);
    ctx.rankPileArrivalCache = ctx.rankPileArrivalCache || new Map();
    if (ctx.rankPileArrivalCache.has(cacheKey)) return ctx.rankPileArrivalCache.get(cacheKey);
    const activeCount = Math.max(1, activePlayablePlayers().length);
    const opponentTurns = turnsRemaining * Math.max(0, activeCount - 1) / activeCount;
    const actionOpportunities = turnsRemaining * 0.55;
    const drawRankProbability = ctx.belief.probabilityOfRank(rank);
    const drawDiscardProbability = clamp(0.34 + cardPoints({ rank, suit: 'clubs' }) * 0.035, 0.34, 0.72);
    const drawReleaseProbability = 1 - Math.pow(
      Math.max(0, 1 - drawRankProbability * drawDiscardProbability),
      actionOpportunities
    );
    const heldDiscardPressure = rankDiscardPressure(bot, rank);
    const heldReleaseProbability = 1 - Math.exp(-heldDiscardPressure * opponentTurns * 0.22);
    const rawArrivalProbability = 1 -
      (1 - drawReleaseProbability) * (1 - heldReleaseProbability);
    const threat = opponentThreatState(bot, ctx);
    const roundSurvivalProbability = clamp(1 - threat.callBeforeNextProbability * 0.75);
    const arrivalProbability = rawArrivalProbability * (0.25 + roundSurvivalProbability * 0.75);
    const reliability = immediateThrowInReliability(bot, ctx, rank, 1);
    const result = {
      turnsRemaining,
      drawRankProbability,
      drawReleaseProbability,
      heldDiscardPressure,
      heldReleaseProbability,
      rawArrivalProbability,
      roundSurvivalProbability,
      arrivalProbability,
      contentionProbability: reliability.contentionProbability,
      executionProbability: reliability.executionProbability,
      actionableProbability: arrivalProbability * reliability.executionProbability
    };
    ctx.rankPileArrivalCache.set(cacheKey, result);
    return result;
  }

  function throwInPotentialValue(bot, card, suppliedContext = null, suppliedTurns = null) {
    if (!card || !card.rank) return 0;
    const ctx = suppliedContext || contextFor(bot);
    const arrival = rankPileArrivalState(bot, card.rank, ctx, suppliedTurns);
    return arrival.actionableProbability *
      (1.2 + cardPoints(card) * 0.68) * KNOWN_RANK_RETENTION_WEIGHT;
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

  function selfKnowledgeReadiness(bot, suppliedContext = null, suppliedThreat = null) {
    const ctx = suppliedContext || contextFor(bot);
    const slots = bot.cards.map((_, index) => {
      const memory = effectiveMemory(bot, botMemoryEntry(bot, bot.id, index));
      return {
        index,
        confidence: memory.confidence || 0,
        points: ctx.slotDistributionFor(bot, index),
        cards: ctx.slotCardDistributionFor(bot, index)
      };
    });
    const unresolvedSlots = slots.filter((slot) => slot.confidence < 0.999).length;
    const unresolvedMass = slots.reduce((sum, slot) => sum + (1 - slot.confidence), 0);
    const knowledgeRatio = slots.length ? clamp(1 - unresolvedMass / slots.length) : 1;
    const ownDistribution = ctx.scoreDistributionFor(bot);
    const ownMoments = distributionMoments(ownDistribution);
    const atMostFiveProbability = probabilityAtMost(ownDistribution, 5);
    const nearFiveProbability = probabilityAtMost(ownDistribution, 7);
    const callDecisionSwing = slots.reduce((best, slot) => (
      Math.max(best, conditionalProbabilityRange(ctx, bot, slot.index, 5))
    ), 0);
    const replacementDecisionSwing = slots.reduce((best, slot) => {
      const moments = distributionMoments(slot.points);
      return Math.max(best, Math.sqrt(Math.max(0, moments.variance)) / 6);
    }, 0);
    const futureThrowInKnowledgeValue = slots.reduce((sum, slot) => (
      sum + slot.cards.reduce((slotSum, item) => (
        slotSum + (item.probability || 0) * ctx.belief.probabilityOfRank(item.card.rank) *
          (0.45 + cardPoints(item.card) * 0.12)
      ), 0) * (1 - slot.confidence)
    ), 0);
    const threat = suppliedThreat || opponentThreatState(bot, ctx);
    const roundEndRisk = clamp((threat.callBeforeNextProbability - 0.45) / 0.45);
    const longHorizonMultiplier = Math.pow(1 - roundEndRisk, 1.4);
    const completionBonus = unresolvedSlots === 1
      ? 4.5 + callDecisionSwing * 8 + atMostFiveProbability * 4
      : (unresolvedSlots === 2 ? 1.8 + callDecisionSwing * 3 : 0);
    const decisionChangeProbability = clamp(Math.max(
      callDecisionSwing,
      replacementDecisionSwing * 0.55,
      Math.min(atMostFiveProbability, 1 - atMostFiveProbability) * 1.6
    ));
    const longHorizonKnowledgeValue = (
      1.2 +
      futureThrowInKnowledgeValue * 1.25 +
      replacementDecisionSwing * 1.4
    ) * longHorizonMultiplier;
    const immediateDecisionKnowledgeValue =
      completionBonus * (0.35 + decisionChangeProbability * 0.65) +
      decisionChangeProbability * 5 +
      callDecisionSwing * roundEndRisk * 5;
    const selfKnowledgeUrgency = unresolvedSlots === 0 ? 0 : (
      longHorizonKnowledgeValue +
      immediateDecisionKnowledgeValue +
      clamp((9 - ownMoments.mean) / 6) * 2.2 * (0.35 + longHorizonMultiplier * 0.65)
    );
    return {
      unresolvedSlots,
      unresolvedMass,
      knowledgeRatio,
      expectedScore: ownMoments.mean,
      atMostFiveProbability,
      nearFiveProbability,
      callDecisionSwing,
      replacementDecisionSwing,
      decisionChangeProbability,
      futureThrowInKnowledgeValue,
      completionBonus,
      roundEndRisk,
      longHorizonMultiplier,
      longHorizonKnowledgeValue,
      immediateDecisionKnowledgeValue,
      selfKnowledgeUrgency,
      opponentCallBeforeNextProbability: threat.callBeforeNextProbability,
      combinedReadiness: clamp(
        atMostFiveProbability * (0.45 + knowledgeRatio * 0.55) +
        threat.callBeforeNextProbability * decisionChangeProbability * 0.25
      )
    };
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
      return sum + (isHalvingTotal(rawTotal) ? item.probability || 0 : 0);
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

  function knownIncomingControlValue(bot, incomingCard, replacementIndex, ctx, turnsRemaining) {
    if (previousStrategy) return {
      total: 0,
      futureKnownThrowInValue: 0,
      safeReplacementTargetValue: 0,
      dutchDecisionProtectionValue: 0
    };
    const entry = effectiveMemory(bot, botMemoryEntry(bot, bot.id, replacementIndex));
    if ((entry.confidence || 0) >= 0.999) return {
      total: 0,
      futureKnownThrowInValue: 0,
      safeReplacementTargetValue: 0,
      dutchDecisionProtectionValue: 0
    };
    const points = cardPoints(incomingCard);
    const activeCount = Math.max(1, activePlayablePlayers().length);
    const botTurns = Math.max(0, turnsRemaining / activeCount);
    const arrival = rankPileArrivalState(bot, incomingCard.rank, ctx, turnsRemaining);
    const futureKnownThrowInValue = arrival.actionableProbability * (
      points * 0.72 + 1.4
    );
    const lowerDrawProbability = ctx.belief.drawDistribution.reduce((sum, item) => (
      sum + (cardPoints(item.card) < points ? item.probability || 0 : 0)
    ), 0);
    const expectedImprovementWhenLower = lowerDrawProbability > 0
      ? ctx.belief.drawDistribution.reduce((sum, item) => (
        sum + (item.probability || 0) * Math.max(0, points - cardPoints(item.card))
      ), 0) / lowerDrawProbability
      : 0;
    const futureReplacementProbability = 1 - Math.pow(
      Math.max(0, 1 - lowerDrawProbability),
      botTurns
    );
    const readiness = selfKnowledgeReadiness(bot, ctx);
    const safeReplacementTargetValue =
      futureReplacementProbability * expectedImprovementWhenLower * 0.7 *
      readiness.longHorizonMultiplier;
    const milestoneWeight = readiness.unresolvedSlots === 1
      ? 4.2
      : (readiness.unresolvedSlots === 2 ? 2.6 : 1);
    const dutchDecisionProtectionValue =
      readiness.decisionChangeProbability * milestoneWeight;
    return {
      total: Math.min(
        9,
        futureKnownThrowInValue +
        safeReplacementTargetValue +
        dutchDecisionProtectionValue
      ),
      futureKnownThrowInValue,
      safeReplacementTargetValue,
      dutchDecisionProtectionValue,
      rankReleaseProbability: arrival.arrivalProbability,
      rankPileArrival: arrival,
      futureReplacementProbability
    };
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
    const readinessBeforeReplacement = selfKnowledgeReadiness(bot, ctx);
    const positionKnowledgeGain = 1 - (entry.confidence || 0);
    const longHorizonReplacementKnowledge = positionKnowledgeGain * (
      0.9 +
      (readinessBeforeReplacement.unresolvedSlots === 2 ? 1.2 : 0) +
      ctx.belief.probabilityOfRank(incomingCard.rank) * (0.5 + cardPoints(incomingCard) * 0.12)
    ) * readinessBeforeReplacement.longHorizonMultiplier;
    const immediateReplacementKnowledge = positionKnowledgeGain * (
      (readinessBeforeReplacement.unresolvedSlots === 1
        ? readinessBeforeReplacement.completionBonus * 0.65
        : 0) +
      readinessBeforeReplacement.decisionChangeProbability * 2.5
    ) * (1 + readinessBeforeReplacement.roundEndRisk *
      readinessBeforeReplacement.decisionChangeProbability * 0.65);
    const replacementKnowledgeValue = !previousStrategy && positionKnowledgeGain > 0.001
      ? longHorizonReplacementKnowledge + immediateReplacementKnowledge
      : 0;
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
      discardGiftAssessment: giftAssessment,
      selfInformation: replacementKnowledgeValue > 0,
      selfInformationDecisionImpact: readinessBeforeReplacement.decisionChangeProbability,
      longHorizonReplacementKnowledge,
      immediateReplacementKnowledge,
      replacementKnowledgeValue
    };
    const hold = currentEvaluation(bot, 'hold', { context: ctx });
    const futureThrowInScoreSaving = futureReplacementThrowInSaving(
      bot,
      incomingCard,
      index,
      ctx,
      hold.turnsRemaining
    );
    const knownCardControl = knownIncomingControlValue(
      bot,
      incomingCard,
      index,
      ctx,
      hold.turnsRemaining
    );
    const discardedRankRetentionValue = !previousStrategy && discarded
      ? throwInPotentialValue(bot, discarded, ctx, hold.turnsRemaining)
      : 0;
    metadata.discardedRankRetentionValue = discardedRankRetentionValue;
    const base = currentEvaluation(bot, actionType, {
      context: ctx,
      ownDistribution,
      informationValue: special.informationValue + replacementKnowledgeValue + knownCardControl.total,
      opponentBenefit: gift + special.opponentBenefit + discardedRankRetentionValue,
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
        informationValue: special.informationValue + replacementKnowledgeValue + knownCardControl.total,
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
    evaluation.metadata.knownCardControl = knownCardControl;
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
    if (selected) {
      const memory = ensureBotMemory(bot);
      if (memory) memory.pendingAceDiscardAssessment = selected.metadata && selected.metadata.aceDiscardAssessment || null;
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
    const readiness = selfKnowledgeReadiness(bot, ctx);
    const ordinaryKnownCard = !SPECIALS.has(drawnCard.rank) && drawnCard.rank !== 'K';
    const knownCardAcceptability = clamp((11 - cardPoints(drawnCard)) / 5);
    const knowledgeStagnationCost = !previousStrategy && ordinaryKnownCard && readiness.unresolvedSlots > 0
      ? knownCardAcceptability * (
        readiness.unresolvedSlots === 1
          ? 3.2 + readiness.decisionChangeProbability * 2.5
          : (readiness.unresolvedSlots === 2
            ? 2.1 + readiness.decisionChangeProbability * 1.8
            : 0.9)
      ) * (
        readiness.longHorizonMultiplier * (1 - readiness.decisionChangeProbability) +
        readiness.decisionChangeProbability * (1 + readiness.roundEndRisk * 0.45)
      )
      : 0;
    metadata.knowledgeStagnationCost = knowledgeStagnationCost;
    metadata.selfKnowledgeReadiness = readiness;
    const base = currentEvaluation(bot, 'discard-drawn', {
      context: ctx,
      informationValue: special.informationValue,
      opponentBenefit,
      metadata
    });
    const evaluation = evaluateImmediateThrowInFollowUp(bot, ctx, {
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
    evaluation.actionValue -= knowledgeStagnationCost;
    evaluation.finalActionValue = evaluation.actionValue;
    return evaluation;
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
    const readiness = selfKnowledgeReadiness(bot, ctx);
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
      round && !round.dutchCallerId &&
      ownAtMostFiveProbability >= (previousStrategy ? 0.9 : 0.82) &&
      confidence >= (previousStrategy ? 0.85 : 0.78) &&
      projectedSuccessProbability >= (previousStrategy ? 0.7 : 0.72) &&
      (previousStrategy || readiness.combinedReadiness >= 0.7) &&
      !gameTotalAlternative
    );
    return {
      active,
      confidence,
      ownAtMostFiveProbability,
      projectedSuccessProbability,
      readiness,
      successfulCallTotal,
      ordinaryExpectedTotal,
      gameTotalAlternative
    };
  }

  const {
    evaluateDrawSources,
    shouldBotTakePile,
    botDeckCardDecision,
    shouldBotSwapDrawn
  } = createDrawDecisionDomain({
    contextFor,
    evaluateDeckDiscard,
    dutchFreezeState,
    botSwapTargets,
    isForcedFinalTurn,
    finalTurnPileAssessment,
    publicMemoryCard,
    isRedKing,
    mixActionEvaluations,
    chooseCharacterAction,
    strategyRelease,
    random
  });

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
    for (const threshold of HALVING_TOTALS) {
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
    const selfReadiness = ownCard ? selfKnowledgeReadiness(bot, ctx) : null;
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
    const futureThrowInKnowledge = ownCard && !previousStrategy
      ? cardDistribution.reduce((sum, item) => (
        sum + (item.probability || 0) * ctx.belief.probabilityOfRank(item.card.rank) *
          (0.65 + cardPoints(item.card) * 0.18)
      ), 0) * uncertainty * (1 + Math.max(0, bot.cards.length - 2) * 0.2)
      : 0;
    const completionMilestone = ownCard && !previousStrategy
      ? uncertainty * selfReadiness.completionBonus
      : 0;
    const ownDecisionChange = ownCard && !previousStrategy
      ? uncertainty * selfReadiness.decisionChangeProbability *
        (4 + selfReadiness.opponentCallBeforeNextProbability * 6)
      : 0;
    const selfKnowledgeUrgencyValue = ownCard && !previousStrategy
      ? uncertainty * Math.min(8, selfReadiness.selfKnowledgeUrgency * 0.38)
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
      futureThrowInKnowledge,
      completionMilestone,
      ownDecisionChange,
      selfKnowledgeUrgency: selfKnowledgeUrgencyValue,
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
        selfReadiness,
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

  const {
    aceDiscardAssessment,
    aceTargetImpact,
    discardSpecialEffects,
    knownOwnCardUtility,
    specialActionValue,
    specialStateValue
  } = createSpecialScoring({
    allSlotTargets,
    contextFor,
    discardGiftAssessment,
    ensureBotMemory,
    isProtectedSpecialTarget,
    opponentSelfKnowledge,
    opponentThreatState
  });

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

  const {
    botQueenTargets,
    botQueenTarget,
    botAceTargetScore,
    botAceTarget
  } = createSpecialDecisionSelectors({
    allSlotTargets,
    contextFor,
    dutchFreezeState,
    currentEvaluation,
    evaluateAceTarget,
    ensureBotMemory,
    chooseCharacterAction,
    strategyRelease,
    random
  });

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

  const {
    activePlayersAfter,
    addRollout,
    createRolloutBucket,
    dutchCallModel,
    evaluationFromBucket,
    normalizedCounts,
    rolloutBotCalls,
    rolloutCallProbability,
    sampleRolloutWorld,
    simulateFinalQueue,
    simulateRolloutTurn
  } = createDutchRollout({
    activePlayablePlayers,
    botMemoryEntry,
    currentEvaluation,
    effectiveMemory,
    isRedKing,
    opponentDistributions,
    opponentThreatState,
    strategyRelease
  });
  function evaluateDutch(bot) {
    const ctx = contextFor(bot);
    const ownInitial = ctx.scoreDistributionFor(bot);
    const decisive = bot.cards.length <= 2 || ctx.opponents.some((player) => player.cards.length <= 2) ||
      probabilityAtMost(ownInitial, 5) > 0.25 || (ctx.state.round && Array.isArray(ctx.state.round.deck) && ctx.state.round.deck.length <= ctx.state.players.length + 2);
    const limits = strategyLimits(bot, decisive);
    const samples = Math.max(24, Math.min(limits.samples, Math.floor(limits.operationBudget / Math.max(1, ctx.opponents.length * 3))));
    const rolloutSeed = seedFromText([bot.id, ctx.state.roundNumber, ctx.state.round && (ctx.state.round.strategyTick ?? ctx.state.round.botTick), 'dutch'].join(':'));
    const rng = seededRandom(rolloutSeed);
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
      rolloutSeed,
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
    const meaningfulCallProbability = Math.max(
      initialAtMostFiveProbability,
      callModel.finalHandAtMostFiveProbability || 0,
      callModel.successProbability || 0
    );
    const guaranteedFinalThrowIn = callModel.guaranteedFinalThrowInToFiveProbability >= 0.99;
    const beneficialExactFailure = callModel.beneficialFailureProbability >= 0.9;
    const exactGameTotalAlternative = callModel.exactThresholdOutcomeProbability >= 0.9 &&
      call.expectedGameScore + 0.25 < continueAction.expectedGameScore;
    const callEligible = previousStrategy
      ? (!startsAboveFive || guaranteedFinalThrowIn || beneficialExactFailure || exactGameTotalAlternative)
      : (meaningfulCallProbability >= 0.03 || guaranteedFinalThrowIn ||
        beneficialExactFailure || exactGameTotalAlternative);
    const threat = opponentThreatState(bot, ctx);
    const readiness = selfKnowledgeReadiness(bot, ctx, threat);
    const callSamplingMargin = 1.64 * Math.sqrt(
      callModel.successProbability * (1 - callModel.successProbability) /
      Math.max(1, callModel.samples)
    );
    const callModelUncertainty = previousStrategy
      ? 0
      : 0.02 + (1 - readiness.knowledgeRatio) * 0.08;
    const conservativeCallSuccessProbability = clamp(
      callModel.successProbability - callSamplingMargin - callModelUncertainty
    );
    const tempoThreatProbability = Math.max(
      opponentCallBeforeNextProbability,
      threat.callBeforeNextProbability
    );
    const residualTempoThreat = previousStrategy
      ? threat.callBeforeNextProbability
      : Math.max(0, threat.callBeforeNextProbability - opponentCallBeforeNextProbability);
    const lostCallFirstCost = callEligible
      ? (previousStrategy
        ? (threat.active ? threat.callBeforeNextProbability * 1.5 : 0)
        : residualTempoThreat * (
          2 + callModel.successProbability * 5 + initialAtMostFiveProbability * 2
        ))
      : 0;
    const callFirstBonus = previousStrategy
      ? (callEligible ? threat.callBeforeNextProbability * callModel.successProbability * 10 : 0)
      : lostCallFirstCost * 0.15;
    call.actionValue += callFirstBonus;
    call.finalActionValue = call.actionValue;
    continueAction.actionValue -= previousStrategy ? lostCallFirstCost : lostCallFirstCost * 0.2;
    continueAction.finalActionValue = continueAction.actionValue;
    call.metadata.callFirstBonus = callFirstBonus;
    call.metadata.opponentThreatMode = threat;
    continueAction.metadata.opponentThreatMode = threat;
    const deliberateThresholdException = guaranteedFinalThrowIn ||
      beneficialExactFailure || exactGameTotalAlternative;
    const ordinaryCallReliabilityTarget = clamp(
      0.74 + (1 - readiness.knowledgeRatio) * 0.06 - tempoThreatProbability * 0.02,
      0.72,
      0.8
    );
    const callReliabilityShortfall = previousStrategy || deliberateThresholdException
      ? 0
      : Math.max(0, ordinaryCallReliabilityTarget - conservativeCallSuccessProbability);
    const dutchReliabilityPenalty = callReliabilityShortfall * (
      10 + callModel.expectedFailedDoubledScore * 0.75
    );
    call.actionValue -= dutchReliabilityPenalty;
    call.finalActionValue = call.actionValue;
    const strongReadyHand =
      initialAtMostFiveProbability >= (previousStrategy ? 0.9 : 0.82) &&
      botRoundScoreConfidence(bot) >= (previousStrategy ? 0.85 : 0.78) &&
      (previousStrategy
        ? callModel.successProbability >= 0.7
        : conservativeCallSuccessProbability >= ordinaryCallReliabilityTarget) &&
      (previousStrategy || readiness.combinedReadiness >= 0.7);
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
        meaningfulCallProbability,
        initialExpectedHandScore: ownInitialMoments.mean,
        initialAtMostFiveProbability,
        guaranteedFinalThrowIn,
        beneficialExactFailure,
        exactGameTotalAlternative
      },
      strongReadyHand,
      selfKnowledgeReadiness: readiness,
      tempoThreatProbability,
      residualTempoThreat,
      lostCallFirstCost,
      conservativeCallSuccessProbability,
      ordinaryCallReliabilityTarget,
      callSamplingMargin,
      callModelUncertainty,
      dutchReliabilityPenalty,
      continuingImprovesGameTotal
    };
    continueAction.metadata = {
      ...continueAction.metadata,
      strongReadyHand,
      selfKnowledgeReadiness: readiness,
      tempoThreatProbability,
      residualTempoThreat,
      lostCallFirstCost,
      conservativeCallSuccessProbability,
      ordinaryCallReliabilityTarget,
      callSamplingMargin,
      callModelUncertainty,
      dutchReliabilityPenalty,
      continuingImprovesGameTotal,
      winningPositionVariancePenalty
    };
    return { call, continue: continueAction };
  }

  const botShouldCallDutch = createDutchDecisionSelector({
    evaluateDutch,
    chooseCharacterAction,
    random
  });

  const { botThrowInCandidate } = createThrowInDecision({
    botMemoryEntry,
    contextFor,
    currentEvaluation,
    drawPointDistribution,
    effectiveMemory,
    isConfirmedCard,
    isForcedFinalTurn,
    isRedKing,
    nextPlayer,
    discardGiftAssessment,
    strategyRelease,
    random
  });
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
    selfKnowledgeReadiness,
    opponentDutchBehavior,
    unknownExpectedPoints,
    rankStatsForBot,
    rankDiscardPressure,
    rankPileArrivalState,
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
    botDeckCardDecision,
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
