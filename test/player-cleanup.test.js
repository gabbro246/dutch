const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlayerCleanup } = require('../lib/player-cleanup.js');

function player(id, extra = {}) {
  return {
    id,
    name: id.toUpperCase(),
    connected: true,
    disconnectedAt: null,
    joinedAt: null,
    left: false,
    isBot: false,
    isSpectator: false,
    ...extra
  };
}

function cleanupFor(state) {
  const calls = {
    resets: [],
    broadcasts: 0,
    removedWaiting: [],
    logs: [],
    clamps: 0,
    missing: 0
  };
  const deps = {
    getState: () => state,
    disconnectGraceMs: 100,
    waitingRoomTimeoutMs: 200,
    gameInactivityTimeoutMs: 300,
    playerSessions: {
      removeWaitingPlayer: (playerId, reason) => {
        calls.removedWaiting.push({ playerId, reason });
        state.players = state.players.filter((item) => item.id !== playerId);
        return true;
      }
    },
    currentPlayer: () => state.round ? state.players[state.round.currentPlayerIndex] || null : null,
    findActiveIndexFrom: (startIndex) => {
      for (let offset = 0; offset < state.players.length; offset += 1) {
        const index = (startIndex + offset + state.players.length) % state.players.length;
        const candidate = state.players[index];
        if (candidate && !candidate.left && !candidate.isSpectator) return index;
      }
      return -1;
    },
    addLog: (text, kind = 'game') => calls.logs.push({ text, kind }),
    clampDeckSetting: () => {
      calls.clamps += 1;
    },
    hasPlayableHumanGame: () => state.players.filter((item) => !item.left && !item.isBot && !item.isSpectator).length >= 1 && state.players.filter((item) => !item.left && !item.isSpectator).length >= 2,
    resetToWaiting: (...args) => calls.resets.push(args),
    handleMissingPlayers: () => {
      calls.missing += 1;
    },
    broadcastState: () => {
      calls.broadcasts += 1;
    }
  };
  return { cleanup: createPlayerCleanup(deps), calls };
}

test('playing inactivity timeout resets and broadcasts', () => {
  const state = {
    phase: 'playing',
    lastGameActivityAt: 100,
    players: [player('ada'), player('ben')],
    round: { currentPlayerIndex: 0 }
  };
  const { cleanup, calls } = cleanupFor(state);

  assert.equal(cleanup.purgeExpiredDisconnectedPlayers(500), true);
  assert.equal(calls.resets.length, 1);
  assert.deepEqual(calls.resets[0], [true, 'game ended after 15 minutes without activity', { adminEvent: 'game_ended_inactivity_timeout' }]);
  assert.equal(calls.broadcasts, 1);
  assert.equal(calls.missing, 0);
});

test('waiting-room expiry removes timed-out humans and bots', () => {
  const state = {
    phase: 'waiting',
    players: [
      player('old', { joinedAt: 100 }),
      player('bot', { joinedAt: 100, isBot: true }),
      player('new', { joinedAt: 450 })
    ],
    round: null
  };
  const { cleanup, calls } = cleanupFor(state);

  assert.equal(cleanup.purgeExpiredDisconnectedPlayers(500), true);
  assert.deepEqual(calls.removedWaiting, [
    { playerId: 'old', reason: 'left after 15 minutes in the waiting room' },
    { playerId: 'bot', reason: 'left after 15 minutes in the waiting room' }
  ]);
  assert.deepEqual(state.players.map((item) => item.id), ['new']);
  assert.equal(calls.broadcasts, 1);
});

test('waiting-room expiry starts at exactly the configured timeout', () => {
  const state = {
    phase: 'waiting',
    players: [player('bot', { joinedAt: 100, isBot: true })],
    round: null
  };
  const { cleanup, calls } = cleanupFor(state);

  assert.equal(cleanup.purgeExpiredDisconnectedPlayers(300), true);
  assert.deepEqual(calls.removedWaiting.map((item) => item.playerId), ['bot']);
});

test('expired disconnected players are removed from round state', () => {
  const state = {
    phase: 'playing',
    lastGameActivityAt: 450,
    players: [
      player('ada'),
      player('ben', { connected: false, disconnectedAt: 100 }),
      player('cara')
    ],
    round: {
      currentPlayerIndex: 1,
      dutchQueue: ['ada', 'ben', 'cara'],
      specialQueue: [{ type: 'Q', actorId: 'ben' }, { type: 'A', actorId: 'cara' }],
      roundWinnerIds: ['ben'],
      dutchCallerId: 'ben',
      winnerId: 'ben',
      drawn: { playerId: 'ben', card: { id: 'd1' } },
      turnComplete: true
    }
  };
  const { cleanup, calls } = cleanupFor(state);

  assert.equal(cleanup.purgeExpiredDisconnectedPlayers(250), true);
  assert.deepEqual(state.players.map((item) => item.id), ['ada', 'cara']);
  assert.deepEqual(state.round.dutchQueue, ['ada', 'cara']);
  assert.deepEqual(state.round.specialQueue, [{ type: 'A', actorId: 'cara' }]);
  assert.deepEqual(state.round.roundWinnerIds, []);
  assert.equal(state.round.dutchCallerId, null);
  assert.equal(state.round.winnerId, null);
  assert.equal(state.round.drawn, null);
  assert.equal(state.round.turnComplete, false);
  assert.equal(calls.logs.at(-1).text, 'BEN was removed after 15 minutes offline');
  assert.equal(calls.clamps, 1);
  assert.equal(calls.missing, 1);
  assert.equal(calls.broadcasts, 1);
});

test('configured inactivity timeout controls game expiry and its message', () => {
  const timeoutMs = 30 * 60 * 1000;
  const state = {
    phase: 'playing',
    inactivityTimeoutMinutes: 30,
    lastGameActivityAt: 100,
    players: [player('ada'), player('ben')],
    round: { currentPlayerIndex: 0 }
  };
  const { cleanup, calls } = cleanupFor(state);

  assert.equal(cleanup.purgeExpiredDisconnectedPlayers(100 + timeoutMs), false);
  assert.equal(cleanup.purgeExpiredDisconnectedPlayers(101 + timeoutMs), true);
  assert.deepEqual(calls.resets[0], [
    true,
    'game ended after 30 minutes without activity',
    { adminEvent: 'game_ended_inactivity_timeout' }
  ]);
});
test('cleanup returns false when nobody expired', () => {
  const state = {
    phase: 'waiting',
    players: [player('ada', { joinedAt: 450 })],
    round: null
  };
  const { cleanup, calls } = cleanupFor(state);

  assert.equal(cleanup.purgeExpiredDisconnectedPlayers(500), false);
  assert.equal(calls.broadcasts, 0);
});
