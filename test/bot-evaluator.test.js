const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateAction, evaluateFinalTurnAction, scoreAfterRound } = require('../lib/bot-evaluator.js');

function player(id, total, cards = 4) {
  return { id, total, cards: Array(cards).fill({}) };
}

function evaluate(ownDistribution, opponentDistribution, opponentCards = 4) {
  const bot = player('bot', 20);
  const opponent = player('opponent', 25, opponentCards);
  return evaluateAction({
    state: { gameTarget: 100, players: [bot, opponent], round: { deck: Array(20), dutchCallerId: null } },
    bot,
    actionType: 'test-action',
    ownDistribution,
    opponentDistributions: [{ player: opponent, distribution: opponentDistribution }],
    informationValue: 1.25,
    opponentBenefit: 0.4,
    immediatePointReduction: 2
  });
}

test('shared action results expose comparable outcome diagnostics', () => {
  const result = evaluate([{ value: 4, probability: 1 }], [{ value: 8, probability: 1 }]);
  for (const field of [
    'expectedRoundScore',
    'expectedGameScore',
    'estimatedWinProbability',
    'dutchSuccessProbability',
    'actionVariance',
    'informationValue',
    'opponentBenefit',
    'finalActionValue'
  ]) {
    assert.equal(Number.isFinite(result[field]), true, field);
  }
  assert.equal(result.expectedRoundScore, 4);
  assert.equal(result.dutchSuccessProbability, 1);
  assert.equal(result.finalActionValue, result.actionValue);
});

test('variance is penalized while safely ahead and rewarded under imminent opponent pressure', () => {
  const safe = evaluate([{ value: 4, probability: 1 }], [{ value: 10, probability: 1 }]);
  const safeVariance = evaluate([
    { value: 2, probability: 0.5 },
    { value: 6, probability: 0.5 }
  ], [{ value: 10, probability: 1 }]);
  assert.ok(safeVariance.riskAdjustment < safe.riskAdjustment);

  const pressured = evaluate([
    { value: 8, probability: 0.5 },
    { value: 12, probability: 0.5 }
  ], [{ value: 4, probability: 1 }], 1);
  assert.ok(pressured.riskAdjustment > 0);
});

test('projected scoring applies exact 50 and 100 halving', () => {
  assert.equal(scoreAfterRound(46, 4), 25);
  assert.equal(scoreAfterRound(96, 4), 50);
  assert.equal(scoreAfterRound(45, 4), 49);
});

test('opponent Dutch calls score success and failure from the bot hand distribution', () => {
  const bot = player('bot', 20);
  const opponent = player('opponent', 25);
  const state = { gameTarget: 100, players: [bot, opponent], round: { deck: Array(20), dutchCallerId: null } };
  const againstFailedCall = evaluateAction({
    state,
    bot,
    actionType: 'opponent-called',
    ownDistribution: [{ value: 4, probability: 1 }],
    opponentDistributions: [{ player: opponent, distribution: [{ value: 5, probability: 1 }] }],
    callerId: opponent.id
  });
  const againstSuccessfulCall = evaluateAction({
    state,
    bot,
    actionType: 'opponent-called',
    ownDistribution: [{ value: 6, probability: 1 }],
    opponentDistributions: [{ player: opponent, distribution: [{ value: 5, probability: 1 }] }],
    callerId: opponent.id
  });

  assert.equal(againstFailedCall.opponentCallFirstProbability, 0);
  assert.equal(againstSuccessfulCall.opponentCallFirstProbability, 0);
  assert.ok(againstFailedCall.estimatedWinProbability > againstSuccessfulCall.estimatedWinProbability);
});

test('Dutch action variance includes zero-or-double scoring outcomes', () => {
  const bot = player('bot', 20);
  const opponent = player('opponent', 25);
  const result = evaluateAction({
    state: { gameTarget: 100, players: [bot, opponent], round: { deck: Array(20), dutchCallerId: null } },
    bot,
    actionType: 'call-dutch',
    ownDistribution: [{ value: 4, probability: 1 }],
    opponentDistributions: [{
      player: opponent,
      distribution: [
        { value: 3, probability: 0.5 },
        { value: 8, probability: 0.5 }
      ]
    }],
    callerId: bot.id
  });

  assert.equal(result.expectedRawHandScore, 4);
  assert.equal(result.expectedRoundScore, 4);
  assert.equal(result.actionVariance, 16);
});

test('final-turn evaluation exposes exact totals for the bot and both Dutch caller outcomes', () => {
  const bot = player('bot', 46);
  const caller = player('caller', 40);
  const state = {
    gameTarget: 100,
    players: [bot, caller],
    round: { deck: Array(20), dutchCallerId: caller.id, dutchQueue: [] }
  };
  const failedCall = evaluateFinalTurnAction({
    state,
    bot,
    actionType: 'final-hold',
    ownDistribution: [{ value: 4, probability: 1 }],
    opponentDistributions: [{ player: caller, distribution: [{ value: 5, probability: 1 }] }]
  });

  assert.equal(failedCall.turnsRemaining, 0);
  assert.equal(failedCall.informationValue, 0);
  assert.equal(failedCall.futureThrowInScoreSaving, 0);
  assert.equal(failedCall.metadata.finalTurnOutcome.dedicated, true);
  assert.equal(failedCall.metadata.finalTurnOutcome.expectedOwnTotal, 25);
  assert.equal(failedCall.metadata.finalTurnOutcome.ownExactThresholdProbability, 1);
  assert.equal(failedCall.metadata.finalTurnOutcome.ownThresholdSaving, 25);
  assert.equal(failedCall.metadata.finalTurnOutcome.callerFailureProbability, 1);
  assert.equal(failedCall.metadata.finalTurnOutcome.callerExpectedTotal, 25);
  assert.equal(failedCall.metadata.finalTurnOutcome.callerExactThresholdProbability, 1);
  assert.deepEqual(failedCall.metadata.finalTurnOutcome.callerOutcomes[0], {
    handScore: 5,
    probability: 1,
    successProbability: 0,
    successfulTotal: 40,
    failedRoundScore: 10,
    failedRawTotal: 50,
    failedTotal: 25,
    failedExactThreshold: true
  });

  const successfulCall = evaluateFinalTurnAction({
    state,
    bot,
    actionType: 'final-hold',
    ownDistribution: [{ value: 6, probability: 1 }],
    opponentDistributions: [{ player: caller, distribution: [{ value: 5, probability: 1 }] }]
  });
  assert.equal(successfulCall.metadata.finalTurnOutcome.callerSuccessProbability, 1);
  assert.equal(successfulCall.metadata.finalTurnOutcome.callerFailureProbability, 0);
  assert.equal(successfulCall.metadata.finalTurnOutcome.callerExpectedTotal, 40);
});

test('game outcome metrics prefer a threshold-adjusted win over a lower raw hand', () => {
  const bot = player('bot', 45);
  const opponent = player('opponent', 30);
  const state = {
    gameTarget: 100,
    players: [bot, opponent],
    round: { deck: Array(20), dutchCallerId: null }
  };
  const lowerRawHand = evaluateAction({
    state,
    bot,
    actionType: 'lower-raw',
    ownDistribution: [{ value: 4, probability: 1 }],
    opponentDistributions: [{ player: opponent, distribution: [{ value: 8, probability: 1 }] }]
  });
  const exactThreshold = evaluateAction({
    state,
    bot,
    actionType: 'exact-threshold',
    ownDistribution: [{ value: 5, probability: 1 }],
    opponentDistributions: [{ player: opponent, distribution: [{ value: 8, probability: 1 }] }]
  });

  assert.ok(exactThreshold.expectedRawHandScore > lowerRawHand.expectedRawHandScore);
  assert.equal(exactThreshold.expectedPostRoundTotal, 50);
  assert.equal(exactThreshold.expectedThresholdAdjustedTotal, 25);
  assert.equal(exactThreshold.expectedThresholdAdjustment, 25);
  assert.ok(exactThreshold.estimatedGameWinProbability > lowerRawHand.estimatedGameWinProbability);
  assert.ok(exactThreshold.actionValue > lowerRawHand.actionValue);
});

test('game outcome metrics include target crossing and opponent post-round totals', () => {
  const bot = player('bot', 99);
  const opponent = player('opponent', 20);
  const result = evaluateAction({
    state: {
      gameTarget: 100,
      players: [bot, opponent],
      round: { deck: Array(20), dutchCallerId: null }
    },
    bot,
    actionType: 'cross-target',
    ownDistribution: [{ value: 2, probability: 1 }],
    opponentDistributions: [{
      player: opponent,
      distribution: [{ value: 5, probability: 1 }]
    }]
  });

  assert.equal(result.expectedPostRoundTotal, 101);
  assert.equal(result.expectedThresholdAdjustedTotal, 101);
  assert.equal(result.probabilityCrossingTarget, 1);
  assert.equal(result.probabilityGameEnds, 1);
  assert.equal(result.estimatedGameWinProbability, 0);
  assert.deepEqual(result.opponentTotalEstimates.map((estimate) => ({
    playerId: estimate.playerId,
    expectedPostRoundTotal: estimate.expectedPostRoundTotal,
    expectedThresholdAdjustedTotal: estimate.expectedThresholdAdjustedTotal,
    probabilityCrossingTarget: estimate.probabilityCrossingTarget
  })), [{
    playerId: opponent.id,
    expectedPostRoundTotal: 25,
    expectedThresholdAdjustedTotal: 25,
    probabilityCrossingTarget: 0
  }]);
});
