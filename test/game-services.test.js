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

function serviceFor() {
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
    }
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
    socket.handlers.setDeckSetting('two');

    assert.equal(services.getState().gameTarget, 50);
    assert.equal(services.getState().deckSetting, 'two');

    services.close();
    assert.deepEqual(calls.clearedIntervals, calls.intervals);
  } finally {
    if (calls.clearedIntervals.length === 0) services.close();
  }
});
