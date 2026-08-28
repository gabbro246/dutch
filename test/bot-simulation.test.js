const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveBotStrategyRelease,
  resolveRoswellStrategyRelease,
  parseVersionedBotSpec,
  simulateGame,
  runTournament,
  runVersionedBotTournament,
  runVersionedRoswellTournament
} = require('../lib/bot-simulation.js');

function stableResult(result) {
  return {
    winnerPolicy: result.winnerPolicy,
    truncated: result.truncated,
    players: result.players,
    choices: Object.fromEntries(Object.entries(result.metrics).map(([id, metrics]) => [id, {
      pileChoices: metrics.pileChoices,
      deckChoices: metrics.deckChoices,
      dutchCalls: metrics.dutchCalls,
      successfulDutchCalls: metrics.successfulDutchCalls,
      failedDutchCalls: metrics.failedDutchCalls,
      throwAttempts: metrics.throwAttempts,
      throwSuccesses: metrics.throwSuccesses
    }]))
  };
}

test('headless complete games are reproducible from a fixed seed', () => {
  const options = {
    seed: 91,
    policies: ['roswell', 'always-lower-pile'],
    gameTarget: 50,
    maxRounds: 5,
    maxTurnsPerRound: 70
  };
  const first = simulateGame(options);
  const second = simulateGame(options);

  assert.deepEqual(stableResult(first), stableResult(second));
  assert.ok(first.metrics['player-0'].decisionCount > 0);
  assert.ok(first.metrics['player-0'].pileChoices + first.metrics['player-0'].deckChoices > 0);
});

test('versioned Roswell tournament runs randomized games in both seat orders', () => {
  const result = runVersionedRoswellTournament({
    gameVersion: '1.3.68',
    seeds: [23],
    gameTarget: 50,
    maxRounds: 5,
    maxTurnsPerRound: 70
  });

  assert.equal(result.games.length, 2);
  assert.deepEqual(
    result.games.map((game) => game.players.map((player) => player.policy)),
    [
      ['roswell-1.3.68', 'roswell-1.3.67'],
      ['roswell-1.3.67', 'roswell-1.3.68']
    ]
  );
  assert.equal(result.comparison.gamesPerVersion, 2);
  assert.equal(result.comparison.randomizedHands, true);
  assert.equal(result.comparison.seatsRotated, true);
  assert.deepEqual(result.comparison.requestedGameVersions, ['1.3.68', '1.3.67']);
  assert.deepEqual(result.comparison.strategyReleases, ['1.3.68', '1.3.67']);
  assert.equal(result.comparison.difference.from, 'roswell-1.3.67');
  assert.equal(result.comparison.difference.to, 'roswell-1.3.68');
  assert.ok(Number.isFinite(result.comparison.difference.metrics.gameWinRate));
  assert.ok(Number.isFinite(result.comparison.difference.metrics.averageFinalGameScore));
  assert.equal(result.summary['roswell-1.3.68'].games, 2);
  assert.equal(result.summary['roswell-1.3.67'].games, 2);
  assert.equal(result.comparison.versions['roswell-1.3.68'].games, 2);
  assert.equal(result.comparison.versions['roswell-1.3.67'].games, 2);
});

test('Roswell comparisons select either release order and resolve unchanged game versions', () => {
  assert.equal(resolveRoswellStrategyRelease('1.3.64'), '1.3.64');
  assert.equal(resolveRoswellStrategyRelease('1.3.65'), '1.3.65');
  assert.equal(resolveRoswellStrategyRelease('1.3.66'), '1.3.65');
  assert.equal(resolveRoswellStrategyRelease('1.3.67'), '1.3.67');
  assert.equal(resolveRoswellStrategyRelease('1.3.68'), '1.3.68');

  const reversed = runVersionedRoswellTournament({
    versions: ['1.3.64', '1.3.65'],
    seeds: [29],
    gameTarget: 50,
    maxRounds: 2,
    maxTurnsPerRound: 40
  });
  assert.deepEqual(reversed.comparison.policies, ['roswell-1.3.64', 'roswell-1.3.65']);
  assert.equal(reversed.comparison.difference.from, 'roswell-1.3.65');
  assert.equal(reversed.comparison.difference.to, 'roswell-1.3.64');
  assert.throws(
    () => runVersionedRoswellTournament({ versions: ['1.3.66', '1.3.65'], seeds: [1] }),
    /both use Roswell 1\.3\.65/
  );
});

test('tournament summary reports game, round, Dutch, throw-in, and latency metrics', () => {
  const result = runTournament({
    seeds: [17],
    lineups: [['roswell', 'always-draw']],
    gameTarget: 50,
    maxRounds: 5,
    maxTurnsPerRound: 70
  });
  const roswell = result.summary.roswell;

  assert.equal(roswell.games, 1);
  assert.ok(roswell.gameWinRate >= 0 && roswell.gameWinRate <= 1);
  assert.ok(roswell.roundWinRate >= 0 && roswell.roundWinRate <= 1);
  assert.ok(roswell.successfulDutchRate >= 0 && roswell.successfulDutchRate <= 1);
  assert.ok(roswell.failedDutchRate >= 0 && roswell.failedDutchRate <= 1);
  assert.ok(roswell.averageDecisionLatencyMs >= 0);
  assert.ok(roswell.maxDecisionLatencyMs < 250);
  assert.ok(Number.isFinite(roswell.averageFinalGameScore));
});

test('all four Beta bots finish a complete game with lightweight decisions', () => {
  const result = simulateGame({
    seed: 27,
    policies: ['roswell-beta', 'athena-beta', 'norman-beta', 'dory-beta'],
    gameTarget: 50,
    maxRounds: 5,
    maxTurnsPerRound: 80
  });

  assert.equal(result.truncated, false);
  for (const metrics of Object.values(result.metrics)) {
    assert.ok(metrics.decisionCount > 0);
    assert.ok(metrics.maxDecisionTimeMs < 250);
  }
});

test('bot version specs resolve to real stored strategy snapshots', () => {
  assert.equal(resolveBotStrategyRelease('roswell', '1.3.74'), '1.3.68');
  assert.equal(resolveBotStrategyRelease('norman', '1.3.66'), '1.3.65');
  assert.equal(resolveBotStrategyRelease('norman-beta', '1.3.74'), '1.3.74');
  assert.equal(resolveBotStrategyRelease('norman-beta', '1.3.76'), '1.3.75');
  assert.equal(resolveBotStrategyRelease('norman-beta', '1.3.77'), '1.3.77');
  assert.equal(resolveBotStrategyRelease('norman-beta', '1.3.78'), '1.3.78');
  assert.deepEqual(parseVersionedBotSpec('Norman-Beta@1.3.74'), {
    spec: 'norman-beta@1.3.74',
    botType: 'norman-beta',
    requestedGameVersion: '1.3.74',
    strategyRelease: '1.3.74',
    decisionSystem: 'simple'
  });
  assert.throws(
    () => parseVersionedBotSpec('norman-beta@1.3.73'),
    /No norman-beta strategy snapshot/
  );
});

test('mixed bot-version tournament rotates seats and reports both snapshots', () => {
  const result = runVersionedBotTournament({
    competitors: ['roswell@1.3.68', 'norman-beta@1.3.74'],
    seeds: [43],
    gameTarget: 50,
    maxRounds: 2,
    maxTurnsPerRound: 40
  });

  assert.equal(result.games.length, 2);
  assert.deepEqual(
    result.games.map((game) => game.players.map((player) => player.policy)),
    [
      ['roswell@1.3.68', 'norman-beta@1.3.74'],
      ['norman-beta@1.3.74', 'roswell@1.3.68']
    ]
  );
  assert.equal(result.comparison.totalGames, 2);
  assert.equal(result.comparison.gamesPerSeat, 1);
  assert.equal(result.comparison.gamesPerCompetitor, 2);
  assert.equal(result.comparison.competitors['roswell@1.3.68'].strategyRelease, '1.3.68');
  assert.equal(result.comparison.competitors['norman-beta@1.3.74'].strategyRelease, '1.3.74');
  assert.equal(result.summary['roswell@1.3.68'].games, 2);
  assert.equal(result.summary['norman-beta@1.3.74'].games, 2);
  assert.throws(
    () => runVersionedBotTournament({
      competitors: ['roswell@1.3.68', 'norman-beta@1.3.74'],
      totalGames: 3
    }),
    /even whole number/
  );
});
