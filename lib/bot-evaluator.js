const { distributionMoments } = require('./bot-belief-state.js');

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function scoreAfterRound(total, roundScore) {
  let result = total + roundScore;
  if (result === 50 || result === 100) result = Math.floor(result / 2);
  return result;
}

function probabilityAtLeast(distribution, value) {
  return distribution.reduce((sum, item) => sum + (item.value >= value ? item.probability : 0), 0);
}

function probabilityAtMost(distribution, value) {
  return distribution.reduce((sum, item) => sum + (item.value <= value ? item.probability : 0), 0);
}

function roundOutcomeProbabilities(ownDistribution, opponents) {
  let roundWinProbability = 0;
  let dutchSuccessProbability = 0;
  for (const own of ownDistribution) {
    let noOpponentLower = 1;
    for (const opponent of opponents) noOpponentLower *= probabilityAtLeast(opponent.distribution, own.value);
    roundWinProbability += own.probability * noOpponentLower;
    if (own.value <= 5) dutchSuccessProbability += own.probability * noOpponentLower;
  }
  return {
    roundWinProbability: clamp(roundWinProbability),
    dutchSuccessProbability: clamp(dutchSuccessProbability)
  };
}

function estimateTurnsRemaining(state, bot, ownMean, opponents) {
  const round = state.round || {};
  if (round.dutchCallerId) return Math.max(0, (round.dutchQueue || []).length);
  const fewestCards = Math.min(bot.cards.length, ...opponents.map((item) => item.player.cards.length));
  const callablePressure = [ownMean, ...opponents.map((item) => item.mean)]
    .reduce((best, score) => Math.max(best, clamp((8 - score) / 8)), 0);
  const reshufflePressure = round.deck && round.deck.length <= Math.max(3, state.players.length) ? 0.75 : 0;
  return Math.max(1, Math.round(2 + fewestCards * 1.4 - callablePressure * 3 - reshufflePressure));
}

function opponentCallFirstProbability(opponents, turnsRemaining, state) {
  if (state.round && state.round.dutchCallerId) return 1;
  let nobodyCalls = 1;
  for (const opponent of opponents) {
    const callable = probabilityAtMost(opponent.distribution, 5);
    const cardPressure = clamp((4 - opponent.player.cards.length) * 0.1, 0, 0.3);
    const opportunity = clamp(turnsRemaining / Math.max(1, opponents.length), 0.25, 1);
    nobodyCalls *= 1 - clamp((callable * 0.9 + cardPressure) * opportunity);
  }
  return clamp(1 - nobodyCalls);
}

function projectedGameWinProbability(bot, ownTotal, opponentTotals, gameTarget) {
  const all = [{ id: bot.id, total: ownTotal }, ...opponentTotals];
  if (all.some((item) => item.total > gameTarget)) {
    const best = Math.min(...all.map((item) => item.total));
    const tied = all.filter((item) => item.total === best).length;
    return ownTotal === best ? 1 / tied : 0;
  }
  if (opponentTotals.length === 0) return 1;
  const pairwise = opponentTotals.map((opponent) => 1 / (1 + Math.exp((ownTotal - opponent.total) / 13)));
  const geometric = Math.pow(pairwise.reduce((product, probability) => product * probability, 1), 1 / pairwise.length);
  const targetPressure = clamp((gameTarget - Math.max(...all.map((item) => item.total))) / gameTarget);
  return clamp(geometric * (0.88 + targetPressure * 0.12));
}

function playerTotalSummary(player, roundScoreDistribution, gameTarget) {
  const outcomes = roundScoreDistribution.map((outcome) => {
    const probability = outcome.probability || 0;
    const postRoundTotal = player.total + outcome.value;
    const thresholdAdjustedTotal = scoreAfterRound(player.total, outcome.value);
    return {
      roundScore: outcome.value,
      probability,
      postRoundTotal,
      thresholdAdjustedTotal,
      thresholdAdjustment: postRoundTotal - thresholdAdjustedTotal,
      crossesTarget: thresholdAdjustedTotal > gameTarget
    };
  });
  return {
    playerId: player.id,
    expectedPostRoundTotal: outcomes.reduce((sum, outcome) => (
      sum + outcome.probability * outcome.postRoundTotal
    ), 0),
    expectedThresholdAdjustedTotal: outcomes.reduce((sum, outcome) => (
      sum + outcome.probability * outcome.thresholdAdjustedTotal
    ), 0),
    expectedThresholdAdjustment: outcomes.reduce((sum, outcome) => (
      sum + outcome.probability * outcome.thresholdAdjustment
    ), 0),
    probabilityCrossingTarget: outcomes.reduce((sum, outcome) => (
      sum + (outcome.crossesTarget ? outcome.probability : 0)
    ), 0),
    outcomes
  };
}

function gameOutcomeUtility({
  estimatedGameWinProbability,
  ownTotalEstimate,
  opponentTotalEstimates,
  probabilityGameEnds,
  gameTarget
}) {
  const averageOpponentTotal = opponentTotalEstimates.length
    ? opponentTotalEstimates.reduce((sum, estimate) => (
      sum + estimate.expectedThresholdAdjustedTotal
    ), 0) / opponentTotalEstimates.length
    : ownTotalEstimate.expectedThresholdAdjustedTotal;
  const relativeTotalAdvantage = averageOpponentTotal -
    ownTotalEstimate.expectedThresholdAdjustedTotal;
  const terminalLossRisk = probabilityGameEnds * (1 - estimatedGameWinProbability);
  return {
    averageOpponentTotal,
    relativeTotalAdvantage,
    terminalLossRisk,
    value:
      estimatedGameWinProbability * 500 -
      ownTotalEstimate.expectedThresholdAdjustedTotal / gameTarget * 18 -
      ownTotalEstimate.expectedPostRoundTotal / gameTarget * 2 -
      terminalLossRisk * 45 -
      ownTotalEstimate.probabilityCrossingTarget * (1 - estimatedGameWinProbability) * 20 +
      relativeTotalAdvantage / gameTarget * 8
  };
}

function opponentScoredDistribution(opponent, ownDistribution, opponents, callerId) {
  if (callerId !== opponent.player.id) return opponent.distribution;
  const scores = new Map();
  const add = (value, probability) => {
    if (probability <= 0) return;
    scores.set(value, (scores.get(value) || 0) + probability);
  };
  const others = opponents.filter((entry) => entry.player.id !== opponent.player.id);
  for (const outcome of opponent.distribution) {
    const noOtherLower = probabilityAtLeast(ownDistribution, outcome.value) *
      others.reduce((product, entry) => (
        product * probabilityAtLeast(entry.distribution, outcome.value)
      ), 1);
    const successProbability = outcome.value <= 5 ? noOtherLower : 0;
    add(0, (outcome.probability || 0) * successProbability);
    add(outcome.value * 2, (outcome.probability || 0) * (1 - successProbability));
  }
  return Array.from(scores, ([value, probability]) => ({ value, probability }));
}

function evaluateAction(context) {
  const {
    state,
    bot,
    actionType,
    ownDistribution,
    opponentDistributions = [],
    callerId = null,
    informationValue = 0,
    opponentBenefit = 0,
    immediatePointReduction = 0,
    futureThrowInScoreSaving = 0,
    extraVariance = 0,
    turnsRemaining: suppliedTurns,
    metadata = {}
  } = context;
  const ownMoments = distributionMoments(ownDistribution);
  const opponents = opponentDistributions.map((entry) => ({
    ...entry,
    ...distributionMoments(entry.distribution)
  }));
  const outcomes = roundOutcomeProbabilities(ownDistribution, opponents);
  const turnsRemaining = suppliedTurns ?? estimateTurnsRemaining(state, bot, ownMoments.mean, opponents);
  const opponentCallFirst = callerId ? 0 : opponentCallFirstProbability(opponents, turnsRemaining, state);

  let immediateDutchScoreSaving = 0;
  if (!callerId) {
    for (const own of ownDistribution) {
      if (own.value > 5) continue;
      const successProbability = opponents.reduce(
        (product, item) => product * probabilityAtLeast(item.distribution, own.value),
        1
      );
      const ordinaryTotal = scoreAfterRound(bot.total, own.value);
      const successfulCallTotal = scoreAfterRound(bot.total, 0);
      immediateDutchScoreSaving += own.probability * successProbability *
        Math.max(0, ordinaryTotal - successfulCallTotal);
    }
  }
  const immediateDutchOptionValue = immediateDutchScoreSaving * 0.72;

  const scoredOwnOutcomes = new Map();
  const addScoredOutcome = (value, probability) => {
    if (probability <= 0) return;
    scoredOwnOutcomes.set(value, (scoredOwnOutcomes.get(value) || 0) + probability);
  };
  for (const own of ownDistribution) {
    if (callerId === bot.id) {
      const successProbability = own.value <= 5
        ? opponents.reduce((product, item) => product * probabilityAtLeast(item.distribution, own.value), 1)
        : 0;
      addScoredOutcome(0, own.probability * successProbability);
      addScoredOutcome(own.value * 2, own.probability * (1 - successProbability));
    } else {
      addScoredOutcome(own.value, own.probability);
    }
  }
  const scoredOwnDistribution = Array.from(scoredOwnOutcomes, ([value, probability]) => ({ value, probability }));
  const scoredOwnMoments = distributionMoments(scoredOwnDistribution);
  const gameTarget = state.gameTarget || 100;
  const ownTotalEstimate = playerTotalSummary(bot, scoredOwnDistribution, gameTarget);
  const opponentTotalEstimates = opponents.map((opponent) => playerTotalSummary(
    opponent.player,
    opponentScoredDistribution(opponent, ownDistribution, opponents, callerId),
    gameTarget
  ));

  let expectedGameScore = 0;
  let estimatedWinProbability = 0;
  for (const own of ownDistribution) {
    let ownTotalBranches;
    if (callerId === bot.id) {
      const successProbability = own.value <= 5
        ? opponents.reduce((product, item) => product * probabilityAtLeast(item.distribution, own.value), 1)
        : 0;
      ownTotalBranches = [
        { probability: successProbability, total: scoreAfterRound(bot.total, 0) },
        { probability: 1 - successProbability, total: scoreAfterRound(bot.total, own.value * 2) }
      ];
    } else {
      ownTotalBranches = [{ probability: 1, total: scoreAfterRound(bot.total, own.value) }];
    }
    const opponentTotals = opponents.map((opponent) => ({
      id: opponent.player.id,
      total: opponent.distribution.reduce((sum, outcome) => {
        if (callerId === opponent.player.id) {
          const noOtherLower = own.value >= outcome.value && opponents
            .filter((item) => item.player.id !== opponent.player.id)
            .reduce((product, item) => product * probabilityAtLeast(item.distribution, outcome.value), 1);
          const success = outcome.value <= 5 && noOtherLower;
          const successfulTotal = scoreAfterRound(opponent.player.total, 0);
          const failedTotal = scoreAfterRound(opponent.player.total, outcome.value * 2);
          return sum + outcome.probability * (
            success * successfulTotal + (1 - success) * failedTotal
          );
        }
        return sum + outcome.probability * scoreAfterRound(opponent.player.total, outcome.value);
      }, 0)
    }));
    for (const branch of ownTotalBranches) {
      expectedGameScore += own.probability * branch.probability * branch.total;
      estimatedWinProbability += own.probability * branch.probability *
        projectedGameWinProbability(bot, branch.total, opponentTotals, gameTarget);
    }
  }

  const variance = Math.max(0, scoredOwnMoments.variance + extraVariance);
  const bestOpponentMean = opponents.length ? Math.min(...opponents.map((item) => item.mean)) : ownMoments.mean;
  const opponentEmergency = opponents.some((item) => item.player.cards.length <= 2 || probabilityAtMost(item.distribution, 5) > 0.45);
  const likelyWinningRound = ownMoments.mean <= bestOpponentMean;
  let riskAdjustment;
  if (likelyWinningRound && !opponentEmergency) riskAdjustment = -Math.sqrt(variance) * 0.9;
  else if (!likelyWinningRound || opponentEmergency) riskAdjustment = Math.sqrt(variance) * 0.28;
  else riskAdjustment = -Math.sqrt(variance) * 0.25;

  const opponentCallCost = opponentCallFirst * (
    Math.max(0, ownMoments.mean - bestOpponentMean) * 2 +
    (opponentEmergency ? Math.max(0, ownMoments.mean - 5) * 0.35 : 0)
  );
  const probabilityGameEnds = 1 - (
    1 - ownTotalEstimate.probabilityCrossingTarget
  ) * opponentTotalEstimates.reduce((product, estimate) => (
    product * (1 - estimate.probabilityCrossingTarget)
  ), 1);
  const gameUtility = gameOutcomeUtility({
    estimatedGameWinProbability: estimatedWinProbability,
    ownTotalEstimate,
    opponentTotalEstimates,
    probabilityGameEnds,
    gameTarget
  });
  const gameOutcomeValue = gameUtility.value;
  const strategicAdjustment =
    outcomes.roundWinProbability * 8 +
    immediateDutchOptionValue * 0.3 -
    opponentCallCost * 0.55 -
    opponentBenefit +
    informationValue * 0.5 +
    futureThrowInScoreSaving * 0.35 +
    immediatePointReduction * 0.15 +
    riskAdjustment;
  const finalActionValue = gameOutcomeValue + strategicAdjustment;

  return {
    actionType,
    expectedRoundScore: scoredOwnMoments.mean,
    expectedRawHandScore: ownMoments.mean,
    expectedGameScore,
    expectedPostRoundTotal: ownTotalEstimate.expectedPostRoundTotal,
    expectedThresholdAdjustedTotal: ownTotalEstimate.expectedThresholdAdjustedTotal,
    expectedThresholdAdjustment: ownTotalEstimate.expectedThresholdAdjustment,
    probabilityCrossingTarget: ownTotalEstimate.probabilityCrossingTarget,
    probabilityGameEnds,
    opponentTotalEstimates,
    estimatedWinProbability: clamp(estimatedWinProbability),
    estimatedGameWinProbability: clamp(estimatedWinProbability),
    gameOutcomeValue,
    strategicAdjustment,
    roundWinProbability: outcomes.roundWinProbability,
    dutchSuccessProbability: outcomes.dutchSuccessProbability,
    opponentCallFirstProbability: opponentCallFirst,
    opponentCallCost,
    immediateDutchScoreSaving,
    immediateDutchOptionValue,
    actionVariance: variance,
    informationValue,
    opponentBenefit,
    immediatePointReduction,
    futureThrowInScoreSaving,
    turnsRemaining,
    riskAdjustment,
    actionValue: finalActionValue,
    finalActionValue,
    metadata
  };
}

function finalTurnOutcomeModel(context, evaluation) {
  const {
    bot,
    ownDistribution,
    opponentDistributions = [],
    callerId
  } = context;
  const ownOutcomes = ownDistribution.map((outcome) => {
    const rawTotal = bot.total + outcome.value;
    const totalAfterHalving = scoreAfterRound(bot.total, outcome.value);
    return {
      handScore: outcome.value,
      probability: outcome.probability || 0,
      roundScore: outcome.value,
      rawTotal,
      totalAfterHalving,
      exactThreshold: rawTotal === 50 || rawTotal === 100,
      thresholdSaving: Math.max(0, rawTotal - totalAfterHalving)
    };
  });
  const expectedOwnTotal = ownOutcomes.reduce((sum, outcome) => (
    sum + outcome.probability * outcome.totalAfterHalving
  ), 0);
  const ownExactThresholdProbability = ownOutcomes.reduce((sum, outcome) => (
    sum + (outcome.exactThreshold ? outcome.probability : 0)
  ), 0);
  const ownThresholdSaving = ownOutcomes.reduce((sum, outcome) => (
    sum + outcome.probability * outcome.thresholdSaving
  ), 0);
  const caller = opponentDistributions.find((entry) => entry.player.id === callerId);
  let callerSuccessProbability = 0;
  let callerFailureProbability = 0;
  let callerExpectedTotal = null;
  let callerExactThresholdProbability = 0;
  const callerOutcomes = [];
  if (caller) {
    callerExpectedTotal = 0;
    const otherOpponents = opponentDistributions.filter((entry) => entry.player.id !== callerId);
    for (const outcome of caller.distribution) {
      const probability = outcome.probability || 0;
      const noOtherLower = probabilityAtLeast(ownDistribution, outcome.value) *
        otherOpponents.reduce((product, entry) => (
          product * probabilityAtLeast(entry.distribution, outcome.value)
        ), 1);
      const successProbability = outcome.value <= 5 ? noOtherLower : 0;
      const successfulTotal = scoreAfterRound(caller.player.total, 0);
      const failedRoundScore = outcome.value * 2;
      const failedRawTotal = caller.player.total + failedRoundScore;
      const failedTotal = scoreAfterRound(caller.player.total, failedRoundScore);
      const successMass = probability * successProbability;
      const failureMass = probability * (1 - successProbability);
      callerSuccessProbability += successMass;
      callerFailureProbability += failureMass;
      callerExpectedTotal += successMass * successfulTotal + failureMass * failedTotal;
      if (caller.player.total === 50 || caller.player.total === 100) {
        callerExactThresholdProbability += successMass;
      }
      if (failedRawTotal === 50 || failedRawTotal === 100) {
        callerExactThresholdProbability += failureMass;
      }
      callerOutcomes.push({
        handScore: outcome.value,
        probability,
        successProbability,
        successfulTotal,
        failedRoundScore,
        failedRawTotal,
        failedTotal,
        failedExactThreshold: failedRawTotal === 50 || failedRawTotal === 100
      });
    }
  }
  return {
    dedicated: true,
    callerId,
    turnsRemaining: 0,
    ignoresLongTermValue: true,
    expectedOwnTotal,
    ownExactThresholdProbability,
    ownThresholdSaving,
    normalLossProbability: 1 - evaluation.roundWinProbability,
    callerSuccessProbability,
    callerFailureProbability,
    callerExpectedTotal,
    callerExactThresholdProbability,
    ownOutcomes,
    callerOutcomes
  };
}

function evaluateFinalTurnAction(context) {
  const callerId = context.callerId || context.state.round && context.state.round.dutchCallerId;
  const evaluation = evaluateAction({
    ...context,
    callerId,
    informationValue: 0,
    futureThrowInScoreSaving: 0,
    turnsRemaining: 0
  });
  const outcome = finalTurnOutcomeModel({ ...context, callerId }, evaluation);
  const callerTotalValue = outcome.callerExpectedTotal === null ? 0 : outcome.callerExpectedTotal * 0.02;
  evaluation.actionValue =
    evaluation.gameOutcomeValue +
    evaluation.roundWinProbability * 4 +
    outcome.ownThresholdSaving * 0.08 +
    callerTotalValue -
    evaluation.opponentBenefit +
    evaluation.immediatePointReduction * 0.15;
  evaluation.strategicAdjustment = evaluation.actionValue - evaluation.gameOutcomeValue;
  evaluation.finalActionValue = evaluation.actionValue;
  evaluation.informationValue = 0;
  evaluation.futureThrowInScoreSaving = 0;
  evaluation.turnsRemaining = 0;
  evaluation.riskAdjustment = 0;
  evaluation.metadata = {
    ...(evaluation.metadata || {}),
    callerId,
    finalTurnOutcome: outcome
  };
  return evaluation;
}

function mixActionEvaluations(actionType, weightedEvaluations, metadata = {}) {
  const branches = weightedEvaluations.filter((item) => item && item.evaluation && item.probability > 0);
  const total = branches.reduce((sum, item) => sum + item.probability, 0) || 1;
  const fields = [
    'expectedRoundScore',
    'expectedRawHandScore',
    'expectedGameScore',
    'expectedPostRoundTotal',
    'expectedThresholdAdjustedTotal',
    'expectedThresholdAdjustment',
    'probabilityCrossingTarget',
    'probabilityGameEnds',
    'estimatedWinProbability',
    'estimatedGameWinProbability',
    'gameOutcomeValue',
    'strategicAdjustment',
    'roundWinProbability',
    'dutchSuccessProbability',
    'opponentCallFirstProbability',
    'opponentCallCost',
    'immediateDutchScoreSaving',
    'immediateDutchOptionValue',
    'informationValue',
    'opponentBenefit',
    'immediatePointReduction',
    'futureThrowInScoreSaving',
    'riskAdjustment',
    'turnsRemaining',
    'actionValue'
  ];
  const result = { actionType, metadata, branches };
  for (const field of fields) {
    result[field] = branches.reduce((sum, item) => sum + item.probability / total * item.evaluation[field], 0);
  }
  const withinVariance = branches.reduce((sum, item) => sum + item.probability / total * item.evaluation.actionVariance, 0);
  const betweenVariance = branches.reduce((sum, item) => {
    const delta = item.evaluation.expectedRoundScore - result.expectedRoundScore;
    return sum + item.probability / total * delta * delta;
  }, 0);
  result.actionVariance = withinVariance + betweenVariance;
  const opponentIds = new Set(branches.flatMap((item) => (
    item.evaluation.opponentTotalEstimates || []
  ).map((estimate) => estimate.playerId)));
  result.opponentTotalEstimates = Array.from(opponentIds, (playerId) => {
    const estimates = branches.map((item) => ({
      probability: item.probability / total,
      estimate: (item.evaluation.opponentTotalEstimates || []).find((entry) => (
        entry.playerId === playerId
      ))
    })).filter((item) => item.estimate);
    return {
      playerId,
      expectedPostRoundTotal: estimates.reduce((sum, item) => (
        sum + item.probability * item.estimate.expectedPostRoundTotal
      ), 0),
      expectedThresholdAdjustedTotal: estimates.reduce((sum, item) => (
        sum + item.probability * item.estimate.expectedThresholdAdjustedTotal
      ), 0),
      expectedThresholdAdjustment: estimates.reduce((sum, item) => (
        sum + item.probability * item.estimate.expectedThresholdAdjustment
      ), 0),
      probabilityCrossingTarget: estimates.reduce((sum, item) => (
        sum + item.probability * item.estimate.probabilityCrossingTarget
      ), 0)
    };
  });
  const finalBranches = branches.filter((item) => (
    item.evaluation.metadata && item.evaluation.metadata.finalTurnOutcome
  ));
  if (finalBranches.length === branches.length && finalBranches.length > 0) {
    const finalFields = [
      'expectedOwnTotal',
      'ownExactThresholdProbability',
      'ownThresholdSaving',
      'normalLossProbability',
      'callerSuccessProbability',
      'callerFailureProbability',
      'callerExpectedTotal',
      'callerExactThresholdProbability'
    ];
    result.metadata.finalTurnOutcome = {
      dedicated: true,
      callerId: finalBranches[0].evaluation.metadata.finalTurnOutcome.callerId,
      turnsRemaining: 0,
      ignoresLongTermValue: true
    };
    for (const field of finalFields) {
      result.metadata.finalTurnOutcome[field] = finalBranches.reduce((sum, item) => (
        sum + item.probability / total * (item.evaluation.metadata.finalTurnOutcome[field] || 0)
      ), 0);
    }
  }
  result.finalActionValue = result.actionValue;
  return result;
}

module.exports = {
  clamp,
  scoreAfterRound,
  probabilityAtLeast,
  probabilityAtMost,
  roundOutcomeProbabilities,
  estimateTurnsRemaining,
  opponentCallFirstProbability,
  projectedGameWinProbability,
  gameOutcomeUtility,
  evaluateAction,
  evaluateFinalTurnAction,
  mixActionEvaluations
};
