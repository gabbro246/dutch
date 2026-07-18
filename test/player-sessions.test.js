const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlayerSessions, playerIdForSocket, normalizePlayerToken } = require('../lib/player-sessions.js');

function socket(id = 'socket-1') {
  const emitted = [];
  return {
    id,
    data: {},
    emitted,
    emit: (event, payload) => emitted.push({ event, payload })
  };
}

function player(id, name, extra = {}) {
  return {
    id,
    name,
    connected: true,
    disconnectedAt: null,
    socketId: null,
    left: false,
    total: 0,
    roundPoints: null,
    cards: [],
    startPeekDone: false,
    startPeekedCardIds: [],
    joinedAt: null,
    isSpectator: false,
    ...extra
  };
}

function sessionsFor(state) {
  const calls = {
    broadcasts: 0,
    clamps: 0,
    logs: [],
    resets: [],
    handledMissing: 0,
    stageUpdates: 0
  };
  const deps = {
    getState: () => state,
    playerNameMaxLength: 24,
    spectatorTriggerName: 'spectator',
    botProfiles: {
      strategic: { name: 'Athena' },
      casual: { name: 'Norman' }
    },
    gameView: {
      buildView: (playerId) => ({ you: playerId })
    },
    broadcastState: () => {
      calls.broadcasts += 1;
    },
    findPlayer: (playerId) => state.players.find((item) => item.id === playerId),
    activePlayers: () => state.players.filter((item) => !item.left),
    activePlayerCount: () => state.players.filter((item) => !item.left).length,
    clampDeckSetting: () => {
      calls.clamps += 1;
    },
    addLog: (text, kind = 'game') => calls.logs.push({ text, kind }),
    hasPlayableHumanGame: () => state.players.filter((item) => !item.left && !item.isBot && !item.isSpectator).length >= 1 && state.players.filter((item) => !item.left && !item.isSpectator).length >= 2,
    resetToWaiting: (...args) => calls.resets.push(args),
    handleMissingPlayers: () => {
      calls.handledMissing += 1;
    },
    updateStageAfterQueue: () => {
      calls.stageUpdates += 1;
    }
  };
  return { sessions: createPlayerSessions(deps), calls };
}

test('joining and identifying use stable tokens without duplicating players', () => {
  const state = { phase: 'waiting', waitingMessage: '', players: [] };
  const { sessions, calls } = sessionsFor(state);
  const client = socket();

  sessions.join(client, { name: 'Ada', token: ' token-a ' });

  assert.equal(playerIdForSocket(client), 'token-a');
  assert.equal(state.players.length, 1);
  assert.equal(state.players[0].id, 'token-a');
  assert.equal(state.players[0].name, 'Ada');
  assert.equal(calls.logs.at(-1).text, 'Ada joined');

  state.players[0].connected = false;
  state.players[0].disconnectedAt = 123;
  sessions.identify(client, 'token-a');

  assert.equal(state.players.length, 1);
  assert.equal(state.players[0].connected, true);
  assert.equal(state.players[0].socketId, 'socket-1');
  assert.equal(calls.logs.at(-1).text, 'Ada reconnected');
  assert.ok(calls.broadcasts >= 2);
});

test('active game join can reattach a disconnected player by name', () => {
  const state = {
    phase: 'playing',
    waitingMessage: 'A game is already active. Join after the game ends.',
    players: [
      player('ada-token', 'Ada', { connected: false, disconnectedAt: 123, socketId: null }),
      player('ben-token', 'Ben', { socketId: 'socket-2' })
    ]
  };
  const { sessions, calls } = sessionsFor(state);
  const client = socket('socket-new');

  sessions.join(client, { name: 'Ada', token: 'new-token' });

  assert.equal(state.players.length, 2);
  assert.equal(playerIdForSocket(client), 'ada-token');
  assert.equal(state.players[0].connected, true);
  assert.equal(state.players[0].disconnectedAt, null);
  assert.equal(state.players[0].socketId, 'socket-new');
  assert.equal(calls.logs.at(-1).text, 'Ada reconnected');
  assert.equal(calls.broadcasts, 1);
  assert.deepEqual(client.emitted, []);
});

test('waiting-room actions remove, move, and add players', () => {
  const state = {
    phase: 'waiting',
    waitingMessage: '',
    players: [
      player('ada', 'Ada'),
      player('ben', 'Ben')
    ]
  };
  const { sessions, calls } = sessionsFor(state);

  assert.equal(sessions.moveWaitingPlayer('ben', 'up'), true);
  assert.deepEqual(state.players.map((item) => item.id), ['ben', 'ada']);

  const botResult = sessions.addBotPlayer('strategic');
  assert.equal(botResult.ok, true);
  assert.equal(state.players.at(-1).id, 'bot-strategic');
  assert.equal(state.players.at(-1).isBot, true);

  assert.equal(sessions.removeWaitingPlayer('ada', 'left'), true);
  assert.deepEqual(state.players.map((item) => item.id), ['ben', 'bot-strategic']);
  assert.equal(calls.logs.at(-1).text, 'Ada left');
  assert.ok(calls.clamps >= 2);
});

test('leave and disconnect update session state for active games', () => {
  const state = {
    phase: 'playing',
    players: [
      player('ada', 'Ada', { socketId: 'socket-1', cards: [{ id: 'a1' }] }),
      player('bot-strategic', 'Athena', { isBot: true, cards: [{ id: 'b1' }] })
    ],
    round: {
      stage: 'special',
      dutchQueue: ['ada', 'bot-strategic'],
      specialQueue: [{ type: 'Q', actorId: 'ada' }],
      roundWinnerIds: ['ada'],
      dutchCallerId: 'ada',
      winnerId: 'ada',
      drawn: { playerId: 'ada', card: { id: 'd1' } },
      turnComplete: true,
      throwIn: { open: true }
    }
  };
  const { sessions, calls } = sessionsFor(state);
  const client = socket();
  client.data.playerId = 'ada';

  sessions.leave(client);

  assert.equal(state.players[0].left, true);
  assert.equal(state.players[0].connected, false);
  assert.equal(state.round.dutchQueue.includes('ada'), false);
  assert.equal(state.round.specialQueue.length, 0);
  assert.equal(state.round.dutchCallerId, null);
  assert.equal(state.round.drawn, null);
  assert.equal(state.round.throwIn.open, false);
  assert.equal(calls.stageUpdates, 1);
  assert.equal(calls.resets.length, 1);

  const state2 = { phase: 'waiting', waitingMessage: '', players: [player('ben', 'Ben', { socketId: 'socket-2' })] };
  const { sessions: sessions2, calls: calls2 } = sessionsFor(state2);
  const client2 = socket('socket-2');
  client2.data.playerId = 'ben';
  sessions2.disconnect(client2);

  assert.equal(state2.players[0].connected, false);
  assert.equal(state2.players[0].socketId, null);
  assert.equal(calls2.logs.at(-1).text, 'Ben disconnected');
});

test('tokens are normalized and capped', () => {
  const longToken = '  ' + 'x'.repeat(100) + '  ';
  assert.equal(normalizePlayerToken(longToken), 'x'.repeat(80));
});
