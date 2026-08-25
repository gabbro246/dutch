const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REMOTE_VOLUME,
  DEFAULT_DISCARD_DELAY_MS,
  WRONG_THROW_PILE_DELAY_MS,
  configureAmbientAudioSession,
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
    phase: 'playing',
    joined: true,
    user: 'ada',
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

test('an ambient audio session is requested when the browser supports it', () => {
  const audioSession = { type: 'auto' };

  assert.equal(configureAmbientAudioSession({ navigator: { audioSession } }), true);
  assert.equal(audioSession.type, 'ambient');
  assert.equal(configureAmbientAudioSession({}), false);
});

test('Web Audio is preferred so game effects do not take Android media focus', async () => {
  const started = [];
  const fetched = [];
  let htmlAudioCreated = 0;
  class FakeAudio {
    constructor() { htmlAudioCreated += 1; }
  }
  class FakeAudioContext {
    constructor() {
      this.state = 'running';
      this.destination = {};
    }
    decodeAudioData(data) { return Promise.resolve({ data }); }
    createBufferSource() {
      return {
        connect() {},
        start() { started.push(this.buffer); },
        stop() {}
      };
    }
    createGain() {
      return { gain: { value: 0 }, connect() {} };
    }
  }
  const target = {
    localStorage: storage(),
    navigator: { audioSession: { type: 'auto' } },
    Audio: FakeAudio,
    AudioContext: FakeAudioContext,
    fetch(path) {
      fetched.push(path);
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(path) });
    }
  };
  const sounds = create({ target });

  assert.equal(sounds.play('draw', 1), true);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(target.navigator.audioSession.type, 'ambient');
  assert.equal(htmlAudioCreated, 0);
  assert.ok(fetched.includes('sounds/card-draw.mp3'));
  assert.equal(started.length, 1);
  assert.equal(started[0].data, 'sounds/card-draw.mp3');
});

test('browser audio preload waits for idle time', () => {
  const idleCalls = [];
  const fetched = [];
  let contextCount = 0;
  class FakeAudioContext {
    constructor() {
      contextCount += 1;
      this.state = 'running';
      this.destination = {};
    }
    decodeAudioData(data) { return Promise.resolve(data); }
  }
  const target = {
    localStorage: storage(),
    AudioContext: FakeAudioContext,
    fetch(path) {
      fetched.push(path);
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(path) });
    },
    requestIdleCallback(callback, options) {
      idleCalls.push({ callback, options });
    }
  };

  create({ target });

  assert.equal(contextCount, 0);
  assert.deepEqual(fetched, []);
  assert.equal(idleCalls.length, 1);
  assert.deepEqual(idleCalls[0].options, { timeout: 1000 });

  idleCalls[0].callback();

  assert.equal(contextCount, 1);
  assert.equal(fetched.length, 6);
});

test('playing before idle time loads only the requested sound immediately', async () => {
  const idleCalls = [];
  const fetched = [];
  class FakeAudioContext {
    constructor() {
      this.state = 'running';
      this.destination = {};
    }
    decodeAudioData(data) { return Promise.resolve(data); }
    createBufferSource() { return { connect() {}, start() {}, stop() {} }; }
    createGain() { return { gain: { value: 0 }, connect() {} }; }
  }
  const sounds = create({
    target: { localStorage: storage() },
    AudioContext: FakeAudioContext,
    fetch: (path) => {
      fetched.push(path);
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(path) });
    },
    requestIdleCallbackFn: (callback) => idleCalls.push(callback)
  });

  sounds.play('draw');
  await Promise.resolve();

  assert.deepEqual(fetched, ['sounds/card-draw.mp3']);
  assert.equal(idleCalls.length, 1);
});

test('game sounds do not play outside a joined game page', () => {
  const before = state({ joined: false });
  const occupiedDraw = state({
    joined: false,
    round: { drawn: { playerId: 'ben', source: 'deck', card: { id: 'd1' } } }
  });
  const waitingDraw = state({
    phase: 'waiting',
    round: { drawn: { playerId: 'ben', source: 'deck', card: { id: 'd1' } } }
  });

  assert.deepEqual(soundEventsForTransition(before, occupiedDraw), []);
  assert.deepEqual(soundEventsForTransition(state({ phase: 'waiting' }), waitingDraw), []);
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
    eventId: '10:1:pile:d2'
  }]);
  assert.deepEqual(soundEventsForTransition(before, remoteDiscard), [{
    name: 'discard',
    volume: REMOTE_VOLUME,
    delayMs: DEFAULT_DISCARD_DELAY_MS,
    eventId: '10:1:pile:d3'
  }]);
});

test('throw-ins use remove for the user and discard for other players', () => {
  const before = state();
  const ownThrow = state({ round: {
    pendingPileReveal: { cardId: 'a1', actorId: 'ada', kind: 'throw-in', moveMs: 420 }
  } });
  const remoteThrow = state({ round: {
    pendingPileReveal: { cardId: 'b1', actorId: 'ben', kind: 'throw-in', moveMs: 420 }
  } });

  assert.deepEqual(soundEventsForTransition(before, ownThrow), [{
    name: 'remove',
    volume: 1,
    delayMs: 0,
    eventId: '10:1:pile:a1'
  }]);
  assert.deepEqual(soundEventsForTransition(before, remoteThrow), [{
    name: 'discard',
    volume: REMOTE_VOLUME,
    delayMs: 420,
    eventId: '10:1:pile:b1'
  }]);
});

test('wrong throw attempts use discard for everyone when the card reaches the pile', () => {
  const before = state();
  const ownWrongThrow = state({ round: {
    wrongThrowIn: { id: 'a2:2000', playerId: 'ada', cardId: 'a2' }
  } });
  const remoteWrongThrow = state({ round: {
    wrongThrowIn: { id: 'b2:2000', playerId: 'ben', cardId: 'b2' }
  } });

  assert.deepEqual(soundEventsForTransition(before, ownWrongThrow), [{
    name: 'discard',
    volume: 1,
    delayMs: WRONG_THROW_PILE_DELAY_MS,
    eventId: '10:1:wrong-throw:a2:2000'
  }]);
  assert.deepEqual(soundEventsForTransition(before, remoteWrongThrow), [{
    name: 'discard',
    volume: REMOTE_VOLUME,
    delayMs: WRONG_THROW_PILE_DELAY_MS,
    eventId: '10:1:wrong-throw:b2:2000'
  }]);
});

test('penalties and Ace additions notify only the recipient', () => {
  const before = state();
  const ownPenalty = state({ round: {
    cardAddEvent: { id: 'p1:wrong', playerId: 'ada', source: 'wrong-throw' }
  } });
  const remotePenalty = state({ round: {
    cardAddEvent: { id: 'p2:wrong', playerId: 'ben', source: 'wrong-throw' }
  } });
  const ownAce = state({ round: {
    cardAddEvent: { id: 'a1:ace', playerId: 'ada', source: 'ace' }
  } });
  const remoteAce = state({ round: {
    cardAddEvent: { id: 'a2:ace', playerId: 'ben', source: 'ace' }
  } });

  assert.deepEqual(soundEventsForTransition(before, ownPenalty), [{
    name: 'add', volume: 1, delayMs: DEFAULT_DISCARD_DELAY_MS, eventId: '10:1:add:p1:wrong'
  }]);
  assert.deepEqual(soundEventsForTransition(before, remotePenalty), []);
  assert.deepEqual(soundEventsForTransition(before, ownAce), [{
    name: 'add', volume: 1, delayMs: DEFAULT_DISCARD_DELAY_MS, eventId: '10:1:add:a1:ace'
  }]);
  assert.deepEqual(soundEventsForTransition(before, remoteAce), []);
});

test('peek events play only in the private view of the peeking player', () => {
  const before = state();
  const localPeek = state({ round: { peekEvent: { id: '2', cardId: 'a1' } } });

  assert.deepEqual(soundEventsForTransition(before, localPeek), [{
    name: 'peek',
    volume: 1,
    eventId: '10:1:peek:2'
  }]);
  assert.deepEqual(soundEventsForTransition(localPeek, localPeek), []);
  assert.deepEqual(soundEventsForTransition(before, state()), []);
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

test('turn sound plays only when the user becomes current', () => {
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

test('a browser-blocked sound is retained and retried after audio unlocks', async () => {
  const played = [];
  let blocked = true;
  class FakeAudio {
    constructor(path) {
      this.path = path;
      this.muted = false;
    }
    cloneNode() { return new FakeAudio(this.path); }
    load() {}
    addEventListener() {}
    pause() {}
    play() {
      if (!this.muted && blocked) {
        blocked = false;
        const error = new Error('blocked');
        error.name = 'NotAllowedError';
        return Promise.reject(error);
      }
      if (!this.muted) played.push(this.path);
      return Promise.resolve();
    }
  }
  const sounds = create({ target: { localStorage: storage() }, Audio: FakeAudio });

  sounds.play('peek', 1);
  await Promise.resolve();
  assert.deepEqual(played, []);

  await sounds.unlock();
  await Promise.resolve();
  assert.deepEqual(played, ['sounds/card-peek.mp3']);
});
