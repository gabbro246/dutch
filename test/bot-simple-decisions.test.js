const test = require('node:test');
const assert = require('node:assert/strict');
const { createBotDecisions } = require('../lib/bot-decisions.js');
const { cardMemory, unknownMemory } = require('../lib/bot-strategy.js');

let nextId = 0;

function card(rank, suit = 'clubs', deckColor = 'blue') {
  nextId += 1;
  return { id: 'simple-' + nextId, rank, suit, deckColor };
}

function player(id, cards, total = 0, extra = {}) {
  return {
    id,
    name: id,
    cards,
    total,
    left: false,
    isSpectator: false,
    ...extra
  };
}

function harness(options = {}) {
  const bot = player(
    'bot',
    options.botCards || [card('10'), card('2')],
    options.botTotal || 0,
    { isBot: true, botType: options.botType || 'norman-beta' }
  );
  const opponents = options.opponents || [player('opponent', [card('4'), card('8')], 20)];
  const state = {
    deckSetting: options.deckSetting || 'one',
    deckColor: 'blue',
    players: [bot, ...opponents],
    round: {
      strategyTick: options.strategyTick || 0,
      discard: [options.pileCard || card('5')],
      dutchCallerId: options.dutchCallerId || '',
      throwIn: options.throwIn || null
    }
  };
  const slots = {
    bot: (options.botMemory || bot.cards.map((item) => cardMemory(item, 'own peek', 1, 'known', 0)))
      .map((entry) => ({ ...entry, ownerId: bot.id })),
    ...Object.fromEntries(opponents.map((opponent) => [
      opponent.id,
      opponent.cards.map((item) => ({ ...cardMemory(item, 'Queen peek', 1, 'known', 0), ownerId: opponent.id }))
    ]))
  };
  bot.botMemory = {
    roundNumber: 1,
    slots,
    discards: options.discards || [],
    removed: [],
    drawn: null
  };

  const decisions = createBotDecisions({
    getState: () => state,
    ensureBotMemory: () => bot.botMemory,
    botMemoryEntry: (viewer, ownerId, index) => viewer.botMemory.slots[ownerId][index],
    effectiveMemory: () => {
      throw new Error('Beta bots must not enter the legacy evaluator');
    },
    activePlayablePlayers: () => state.players,
    isProtectedSpecialTarget: () => false,
    findActiveIndexFrom: (index) => index,
    randomBetween: (min) => min,
    random: options.random || (() => 0),
    simpleStrategyRelease: options.simpleStrategyRelease
  });
  return { bot, opponents, state, decisions };
}

test('Beta profiles use predefined pile and replacement rules without the legacy evaluator', () => {
  const setup = harness();
  assert.equal(setup.decisions.shouldBotTakePile(setup.bot), true);
  assert.equal(setup.decisions.botBestSwapTarget(setup.bot, card('A')).index, 0);

  setup.state.round.discard = [card('6')];
  assert.equal(setup.decisions.shouldBotTakePile(setup.bot), false);
});

test('Beta bots replace unknown cards first and discard cards that improve nothing', () => {
  const setup = harness({
    botMemory: [unknownMemory('unknown', 0), cardMemory(card('2'), 'own peek', 1, 'known', 0)]
  });

  assert.equal(setup.decisions.botDeckCardDecision(setup.bot, card('9')).swapTarget.index, 0);

  setup.bot.botMemory.slots.bot[0] = cardMemory(card('3'), 'own peek', 1, 'known', 0);
  setup.bot.botMemory.slots.bot[0].ownerId = setup.bot.id;
  assert.equal(setup.decisions.botDeckCardDecision(setup.bot, card('9')).swapTarget, null);
});

test('Beta bots replace a remembered Queen before an unknown card', () => {
  const setup = harness({
    botMemory: [unknownMemory('unknown', 0), cardMemory(card('Q'), 'own peek', 1, 'known', 0)]
  });
  assert.equal(setup.decisions.botBestSwapTarget(setup.bot, card('4')).index, 1);
});

test('Beta special cards target unknown cards and the most dangerous opponent', () => {
  const lowTotal = player('low-total', [card('7'), card('9')], 2);
  const fewCards = player('few-cards', [card('8')], 20);
  const setup = harness({
    opponents: [lowTotal, fewCards],
    botMemory: [unknownMemory('unknown', 0), cardMemory(card('3'), 'own peek', 1, 'known', 0)]
  });

  assert.equal(setup.decisions.botQueenTarget(setup.bot).player.id, setup.bot.id);
  assert.ok(['low-total', 'few-cards'].includes(setup.decisions.botAceTarget(setup.bot).player.id));

  setup.bot.botMemory.slots.bot[0] = cardMemory(card('10'), 'own peek', 1, 'known', 0);
  setup.bot.botMemory.slots.bot[0].ownerId = setup.bot.id;
  lowTotal.cards.forEach((item, index) => {
    setup.bot.botMemory.slots[lowTotal.id][index] = unknownMemory('unknown', 0);
    setup.bot.botMemory.slots[lowTotal.id][index].ownerId = lowTotal.id;
  });
  assert.equal(setup.decisions.botQueenTarget(setup.bot).player.id, 'low-total');
});

test('Beta bots always use remembered throw-ins except red Kings', () => {
  const setup = harness({
    botCards: [card('K', 'hearts'), card('5')],
    throwIn: { open: true, rank: 'K' }
  });
  assert.equal(setup.decisions.botThrowInCandidate(setup.bot), null);

  setup.bot.botMemory.slots.bot[0] = {
    ...cardMemory(card('K', 'spades'), 'own peek', 1, 'known', 0),
    ownerId: setup.bot.id
  };
  assert.equal(setup.decisions.botThrowInCandidate(setup.bot).index, 0);
});

test('Beta bots call Dutch only with a fully known hand at five or less', () => {
  const known = harness({ botCards: [card('2'), card('3')] });
  assert.equal(known.decisions.botShouldCallDutch(known.bot), true);

  known.bot.botMemory.slots.bot[1] = unknownMemory('unknown', 0);
  known.bot.botMemory.slots.bot[1].ownerId = known.bot.id;
  assert.equal(known.decisions.botShouldCallDutch(known.bot), false);
});

test('score-aware Beta bots can deliberately make a wrong Dutch call to hit a halving total', () => {
  const setup = harness({
    botType: 'roswell-beta',
    botTotal: 88,
    botCards: [card('3'), card('3')]
  });

  assert.equal(setup.decisions.activeHalvingPlan(setup.bot).type, 'wrong-dutch');
  assert.equal(setup.decisions.deliberateWrongDutch(setup.bot), true);
  assert.equal(setup.decisions.botShouldCallDutch(setup.bot), true);
});

test('score-aware Beta bots avoid Dutch when an ordinary round score reaches halving', () => {
  const setup = harness({
    botType: 'roswell-beta',
    botTotal: 48,
    botCards: [card('A'), card('A')]
  });

  assert.equal(setup.decisions.activeHalvingPlan(setup.bot).type, 'ordinary');
  assert.equal(setup.decisions.botShouldCallDutch(setup.bot), false);
});

test('counting Beta bots derive unknown value from remembered cards outside the deck', () => {
  const setup = harness({
    botType: 'roswell-beta',
    botCards: [card('K', 'spades')]
  });
  const expected = setup.decisions.unknownExpectedPoints(setup.bot);
  assert.ok(expected < 6.5);
  assert.ok(expected > 6.3);
});

test('Beta recall can create a persistent false memory and later forget it below 50%', () => {
  const rolls = [0.99, 0.99];
  const setup = harness({
    botType: 'dory-beta',
    botCards: [card('4')],
    strategyTick: 8,
    random: () => rolls.shift() ?? 0
  });
  const original = setup.bot.botMemory.slots.bot[0].card;

  const mistaken = setup.decisions.recallEntry(setup.bot, setup.bot.id, 0);
  assert.notDeepEqual(mistaken.card, original);
  assert.ok(Math.abs(mistaken.confidence - 0.68) < 1e-9);
  assert.deepEqual(setup.decisions.recallEntry(setup.bot, setup.bot.id, 0).card, mistaken.card);

  setup.state.round.strategyTick = 14;
  const forgotten = setup.decisions.recallEntry(setup.bot, setup.bot.id, 0);
  assert.equal(forgotten.card, null);
  assert.ok(forgotten.confidence < 0.5);
});

test('Beta bots take pile cards over five only when they advance halving', () => {
  const ordinary = harness({
    botType: 'roswell-beta',
    botTotal: 38,
    botCards: [card('4'), card('4')],
    pileCard: card('8')
  });
  assert.equal(ordinary.decisions.shouldBotTakePile(ordinary.bot), true);

  const noHalving = harness({
    botType: 'roswell-beta',
    botCards: [card('4'), card('4')],
    pileCard: card('8')
  });
  assert.equal(noHalving.decisions.shouldBotTakePile(noHalving.bot), false);
});

test('Beta bots retain a matching throw-in card needed for an exact halving score', () => {
  const setup = harness({
    botType: 'roswell-beta',
    botTotal: 38,
    botCards: [card('4'), card('8')],
    throwIn: { open: true, rank: '8' }
  });

  assert.equal(setup.decisions.activeHalvingPlan(setup.bot).desiredHandScore, 12);
  assert.equal(setup.decisions.botThrowInCandidate(setup.bot), null);
});

test('ordinary Dutch stays at five or less and waits when a known opponent is lower', () => {
  const lowerOpponent = player('lower', [card('A'), card('A')], 20);
  const setup = harness({
    botType: 'roswell-beta',
    botCards: [card('2'), card('3')],
    opponents: [lowerOpponent]
  });
  assert.equal(setup.decisions.botShouldCallDutch(setup.bot), false);

  setup.bot.botMemory.slots.bot[1] = {
    ...cardMemory(card('4'), 'own peek', 1, 'known', 0),
    ownerId: setup.bot.id
  };
  assert.equal(setup.decisions.botShouldCallDutch(setup.bot), false);
});

test('the tactical planner avoids discarding a rank that gives a ready opponent a throw-in', () => {
  const opponent = player('opponent', [card('9')], 20);
  const setup = harness({
    botType: 'roswell-beta',
    botCards: [card('9'), card('2')],
    opponents: [opponent]
  });

  assert.equal(setup.decisions.botDeckCardDecision(setup.bot, card('8')).swapTarget, null);

  const historical = harness({
    botType: 'roswell-beta',
    botCards: [card('9'), card('2')],
    opponents: [player('opponent', [card('9')], 20)],
    simpleStrategyRelease: '1.3.74'
  });
  assert.equal(historical.decisions.botDeckCardDecision(historical.bot, card('8')).swapTarget.index, 0);
});

test('halving lookahead is deterministic and stays inside its configured state budget', () => {
  const setup = harness({
    botType: 'roswell-beta',
    botTotal: 88,
    botCards: [card('4'), card('4')]
  });
  setup.decisions.activeHalvingPlan(setup.bot);
  const diagnostics = setup.decisions.botPlannerDiagnostics(setup.bot);

  assert.equal(diagnostics.turns, 2);
  assert.ok(diagnostics.nodes > 0);
  assert.ok(diagnostics.nodes <= diagnostics.budget);
});
