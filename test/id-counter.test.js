const test = require('node:test');
const assert = require('node:assert/strict');
const { createIdCounter } = require('../lib/id-counter.js');

test('createIdCounter returns sequential ids from the default start', () => {
  const nextId = createIdCounter();

  assert.equal(nextId(), 1);
  assert.equal(nextId(), 2);
  assert.equal(nextId(), 3);
});

test('createIdCounter supports a custom start value', () => {
  const nextId = createIdCounter(7);

  assert.equal(nextId(), 7);
  assert.equal(nextId(), 8);
});
