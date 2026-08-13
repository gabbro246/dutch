const test = require('node:test');
const assert = require('node:assert/strict');
const { createGameServices } = require('../lib/game-services.js');
const { mergeIncrementalState } = require('../public/client-state.js');

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

test('reconnecting receives complete score history before limited live updates', () => {
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

    services.getState().scoreHistory = Array.from({ length: 6 }, (_, index) => ({
      round: index + 1,
      players: []
    }));
    ada.handlers.disconnect();

    const reloaded = fakeSocket('socket-a-reloaded');
    io.sockets.sockets.set(reloaded.id, reloaded);
    io.handlers.connection(reloaded);
    reloaded.handlers.identify('ada-token');

    const reconnectStates = reloaded.emitted
      .filter((event) => event.event === 'state')
      .map((event) => event.payload);
    assert.ok(reconnectStates.length >= 2);
    assert.equal(reconnectStates[0].scoreHistoryComplete, true);
    assert.deepEqual(reconnectStates[0].scoreHistory.map((entry) => entry.round), [1, 2, 3, 4, 5, 6]);
    assert.equal(reconnectStates.at(-1).scoreHistoryComplete, false);
    assert.deepEqual(reconnectStates.at(-1).scoreHistory.map((entry) => entry.round), [3, 4, 5, 6]);

    const clientState = reconnectStates.reduce(
      (previousState, nextState) => mergeIncrementalState(previousState, nextState),
      null
    );
    assert.deepEqual(clientState.scoreHistory.map((entry) => entry.round), [1, 2, 3, 4, 5, 6]);
  } finally {
    services.close();
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

    ada.handlers.setGameTarget(50);
    ben.handlers.setInactivityTimeout(90);
    ben.handlers.setHighlightChangedCards('false');

    assert.equal(services.getState().phase, 'playing');
    assert.equal(services.getState().gameTarget, 50);
    assert.equal(services.getState().inactivityTimeoutMinutes, 90);
    assert.equal(services.getState().highlightChangedCards, false);
    assert.deepEqual(
      services.getState().log.slice(0, 3).map((entry) => [entry.text, entry.kind]),
      [
        ['Ben turned changed-card highlighting off', 'system'],
        ['Ben changed inactivity timeout from 15 to 90 minutes', 'system'],
        ['Ada changed game length from 100 points to 50 points', 'system']
      ]
    );
    const latestAdaState = ada.emitted.filter((event) => event.event === 'state').at(-1).payload;
    assert.equal(latestAdaState.highlightChangedCards, false);
  } finally {
    services.close();
  }
});

test('socket shuffle preserves the pile top and resumes a pending human draw', () => {
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

    const state = services.getState();
    const round = state.round;
    round.stage = 'turn';
    round.currentPlayerIndex = state.players.findIndex((player) => player.id === 'ada-token');
    round.drawn = null;
    round.turnComplete = false;
    round.specialQueue = [];
    const top = { id: 'pile-top', rank: 'K', suit: 'hearts', deckColor: 'blue' };
    round.deck = [];
    round.discard = [
      { id: 'buried-1', rank: '2', suit: 'clubs', deckColor: 'blue' },
      { id: 'buried-2', rank: '3', suit: 'clubs', deckColor: 'blue' },
      top
    ];
    round.needsReshuffle = false;

    ada.handlers.takeDeck();

    assert.equal(round.drawn, null);
    assert.equal(round.needsReshuffle, true);
    assert.deepEqual(round.pendingDeckDraws.map((item) => item.type), ['takeDeck']);
    const waitingView = ada.emitted.filter((event) => event.event === 'state').at(-1).payload;
    assert.equal(waitingView.round.needsReshuffle, true);
    assert.equal(waitingView.round.controls.canReshuffle, true);

    ben.handlers.shuffle();

    assert.equal(round.discard.length, 1);
    assert.equal(round.discard[0], top);
    assert.equal(round.needsReshuffle, false);
    assert.equal(round.pendingDeckDraws.length, 0);
    assert.equal(round.drawn.playerId, 'ada-token');
    assert.equal(round.drawn.source, 'deck');
    assert.equal(round.deck.length, 1);
    assert.equal(round.reshuffleToken, 1);
    assert.equal(state.log[0].text, 'discard pile reshuffled into draw pile');
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

test('fixed-seed games stay deterministic without retaining bot thoughts', () => {
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
    const firstState = one.services.getState();
    const secondState = two.services.getState();
    assert.deepEqual(firstState.round.deck, secondState.round.deck);
    assert.deepEqual(
      firstState.players.map((player) => player.cards),
      secondState.players.map((player) => player.cards)
    );
    assert.equal(Object.hasOwn(firstState, 'replayArchive'), false);
    assert.equal(Object.hasOwn(firstState, 'botDiagnostics'), false);
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
