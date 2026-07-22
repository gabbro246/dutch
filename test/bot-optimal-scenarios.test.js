const test = require('node:test');
const assert = require('node:assert/strict');
const { createBotDecisions } = require('../lib/bot-decisions.js');
const { cardMemory, unknownMemory, effectiveMemory } = require('../lib/bot-strategy.js');

let nextId = 1;
function card(rank, suit = 'clubs') {
  return { id: 'scenario-' + nextId++, rank, suit, deckColor: 'blue' };
}

function harness(options) {
  const bot = {
    id: 'bot',
    name: 'Roswell',
    isBot: true,
    botType: options.botType || 'roswell',
    cards: options.own,
    total: options.total || 0,
    left: false,
    isSpectator: false
  };
  const opponents = (options.opponents || []).map((cards, index) => ({
    id: 'opp-' + index,
    name: 'Opponent ' + index,
    cards,
    total: (options.opponentTotals || [])[index] || 0,
    left: false,
    isSpectator: false
  }));
  const state = {
    deckSetting: 'one',
    gameTarget: options.gameTarget || 100,
    roundNumber: 3,
    players: [bot, ...opponents],
    round: {
      currentPlayerIndex: 0,
      discard: [options.pile || card('9')],
      deck: Array(options.deckCount || 20).fill(null),
      dutchCallerId: null,
      strategyTick: 4,
      throwIn: options.throwIn || null
    }
  };
  const slots = {
    bot: bot.cards.map((item) => options.ownUnknown
      ? unknownMemory('own unknown', 4)
      : cardMemory(item, 'own peek', 1, 'known', 4))
  };
  opponents.forEach((player) => {
    slots[player.id] = player.cards.map((item) => options.opponentsUnknown
      ? unknownMemory('opponent unknown', 4)
      : cardMemory(item, 'Queen peek', 1, 'known', 4));
  });
  const memory = {
    slots,
    discards: [],
    removed: [],
    reshuffles: [],
    inference: options.inference || {},
    humanKnowledge: options.humanKnowledge || {},
    humanKnowledgeRevision: options.humanKnowledgeRevision || 0
  };
  const decisions = createBotDecisions({
    getState: () => state,
    ensureBotMemory: () => memory,
    botMemoryEntry: (viewer, ownerId, index) => memory.slots[ownerId][index],
    effectiveMemory: (viewer, entry) => effectiveMemory(viewer, entry, 4),
    effectiveHumanMemory: (viewer, humanId, ownerId, index) => {
      const model = memory.humanKnowledge[humanId];
      const entry = model && model.slots && model.slots[ownerId] && model.slots[ownerId][index];
      return entry || { state: 'unknown', confidence: 0, card: null, source: 'human unknown' };
    },
    activePlayablePlayers: () => state.players,
    isProtectedSpecialTarget: (playerId) => !!(
      state.round.dutchCallerId && state.round.dutchCallerId === playerId
    ),
    findActiveIndexFrom: (start) => start % state.players.length,
    randomBetween: (min, max) => (min + max) / 2,
    random: () => 0.5
  });
  return { bot, opponents, state, memory, decisions };
}

test('rejects a lower pile card when it cannot create a viable Dutch state and deck upside is better', () => {
  const setup = harness({
    own: [card('K', 'hearts'), card('2'), card('3'), card('9')],
    opponents: [[card('A'), card('A', 'spades'), card('2'), card('K', 'diamonds')]],
    total: 40,
    opponentTotals: [20],
    pile: card('8')
  });
  const result = setup.decisions.evaluateDrawSources(setup.bot);
  assert.equal(result.selected.actionType, 'draw-deck');
  assert.ok(result.deck.actionValue > result.pile.actionValue);
  assert.equal(result.pile.expectedRoundScore > 5, true);
});

test('takes a safe pile card while ahead when it creates a callable winning hand', () => {
  const setup = harness({
    own: [card('K', 'hearts'), card('2'), card('3'), card('8')],
    opponents: [[card('10'), card('9'), card('8'), card('7')]],
    total: 20,
    opponentTotals: [55],
    pile: card('K', 'diamonds')
  });
  const result = setup.decisions.evaluateDrawSources(setup.bot);
  assert.equal(result.selected.actionType, 'take-pile');
  assert.equal(result.pile.expectedRoundScore, 5);
  assert.ok(result.pile.actionVariance <= result.deck.actionVariance);
});

test('accepts deck variance when an opponent is likely to end the round first', () => {
  const setup = harness({
    own: [card('K', 'hearts'), card('2'), card('3'), card('9')],
    opponents: [[card('A'), card('2')]],
    total: 40,
    opponentTotals: [20],
    pile: card('8')
  });
  const result = setup.decisions.evaluateDrawSources(setup.bot);
  assert.equal(result.selected.actionType, 'draw-deck');
  assert.ok(result.deck.actionVariance > result.pile.actionVariance);
});

test('Dutch evaluator rejects lower opponent, uncertain, and high-card calls but accepts a safe call', () => {
  const lowerOpponent = harness({
    own: [card('2'), card('2')],
    opponents: [[card('A'), card('A')]]
  });
  assert.equal(lowerOpponent.decisions.botShouldCallDutch(lowerOpponent.bot), false);

  const uncertain = harness({
    own: [card('A'), card('2')],
    ownUnknown: true,
    opponents: [[card('8'), card('9')]]
  });
  const uncertainResult = uncertain.decisions.evaluateDutch(uncertain.bot);
  assert.equal(uncertain.decisions.botShouldCallDutch(uncertain.bot), false);
  assert.ok(uncertainResult.call.dutchSuccessProbability < 0.5);

  const safe = harness({
    own: [card('A'), card('2'), card('K', 'hearts')],
    opponents: [[card('8'), card('9')]]
  });
  assert.equal(safe.decisions.botShouldCallDutch(safe.bot), true);
  assert.ok(safe.decisions.evaluateDutch(safe.bot).call.dutchSuccessProbability > 0.8);

  const high = harness({
    own: [card('K', 'clubs'), card('2')],
    opponents: [[card('9'), card('8')]]
  });
  assert.equal(high.decisions.botShouldCallDutch(high.bot), false);
});

test('Dutch continue rollout includes an opponent call and the real final-turn response', () => {
  const setup = harness({
    own: [card('2'), card('3')],
    opponents: [[card('A'), card('2')]],
    pile: card('9')
  });
  const result = setup.decisions.evaluateDutch(setup.bot);

  assert.equal(result.continue.metadata.simulatedToNextDecision, true);
  assert.ok(result.continue.metadata.opponentCallBeforeNextProbability > 0.7);
  assert.ok(result.continue.branches.some((branch) => (
    branch.evaluation.actionType === 'continue-opponent-called' &&
    branch.evaluation.metadata.callerId === setup.opponents[0].id
  )));
  assert.equal(result.continue.metadata.expectedImprovement, undefined);
  assert.ok(result.continue.actionVariance > 0);
});

test('Dutch at five uses beliefs and does not wait for secret proof that nobody is lower', () => {
  const setup = harness({
    own: [card('2'), card('3')],
    opponents: [[card('A'), card('A', 'spades')]],
    opponentsUnknown: true
  });
  const result = setup.decisions.evaluateDutch(setup.bot);

  assert.ok(result.call.dutchSuccessProbability > 0.5);
  assert.equal(setup.decisions.botShouldCallDutch(setup.bot), true);
});

test('Dutch evaluation preserves a safe exact-50 halving opportunity', () => {
  const setup = harness({
    own: [card('2'), card('2')],
    opponents: [[card('9'), card('9')]],
    total: 46
  });
  const result = setup.decisions.evaluateDutch(setup.bot);

  assert.equal(setup.decisions.botShouldCallDutch(setup.bot), false);
  assert.ok(result.continue.expectedGameScore < result.call.expectedGameScore);
});

test('a strong Dutch-ready hand freezes draws and unnecessary special actions', () => {
  const setup = harness({
    own: [card('2'), card('3')],
    opponents: [[card('10'), card('9')]],
    pile: card('A')
  });

  const draw = setup.decisions.evaluateDrawSources(setup.bot);
  assert.equal(draw.deck.metadata.dutchFreeze.active, true);
  assert.equal(draw.selected.actionType, 'draw-deck');
  assert.equal(setup.decisions.shouldBotSwapDrawn(setup.bot, card('K', 'hearts')), false);
  assert.equal(setup.decisions.botAceTarget(setup.bot), null);
  assert.equal(setup.decisions.botQueenTarget(setup.bot), null);
  assert.deepEqual(setup.decisions.botJackCandidates(setup.bot), []);
  assert.equal(setup.decisions.botShouldCallDutch(setup.bot), true);
});

test('exact total strategy prevents freezing or calling an otherwise strong hand', () => {
  const setup = harness({
    own: [card('2'), card('2')],
    opponents: [[card('10'), card('9')]],
    total: 46
  });

  const draw = setup.decisions.evaluateDrawSources(setup.bot);
  assert.equal(draw.deck.metadata.dutchFreeze.active, false);
  assert.equal(setup.decisions.botShouldCallDutch(setup.bot), false);
});

test('Dutch calls expose explicit final-turn and post-halving outcome arithmetic', () => {
  const setup = harness({
    own: [card('2'), card('3')],
    opponents: [[card('8')]],
    opponentTotals: [30]
  });
  const result = setup.decisions.evaluateDutch(setup.bot);
  const model = result.call.metadata.deliberateCallModel;

  assert.equal(result.call.metadata.simulatedFinalTurns, true);
  assert.equal(result.call.metadata.finalOpponentExpectedScores.length, 1);
  assert.ok(result.call.metadata.finalOpponentExpectedScores[0].score < 8);
  assert.equal(model.samples > 0, true);
  assert.equal(model.outcomes.length > 0, true);
  assert.ok(model.outcomes.every((outcome) => (
    Number.isFinite(outcome.finalHandScore) &&
    Number.isFinite(outcome.doubledScore) &&
    Number.isFinite(outcome.rawTotal) &&
    Number.isFinite(outcome.totalAfterHalving) &&
    Number.isFinite(outcome.gameWinProbability)
  )));
});

test('Dutch above five is rejected without a guaranteed throw-in or beneficial exact total', () => {
  const setup = harness({
    own: [card('6')],
    opponents: [[card('A')]],
    total: 0
  });
  const result = setup.decisions.evaluateDutch(setup.bot);

  assert.equal(result.call.metadata.callEligibility.startsAboveFive, true);
  assert.equal(result.call.eligible, false);
  assert.equal(setup.decisions.botShouldCallDutch(setup.bot), false);
});

test('a guaranteed final throw-in can make an above-five Dutch call eligible', () => {
  const setup = harness({
    own: [card('6')],
    opponents: [[card('9')]],
    pile: card('6'),
    throwIn: { open: true, rank: '6' }
  });
  const result = setup.decisions.evaluateDutch(setup.bot);

  assert.equal(result.call.metadata.callEligibility.startsAboveFive, true);
  assert.equal(result.call.metadata.callEligibility.guaranteedFinalThrowIn, true);
  assert.equal(result.call.metadata.deliberateCallModel.finalHandAtMostFiveProbability, 1);
  assert.equal(result.call.eligible, true);
});

test('a deliberate failed Dutch call requires exact arithmetic that lowers the total', () => {
  const beneficial = harness({
    own: [card('6')],
    opponents: [[card('A')]],
    total: 38
  });
  const beneficialResult = beneficial.decisions.evaluateDutch(beneficial.bot);
  const beneficialModel = beneficialResult.call.metadata.deliberateCallModel;

  assert.ok(beneficialModel.beneficialFailureProbability >= 0.9);
  assert.equal(beneficialResult.call.metadata.callEligibility.beneficialExactFailure, true);
  assert.ok(beneficialModel.outcomes.some((outcome) => (
    !outcome.success && outcome.doubledScore === 12 && outcome.rawTotal === 50 &&
    outcome.exactThreshold && outcome.totalAfterHalving === 25 && outcome.beneficialFailure
  )));
  assert.equal(beneficial.decisions.botShouldCallDutch(beneficial.bot), true);

  const nonExact = harness({
    own: [card('6')],
    opponents: [[card('A')]],
    total: 39
  });
  const nonExactResult = nonExact.decisions.evaluateDutch(nonExact.bot);
  assert.equal(nonExactResult.call.metadata.callEligibility.beneficialExactFailure, false);
  assert.equal(nonExactResult.call.eligible, false);
  assert.equal(nonExact.decisions.botShouldCallDutch(nonExact.bot), false);
});

test('a high-probability Dutch win penalizes needless continuation variance', () => {
  const setup = harness({
    own: [card('2'), card('2')],
    opponents: [[card('10'), card('9')]]
  });
  const result = setup.decisions.evaluateDutch(setup.bot);

  assert.equal(result.call.metadata.strongReadyHand, true);
  assert.equal(result.call.metadata.continuingImprovesGameTotal, false);
  assert.ok(result.continue.metadata.winningPositionVariancePenalty >= 0);
  assert.equal(setup.decisions.botShouldCallDutch(setup.bot), true);
});

test('opponent threat mode combines score, recent actions, and remembered self-knowledge', () => {
  const knownTwo = cardMemory({ rank: '2', suit: 'clubs' }, 'start peek', 1, 'known', 4);
  const knownThree = cardMemory({ rank: '3', suit: 'clubs' }, 'start peek', 0.95, 'known', 4);
  const informed = harness({
    own: [card('10'), card('9')],
    opponents: [[card('2'), card('3')]],
    humanKnowledge: {
      'opp-0': {
        slots: {
          bot: [unknownMemory('human unknown', 4), unknownMemory('human unknown', 4)],
          'opp-0': [knownTwo, knownThree]
        },
        dutchReadiness: 0.45
      }
    },
    inference: {
      'opp-0': {
        lowCardBelief: 0.5,
        dutchReadiness: 0.35,
        rankConfidence: {},
        targetInterest: {},
        recentActions: [
          { type: 'take-pile', low: true, points: 2, valid: true, updatedTick: 3 },
          { type: 'throw-in', low: true, points: null, valid: true, updatedTick: 4 }
        ]
      }
    }
  });
  const poorKnowledge = harness({
    own: [card('10'), card('9')],
    opponents: [[card('2'), card('3')]]
  });

  const informedProfile = informed.decisions.opponentThreatState(informed.bot).primary;
  const poorProfile = poorKnowledge.decisions.opponentThreatState(poorKnowledge.bot).primary;

  assert.equal(informedProfile.immediate, true);
  assert.ok(informedProfile.callBeforeNextProbability >= 0.58);
  assert.ok(informedProfile.recentLowPressure > 0.5);
  assert.ok(informedProfile.selfKnowledge.knownLowPositions > 1.5);
  assert.ok(informedProfile.score > poorProfile.score + 0.05);
});

test('threat mode favors immediate reduction and discounts future throw-in plans', () => {
  const setup = harness({
    own: [card('5'), card('9'), card('2')],
    opponents: [[card('2'), card('3')]],
    inference: {
      'opp-0': {
        lowCardBelief: 0.6,
        dutchReadiness: 0.5,
        rankConfidence: {},
        targetInterest: {},
        recentActions: [
          { type: 'take-pile', low: true, points: 2, valid: true, updatedTick: 4 },
          { type: 'throw-in', low: true, points: null, valid: true, updatedTick: 4 }
        ]
      }
    }
  });
  const replacement = setup.decisions.evaluateReplacement(setup.bot, card('5', 'spades'), 1);
  const smallImprovement = setup.decisions.evaluateReplacement(setup.bot, card('8', 'hearts'), 1);
  const adjustment = replacement.metadata.opponentThreatMode;

  assert.equal(adjustment.active, true);
  assert.ok(replacement.immediatePointReduction > 3);
  assert.ok(adjustment.immediateReductionBonus > 0);
  assert.ok(adjustment.futureThrowInMultiplier < 0.5);
  assert.ok(smallImprovement.metadata.opponentThreatMode.smallImprovementPenalty > 0);
});

test('threat mode strengthens discard denial and targets specials at the threat', () => {
  const threatOptions = {
    own: [card('10'), card('4')],
    opponents: [[card('2'), card('3')], [card('10', 'spades'), card('9', 'spades')]],
    inference: {
      'opp-0': {
        lowCardBelief: 0.7,
        dutchReadiness: 0.55,
        rankConfidence: {},
        targetInterest: {},
        recentActions: [
          { type: 'take-pile', low: true, points: 2, valid: true, updatedTick: 4 },
          { type: 'throw-in', low: true, points: null, valid: true, updatedTick: 4 }
        ]
      }
    }
  };
  const setup = harness(threatOptions);
  const baseline = harness({
    own: [card('10'), card('4')],
    opponents: [[card('2'), card('3')], [card('10', 'spades'), card('9', 'spades')]]
  });
  const threatenedDiscard = setup.decisions.evaluateDeckDiscard(
    setup.bot,
    card('2', 'hearts'),
    setup.decisions.contextFor(setup.bot)
  );
  const baselineDiscard = baseline.decisions.evaluateDeckDiscard(
    baseline.bot,
    card('2', 'hearts'),
    baseline.decisions.contextFor(baseline.bot)
  );
  const ace = setup.decisions.botAceTarget(setup.bot);
  const jack = setup.decisions.botJackCandidates(setup.bot)[0];

  assert.ok(threatenedDiscard.opponentBenefit > baselineDiscard.opponentBenefit);
  assert.equal(ace.player.id, setup.opponents[0].id);
  assert.ok(ace.metadata.threatAttackBonus > 0);
  assert.ok(jack.metadata.jackThreatBonus > 0);
});

test('threat mode values uncertainty reduction about the threatening human', () => {
  const knownTwo = cardMemory({ rank: '2', suit: 'clubs' }, 'start peek', 1, 'known', 4);
  const knownThree = cardMemory({ rank: '3', suit: 'clubs' }, 'start peek', 1, 'known', 4);
  const setup = harness({
    own: [card('10'), card('9')],
    opponents: [[card('2'), card('3')], [card('9'), card('10')]],
    opponentsUnknown: true,
    humanKnowledge: {
      'opp-0': {
        slots: {
          bot: [unknownMemory('human unknown', 4), unknownMemory('human unknown', 4)],
          'opp-0': [knownTwo, knownThree],
          'opp-1': [unknownMemory('human unknown', 4), unknownMemory('human unknown', 4)]
        },
        dutchReadiness: 0.9
      },
      'opp-1': {
        slots: {
          bot: [unknownMemory('human unknown', 4), unknownMemory('human unknown', 4)],
          'opp-0': [unknownMemory('human unknown', 4), unknownMemory('human unknown', 4)],
          'opp-1': [unknownMemory('human unknown', 4), unknownMemory('human unknown', 4)]
        },
        dutchReadiness: 0
      }
    },
    inference: {
      'opp-0': {
        lowCardBelief: 1,
        dutchReadiness: 1,
        rankConfidence: {},
        targetInterest: {},
        recentActions: [
          { type: 'take-pile', low: true, points: 2, valid: true, updatedTick: 4 },
          { type: 'throw-in', low: true, points: null, valid: true, updatedTick: 4 }
        ]
      }
    }
  });
  const queen = setup.decisions.botQueenTarget(setup.bot);

  assert.equal(queen.player.id, setup.opponents[0].id);
  assert.equal(queen.metadata.opponentThreatMode.active, true);
  assert.ok(queen.metadata.opponentThreatMode.informationMultiplier > 1);
});

test('threat mode adds value to calling Dutch before an opponent can call', () => {
  const setup = harness({
    own: [card('2'), card('3')],
    opponents: [[card('5')]],
    inference: {
      'opp-0': {
        lowCardBelief: 0.5,
        dutchReadiness: 0.8,
        rankConfidence: {},
        targetInterest: {},
        recentActions: [
          { type: 'take-pile', low: true, points: 5, valid: true, updatedTick: 4 }
        ]
      }
    }
  });
  const result = setup.decisions.evaluateDutch(setup.bot);

  assert.ok(result.call.metadata.callFirstBonus > 0);
  assert.equal(result.call.metadata.opponentThreatMode.active, true);
  assert.equal(setup.decisions.botShouldCallDutch(setup.bot), true);
});

test('Ace discard assessment includes replacement, retention, target escape, retaliation, and pile exposure', () => {
  const setup = harness({
    own: [card('A'), card('9')],
    opponents: [[card('2'), card('3')]],
    inference: {
      'opp-0': {
        lowCardBelief: 0.7,
        dutchReadiness: 0.7,
        rankConfidence: {},
        targetInterest: {},
        recentActions: [
          { type: 'take-pile', low: true, points: 2, valid: true, updatedTick: 4 }
        ]
      }
    }
  });
  setup.memory.aceAttackers = { 'opp-0': 2 };
  const replacement = setup.decisions.evaluateReplacement(setup.bot, card('3', 'spades'), 0);
  const assessment = replacement.metadata.aceDiscardAssessment;
  const target = assessment.targets.find((item) => item.playerId === setup.opponents[0].id);
  const deckDiscard = setup.decisions.evaluateDeckDiscard(
    setup.bot,
    card('A', 'hearts'),
    setup.decisions.contextFor(setup.bot)
  );

  assert.equal(assessment.incomingCard.rank, '3');
  assert.equal(assessment.guaranteedScoreIncrease, 2);
  assert.equal(assessment.aceLowCardRetentionValue, 1);
  assert.ok(assessment.opponentExpectedDisadvantage > 0);
  assert.ok(assessment.pileExposureCost > 0);
  assert.ok(assessment.retaliationCost > 0);
  assert.ok(target.discardAddedChance > 0);
  assert.ok(target.discardAddedChance < 1);
  assert.ok(target.callProbabilityReduction > 0);
  assert.equal(deckDiscard.metadata.aceDiscardAssessment.guaranteedScoreIncrease, 0);
  assert.ok(deckDiscard.metadata.aceDiscardAssessment.pileExposureCost > 0);
});

test('Ace discard is rejected when its guaranteed score increase exceeds opponent disadvantage', () => {
  const setup = harness({
    own: [card('A'), card('2')],
    opponents: [[card('10'), card('9')]]
  });
  const replacement = setup.decisions.evaluateReplacement(
    setup.bot,
    card('K', 'clubs'),
    0
  );
  const assessment = replacement.metadata.aceDiscardAssessment;

  assert.ok(assessment.guaranteedScoreIncrease > assessment.opponentExpectedDisadvantage);
  assert.equal(assessment.eligible, false);
  assert.equal(replacement.eligible, false);
  assert.equal(replacement.rejectionReason, 'ace-cost-exceeds-opponent-disadvantage');

  setup.memory.pendingAceDiscardAssessment = assessment;
  const target = setup.decisions.evaluateAceTarget(setup.bot, setup.opponents[0]);
  assert.equal(target.metadata.aceImpact.costExceedsDisadvantage, true);
  assert.equal(target.eligible, false);
});

test('Ace retaliation history raises expected retaliation cost', () => {
  const baseline = harness({
    own: [card('10'), card('9')],
    opponents: [[card('2'), card('3')]]
  });
  const retaliatory = harness({
    own: [card('10'), card('9')],
    opponents: [[card('2'), card('3')]]
  });
  baseline.memory.aceAttackers = {};
  retaliatory.memory.aceAttackers = { 'opp-0': 3 };

  const ordinaryImpact = baseline.decisions.aceTargetImpact(baseline.bot, baseline.opponents[0]);
  const retaliatoryImpact = retaliatory.decisions.aceTargetImpact(retaliatory.bot, retaliatory.opponents[0]);

  assert.ok(retaliatoryImpact.retaliationChance > ordinaryImpact.retaliationChance);
  assert.ok(retaliatoryImpact.retaliationCost > ordinaryImpact.retaliationCost);
});

test('Ace strong bonuses require material round impact against an immediate threat', () => {
  const setup = harness({
    own: [card('10'), card('9')],
    opponents: [[card('2'), card('3')], [card('10', 'spades'), card('9', 'spades')]],
    inference: {
      'opp-0': {
        lowCardBelief: 0.8,
        dutchReadiness: 0.8,
        rankConfidence: {},
        targetInterest: {},
        recentActions: [
          { type: 'take-pile', low: true, points: 2, valid: true, updatedTick: 4 },
          { type: 'throw-in', low: true, points: null, valid: true, updatedTick: 4 }
        ]
      }
    }
  });
  const threat = setup.decisions.evaluateAceTarget(setup.bot, setup.opponents[0]);
  const safe = setup.decisions.evaluateAceTarget(setup.bot, setup.opponents[1]);
  const selected = setup.decisions.botAceTarget(setup.bot);

  assert.equal(threat.metadata.aceImpact.immediateThreat, true);
  assert.equal(threat.metadata.aceImpact.materialRoundImpact, true);
  assert.ok(threat.metadata.aceImpact.strongThreatBonus > 0);
  assert.equal(safe.metadata.aceImpact.strongThreatBonus, 0);
  assert.ok(safe.metadata.aceImpact.nonThreatPenalty > 0);
  assert.equal(selected.player.id, setup.opponents[0].id);
  assert.ok(threat.metadata.aceImpact.callProbabilityReduction > safe.metadata.aceImpact.callProbabilityReduction);
  assert.ok(threat.metadata.aceImpact.roundWinProbabilityReduction >= safe.metadata.aceImpact.roundWinProbabilityReduction);
});

test('Queen skips peeks that are known, committed, or too late to change a decision', () => {
  const known = harness({
    own: [card('10'), card('9')],
    opponents: [[card('8'), card('7')]]
  });
  assert.equal(known.decisions.botQueenTarget(known.bot), null);

  const committed = harness({
    own: [card('2'), card('3')],
    opponents: [[card('10'), card('9')]],
    opponentsUnknown: true
  });
  committed.state.round.dutchCallerId = committed.bot.id;
  const committedTarget = committed.decisions.evaluateQueenTarget(
    committed.bot,
    committed.opponents[0],
    0
  );
  assert.equal(committedTarget.eligible, false);
  assert.equal(committedTarget.rejectionReason, 'queen-dutch-committed');
  assert.equal(committed.decisions.botQueenTarget(committed.bot), null);

  const finalTurn = harness({
    own: [card('10'), card('9')],
    ownUnknown: true,
    opponents: [[card('8'), card('7')]],
    opponentsUnknown: true
  });
  finalTurn.state.round.dutchCallerId = finalTurn.opponents[0].id;
  finalTurn.state.round.dutchQueue = [];
  finalTurn.state.round.specialQueue = [{ type: 'Q', actorId: finalTurn.bot.id }];
  finalTurn.state.round.throwIn = { open: false, rank: 'Q' };
  const lateTarget = finalTurn.decisions.evaluateQueenTarget(finalTurn.bot, finalTurn.bot, 0);

  assert.equal(lateTarget.eligible, false);
  assert.equal(lateTarget.rejectionReason, 'queen-final-turn-no-usable-choice');
  assert.equal(finalTurn.decisions.botQueenTarget(finalTurn.bot), null);
});

test('Queen prioritizes an uncertain own position with the greatest high-card exposure', () => {
  const setup = harness({
    own: [card('10'), card('2')],
    opponents: [[card('6'), card('6', 'spades')]],
    total: 40
  });
  setup.memory.slots.bot = [
    cardMemory(setup.bot.cards[0], 'uncertain own card', 0.45, 'guessed', 4),
    cardMemory(setup.bot.cards[1], 'uncertain own card', 0.45, 'guessed', 4)
  ];

  const target = setup.decisions.botQueenTarget(setup.bot);
  const alternatives = setup.decisions.botQueenTargets(setup.bot).ownUnknown;

  assert.equal(target.player.id, setup.bot.id);
  assert.equal(target.index, 0);
  assert.ok(target.queenDecisionImpact.reasons.includes('replacement'));
  assert.ok(target.queenDecisionImpact.reasons.includes('scoreThreshold'));
  assert.ok(target.queenDecisionImpact.thresholdSwing > 0);
  assert.ok(
    target.queenDecisionImpact.highCardExposure >
    alternatives.find((item) => item.index === 1).queenDecisionImpact.highCardExposure
  );
});

test('Queen keeps final-turn peeks only when an immediate throw-in or queued special can use them', () => {
  const throwIn = harness({
    own: [card('Q'), card('9')],
    ownUnknown: true,
    opponents: [[card('8'), card('7')]]
  });
  throwIn.state.round.dutchCallerId = throwIn.opponents[0].id;
  throwIn.state.round.specialQueue = [{ type: 'Q', actorId: throwIn.bot.id }];
  throwIn.state.round.throwIn = { open: true, rank: 'Q' };
  const throwInTarget = throwIn.decisions.botQueenTarget(throwIn.bot);

  assert.equal(throwInTarget.player.id, throwIn.bot.id);
  assert.ok(throwInTarget.queenDecisionImpact.reasons.includes('throwIn'));
  assert.ok(throwInTarget.queenDecisionImpact.matchingThrowInProbability > 0);

  const queuedJack = harness({
    own: [card('10'), card('9')],
    ownUnknown: true,
    opponents: [[card('2'), card('3')]],
    opponentsUnknown: true
  });
  queuedJack.state.round.dutchCallerId = queuedJack.opponents[0].id;
  queuedJack.state.round.specialQueue = [
    { type: 'Q', actorId: queuedJack.bot.id },
    { type: 'J', actorId: queuedJack.bot.id }
  ];
  queuedJack.state.round.throwIn = { open: false, rank: 'Q' };
  const jackTarget = queuedJack.decisions.botQueenTarget(queuedJack.bot);

  assert.ok(jackTarget);
  assert.ok(jackTarget.queenDecisionImpact.reasons.includes('jackTarget'));
});

test('Queen inspects the threatening human position that best clarifies Dutch readiness', () => {
  const setup = harness({
    own: [card('10'), card('9')],
    opponents: [[card('2'), card('3')], [card('9'), card('10')]],
    opponentsUnknown: true,
    inference: {
      'opp-0': {
        lowCardBelief: 0.9,
        dutchReadiness: 0.9,
        rankConfidence: {},
        targetInterest: {},
        recentActions: [
          { type: 'take-pile', low: true, points: 2, valid: true, updatedTick: 4 },
          { type: 'throw-in', low: true, points: null, valid: true, updatedTick: 4 }
        ]
      }
    }
  });
  setup.memory.humanKnowledge['opp-0'] = {
    slots: {
      'opp-0': [
        cardMemory(setup.opponents[0].cards[0], 'opening peek', 1, 'known', 4),
        cardMemory(setup.opponents[0].cards[1], 'opening peek', 1, 'known', 4)
      ]
    },
    dutchReadiness: 0.9
  };

  const target = setup.decisions.botQueenTarget(setup.bot);
  const threatTargets = setup.decisions.botQueenTargets(setup.bot).opponentUnknown
    .filter((item) => item.player.id === setup.opponents[0].id);

  assert.equal(target.player.id, setup.opponents[0].id);
  assert.equal(target.queenDecisionImpact.humanOpponent, true);
  assert.equal(target.queenDecisionImpact.immediateThreat, true);
  assert.ok(target.queenDecisionImpact.reasons.includes('threatClassification'));
  assert.equal(
    target.queenDecisionImpact.threatClassification,
    Math.max(...threatTargets.map((item) => item.queenDecisionImpact.threatClassification))
  );
});

test('Queen uses information value and Ace includes cumulative game position in target selection', () => {
  const queen = harness({
    own: [card('2'), card('3'), card('8')],
    ownUnknown: true,
    opponents: [[card('2')]],
    opponentsUnknown: true
  });
  const queenTarget = queen.decisions.botQueenTarget(queen.bot);
  assert.equal(queenTarget.player.id, queen.opponents[0].id);
  assert.ok(queenTarget.informationValue > 0);

  const ace = harness({
    own: [card('2'), card('3')],
    opponents: [
      [card('10'), card('9'), card('8'), card('7')],
      [card('2')]
    ],
    opponentsUnknown: true,
    total: 30,
    opponentTotals: [5, 35]
  });
  const aceTarget = ace.decisions.botAceTarget(ace.bot);
  const aceActions = ace.opponents.map((player) => (
    ace.decisions.evaluateAceTarget(ace.bot, player)
  )).filter((action) => action && action.eligible);
  assert.equal(aceTarget.player.id, ace.opponents[0].id);
  assert.equal(
    aceTarget.estimatedGameWinProbability,
    Math.max(...aceActions.map((action) => action.estimatedGameWinProbability))
  );
});

test('throw-in is selected only when expected value is positive', () => {
  const positive = harness({
    own: [card('9'), card('2')],
    opponents: [[card('8'), card('8')]],
    throwIn: { open: true, rank: '9' }
  });
  const candidate = positive.decisions.botThrowInCandidate(positive.bot);
  assert.equal(candidate.index, 0);
  assert.ok(candidate.expectedValue > 0 || candidate.confidence === 1);

  const uncertain = harness({
    own: [card('9'), card('2')],
    ownUnknown: true,
    opponents: [[card('8'), card('8')]],
    throwIn: { open: true, rank: '9' }
  });
  assert.equal(uncertain.decisions.botThrowInCandidate(uncertain.bot), null);
});

test('discarding a drawn matching rank evaluates the immediate throw-in continuation', () => {
  const setup = harness({
    own: [card('9'), card('2')],
    opponents: [[card('8'), card('7')]]
  });
  const ctx = setup.decisions.contextFor(setup.bot);
  const result = setup.decisions.evaluateDeckDiscard(setup.bot, card('9', 'spades'), ctx);

  assert.equal(result.metadata.throwInFollowUp.index, 0);
  assert.equal(result.metadata.throwInFollowUp.rank, '9');
  assert.equal(result.metadata.throwInFollowUp.confidence, 1);
  assert.equal(result.expectedRawHandScore, 2);
});

test('replacement values a retained rank match as a future throw-in path', () => {
  const setup = harness({
    own: [card('5'), card('9'), card('2')],
    opponents: [[card('8'), card('7')]]
  });
  const result = setup.decisions.evaluateReplacement(setup.bot, card('5', 'spades'), 1);

  assert.ok(result.futureThrowInScoreSaving > 0);
  assert.ok(result.finalActionValue > result.actionValue - 1e-9);
});

test('discard value includes the opponent throw-in it may enable', () => {
  const setup = harness({
    own: [card('2'), card('3')],
    opponents: [[card('9'), card('7')]]
  });
  const ctx = setup.decisions.contextFor(setup.bot);

  assert.equal(setup.decisions.opponentThrowInBenefit(setup.bot, card('9', 'spades'), ctx), 9);
  assert.equal(setup.decisions.opponentThrowInBenefit(setup.bot, card('6'), ctx), 0);
});

test('discard control applies stronger gift penalties to Aces, red Kings, and low cards', () => {
  const setup = harness({
    own: [card('10'), card('9')],
    opponents: [[card('10', 'spades'), card('9', 'spades'), card('8')]]
  });
  const ctx = setup.decisions.contextFor(setup.bot);
  const ace = setup.decisions.discardGiftAssessment(setup.bot, card('A', 'spades'), ctx);
  const redKing = setup.decisions.discardGiftAssessment(setup.bot, card('K', 'hearts'), ctx);
  const two = setup.decisions.discardGiftAssessment(setup.bot, card('2', 'hearts'), ctx);
  const six = setup.decisions.discardGiftAssessment(setup.bot, card('6', 'hearts'), ctx);
  const aceDiscard = setup.decisions.evaluateDeckDiscard(setup.bot, card('A', 'clubs'), ctx);

  assert.ok(ace.cardClassPenalty > 0);
  assert.ok(redKing.cardClassPenalty > ace.cardClassPenalty);
  assert.ok(two.cardClassPenalty > six.cardClassPenalty);
  assert.ok(ace.totalPenalty > six.totalPenalty);
  assert.ok(redKing.totalPenalty > six.totalPenalty);
  assert.ok(two.totalPenalty > six.totalPenalty);
  assert.equal(
    aceDiscard.metadata.aceDiscardAssessment.pileExposureCost,
    aceDiscard.metadata.discardGiftAssessment.totalPenalty
  );
});

test('discard control penalizes a rank the next player can throw in', () => {
  const setup = harness({
    own: [card('10'), card('8')],
    opponents: [[card('9'), card('3')], [card('7'), card('4')]]
  });
  const ctx = setup.decisions.contextFor(setup.bot);
  const matching = setup.decisions.discardGiftAssessment(setup.bot, card('9', 'spades'), ctx);
  const neutral = setup.decisions.discardGiftAssessment(setup.bot, card('6'), ctx);
  const nextMatch = matching.targets.find((target) => target.playerId === setup.opponents[0].id);

  assert.equal(nextMatch.actsNext, true);
  assert.equal(nextMatch.matchingThrowInValue, 9);
  assert.ok(nextMatch.throwInValue > 0);
  assert.ok(matching.totalPenalty > neutral.totalPenalty);
});

test('discard control scales with threat pressure and a known high replacement', () => {
  const options = {
    own: [card('10'), card('9')],
    opponents: [[card('K', 'clubs'), card('2'), card('3')]]
  };
  const baseline = harness(options);
  const threatened = harness({
    ...options,
    inference: {
      'opp-0': {
        lowCardBelief: 0.9,
        dutchReadiness: 0.9,
        rankConfidence: {},
        targetInterest: {},
        recentActions: [
          { type: 'take-pile', low: true, points: 2, valid: true, updatedTick: 4 },
          { type: 'throw-in', low: true, points: null, valid: true, updatedTick: 4 }
        ]
      }
    },
    humanKnowledge: {
      'opp-0': {
        slots: {
          'opp-0': [
            unknownMemory('human unknown', 4),
            cardMemory({ rank: '2', suit: 'clubs' }, 'opening peek', 1, 'known', 4),
            cardMemory({ rank: '3', suit: 'clubs' }, 'opening peek', 1, 'known', 4)
          ]
        },
        dutchReadiness: 0.9
      }
    }
  });
  const ordinary = baseline.decisions.discardGiftAssessment(
    baseline.bot,
    card('2', 'hearts'),
    baseline.decisions.contextFor(baseline.bot)
  );
  const dangerous = threatened.decisions.discardGiftAssessment(
    threatened.bot,
    card('2', 'hearts'),
    threatened.decisions.contextFor(threatened.bot)
  );
  const ordinaryTarget = ordinary.targets[0];
  const dangerousTarget = dangerous.targets[0];

  assert.ok(dangerousTarget.knownHighReplacementValue >= 11);
  assert.ok(dangerousTarget.knownLowPressure > 0);
  assert.ok(dangerousTarget.callProbability > ordinaryTarget.callProbability);
  assert.ok(dangerousTarget.threatMultiplier > ordinaryTarget.threatMultiplier);
  assert.ok(dangerous.totalPenalty > ordinary.totalPenalty);
});

test('discard danger decays when other players act before the threat', () => {
  const setup = harness({
    own: [card('10'), card('9')],
    opponents: [
      [card('K', 'clubs'), card('2'), card('3')],
      [card('6'), card('7'), card('8'), card('9')],
      [card('6', 'spades'), card('7', 'spades'), card('8', 'spades'), card('9', 'spades')]
    ],
    inference: {
      'opp-0': {
        lowCardBelief: 0.9,
        dutchReadiness: 0.9,
        rankConfidence: {},
        targetInterest: {},
        recentActions: [
          { type: 'take-pile', low: true, points: 2, valid: true, updatedTick: 4 },
          { type: 'throw-in', low: true, points: null, valid: true, updatedTick: 4 }
        ]
      }
    }
  });
  const nextAssessment = setup.decisions.discardGiftAssessment(
    setup.bot,
    card('2', 'hearts'),
    setup.decisions.contextFor(setup.bot)
  );
  setup.state.players = [
    setup.bot,
    setup.opponents[1],
    setup.opponents[2],
    setup.opponents[0]
  ];
  const delayedAssessment = setup.decisions.discardGiftAssessment(
    setup.bot,
    card('2', 'hearts'),
    setup.decisions.contextFor(setup.bot)
  );
  const nextThreat = nextAssessment.targets.find((target) => target.playerId === setup.opponents[0].id);
  const delayedThreat = delayedAssessment.targets.find((target) => target.playerId === setup.opponents[0].id);

  assert.equal(nextThreat.distance, 1);
  assert.equal(delayedThreat.distance, 3);
  assert.equal(nextThreat.pileSurvivalProbability, 1);
  assert.ok(delayedThreat.pileSurvivalProbability < nextThreat.pileSurvivalProbability);
  assert.ok(delayedThreat.penalty < nextThreat.penalty);
  assert.ok(delayedAssessment.totalPenalty < nextAssessment.totalPenalty);
});

test('Jack avoids same-hand reordering when it has no disruption benefit', () => {
  const setup = harness({
    own: [card('9'), card('2'), card('3')],
    opponents: [[card('8'), card('7'), card('4')]]
  });
  const candidates = setup.decisions.botJackCandidates(setup.bot);

  assert.ok(candidates.length > 0);
  assert.ok(candidates.every((candidate) => candidate.a.player.id !== candidate.b.player.id));
});

test('Jack prefers the highest known own card for the lowest known opponent card', () => {
  const setup = harness({
    own: [card('10'), card('2')],
    opponents: [[card('A'), card('9')]]
  });
  const candidates = setup.decisions.botJackCandidates(setup.bot);
  const selected = candidates[0];
  const own = selected.a.player.id === setup.bot.id ? selected.a : selected.b;
  const incoming = own === selected.a ? selected.b : selected.a;

  assert.equal(own.index, 0);
  assert.equal(incoming.player.id, setup.opponents[0].id);
  assert.equal(incoming.index, 0);
  assert.equal(selected.metadata.directPriority, true);
  assert.ok(selected.metadata.directHandImprovement > 0);
});

test('Jack scores human knowledge disruption and allows useful same-hand swaps', () => {
  const knownTwo = cardMemory({ rank: '2', suit: 'clubs' }, 'start peek', 1, 'known', 4);
  const knownEight = cardMemory({ rank: '8', suit: 'clubs' }, 'start peek', 0.9, 'known', 4);
  const setup = harness({
    own: [card('9'), card('3')],
    opponents: [[card('2'), card('8')]],
    humanKnowledge: {
      'opp-0': {
        slots: {
          bot: [unknownMemory('human unknown', 4), unknownMemory('human unknown', 4)],
          'opp-0': [knownTwo, knownEight]
        },
        dutchReadiness: 0.8
      }
    },
    humanKnowledgeRevision: 7
  });
  const candidates = setup.decisions.botJackCandidates(setup.bot);
  const sameHand = candidates.find((candidate) => (
    candidate.a.player.id === setup.opponents[0].id &&
    candidate.b.player.id === setup.opponents[0].id
  ));

  assert.ok(sameHand);
  assert.equal(sameHand.metadata.humanKnowledgeRevision, 7);
  assert.equal(sameHand.metadata.disruption.invalidatedPositions, 2);
  assert.ok(sameHand.metadata.disruption.knowledgeLossValue > 0);
});

test('Jack gives the largest bonus to a direct improvement that also disrupts a Dutch threat', () => {
  const knownLow = cardMemory({ rank: '2', suit: 'clubs' }, 'start peek', 1, 'known', 4);
  const setup = harness({
    own: [card('10'), card('3')],
    opponents: [[card('2'), card('8')]],
    humanKnowledge: {
      'opp-0': {
        slots: {
          bot: [unknownMemory('human unknown', 4), unknownMemory('human unknown', 4)],
          'opp-0': [knownLow, unknownMemory('human unknown', 4)]
        },
        dutchReadiness: 0.9
      }
    }
  });
  const selected = setup.decisions.botJackCandidates(setup.bot)[0];

  assert.equal(selected.metadata.directPriority, true);
  assert.equal(selected.metadata.dualPurpose, true);
  assert.ok(selected.metadata.disruption.knownLowRemovedValue > 0);
  assert.ok(selected.metadata.disruption.threatDamageValue > 0);
});

test('Jack strategy values a cross-player swap that creates an own rank pair', () => {
  const setup = harness({
    own: [card('5'), card('6')],
    opponents: [[card('5', 'spades'), card('6', 'spades')]]
  });
  const candidates = setup.decisions.botJackCandidates(setup.bot);
  const createsPair = candidates.find((candidate) => (
    candidate.a.player.id === setup.bot.id &&
    candidate.a.index === 1 &&
    candidate.b.player.id === setup.opponents[0].id &&
    candidate.b.index === 0
  ));

  assert.ok(createsPair);
  assert.ok(createsPair.futureThrowInScoreSaving > 0);
});

test('confirmed low cards are not worsened for speculative future throw-ins', () => {
  const setup = harness({
    own: [card('2'), card('10'), card('10', 'spades')],
    opponents: [[card('8'), card('7')]]
  });
  const result = setup.decisions.evaluateReplacement(setup.bot, card('10', 'hearts'), 0);

  assert.ok(result.futureThrowInScoreSaving > 0);
  assert.equal(result.eligible, false);
  assert.equal(result.rejectionReason, 'protected-confirmed-low-card');
});

test('contested immediate throw-ins cannot justify degrading a confirmed card', () => {
  const setup = harness({
    own: [card('2'), card('2', 'spades')],
    opponents: [[card('2', 'hearts'), card('7')]]
  });
  const result = setup.decisions.evaluateReplacement(setup.bot, card('3'), 0);

  assert.equal(result.metadata.throwInFollowUp.reliability, 'speculative');
  assert.ok(result.metadata.throwInFollowUp.contentionProbability > 0.99);
  assert.equal(result.metadata.protection.reliableImmediateThrowIn, false);
  assert.equal(result.eligible, false);
});

test('a confirmed red King is protected from replacement and ordinary throw-in', () => {
  const setup = harness({
    own: [card('K', 'hearts'), card('2')],
    opponents: [[card('8'), card('7')]],
    pile: card('K', 'clubs'),
    throwIn: { open: true, rank: 'K' }
  });

  const replacement = setup.decisions.evaluateReplacement(setup.bot, card('4'), 0);
  assert.equal(replacement.eligible, false);
  assert.equal(replacement.rejectionReason, 'protected-red-king');
  assert.equal(setup.decisions.botThrowInCandidate(setup.bot), null);
});

test('a red King throw-in is allowed only when the next action recovers it for a better card', () => {
  const redKing = card('K', 'hearts');
  const setup = harness({
    own: [redKing, card('9')],
    opponents: [[card('8'), card('7')]],
    pile: card('K', 'clubs'),
    throwIn: { open: true, rank: 'K' }
  });
  setup.state.round.currentPlayerIndex = 1;
  setup.state.round.stage = 'turn';
  setup.state.round.turnComplete = true;
  setup.state.round.drawn = null;
  setup.state.round.specialQueue = [];

  const candidate = setup.decisions.botThrowInCandidate(setup.bot);
  assert.equal(candidate.index, 0);
  assert.equal(candidate.recoveryPlan.expectedHandImprovement, 9);
  assert.equal(candidate.throwInReliability, 'guaranteed-next-action');

  setup.bot.cards.splice(0, 1);
  setup.memory.slots.bot.splice(0, 1);
  setup.state.round.discard[setup.state.round.discard.length - 1] = redKing;
  setup.memory.pendingRedKingRecovery = { ...candidate.recoveryPlan, cardId: redKing.id };
  const draw = setup.decisions.evaluateDrawSources(setup.bot);
  assert.equal(draw.selected.actionType, 'take-pile');
  assert.equal(draw.selected.metadata.guaranteedRedKingRecovery, true);
});

test('pile cards require a concrete benefit and cannot merely worsen known cards', () => {
  const setup = harness({
    own: [card('2'), card('3')],
    opponents: [[card('8'), card('7')]],
    pile: card('4')
  });
  const result = setup.decisions.evaluateDrawSources(setup.bot);

  assert.equal(result.pile, null);
  assert.equal(result.selected.actionType, 'draw-deck');
});

test('guaranteed throw-ins, valuable specials, and exact thresholds can justify a worse known card', () => {
  const throwSetup = harness({
    own: [card('2'), card('2', 'spades')],
    opponents: [[card('8'), card('7')]]
  });
  const guaranteed = throwSetup.decisions.evaluateReplacement(throwSetup.bot, card('3'), 0);
  assert.equal(guaranteed.eligible, true);
  assert.equal(guaranteed.metadata.protection.guaranteedThrowIn, true);

  const aceSetup = harness({
    own: [card('A'), card('2')],
    opponents: [[card('8'), card('7')]]
  });
  const ace = aceSetup.decisions.evaluateReplacement(aceSetup.bot, card('5'), 0);
  assert.equal(ace.eligible, true);
  assert.equal(ace.metadata.protection.worthwhileSpecial, true);

  const thresholdSetup = harness({
    own: [card('2'), card('3')],
    opponents: [[card('8'), card('7')]],
    total: 43
  });
  const threshold = thresholdSetup.decisions.evaluateReplacement(thresholdSetup.bot, card('4'), 0);
  assert.equal(threshold.eligible, true);
  assert.ok(threshold.metadata.protection.thresholdBenefit > 0);
});

test('bot diagnostics retain hidden decision state outside the public game log', () => {
  const setup = harness({
    own: [card('A'), card('2'), card('K', 'hearts')],
    opponents: [[card('8'), card('9')]]
  });

  setup.decisions.evaluateDrawSources(setup.bot);
  setup.decisions.botShouldCallDutch(setup.bot);

  assert.deepEqual(setup.state.log, undefined);
  assert.equal(setup.state.botDiagnostics.length, 2);
  assert.equal(setup.state.botDiagnostics[0].decision, 'draw-source');
  assert.equal(setup.state.botDiagnostics[1].decision, 'dutch');
  assert.equal(setup.state.botDiagnostics[1].actualHands[0].score, 3);
});

test('forced final turns use the dedicated evaluator and preserve a confirmed low card', () => {
  const setup = harness({
    own: [card('2')],
    opponents: [[card('5')]],
    pile: card('4')
  });
  setup.state.round.dutchCallerId = setup.opponents[0].id;
  setup.state.round.dutchQueue = [];

  const hold = setup.decisions.currentEvaluation(setup.bot, 'final-hold');
  const draw = setup.decisions.evaluateDrawSources(setup.bot);

  assert.equal(hold.turnsRemaining, 0);
  assert.equal(hold.metadata.finalTurnOutcome.dedicated, true);
  assert.equal(hold.metadata.finalTurnOutcome.ignoresLongTermValue, true);
  assert.equal(draw.pile, null);
  assert.equal(draw.selected.actionType, 'draw-deck');
});

test('final-turn pile cards require guaranteed improvement when the replaced card is uncertain', () => {
  const uncertain = harness({
    own: [card('10'), card('2')],
    ownUnknown: true,
    opponents: [[card('5')]],
    pile: card('5')
  });
  uncertain.state.round.dutchCallerId = uncertain.opponents[0].id;
  uncertain.state.round.dutchQueue = [];
  assert.equal(uncertain.decisions.evaluateDrawSources(uncertain.bot).pile, null);

  const guaranteed = harness({
    own: [card('10'), card('2')],
    opponents: [[card('5')]],
    pile: card('5')
  });
  guaranteed.state.round.dutchCallerId = guaranteed.opponents[0].id;
  guaranteed.state.round.dutchQueue = [];
  const pile = guaranteed.decisions.evaluateDrawSources(guaranteed.bot).pile;
  assert.ok(pile);
  assert.equal(pile.metadata.finalTurnPile.guaranteedScoreReduction, true);
});

test('final-turn throw-ins are evaluated as immediate score outcomes without future value', () => {
  const setup = harness({
    own: [card('9'), card('2')],
    opponents: [[card('5')]],
    throwIn: { open: true, rank: '9' }
  });
  setup.state.round.dutchCallerId = setup.opponents[0].id;
  setup.state.round.dutchQueue = [];

  const candidate = setup.decisions.botThrowInCandidate(setup.bot);
  assert.ok(candidate);
  assert.equal(candidate.index, 0);
  assert.equal(candidate.futureThrowInScoreSaving, 0);
  assert.equal(candidate.metadata.finalTurnOutcome.dedicated, true);
  assert.ok(candidate.metadata.finalTurnOutcome.expectedOwnTotal < setup.bot.total + 11);
});

test('final-turn Jacks keep only swaps that materially change the round outcome', () => {
  const useful = harness({
    own: [card('9')],
    opponents: [[card('5')], [card('2')]]
  });
  useful.state.round.dutchCallerId = useful.opponents[0].id;
  useful.state.round.dutchQueue = [];
  const candidates = useful.decisions.botJackCandidates(useful.bot);

  assert.ok(candidates.length > 0);
  assert.equal(candidates.every((candidate) => candidate.metadata.finalTurnMaterialImpact), true);
  assert.ok(candidates[0].metadata.finalTurnOutcome.expectedOwnTotal < useful.bot.total + 9);

  const harmful = harness({
    own: [card('2')],
    opponents: [[card('5')], [card('9')]]
  });
  harmful.state.round.dutchCallerId = harmful.opponents[0].id;
  harmful.state.round.dutchQueue = [];
  assert.deepEqual(harmful.decisions.botJackCandidates(harmful.bot), []);
});

test('live position estimates store confidence and the last knowledge-changing event', () => {
  const setup = harness({
    own: [card('9')],
    opponents: [[card('2')]],
    opponentsUnknown: true
  });
  const ctx = setup.decisions.contextFor(setup.bot);
  const own = ctx.positionEstimateFor(setup.bot, 0);
  const opponent = ctx.positionEstimateFor(setup.opponents[0], 0);

  assert.equal(own.expectedValue, 9);
  assert.equal(own.knownRank, '9');
  assert.equal(own.confidence, 1);
  assert.equal(own.source, 'own peek');
  assert.equal(own.lastChangedEvent, 'own peek');
  assert.equal(own.lastChangedTick, 4);

  assert.notEqual(opponent.expectedValue, 2);
  assert.equal(opponent.knownRank, null);
  assert.equal(opponent.confidence, 0);
  assert.equal(opponent.source, 'opponent unknown');
  assert.equal(opponent.lastChangedEvent, 'opponent unknown');
  assert.deepEqual(setup.memory.positionEstimates[setup.opponents[0].id][0], opponent);
});

test('unknown actual cards cannot change live decisions built from identical memories', () => {
  const lowActual = harness({
    own: [card('A'), card('2')],
    ownUnknown: true,
    opponents: [[card('2'), card('3')]],
    opponentsUnknown: true,
    pile: card('6')
  });
  const highActual = harness({
    own: [card('K', 'clubs'), card('10')],
    ownUnknown: true,
    opponents: [[card('K', 'clubs'), card('Q')]],
    opponentsUnknown: true,
    pile: card('6')
  });

  const lowDecision = lowActual.decisions.evaluateDrawSources(lowActual.bot);
  const highDecision = highActual.decisions.evaluateDrawSources(highActual.bot);

  assert.equal(lowDecision.selected.actionType, highDecision.selected.actionType);
  assert.equal(lowDecision.deck.expectedRawHandScore, highDecision.deck.expectedRawHandScore);
  assert.equal(lowDecision.deck.estimatedGameWinProbability, highDecision.deck.estimatedGameWinProbability);
  assert.equal(lowDecision.deck.actionValue, highDecision.deck.actionValue);

  const jackSetup = harness({
    own: [card('10')],
    opponents: [[card('2')]],
    ownUnknown: true,
    opponentsUnknown: true
  });
  const jackCandidates = jackSetup.decisions.botJackCandidates(jackSetup.bot);
  assert.equal(jackCandidates.every((candidate) => (
    candidate.a.card === null && candidate.b.card === null
  )), true);
});
