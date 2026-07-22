const test = require('node:test');
const assert = require('node:assert/strict');
const { createGameServices } = require('../lib/game-services.js');

function config(overrides = {}) {
  return {
    port: 3000,
    appVersion: 'test',
    adminLogPath: '/tmp/dutch-test-usage.log',
    gameLogDir: '/tmp/dutch-game-logs-test',
    spectatorTriggerName: 'spectator',
    disconnectGraceMs: 15 * 60 * 1000,
    waitingRoomTimeoutMs: 15 * 60 * 1000,
    gameInactivityTimeoutMs: 15 * 60 * 1000,
    botFinishedGameResetMs: 60 * 1000,
    jackSwapSelectionMs: 500,
    ...overrides
  };
}

function fakeIo() {
  return {
    handlers: {},
    sockets: { sockets: new Map() },
    on(event, handler) {
      this.handlers[event] = handler;
    }
  };
}

function fakeSocket(id) {
  return {
    id,
    data: {},
    handlers: {},
    emitted: [],
    on(event, handler) {
      this.handlers[event] = handler;
    },
    emit(event, payload) {
      this.emitted.push({ event, payload });
    }
  };
}

function serviceFor(options = {}) {
  const io = fakeIo();
  const calls = {
    intervals: [],
    clearedIntervals: []
  };
  const services = createGameServices({
    io,
    config: config(),
    setIntervalFn(fn, ms) {
      const interval = {
        fn,
        ms,
        unrefCalled: false,
        unref() {
          this.unrefCalled = true;
        }
      };
      calls.intervals.push(interval);
      return interval;
    },
    clearIntervalFn(interval) {
      calls.clearedIntervals.push(interval);
    },
    ...options
  });
  return { services, io, calls };
}

test('createGameServices owns initial state and registers socket handlers', () => {
  const { services, io, calls } = serviceFor();
  try {
    assert.equal(services.getState().phase, 'waiting');
    assert.deepEqual(services.getState().players, []);
    assert.equal(typeof io.handlers.connection, 'function');
    assert.equal(calls.intervals.length, 1);
    assert.equal(calls.intervals[0].ms, 60 * 1000);
    assert.equal(calls.intervals[0].unrefCalled, true);
  } finally {
    services.close();
  }
});

test('registered sockets can join and update waiting-room settings', () => {
  const { services, io, calls } = serviceFor();
  try {
    const socket = fakeSocket('socket-1');
    io.sockets.sockets.set(socket.id, socket);
    io.handlers.connection(socket);

    socket.handlers.join({ name: 'Ada', token: ' ada-token ' });

    assert.equal(services.getState().players.length, 1);
    assert.equal(services.getState().players[0].id, 'ada-token');
    assert.equal(services.getState().players[0].name, 'Ada');
    assert.equal(socket.emitted.some((event) => event.event === 'state'), true);

    socket.handlers.setGameTarget(50);
    socket.handlers.setInactivityTimeout(90);
    socket.handlers.setDeckSetting('two');
    socket.handlers.setHighlightChangedCards(false);

    assert.equal(services.getState().gameTarget, 50);
    assert.equal(services.getState().inactivityTimeoutMinutes, 90);
    assert.equal(services.getState().deckSetting, 'two');
    assert.equal(services.getState().highlightChangedCards, true);

    services.close();
    assert.deepEqual(calls.clearedIntervals, calls.intervals);
  } finally {
    if (calls.clearedIntervals.length === 0) services.close();
  }
});

test('changed-card highlighting is a shared in-game setting', () => {
  const { services, io } = serviceFor();
  try {
    const ada = fakeSocket('socket-a');
    const ben = fakeSocket('socket-b');
    io.sockets.sockets.set(ada.id, ada);
    io.sockets.sockets.set(ben.id, ben);
    io.handlers.connection(ada);
    io.handlers.connection(ben);
    ada.handlers.join({ name: 'Ada', token: 'ada-token' });
    ben.handlers.join({ name: 'Ben', token: 'ben-token' });
    ada.handlers.startGame();

    ben.handlers.setHighlightChangedCards('false');

    assert.equal(services.getState().phase, 'playing');
    assert.equal(services.getState().highlightChangedCards, false);
    const latestAdaState = ada.emitted.filter((event) => event.event === 'state').at(-1).payload;
    assert.equal(latestAdaState.highlightChangedCards, false);
  } finally {
    services.close();
  }
});


test('connected players can start again immediately after manually ending a game', () => {
  const { services, io } = serviceFor();
  try {
    const ada = fakeSocket('socket-a');
    const ben = fakeSocket('socket-b');
    io.sockets.sockets.set(ada.id, ada);
    io.sockets.sockets.set(ben.id, ben);
    io.handlers.connection(ada);
    io.handlers.connection(ben);
    ada.handlers.join({ name: 'Ada', token: 'ada-token' });
    ben.handlers.join({ name: 'Ben', token: 'ben-token' });
    ada.handlers.startGame();

    ada.handlers.endGameForAll();

    assert.equal(services.getState().phase, 'waiting');
    assert.equal(services.getState().players.find((player) => player.id === 'ada-token').socketId, ada.id);
    assert.equal(services.getState().players.find((player) => player.id === 'ben-token').socketId, ben.id);

    ada.handlers.startGame();

    assert.equal(services.getState().phase, 'playing');
    assert.equal(services.getState().roundNumber, 1);
  } finally {
    services.close();
  }
});

test('fixed-seed games record the full private shuffle and initial state without exposing it live', () => {
  function startedGame() {
    const setup = serviceFor({ gameSeed: 424242 });
    const first = fakeSocket('socket-a');
    const second = fakeSocket('socket-b');
    setup.io.sockets.sockets.set(first.id, first);
    setup.io.sockets.sockets.set(second.id, second);
    setup.io.handlers.connection(first);
    setup.io.handlers.connection(second);
    first.handlers.join({ name: 'Ada', token: 'ada-seed-token' });
    second.handlers.join({ name: 'Ben', token: 'ben-seed-token' });
    first.handlers.startGame();
    return { ...setup, first, second };
  }

  const one = startedGame();
  const two = startedGame();
  try {
    const firstArchive = one.services.getState().replayArchive;
    const secondArchive = two.services.getState().replayArchive;
    assert.equal(firstArchive.gameSeed, 424242);
    assert.equal(firstArchive.rounds.length, 1);
    assert.equal(firstArchive.rounds[0].shuffledDeckOrder.length, 52);
    assert.deepEqual(
      firstArchive.rounds[0].initialHands.map((entry) => entry.cards.length),
      [4, 4]
    );
    assert.deepEqual(
      firstArchive.rounds[0].shuffledDeckOrder,
      secondArchive.rounds[0].shuffledDeckOrder
    );
    assert.deepEqual(firstArchive.initialState.round.deck, secondArchive.initialState.round.deck);
    const liveStatePayloads = one.first.emitted
      .filter((event) => event.event === 'state')
      .map((event) => event.payload);
    assert.ok(liveStatePayloads.length > 0);
    assert.ok(liveStatePayloads.every((view) => !Object.hasOwn(view, 'replayArchive')));
    assert.ok(liveStatePayloads.every((view) => !Object.hasOwn(view, 'botDiagnostics')));
  } finally {
    one.services.close();
    two.services.close();
  }
});
