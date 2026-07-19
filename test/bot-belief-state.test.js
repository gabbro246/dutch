const test = require('node:test');
const assert = require('node:assert/strict');
const { createBotMemory } = require('../lib/bot-memory.js');
const { createCardFlow } = require('../lib/card-flow.js');
const { buildBeliefState, CARD_ZONES } = require('../lib/bot-belief-state.js');

function card(id, rank, suit = 'clubs') {
  return { id, rank, suit, deckColor: 'blue' };
}

function player(id, cards, extra = {}) {
  return { id, name: id, cards, total: 0, left: false, isSpectator: false, ...extra };
}

test('buried discards return to draw probability on reshuffle while top stays excluded', () => {
  const bot = player('bot', [card('own', 'A', 'spades')], { isBot: true, botType: 'roswell' });
  const opponent = player('opp', [card('hidden', '7')]);
  const two = card('two', '2');
  const three = card('three', '3');
  const top = card('top', 'K', 'hearts');
  const state = {
    deckSetting: 'one',
    roundNumber: 1,
    players: [bot, opponent],
    round: {
      strategyTick: 2,
      deck: [],
      discard: [two, three, top],
      reveals: [],
      specialQueue: []
    }
  };
  const memory = createBotMemory({
    getState: () => state,
    activeBots: () => [bot],
    activePlayablePlayers: () => state.players
  });
  memory.syncBotMemories();
  memory.rememberSlotForBot(bot, bot.id, 0, bot.cards[0], 'own peek', 1);
  memory.observeDiscardForAllBots(two, 'discarded');
  memory.observeDiscardForAllBots(three, 'discarded');
  memory.observeDiscardForAllBots(top, 'discarded');

  const before = buildBeliefState({
    state,
    bot,
    memory: bot.botMemory,
    effectiveMemory: memory.effectiveMemory
  });
  assert.equal(before.probabilityOf(two), 0);
  assert.equal(before.probabilityOf(top), 0);

  const flow = createCardFlow({
    getState: () => state,
    specialRanks: ['A', 'Q', 'J'],
    shuffle: (cards) => cards,
    observeReshuffleForAllBots: memory.observeReshuffleForAllBots,
    addLog: () => {},
    nameOf: () => '',
    specialName: (rank) => rank,
    nextThrowInToken: () => 1,
    rankValue: (item) => item.rank,
    updateStageAfterQueue: () => {},
    broadcastState: () => {},
    suitSymbol: () => ''
  });
  flow.ensureDrawPile();

  const after = buildBeliefState({
    state,
    bot,
    memory: bot.botMemory,
    effectiveMemory: memory.effectiveMemory
  });
  assert.ok(after.probabilityOf(two) > 0);
  assert.equal(after.probabilityOf(top), 0);
  assert.equal(after.rankRemaining['2'], before.rankRemaining['2'] + 1);
  assert.equal(bot.botMemory.reshuffles.length, 1);
  assert.equal(bot.botMemory.reshuffles[0].cards.length, 2);
  assert.deepEqual(state.round.discard, [top]);
});

test('known and unknown slots share one remaining physical-card pool without double counting', () => {
  const known = card('physical', '9', 'diamonds');
  const bot = player('bot', [known, card('unknown-own', '4')], { isBot: true, botType: 'roswell' });
  const opponent = player('opp', [card('unknown-opp', '6')]);
  const state = {
    deckSetting: 'one',
    roundNumber: 1,
    players: [bot, opponent],
    round: { strategyTick: 0, deck: Array(48).fill(null), discard: [card('top', '3')] }
  };
  const memory = createBotMemory({
    getState: () => state,
    activeBots: () => [bot],
    activePlayablePlayers: () => state.players
  });
  memory.syncBotMemories();
  memory.rememberSlotForBot(bot, bot.id, 0, known, 'own peek', 1);

  const belief = buildBeliefState({
    state,
    bot,
    memory: bot.botMemory,
    effectiveMemory: memory.effectiveMemory
  });
  assert.equal(belief.counts.get('9:diamonds'), 0);
  assert.equal(belief.unknownSlots, 2);
  assert.equal(belief.unknownPoolSize, belief.drawCount + belief.unknownSlots);
  assert.equal(belief.zones.filter((zone) => zone.zone === CARD_ZONES.DRAW_PILE).length, 1);
  assert.equal(belief.zones.some((zone) => zone.zone === CARD_ZONES.UNCERTAIN_OWN_SLOT), true);
  assert.equal(belief.zones.some((zone) => zone.zone === CARD_ZONES.UNCERTAIN_OPPONENT_SLOT), true);
});
