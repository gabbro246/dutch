#!/usr/bin/env node
const os = require('node:os');
const path = require('node:path');
const packageInfo = require('../package.json');
const {
  runVersionedBotTournament,
  runVersionedRoswellTournament
} = require('../lib/bot-simulation.js');
const { createTournamentLogWriter } = require('../lib/bot-tournament-log.js');
const { createTournamentProgress } = require('../lib/bot-tournament-progress.js');
const { runTournamentInWorkers } = require('../lib/bot-tournament-runner.js');

function parseArguments(rawArgs) {
  const args = [];
  let requestedJobs = null;
  for (let index = 0; index < rawArgs.length; index += 1) {
    const argument = rawArgs[index];
    if (argument === '--jobs') {
      if (index + 1 >= rawArgs.length) throw new Error('Provide a worker count after --jobs.');
      requestedJobs = rawArgs[++index];
    } else if (argument.startsWith('--jobs=')) {
      requestedJobs = argument.slice('--jobs='.length);
    } else {
      args.push(argument);
    }
  }
  if (requestedJobs !== null && requestedJobs !== 'auto') {
    const value = Number(requestedJobs);
    if (!Number.isInteger(value) || value < 1) {
      throw new Error('Worker count must be "auto" or a whole number of at least 1.');
    }
    requestedJobs = value;
  }
  return { args, requestedJobs };
}

function automaticWorkerCount(totalGames) {
  const available = typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : os.cpus().length;
  return Math.min(totalGames, Math.max(1, Math.min(8, available - 1)));
}

async function main() {
  const parsed = parseArguments(process.argv.slice(2));
  const args = parsed.args;
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

  const requestedGameCount = Math.max(
    1,
    Number(count) || (versionedBots ? 100 : (versionedRoswell ? 10 : 2))
  );
  const seeds = versionedBots
    ? undefined
    : Array.from({ length: requestedGameCount }, (_, index) => 1001 + index);
  const totalGames = versionedBots
    ? requestedGameCount
    : requestedGameCount * (versionedRoswell ? 2 : 8);
  const workerCount = parsed.requestedJobs === null || parsed.requestedJobs === 'auto'
    ? automaticWorkerCount(totalGames)
    : Math.min(parsed.requestedJobs, totalGames);
  const tournamentStartedAt = new Date();
  const writer = createTournamentLogWriter({
    gameLogDir: path.join(__dirname, '..', 'game-logs'),
    startedAt: tournamentStartedAt,
    gameVersion: packageInfo.version
  });
  const progress = createTournamentProgress({ totalGames, workerCount });
  const tournamentLabel = versionedBots
    ? requestedCompetitors.join(' vs ')
    : (versionedRoswell
      ? (requestedVersions.length ? requestedVersions.join(' vs ') : 'latest Roswell versions')
      : 'standard bot benchmark');
  progress.start(tournamentLabel);

  const tournamentOptions = {
    seeds,
    gamesPerSeat: requestedGameCount,
    totalGames: versionedBots ? requestedGameCount : undefined,
    competitors: versionedBots ? requestedCompetitors : undefined,
    gameVersion: packageInfo.version,
    versions: requestedVersions.length ? requestedVersions : undefined,
    capturePostGameLog: true,
    tournamentStartedAt,
    jobs: workerCount,
    tournamentRunner: runTournamentInWorkers,
    onGameComplete(game, gameNumber, lineup) {
      writer.writeGame(game, gameNumber, lineup);
      progress.gameComplete(lineup);
    }
  };
  const result = versionedBots
    ? await runVersionedBotTournament(tournamentOptions)
    : (versionedRoswell
      ? await runVersionedRoswellTournament(tournamentOptions)
      : await runTournamentInWorkers(tournamentOptions));
  const report = {
    gameVersion: packageInfo.version,
    tournamentType: result.comparison
      ? result.comparison.policies.join('-vs-')
      : 'standard',
    requestedGames: versionedBots ? requestedGameCount : undefined,
    gamesPerLineup: versionedBots ? undefined : requestedGameCount,
    workerCount,
    totalGames: result.games.length,
    truncatedGames: result.games.filter((game) => game.truncated).length,
    tournamentLogDirectory: writer.directory,
    summary: result.summary,
    comparison: result.comparison || null
  };
  writer.writeSummary(report);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

main().catch((error) => {
  process.stderr.write((error && error.stack ? error.stack : String(error)) + '\n');
  process.exitCode = 1;
});
