const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REMOTE_VOLUME,
  DEFAULT_DISCARD_DELAY_MS,
  getStoredEnabled,
  soundEventsForTransition,
  create
} = require('../public/client-sounds.js');

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value))
  };
}

function state(overrides = {}) {
  return {
    gameStartedAt: 10,
    roundNumber: 1,
    you: 'ada',
    ...overrides,
    round: {
      stage: 'turn',
      currentPlayerId: 'ben',
      drawn: null,
      pendingPileReveal: null,
      ...(overrides.round || {})
    }
  };
}

test('sound effects default on and a disabled preference persists', () => {
  const target = { localStorage: storage() };
  const sounds = create({ target, Audio: null });

  assert.equal(getStoredEnabled(target), true);
  sounds.setEnabled(false);
  assert.equal(sounds.isEnabled(), false);
  assert.equal(getStoredEnabled(target), false);
});

test('draw and discard sounds use full local volume and quieter remote volume', () => {
  const before = state();
  const beforeLocalDraw = state({ round: { currentPlayerId: 'ada' } });
  const localDraw = state({ round: { currentPlayerId: 'ada', drawn: { playerId: 'ada', source: 'deck', card: { id: 'd1' } } } });
  const remoteDraw = state({ round: { drawn: { playerId: 'ben', source: 'pile', card: { id: 'p1' } } } });
  const localDiscard = state({ round: { pendingPileReveal: { cardId: 'd2', actorId: 'ada', moveMs: 420 } } });
  const remoteDiscard = state({ round: { pendingPileReveal: { cardId: 'd3', actorId: 'ben' } } });

  assert.deepEqual(soundEventsForTransition(beforeLocalDraw, localDraw), [{ name: 'draw', volume: 1 }]);
  assert.deepEqual(soundEventsForTransition(before, remoteDraw), [{ name: 'draw', volume: REMOTE_VOLUME }]);
  assert.deepEqual(soundEventsForTransition(before, localDiscard), [{
    name: 'discard',
    volume: 1,
    delayMs: 420,
    eventId: '10:1:discard:d2'
  }]);
  assert.deepEqual(soundEventsForTransition(before, remoteDiscard), [{
    name: 'discard',
    volume: REMOTE_VOLUME,
    delayMs: DEFAULT_DISCARD_DELAY_MS,
    eventId: '10:1:discard:d3'
  }]);
});

test('discard playback waits until the card reaches the pile', () => {
  const scheduled = [];
  const played = [];
  class FakeAudio {
    constructor(path) { this.path = path; }
    cloneNode() { return new FakeAudio(this.path); }
    addEventListener() {}
    play() { played.push(this.path); }
  }
  const target = { localStorage: storage() };
  const sounds = create({
    target,
    Audio: FakeAudio,
    setTimeoutFn: (callback, delay) => scheduled.push({ callback, delay })
  });
  const discard = state({ round: { pendingPileReveal: { cardId: 'd2', actorId: 'ada', moveMs: 420 } } });

  sounds.handleStateTransition(state(), discard);

  assert.deepEqual(played, []);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 420);
  scheduled[0].callback();
  assert.deepEqual(played, ['sounds/card-discard.mp3']);
});

test('the same discard event cannot be scheduled twice', () => {
  const scheduled = [];
  const target = { localStorage: storage() };
  const sounds = create({
    target,
    Audio: class FakeAudio {},
    setTimeoutFn: (callback, delay) => scheduled.push({ callback, delay })
  });
  const before = state();
  const discard = state({ round: { pendingPileReveal: { cardId: 'd2', actorId: 'ada', moveMs: 420 } } });

  sounds.handleStateTransition(before, discard);
  sounds.handleStateTransition(before, discard);

  assert.equal(scheduled.length, 1);
});

test('turn sound plays only when the local player becomes current', () => {
  const otherTurn = state();
  const ownTurn = state({ round: { currentPlayerId: 'ada' } });
  const opening = state({ round: { stage: 'opening', currentPlayerId: 'ada' } });

  assert.deepEqual(soundEventsForTransition(otherTurn, ownTurn), [{ name: 'turn', volume: 1 }]);
  assert.deepEqual(soundEventsForTransition(opening, ownTurn), [{ name: 'turn', volume: 1 }]);
  assert.deepEqual(soundEventsForTransition(ownTurn, ownTurn), []);
  assert.deepEqual(soundEventsForTransition(null, ownTurn), []);
  assert.deepEqual(soundEventsForTransition(ownTurn, otherTurn), []);
});

test('disabled manager does not play audio', () => {
  const played = [];
  class FakeAudio {
    constructor(path) { this.path = path; }
    cloneNode() { return new FakeAudio(this.path); }
    addEventListener() {}
    play() { played.push({ path: this.path, volume: this.volume }); }
    pause() {}
  }
  const target = { localStorage: storage({ dutchSoundEffects: 'off' }) };
  const sounds = create({ target, Audio: FakeAudio });

  assert.equal(sounds.play('draw', 1), false);
  assert.deepEqual(played, []);
  sounds.setEnabled(true);
  assert.equal(sounds.play('draw', REMOTE_VOLUME), true);
  assert.deepEqual(played, [{ path: 'sounds/card-draw.mp3', volume: REMOTE_VOLUME }]);
});
