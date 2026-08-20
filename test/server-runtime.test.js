const test = require('node:test');
const assert = require('node:assert/strict');
const { createServerRuntime } = require('../lib/server-runtime.js');

function runtimeFor(overrides = {}) {
  const state = {
    deckSetting: 'two',
    gameTarget: 50,
    roundNumber: 3
  };
  const calls = {
    directories: [],
    appended: [],
    logs: [],
    errors: []
  };
  const deps = {
    getState: () => state,
    activePlayablePlayers: () => [
      { name: 'Ada', isBot: false },
      { name: 'Ben', isBot: true }
    ],
    scoreSnapshot: () => [
      { name: 'Ada', total: 12, roundPoints: 4 },
      { name: 'Ben', total: 20, roundPoints: null }
    ],
    adminLogPath: '/tmp/dutch-usage.log',
    port: 3000,
    now: () => new Date('2026-01-02T03:04:05.000Z'),
    fs: {
      mkdir: (directory, options, callback) => {
        calls.directories.push({ directory, options });
        callback(null);
      },
      appendFile: (filePath, content, callback) => {
        calls.appended.push({ filePath, content });
        callback(null);
      }
    },
    os: {
      networkInterfaces: () => ({
        lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
        eth0: [
          { family: 'IPv4', internal: false, address: '192.168.1.44' },
          { family: 'IPv6', internal: false, address: 'fe80::1' }
        ]
      })
    },
    console: {
      log: (...args) => calls.logs.push(args.join(' ')),
      error: (...args) => calls.errors.push(args.join(' '))
    },
    ...overrides
  };
  return {
    runtime: createServerRuntime(deps),
    calls,
    state
  };
}

test('adminLog writes a timestamped JSON line', () => {
  const { runtime, calls } = runtimeFor();

  runtime.adminLog('game_started', { players: ['Ada'], target: 50 });

  assert.equal(calls.appended.length, 1);
  assert.deepEqual(calls.directories, [{ directory: '/tmp', options: { recursive: true } }]);
  assert.equal(calls.appended[0].filePath, '/tmp/dutch-usage.log');
  assert.deepEqual(JSON.parse(calls.appended[0].content), {
    datetime: '2026-01-02T03:04:05.000Z',
    event: 'game_started',
    players: ['Ada'],
    target: 50
  });
  assert.match(calls.appended[0].content, /\n$/);
});

test('adminLog reports append errors through the injected console', () => {
  const { runtime, calls } = runtimeFor({
    fs: {
      mkdir: (directory, options, callback) => callback(null),
      appendFile: (filePath, content, callback) => callback(new Error('disk full'))
    }
  });

  runtime.adminLog('game_started');

  assert.deepEqual(calls.errors, ['Could not write admin usage log: disk full']);
});

test('adminLog reports directory creation errors without attempting to append', () => {
  const { runtime, calls } = runtimeFor({
    fs: {
      mkdir: (directory, options, callback) => callback(new Error('permission denied')),
      appendFile: () => calls.appended.push('unexpected')
    }
  });

  runtime.adminLog('game_started');

  assert.deepEqual(calls.appended, []);
  assert.deepEqual(calls.errors, ['Could not create admin usage log directory: permission denied']);
});

test('terminal helpers format game start, game end, settings, players, and scores', () => {
  const { runtime, calls, state } = runtimeFor();

  assert.equal(runtime.terminalSettingsText(), 'two decks, target 50 points');
  assert.equal(runtime.terminalPlayerNames(), 'Ada, Ben (bot)');
  assert.equal(runtime.terminalScoresText(), 'Ada: 12 pts, round 4; Ben: 20 pts');

  runtime.terminalGameStarted();
  runtime.terminalGameEnded('score target reached', 'Ada');

  assert.deepEqual(calls.logs, [
    '[Dutch] 2026-01-02T03:04:05.000Z Game started. Players: Ada, Ben (bot). Settings: two decks, target 50 points.',
    '[Dutch] 2026-01-02T03:04:05.000Z Game ended. Winner: Ada. Reason: score target reached. Rounds: 3. Final scores: Ada: 12 pts, round 4; Ben: 20 pts.'
  ]);

  state.singleRound = true;
  assert.equal(runtime.terminalSettingsText(), 'two decks, single round');
});

test('hostAddresses and startup logging use external IPv4 addresses', () => {
  const { runtime, calls } = runtimeFor();

  assert.deepEqual(runtime.hostAddresses(4567), ['http://192.168.1.44:4567']);

  runtime.logServerStarted(4567);

  assert.deepEqual(calls.logs, [
    'Dutch! 🂡 server: http://localhost:4567',
    'game logs:       http://localhost:4567/logs',
    'interactions:    http://localhost:4567/interactions',
    'network address: http://192.168.1.44:4567',
    ''
  ]);
});
