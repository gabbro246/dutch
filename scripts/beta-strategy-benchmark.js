#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { runVersionedBotTournament, runTournament } = require('../lib/bot-simulation.js');
const { createTournamentLogWriter } = require('../lib/bot-tournament-log.js');
const { createDeterministicRandom } = require('../lib/deterministic-rng.js');
const packageInfo = require('../package.json');

const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf('--' + name);
  return index < 0 ? fallback : args[index + 1];
}
const games = Number(option('games', 200));
const seedStart = Number(option('seed', 50001));
const suite = option('suite', 'all');
const caseFilter = option('case', null);
const roundLimit = Number(option('rounds', 0));
const maxRounds = Number(option('max-rounds', 250));
const maxTurnsPerRound = Number(option('max-turns', 300));
if (!Number.isInteger(games) || games < 4 || games % 4) throw new Error('--games must be a positive multiple of four.');
if (!Number.isSafeInteger(seedStart)) throw new Error('--seed must be an integer.');
if (![0, 1, 5].includes(roundLimit)) throw new Error('--rounds must be 1 or 5; omit it for a points game.');
if (![maxRounds, maxTurnsPerRound].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Round and turn limits must be positive integers.');
if (!['all', 'core', 'characters', 'older', 'field'].includes(suite)) throw new Error('Unknown --suite.');
const directory = path.resolve(option('output', path.join(__dirname, '..', 'game-logs', 'beta-strategy-' + Date.now())));
fs.mkdirSync(directory, { recursive: true });
const sources = fs.readdirSync(path.join(__dirname, '..', 'lib')).filter(name => name.endsWith('.js') || name === 'bot-hand-values.json').map(name => 'lib/' + name).concat(['public/shared.js', 'scripts/beta-strategy-benchmark.js', 'scripts/build-beta-hand-values.js', 'package.json']).sort();
const sourceHashes = Object.fromEntries(sources.map(name => [name, crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', name))).digest('hex')]));
const cases = [];
if (suite === 'all' || suite === 'core') {
  cases.push(['original-beta', 'roswell-beta@1.3.82', 'roswell-beta@1.3.79'], ['beta-1.3.80', 'roswell-beta@1.3.82', 'roswell-beta@1.3.80'], ['previous-beta', 'roswell-beta@1.3.82', 'roswell-beta@1.3.81'], ['legacy-1.3.67', 'roswell-beta@1.3.82', 'roswell@1.3.67']);
}
if (suite === 'all' || suite === 'characters') {
  for (const name of ['athena', 'norman', 'dory']) cases.push([name, name + '-beta@1.3.82', name + '-beta@1.3.79']);
}
if (suite === 'all' || suite === 'older') {
  for (const version of ['1.3.74', '1.3.75']) cases.push(['beta-' + version, 'roswell-beta@1.3.82', 'roswell-beta@' + version]);
  cases.push(['legacy-1.3.68', 'roswell-beta@1.3.82', 'roswell@1.3.68']);
}
if (suite === 'all' || suite === 'field') {
  cases.push(['four-player-new', 'roswell-beta@1.3.82', null], ['four-player-old', 'roswell-beta@1.3.79', null]);
}
if (caseFilter && !cases.some(([name]) => name === caseFilter)) throw new Error('The requested --case is not in this suite.');

function interval(results, candidate) {
  if (!results.length) return null;
  const clusters = new Map();
  for (const game of results) {
    const record = clusters.get(game.seed) || [];
    record.push(game.winnerPolicy === candidate ? 1 : 0);
    clusters.set(game.seed, record);
  }
  const samples = Array.from(clusters.values(), record => record.reduce((sum, win) => sum + win, 0) / record.length);
  const rng = createDeterministicRandom(271828);
  const bootstrap = Array.from({ length: 3000 }, () => samples.reduce(sum => sum + samples[Math.floor(rng() * samples.length)], 0) / samples.length).sort((a, b) => a - b);
  return [bootstrap[Math.floor(bootstrap.length * 0.025)], bootstrap[Math.floor(bootstrap.length * 0.975)]];
}

const report = { gameVersion: packageInfo.version, startedAt: new Date().toISOString(), suite, caseFilter, gamesPerCase: games, seedStart, roundLimit, gameTarget: 100, maxRounds, maxTurnsPerRound, sourceHashes, cases: [] };
for (const [name, candidate, opponent] of cases.filter(([name]) => !caseFilter || name === caseFilter)) {
  const caseDirectory = path.join(directory, name);
  fs.mkdirSync(caseDirectory, { recursive: true });
  const writer = createTournamentLogWriter({ gameLogDir: caseDirectory, gameVersion: packageInfo.version, startedAt: new Date() });
  const seeds = Array.from({ length: games / (opponent ? 2 : 4) }, (_, index) => seedStart + index);
  const opts = {
    seeds, gameVersion: packageInfo.version, maxRounds, maxTurnsPerRound, roundLimit,
    capturePostGameLog: true,
    onGameComplete(game, number, lineup) {
      writer.writeGame(game, number, lineup);
      if (number % 20 === 0) process.stdout.write(`${name}: ${number}/${games} games\n`);
    }
  };
  let result;
  if (opponent) result = runVersionedBotTournament({ ...opts, competitors: [candidate, opponent] });
  else {
    const lineup = [candidate, 'athena-beta@1.3.79', 'norman-beta@1.3.79', 'dory-beta@1.3.79'];
    const lineups = lineup.map((_, seat) => lineup.slice(seat).concat(lineup.slice(0, seat)));
    result = runTournament({ ...opts, lineups });
  }
  const tiedGames = result.games.filter(game => {
    const lowest = Math.min(...game.players.map(player => player.total));
    return game.players.filter(player => player.total === lowest).length > 1;
  }).length;
  const excludedSeeds = new Set(result.games.filter(game => game.truncated || Object.values(game.metrics).some(metric => metric.forcedRoundEndings)).map(game => game.seed));
  const completePairs = result.games.filter(game => !excludedSeeds.has(game.seed));
  const completeWins = completePairs.filter(game => game.winnerPolicy === candidate).length;
  const entry = {
    name, candidate, opponent, games: result.games.length,
    truncatedGames: result.games.filter(game => game.truncated).length,
    forcedEndingGames: result.games.filter(game => Object.values(game.metrics).some(metric => metric.forcedRoundEndings)).length,
    tiedGames, candidateWinInterval95: interval(result.games, candidate),
    completePairs: { games: completePairs.length, wins: completeWins, winRate: completePairs.length ? completeWins / completePairs.length : null, interval95: interval(completePairs, candidate), excludedSeeds: Array.from(excludedSeeds) },
    summary: result.summary, comparison: result.comparison || null,
    gameResults: result.games.map(game => ({ seed: game.seed, winnerPolicy: game.winnerPolicy, truncated: game.truncated, forcedRoundEndings: Object.values(game.metrics).reduce((sum, entry) => sum + entry.forcedRoundEndings, 0), players: game.players, metrics: game.metrics })),
    replayDirectory: writer.directory
  };
  writer.writeSummary(entry);
  report.cases.push(entry);
  fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(`${name}: ${(entry.summary[candidate].gameWinRate * 100).toFixed(1)}% wins; ${entry.truncatedGames} truncated; ${entry.forcedEndingGames} forced\n`);
}
report.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify(report, null, 2) + '\n');
process.stdout.write(`Results saved to ${directory}\n`);
