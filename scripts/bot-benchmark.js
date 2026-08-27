#!/usr/bin/env node
const path = require('path');
const packageInfo = require('../package.json');
const {
  runTournament,
  runVersionedBotTournament,
  runVersionedRoswellTournament
} = require('../lib/bot-simulation.js');
const { createTournamentLogWriter } = require('../lib/bot-tournament-log.js');

const args = process.argv.slice(2);
const versionedRoswell = args.includes('--versions');
const requestedCompetitors = args.filter((argument) => argument.includes('@'));
const versionedBots = args.includes('--bot-versions') || requestedCompetitors.length > 0;
if (versionedRoswell && versionedBots) {
  throw new Error('Choose either a bot-version tournament or the legacy Roswell-version comparison.');
}
const count = args.find((argument) => /^\d+$/.test(argument));
const requestedVersions = args.filter((argument) => /^\d+\.\d+\.\d+$/.test(argument));
if (versionedRoswell && requestedVersions.length !== 0 && requestedVersions.length !== 2) {
  throw new Error('Provide either no Dutch versions or exactly two, for example: 100 1.3.68 1.3.67');
}
if (versionedBots && requestedCompetitors.length !== 2) {
  throw new Error(
    'Provide exactly two bot versions, for example: 100 roswell@1.3.68 norman-beta@1.3.74'
  );
}

const requestedGameCount = Math.max(1, Number(count) || (versionedBots ? 100 : (versionedRoswell ? 10 : 2)));
const seeds = versionedBots
  ? undefined
  : Array.from({ length: requestedGameCount }, (_, index) => 1001 + index);
const tournamentStartedAt = new Date();
const writer = createTournamentLogWriter({
  gameLogDir: path.join(__dirname, '..', 'game-logs'),
  startedAt: tournamentStartedAt,
  gameVersion: packageInfo.version
});
const tournamentOptions = {
  seeds,
  gamesPerSeat: requestedGameCount,
  totalGames: versionedBots ? requestedGameCount : undefined,
  competitors: versionedBots ? requestedCompetitors : undefined,
  gameVersion: packageInfo.version,
  versions: requestedVersions.length ? requestedVersions : undefined,
  capturePostGameLog: true,
  tournamentStartedAt,
  onGameComplete: (game, gameNumber, lineup) => writer.writeGame(game, gameNumber, lineup)
};
const result = versionedBots
  ? runVersionedBotTournament(tournamentOptions)
  : (versionedRoswell ? runVersionedRoswellTournament(tournamentOptions) : runTournament(tournamentOptions));
const report = {
  gameVersion: packageInfo.version,
  tournamentType: result.comparison
    ? result.comparison.policies.join('-vs-')
    : 'standard',
  requestedGames: versionedBots ? requestedGameCount : undefined,
  gamesPerLineup: versionedBots ? undefined : requestedGameCount,
  totalGames: result.games.length,
  truncatedGames: result.games.filter((game) => game.truncated).length,
  tournamentLogDirectory: writer.directory,
  summary: result.summary,
  comparison: result.comparison || null
};
writer.writeSummary(report);
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
