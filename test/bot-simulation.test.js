const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveRoswellStrategyRelease,
  simulateGame,
  runTournament,
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
