const test = require('node:test');
const assert = require('node:assert/strict');
const { createBotDecisions, DEFAULT_SIMPLE_STRATEGY_RELEASE } = require('../lib/bot-decisions.js');
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
    isProtectedSpecialTarget: (id) => state.round.dutchCallerId === id,
    findActiveIndexFrom: (index) => index,
    randomBetween: (min) => min,
    random: options.random || (() => 0),
    profileFor: options.profileFor,
    simpleStrategyRelease: options.simpleStrategyRelease
  });
  return { bot, opponents, state, decisions };
}

test('Beta bots default to the 1.3.81 strategy snapshot', () => {
  assert.equal(DEFAULT_SIMPLE_STRATEGY_RELEASE, '1.3.81');
});

test('Beta profiles use predefined pile and replacement rules without the legacy evaluator', () => {
  const setup = harness({ pileCard: card('A') });
  assert.equal(setup.decisions.shouldBotTakePile(setup.bot), true);
  assert.equal(setup.decisions.botBestSwapTarget(setup.bot, card('A')).index, 0);

  setup.state.round.discard = [card('6')];
  assert.equal(setup.decisions.shouldBotTakePile(setup.bot), false);
});

test('Beta bots can learn a high card when later matching throws make it useful', () => {
  const options = {
    simpleStrategyRelease: '1.3.82',
    botMemory: [unknownMemory('unknown', 0), cardMemory(card('2'), 'own peek', 1, 'known', 0)]
  };
  const current = harness(options);

  assert.equal(current.decisions.botDeckCardDecision(current.bot, card('8')).swapTarget.index, 0);
  assert.equal(current.decisions.botDeckCardDecision(current.bot, card('9')).swapTarget, null);
  assert.equal(current.decisions.botDeckCardDecision(current.bot, card('4')).swapTarget.index, 0);
});

test('Beta bots release a known Queen to learn an unknown more cheaply', () => {
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

test('Beta bots use certain matching throw-ins while retaining a red King in a larger hand', () => {
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

test('ordinary Beta Dutch calls require a fully known hand at five or less', () => {
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

test('Beta pile fives require the rest of the known hand to be worth zero', () => {
  const knownHighCard = harness({
    botCards: [card('10'), card('2')],
    pileCard: card('5')
  });
  assert.equal(knownHighCard.decisions.shouldBotTakePile(knownHighCard.bot), false);

  const weakUnknown = harness({
    botCards: [card('10'), card('2')],
    botMemory: [unknownMemory('unknown', 0), cardMemory(card('2'), 'own peek', 1, 'known', 0)],
    pileCard: card('5')
  });
  assert.equal(weakUnknown.decisions.shouldBotTakePile(weakUnknown.bot), false);

  const completesDutch = harness({
    botCards: [card('10'), card('K', 'hearts')],
    opponents: [player('opponent', [card('7'), card('8')], 20)],
    pileCard: card('5')
  });
  assert.equal(completesDutch.decisions.shouldBotTakePile(completesDutch.bot), true);
});

test('Beta bots take a four that secures Dutch but reject a marginal pile upgrade', () => {
  const strong = harness({ botCards: [card('9'), card('K', 'hearts')], pileCard: card('4'), opponents: [player('opponent', [card('7'), card('10')], 20)] });
  const marginal = harness({ botCards: [card('6'), card('2')], pileCard: card('4') });

  assert.equal(strong.decisions.shouldBotTakePile(strong.bot), true);
  assert.equal(marginal.decisions.shouldBotTakePile(marginal.bot), false);
});

test('Beta bots use useful drawn Queens and Jacks instead of inserting them blindly', () => {
  const setup = harness({
    botMemory: [unknownMemory('unknown', 0), cardMemory(card('2'), 'own peek', 1, 'known', 0)]
  });

  assert.equal(setup.decisions.botDeckCardDecision(setup.bot, card('Q')).swapTarget, null);
  assert.equal(setup.decisions.botDeckCardDecision(setup.bot, card('J')).swapTarget, null);
});

test('Beta bots take high pile cards only for immediate exact halving', () => {
  const exact = harness({
    botType: 'roswell-beta',
    botTotal: 38,
    botCards: [card('4'), card('4')],
    pileCard: card('8')
  });
  assert.equal(exact.decisions.shouldBotTakePile(exact.bot), true);

  const progressOnly = harness({
    botType: 'roswell-beta',
    botTotal: 38,
    botCards: [card('4'), card('10')],
    pileCard: card('9')
  });
  assert.equal(progressOnly.decisions.shouldBotTakePile(progressOnly.bot), false);

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

test('current Beta bots reject small reductions that enable much larger opponent throw-ins', () => {
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

test('Beta bots keep a drawn red King while denying an opponent a Queen throw-in', () => {
  const opponent = player('opponent', [card('Q', 'diamonds')], 20);
  const setup = harness({
    simpleStrategyRelease: '1.3.82',
    botType: 'roswell-beta',
    botCards: [card('Q', 'clubs'), card('2')],
    opponents: [opponent]
  });

  const decision = setup.decisions.botDeckCardDecision(setup.bot, card('K', 'hearts'));
  assert.equal(decision.swapTarget.index, 1);
});

test('Beta bots keep a drawn red King instead of offering it to an opponent', () => {
  const opponent = player('opponent', [card('10'), card('2')], 20);
  const setup = harness({
    botType: 'roswell-beta',
    botCards: [card('8'), card('2')],
    opponents: [opponent]
  });

  const decision = setup.decisions.botDeckCardDecision(setup.bot, card('K', 'hearts'));
  assert.equal(decision.swapTarget.index, 0);
});

test('Beta bots count a guaranteed throw-in when choosing the greatest point reduction', () => {
  const setup = harness({
    botCards: [card('10'), card('8', 'clubs'), card('8', 'diamonds')],
    opponents: [player('opponent', [card('4'), card('6')], 20)]
  });

  const decision = setup.decisions.botDeckCardDecision(setup.bot, card('7'));
  assert.ok([1, 2].includes(decision.swapTarget.index));
});

test('Beta bots drop impossible Dutch and Ace plans after an opponent calls Dutch', () => {
  const opponent = player('opponent', [card('2')], 20);
  const setup = harness({
    botType: 'roswell-beta',
    botTotal: 74,
    botCards: [card('A', 'spades'), card('A', 'hearts')],
    opponents: [opponent],
    dutchCallerId: opponent.id,
    pileCard: card('Q', 'clubs')
  });

  assert.equal(setup.decisions.activeHalvingPlan(setup.bot), null);
  assert.equal(setup.decisions.shouldBotTakePile(setup.bot), false);
  assert.equal(setup.decisions.botAceTarget(setup.bot), null);
  assert.equal(setup.decisions.specialActionValue(setup.bot, card('A')), 0);
});

test('draw planning stays inside its configured state budget', () => {
  const setup = harness({
    simpleStrategyRelease: '1.3.82',
    botType: 'roswell-beta',
    botTotal: 88,
    botCards: [card('4'), card('4')]
  });
  setup.decisions.evaluateDrawSources(setup.bot);
  const diagnostics = setup.decisions.botPlannerDiagnostics(setup.bot);

  assert.equal(diagnostics.turns, 3);
  assert.ok(diagnostics.nodes > 0);
  assert.ok(diagnostics.nodes <= diagnostics.budget);
});

test('Dutch forecast rejects a next-player pile improvement below the caller', () => {
  const setup = harness({ botType: 'roswell-beta', botCards: [card('5')], pileCard: card('2'), opponents: [player('opponent', [card('K', 'hearts'), card('8')], 20)] });
  assert.equal(setup.decisions.botShouldCallDutch(setup.bot), false);
  assert.equal(setup.decisions.botCallAssessment(setup.bot).probability, 0);
});

test('Dutch final-turn forecasting respects the caller seat', () => {
  const setup = harness({ botType: 'roswell-beta', botCards: [card('5')], pileCard: card('2'), opponents: [player('opponent', [card('K', 'hearts'), card('8')], 20)] });
  setup.state.players.reverse();
  setup.state.round.currentPlayerIndex = 1;
  assert.equal(setup.decisions.botShouldCallDutch(setup.bot), false);
});

test('a final-turn Jack removes a known thirteen before an unknown', () => {
  const own = [card('K', 'clubs'), card('7')];
  const setup = harness({ botType: 'roswell-beta', botCards: own, botMemory: [cardMemory(own[0], 'peek', 1), unknownMemory()], dutchCallerId: 'caller', opponents: [player('opponent', [card('K', 'hearts'), card('8')]), player('caller', [card('2')])] });
  const swap = setup.decisions.botJackCandidates(setup.bot)[0];
  assert.equal(swap.a.index, 0);
  assert.equal(swap.b.player.id, 'opponent');
  assert.equal(swap.b.index, 0);
});

test('Ace and Jack never target a protected caller', () => {
  const setup = harness({ botType: 'roswell-beta', botCards: [card('K', 'clubs')], dutchCallerId: 'opponent', opponents: [player('opponent', [card('K', 'hearts')])] });
  assert.equal(setup.decisions.botAceTarget(setup.bot), null);
  assert.deepEqual(setup.decisions.botJackCandidates(setup.bot), []);
});

test('same-hand confusion is not a substitute for a useful Jack', () => {
  const setup = harness({ botType: 'roswell-beta', botCards: [card('K', 'hearts')], opponents: [player('opponent', [card('9'), card('10')])] });
  assert.deepEqual(setup.decisions.botJackCandidates(setup.bot), []);
});

test('a zero-point hand calls and its last red King can be thrown', () => {
  const setup = harness({ botType: 'roswell-beta', botCards: [card('K', 'hearts')], throwIn: { open: true, rank: 'K' } });
  assert.equal(setup.decisions.botShouldCallDutch(setup.bot), true);
  assert.equal(setup.decisions.botThrowInCandidate(setup.bot).index, 0);
});

test('another caller prevents planning a deliberate wrong-Dutch halving', () => {
  const setup = harness({ botType: 'roswell-beta', botTotal: 76, botCards: [card('Q')], dutchCallerId: 'opponent' });
  assert.equal(setup.decisions.deliberateWrongDutch(setup.bot), false);
  assert.equal(setup.decisions.botShouldCallDutch(setup.bot), false);
});

test('human throw-in priority reduces the value of a contested pair removal', () => {
  const opponent = player('opponent', [card('8'), card('10')], 20, { isBot: true });
  const setup = harness({ botType: 'roswell-beta', botCards: [card('8'), card('8', 'hearts')], pileCard: card('2'), opponents: [opponent] });
  const botRace = setup.decisions.evaluateDrawSources(setup.bot).pile.utility;
  opponent.isBot = false;
  const humanRace = setup.decisions.evaluateDrawSources(setup.bot).pile.utility;
  assert.ok(humanRace < botRace);
});

test('decisions do not read unknown physical faces or human-private knowledge', () => {
  const setup = harness({ botType: 'roswell-beta', botCards: [card('9'), card('3')], botMemory: [unknownMemory(), unknownMemory()] });
  setup.opponents[0].cards.forEach((_, i) => { setup.bot.botMemory.slots.opponent[i] = unknownMemory(); });
  const before = setup.decisions.evaluateDrawSources(setup.bot).selected.actionType;
  for (const player of setup.state.players) {
    player.cards = player.cards.map((item) => ({ id: item.id, get rank() { throw new Error('hidden rank read'); }, get suit() { throw new Error('hidden suit read'); } }));
  }
  setup.bot.botMemory.humanKnowledge = { opponent: { get slots() { throw new Error('private human knowledge read'); } } };
  assert.equal(setup.decisions.evaluateDrawSources(setup.bot).selected.actionType, before);
});

test('a pile replacement remains mandatory even when every replacement raises points', () => {
  const setup = harness({ botType: 'roswell-beta', botCards: [card('A')], opponents: [player('opponent', [card('8')])] });
  assert.equal(setup.decisions.botBestSwapTarget(setup.bot, card('10'), { required: true }).index, 0);
});

test('a zero-use final-turn Queen is skipped', () => {
  const setup = harness({ botType: 'roswell-beta', botMemory: [unknownMemory(), unknownMemory()], dutchCallerId: 'opponent' });
  assert.equal(setup.decisions.botQueenTarget(setup.bot), null);
});

test('a doubtful low-value throw is skipped because a penalty costs more', () => {
  const own = [card('2'), card('K', 'clubs')];
  const setup = harness({ botType: 'dory-beta', botCards: own, botMemory: own.map(item => cardMemory(item, 'peek', 0.6)), throwIn: { open: true, rank: '2' } });
  assert.equal(setup.decisions.botThrowInCandidate(setup.bot), null);
  setup.bot.botMemory.slots.bot[0] = cardMemory(own[0], 'public reveal', 1);
  assert.equal(setup.decisions.botThrowInCandidate(setup.bot).index, 0);
});

test('large penalty hands use bounded decisions without reading hidden faces', () => {
  const own = Array.from({ length: 20 }, () => card('9'));
  const setup = harness({ botType: 'roswell-beta', botCards: own, botMemory: own.map(() => unknownMemory()) });
  setup.bot.cards = own.map(item => ({ id: item.id, get rank() { throw new Error('hidden face'); } }));
  const choice = setup.decisions.botBestSwapTarget(setup.bot, card('K', 'hearts'), { required: true });
  assert.ok(choice && choice.index >= 0 && choice.index < 20);
  const diagnostic = setup.decisions.botPlannerDiagnostics(setup.bot);
  assert.ok(diagnostic.nodes <= diagnostic.budget);
});

test('a final-game lead can justify Dutch above five even without a halving', () => {
  const setup = harness({ botType: 'roswell-beta', botCards: [card('6')], botTotal: 0, opponents: [player('opponent', [card('8'), card('9'), card('10')], 40)] });
  setup.state.roundLimit = 5;
  setup.state.roundNumber = 5;
  assert.equal(setup.decisions.botShouldCallDutch(setup.bot), true);
  assert.equal(setup.decisions.deliberateWrongDutch(setup.bot), true);
  setup.state.roundNumber = 4;
  assert.equal(setup.decisions.botShouldCallDutch(setup.bot), false);
});

test('a rival halving prevents an otherwise tempting final-game Dutch call', () => {
  const setup = harness({ botType: 'roswell-beta', botCards: [card('K', 'clubs'), card('2')], pileCard: card('A'), opponents: [player('opponent', [card('8'), card('9')], 40)] });
  setup.state.roundLimit = 1;
  setup.state.roundNumber = 1;
  assert.equal(setup.decisions.botShouldCallDutch(setup.bot), false);
});

test('a zero-point Dutch call preserves an existing total halving', () => {
  const setup = harness({ botType: 'roswell-beta', botTotal: 50, botCards: [card('K', 'hearts')] });
  assert.equal(setup.decisions.botShouldCallDutch(setup.bot), true);
});

test('holding an exact halving does not cause endless equal-card pile exchanges', () => {
  const setup = harness({ botType: 'roswell-beta', botTotal: 31, botCards: [card('3'), card('4'), card('4'), card('4'), card('4')], pileCard: card('3'), opponents: [player('opponent', [card('3'), card('9')])] });
  assert.equal(setup.decisions.activeHalvingPlan(setup.bot).type, 'ordinary');
  assert.equal(setup.decisions.shouldBotTakePile(setup.bot), false);
});

test('current Beta uses the same knowledge decisions in every game length', () => {
  const own = [card('10'), card('8')];
  const setup = harness({ botType: 'roswell-beta', botCards: own, botMemory: [cardMemory(own[0], 'peek', 1), unknownMemory()] });
  setup.state.roundNumber = 1;
  for (const rounds of [1, 5, 0]) {
    setup.state.roundLimit = rounds;
    assert.equal(setup.decisions.botDeckCardDecision(setup.bot, card('Q')).actionType, 'discard-drawn');
  }
});

test('the frozen 1.3.80 snapshot retains its original single-round fallback', () => {
  const own = [card('10'), card('8')];
  const setup = harness({ simpleStrategyRelease: '1.3.80', botType: 'roswell-beta', botCards: own, botMemory: [cardMemory(own[0], 'peek', 1), unknownMemory()] });
  setup.state.roundLimit = 1;
  assert.equal(setup.decisions.botDeckCardDecision(setup.bot, card('Q')).swapTarget.index, 1);
  setup.state.roundLimit = 0;
  assert.equal(setup.decisions.botDeckCardDecision(setup.bot, card('Q')).actionType, 'discard-drawn');
});

test('an available Ace is resolved before Dutch to spoil a rival exact halving',()=>{
  const h=harness({simpleStrategyRelease:'1.3.82',botType:'roswell-beta',botTotal:30,botCards:[card('K','hearts')],opponents:[player('opponent',[card('5')],45)]});
  h.state.round.stage='special';h.state.round.specialQueue=[{actorId:h.bot.id,type:'A'}];
  assert.equal(h.decisions.botShouldCallDutch(h.bot),false);
  assert.equal(h.decisions.botAceTarget(h.bot).player.id,'opponent');
});

test('waiting to spoil a rival halving has a strict two-cycle limit',()=>{
  const h=harness({simpleStrategyRelease:'1.3.82',botType:'roswell-beta',botTotal:30,botCards:[card('K','hearts')],opponents:[player('opponent',[card('5')],45)]});
  assert.equal(h.decisions.botShouldCallDutch(h.bot),false);
  h.state.round.strategyTick=4;
  assert.equal(h.decisions.botShouldCallDutch(h.bot),true);
});
