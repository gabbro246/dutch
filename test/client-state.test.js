const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeIncrementalState, cardAnimationSignature } = require('../public/client-state.js');

test('incremental live logs merge with the complete client history without duplicates', () => {
  const prior = {
    gameStartedAt: 10,
    log: [
      { id: 3, text: 'three' },
      { id: 2, text: 'two' },
      { id: 1, text: 'one' }
    ]
  };
  const incoming = {
    gameStartedAt: 10,
    log: [{ id: 4, text: 'four' }, { id: 3, text: 'three' }],
    logLength: 4,
    logComplete: false
  };

  const merged = mergeIncrementalState(prior, incoming);

  assert.deepEqual(merged.log.map((entry) => entry.id), [4, 3, 2, 1]);
  assert.equal(merged.logComplete, true);
});

test('incremental logs do not cross game boundaries', () => {
  const prior = { gameStartedAt: 10, log: [{ id: 1 }] };
  const incoming = { gameStartedAt: 20, log: [{ id: 2 }], logLength: 2, logComplete: false };

  assert.equal(mergeIncrementalState(prior, incoming), incoming);
});

test('incremental score history merges chronological round windows', () => {
  const prior = {
    gameStartedAt: 10,
    log: [],
    scoreHistory: [{ round: 1 }, { round: 2 }, { round: 3 }]
  };
  const incoming = {
    gameStartedAt: 10,
    log: [],
    scoreHistory: [{ round: 3 }, { round: 4 }],
    scoreHistoryLength: 4,
    scoreHistoryStart: 2,
    scoreHistoryComplete: false
  };

  const merged = mergeIncrementalState(prior, incoming);

  assert.deepEqual(merged.scoreHistory.map((entry) => entry.round), [1, 2, 3, 4]);
  assert.equal(merged.scoreHistoryComplete, true);
});

test('animation signatures ignore status-only changes and detect card layout changes', () => {
  const state = {
    roundNumber: 2,
    round: {
      stage: 'turn',
      players: [{ id: 'a', cards: [{ id: 'c1', back: true }] }],
      discardTop: null,
      discardCount: 0,
      drawn: null,
      wrongThrowPenalty: null,
      wrongThrowIn: null
    }
  };
  const statusOnly = { ...state, log: [{ text: 'status' }] };
  const moved = {
    ...state,
    round: { ...state.round, players: [{ id: 'a', cards: [{ id: 'c2', back: true }] }] }
  };

  assert.equal(cardAnimationSignature(state), cardAnimationSignature(statusOnly));
  assert.notEqual(cardAnimationSignature(state), cardAnimationSignature(moved));

  const reshuffled = { ...state, round: { ...state.round, reshuffleToken: 1 } };
  assert.notEqual(cardAnimationSignature(state), cardAnimationSignature(reshuffled));

  const penalized = {
    ...state,
    round: { ...state.round, wrongThrowPenalty: { id: 'penalty:wrong-card' } }
  };
  assert.notEqual(cardAnimationSignature(state), cardAnimationSignature(penalized));
});
