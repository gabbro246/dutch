const test = require('node:test');
const assert = require('node:assert/strict');
const { freshState } = require('../lib/game-state.js');
const { createDeck, createCombinedDeck, shuffle } = require('../lib/deck.js');

function counter(start = 1) {
  let next = start;
  return () => next++;
}

test('fresh state creates independent waiting tables', () => {
  const first = freshState();
  const second = freshState();

  assert.equal(first.phase, 'waiting');
  assert.equal(first.deckSetting, 'one');
  assert.equal(first.gameTarget, 100);
  assert.equal(first.waitingMessage, 'A game is already active. Join after the game ends.');
  first.players.push({ id: 'ada' });
  first.log.push({ text: 'hello' });

  assert.deepEqual(second.players, []);
  assert.deepEqual(second.log, []);
});

test('createDeck creates a full color deck with sequential ids', () => {
  const deck = createDeck('red', counter(7));

  assert.equal(deck.length, 52);
  assert.equal(deck[0].id, 'c7');
  assert.equal(deck.at(-1).id, 'c58');
  assert.equal(deck.every((card) => card.deckColor === 'red'), true);
  assert.equal(new Set(deck.map((card) => card.rank + card.suit)).size, 52);
});

test('createCombinedDeck builds one or two deck settings', () => {
  const oneDeck = createCombinedDeck('one', {
    nextCardId: counter(1),
    random: () => 0.75
  });

  assert.equal(oneDeck.deckColor, 'blue');
  assert.equal(oneDeck.cards.length, 52);
  assert.equal(oneDeck.cards.every((card) => card.deckColor === 'blue'), true);

  const twoDecks = createCombinedDeck('two', {
    nextCardId: counter(1),
    random: () => 0
  });

  assert.equal(twoDecks.deckColor, 'red+blue');
  assert.equal(twoDecks.cards.length, 104);
  assert.equal(twoDecks.cards.filter((card) => card.deckColor === 'red').length, 52);
  assert.equal(twoDecks.cards.filter((card) => card.deckColor === 'blue').length, 52);
});

test('shuffle mutates and returns the provided cards', () => {
  const cards = [1, 2, 3];
  const result = shuffle(cards, () => 0);

  assert.equal(result, cards);
  assert.deepEqual(cards, [2, 3, 1]);
});
