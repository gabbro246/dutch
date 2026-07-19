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
        projectedGameWinProbability(bot, branch.total, opponentTotals, state.gameTarget || 100);
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
  const finalActionValue =
    estimatedWinProbability * 120 +
    outcomes.roundWinProbability * 30 +
    immediateDutchOptionValue -
    expectedGameScore * 0.72 -
    opponentCallCost -
    opponentBenefit * 1.35 +
    informationValue * 0.85 +
    futureThrowInScoreSaving * 0.72 +
    immediatePointReduction * 0.22 +
    riskAdjustment;

  return {
    actionType,
    expectedRoundScore: scoredOwnMoments.mean,
    expectedRawHandScore: ownMoments.mean,
    expectedGameScore,
    estimatedWinProbability: clamp(estimatedWinProbability),
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

function mixActionEvaluations(actionType, weightedEvaluations, metadata = {}) {
  const branches = weightedEvaluations.filter((item) => item && item.evaluation && item.probability > 0);
  const total = branches.reduce((sum, item) => sum + item.probability, 0) || 1;
  const fields = [
    'expectedRoundScore',
    'expectedRawHandScore',
    'expectedGameScore',
    'estimatedWinProbability',
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
  evaluateAction,
  mixActionEvaluations
};
