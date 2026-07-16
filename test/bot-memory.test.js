const test = require('node:test');
const assert = require('node:assert/strict');
const { createBotMemory } = require('../lib/bot-memory.js');

function card(id, rank = '7', suit = 'clubs') {
  return { id, rank, suit, deckColor: 'blue' };
}

function player(id, cards, extra = {}) {
  return {
    id,
    name: id.toUpperCase(),
    cards,
    left: false,
    isSpectator: false,
    isBot: false,
    ...extra
  };
}

function memoryFor(state) {
  const memory = createBotMemory({
    getState: () => state,
    activeBots: () => state.players.filter((item) => item.isBot && !item.left),
    activePlayablePlayers: () => state.players.filter((item) => !item.left && !item.isSpectator)
  });
  return memory;
}

test('ensureBotMemory initializes and sizes slots for playable players', () => {
  const bot = player('bot', [card('b1'), card('b2')], { isBot: true, botType: 'strategic' });
  const state = {
    roundNumber: 3,
    round: { botTick: 12 },
    players: [
      bot,
      player('ada', [card('a1'), card('a2'), card('a3')]),
      player('spec', [card('s1')], { isSpectator: true })
    ]
  };
  const memory = memoryFor(state);

  const botMemory = memory.ensureBotMemory(bot);

  assert.equal(botMemory.roundNumber, 3);
  assert.equal(botMemory.slots.bot.length, 2);
  assert.equal(botMemory.slots.ada.length, 3);
  assert.equal(botMemory.slots.spec, undefined);
  assert.equal(botMemory.slots.ada[0].source, 'unknown');
  assert.equal(botMemory.slots.ada[0].updatedTick, 12);

  state.players[1].cards.pop();
  memory.ensureBotMemory(bot);
  assert.equal(botMemory.slots.ada.length, 2);
});

test('remember, forget, add, remove, and move slot memory mutate all bots', () => {
  const bot = player('bot', [card('b1'), card('b2')], { isBot: true, botType: 'strategic' });
  const ada = player('ada', [card('a1', '9'), card('a2', '2')]);
  const state = {
    roundNumber: 1,
    round: { botTick: 5 },
    players: [bot, ada]
  };
  const memory = memoryFor(state);
  memory.syncBotMemories();

  memory.rememberSlotForAllBots('ada', 0, ada.cards[0], 'peek', 0.92);
  assert.equal(bot.botMemory.slots.ada[0].card.rank, '9');
  assert.equal(bot.botMemory.slots.ada[0].confidence, 0.92);

  memory.forgetSlotForAllBots('ada', 0, 'forgotten');
  assert.equal(bot.botMemory.slots.ada[0].state, 'unknown');
  assert.equal(bot.botMemory.slots.ada[0].source, 'forgotten');

  memory.addUnknownSlotForAllBots('ada', 'Ace');
  assert.equal(bot.botMemory.slots.ada.length, 3);
  assert.equal(bot.botMemory.slots.ada[2].source, 'Ace');

  memory.rememberSlotForBot(bot, 'bot', 0, bot.cards[0], 'own peek', 1);
  memory.rememberSlotForBot(bot, 'ada', 1, ada.cards[1], 'queen', 0.8);
  memory.moveSlotMemoryForAllBots('bot', 0, 'ada', 1, 'Jack swap');
  assert.equal(bot.botMemory.slots.bot[0].card.rank, '2');
  assert.equal(bot.botMemory.slots.ada[1].card.rank, '7');
  assert.equal(bot.botMemory.slots.ada[1].source, 'Jack swap');

  memory.removeSlotForAllBots('ada', 1, 'throw-in');
  assert.equal(bot.botMemory.slots.ada.length, 1);
  assert.deepEqual(bot.botMemory.discards.at(-1), { source: 'throw-in', updatedTick: 5 });
});

test('observations record discards, pile takes, and Ace attackers', () => {
  const bot = player('bot', [card('b1')], { isBot: true, botType: 'casual' });
  const ada = player('ada', [card('a1')]);
  const state = {
    roundNumber: 1,
    round: { botTick: 9 },
    players: [bot, ada]
  };
  const memory = memoryFor(state);
  memory.syncBotMemories();

  for (let i = 0; i < 82; i += 1) memory.observeDiscardForAllBots(card('d' + i, 'Q'), 'discarded', 'ada');
  assert.equal(bot.botMemory.discards.length, 80);
  assert.equal(bot.botMemory.discards.at(-1).rank, 'Q');
  assert.equal(bot.botMemory.discards.at(-1).actorId, 'ada');

  memory.observePileTakeForAllBots('ada', card('p1', 'A', 'spades'));
  assert.equal(bot.botMemory.pendingPile.actorId, 'ada');
  assert.equal(bot.botMemory.pendingPile.rank, 'A');
  assert.equal(bot.botMemory.pendingPile.card.suit, 'spades');

  memory.observeAceForAllBots('ada', 'bot');
  memory.observeAceForAllBots('ada', 'bot');
  memory.observeAceForAllBots('bot', 'bot');
  assert.equal(bot.botMemory.aceAttackers.ada, 2);
  assert.equal(bot.botMemory.aceAttackers.bot, undefined);
});

test('botMemoryEntry and effectiveMemory use the current bot tick', () => {
  const bot = player('bot', [card('b1')], { isBot: true, botType: 'distracted' });
  const state = {
    roundNumber: 1,
    round: { botTick: 0 },
    players: [bot]
  };
  const memory = memoryFor(state);
  memory.syncBotMemories();
  memory.rememberSlotForBot(bot, 'bot', 0, bot.cards[0], 'start peek', 0.9);

  state.round.botTick = 60;
  const effective = memory.effectiveMemory(bot, memory.botMemoryEntry(bot, 'bot', 0));

  assert.equal(effective.state, 'stale');
  assert.equal(effective.card, null);
  assert.equal(memory.botMemoryEntry(bot, 'missing', 0).state, 'unknown');
});
