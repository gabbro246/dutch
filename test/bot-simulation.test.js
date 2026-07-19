const test = require('node:test');
const assert = require('node:assert/strict');
const { simulateGame, runTournament } = require('../lib/bot-simulation.js');

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
