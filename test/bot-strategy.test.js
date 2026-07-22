const test = require('node:test');
const assert = require('node:assert/strict');
const { BOT_PROFILES } = require('../lib/bot-profiles.js');
const {
  botProfile,
  publicMemoryCard,
  rankValue,
  unknownMemory,
  cardMemory,
  effectiveMemory
} = require('../lib/bot-strategy.js');

function card(rank = '8', suit = 'hearts') {
  return { id: rank + suit, rank, suit, deckColor: 'red' };
}

test('bot profiles use character names as canonical identifiers', () => {
  assert.deepEqual(Object.keys(BOT_PROFILES), ['athena', 'roswell', 'norman', 'dory']);
});

test('public memory cards keep only gameplay-visible card details', () => {
  assert.deepEqual(publicMemoryCard(card('K', 'diamonds')), {
    rank: 'K',
    suit: 'diamonds',
    red: true,
    points: 0
  });
  assert.equal(publicMemoryCard(null), null);
  assert.equal(rankValue(card('Q')), 'Q');
});

test('memory entries carry source, rank, confidence, and tick', () => {
  assert.deepEqual(unknownMemory('reshuffle', 7), {
    state: 'unknown',
    card: null,
    rank: null,
    knownRank: null,
    expectedValue: 6.4,
    confidence: 0,
    source: 'reshuffle',
    updatedTick: 7,
    lastChangedEvent: 'reshuffle',
    lastChangedTick: 7
  });

  assert.deepEqual(cardMemory(card('A', 'spades'), 'peek', 0.82, 'known', 11), {
    state: 'known',
    card: {
      rank: 'A',
      suit: 'spades',
      red: false,
      points: 1
    },
    rank: 'A',
    knownRank: 'A',
    expectedValue: 1,
    confidence: 0.82,
    source: 'peek',
    updatedTick: 11,
    lastChangedEvent: 'peek',
    lastChangedTick: 11
  });
});

test('effective memory decays confidence by bot profile and age', () => {
  const fresh = cardMemory(card('4', 'clubs'), 'own peek', 0.9, 'known', 10);
  const known = effectiveMemory({ botType: 'athena' }, fresh, 10);
  assert.equal(known.state, 'known');
  assert.equal(known.card.rank, '4');
  assert.equal(known.confidence, 0.9);

  const stale = effectiveMemory({ botType: 'dory' }, fresh, 60);
  assert.equal(stale.state, 'stale');
  assert.equal(stale.card, null);
  assert.ok(stale.confidence < 0.46);
});

test('unknown effective memory preserves rank and source when present', () => {
  assert.deepEqual(effectiveMemory({ botType: 'missing' }, { rank: 'J', source: 'throw-in' }, 3), {
    state: 'unknown',
    confidence: 0,
    card: null,
    rank: 'J',
    knownRank: 'J',
    expectedValue: 6.4,
    source: 'throw-in',
    updatedTick: 0,
    lastChangedEvent: 'throw-in',
    lastChangedTick: 0
  });
  assert.equal(botProfile({ botType: 'missing' }).label, 'norman');
});
