const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const selectInteraction = require('../public/select-interaction.js');

function fakeSelect() {
  const listeners = {};
  return {
    isConnected: true,
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
    dispatch(type, event = {}) {
      listeners[type](event);
    }
  };
}

test('tracks a settings dropdown until its selection finishes', () => {
  const scheduled = [];
  const tracker = selectInteraction.create({
    schedule: (callback) => scheduled.push(callback)
  });
  const select = fakeSelect();
  tracker.wire(select);

  select.dispatch('pointerdown');
  assert.equal(tracker.current(), select);

  select.dispatch('change');
  assert.equal(tracker.current(), select);
  scheduled.shift()();
  assert.equal(tracker.current(), null);
});

test('supports keyboard opening, cancelling, and clicking outside', () => {
  const scheduled = [];
  const tracker = selectInteraction.create({
    schedule: (callback) => scheduled.push(callback)
  });
  const select = fakeSelect();
  tracker.wire(select);

  select.dispatch('keydown', { key: 'Enter' });
  assert.equal(tracker.current(), select);
  select.dispatch('keydown', { key: 'Escape' });
  scheduled.shift()();
  assert.equal(tracker.current(), null);

  select.dispatch('pointerdown');
  tracker.releaseIfOutside({});
  scheduled.shift()();
  assert.equal(tracker.current(), null);
});

test('forgets a dropdown that is no longer connected', () => {
  const tracker = selectInteraction.create();
  const select = fakeSelect();

  tracker.begin(select);
  select.isConnected = false;

  assert.equal(tracker.current(), null);
});

test('incoming game states render immediately while settings are preserved in place', () => {
  const clientSource = fs.readFileSync(require.resolve('../public/client.js'), 'utf8');

  assert.match(clientSource, /socket\.on\('state', applyIncomingState\)/);
  assert.match(clientSource, /replaceGameViewAroundSettings\(gameMarkup, activeSettingsSelect\)/);
  assert.doesNotMatch(clientSource, /deferredState|pendingGameState/);
});
