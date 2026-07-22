#!/usr/bin/env node
const path = require('path');
const { runTournament } = require('../lib/bot-simulation.js');
const { createTournamentLogWriter } = require('../lib/bot-tournament-log.js');

const gamesPerLineup = Math.max(1, Number(process.argv[2]) || 2);
const seeds = Array.from({ length: gamesPerLineup }, (_, index) => 1001 + index);
const tournamentStartedAt = new Date();
const writer = createTournamentLogWriter({
  gameLogDir: path.join(__dirname, '..', 'game-logs'),
  startedAt: tournamentStartedAt
});
const result = runTournament({
  seeds,
  capturePostGameLog: true,
  tournamentStartedAt,
  onGameComplete: (game, gameNumber, lineup) => writer.writeGame(game, gameNumber, lineup)
});
const report = {
  gamesPerLineup,
  totalGames: result.games.length,
  truncatedGames: result.games.filter((game) => game.truncated).length,
  tournamentLogDirectory: writer.directory,
  summary: result.summary
};
writer.writeSummary(report);
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
