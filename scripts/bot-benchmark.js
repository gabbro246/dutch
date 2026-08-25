#!/usr/bin/env node
const path = require('path');
const packageInfo = require('../package.json');
const { runTournament, runVersionedRoswellTournament } = require('../lib/bot-simulation.js');
const { createTournamentLogWriter } = require('../lib/bot-tournament-log.js');

const args = process.argv.slice(2);
const versionedRoswell = args.includes('--versions');
const count = args.find((argument) => /^\d+$/.test(argument));
const requestedVersions = args.filter((argument) => /^\d+\.\d+\.\d+$/.test(argument));
if (versionedRoswell && requestedVersions.length !== 0 && requestedVersions.length !== 2) {
  throw new Error('Provide either no Dutch versions or exactly two, for example: 100 1.3.67 1.3.65');
}
const gamesPerLineup = Math.max(1, Number(count) || (versionedRoswell ? 10 : 2));
const seeds = Array.from({ length: gamesPerLineup }, (_, index) => 1001 + index);
const tournamentStartedAt = new Date();
const writer = createTournamentLogWriter({
  gameLogDir: path.join(__dirname, '..', 'game-logs'),
  startedAt: tournamentStartedAt,
  gameVersion: packageInfo.version
});
const tournamentOptions = {
  seeds,
  gamesPerSeat: gamesPerLineup,
  gameVersion: packageInfo.version,
  versions: requestedVersions.length ? requestedVersions : undefined,
  capturePostGameLog: true,
  tournamentStartedAt,
  onGameComplete: (game, gameNumber, lineup) => writer.writeGame(game, gameNumber, lineup)
};
const result = versionedRoswell
  ? runVersionedRoswellTournament(tournamentOptions)
  : runTournament(tournamentOptions);
const report = {
  gameVersion: packageInfo.version,
  tournamentType: versionedRoswell
    ? result.comparison.policies.join('-vs-')
    : 'standard',
  gamesPerLineup,
  totalGames: result.games.length,
  truncatedGames: result.games.filter((game) => game.truncated).length,
  tournamentLogDirectory: writer.directory,
  summary: result.summary,
  comparison: result.comparison || null
};
writer.writeSummary(report);
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
