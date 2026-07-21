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
    inference: {},
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
    isProtectedSpecialTarget: () => false,
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

test('Queen uses information value and Ace targets expected damage rather than cumulative lead alone', () => {
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
  assert.equal(aceTarget.player.id, ace.opponents[1].id);
  assert.notEqual(aceTarget.player.total, Math.min(...ace.opponents.map((player) => player.total)));
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
