const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { logTimestamp } = require('../public/shared.js');
const { finishedGameLogText } = require('./game-log.js');

function safeName(value) {
  return String(value || 'game')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'game';
}

function createUniqueTournamentDirectory(gameLogDir, startedAt = new Date()) {
  const base = 'tournament-' + logTimestamp(startedAt);
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const name = suffix ? base + '-' + (suffix + 1) : base;
    const directory = path.join(gameLogDir, name);
    try {
      fs.mkdirSync(directory, { recursive: false });
      return directory;
    } catch (error) {
      if (error.code === 'ENOENT') {
        fs.mkdirSync(gameLogDir, { recursive: true });
        suffix -= 1;
        continue;
      }
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('Could not create a unique tournament log directory.');
}

function createTournamentLogWriter(options = {}) {
  const startedAt = options.startedAt || new Date();
  const directory = createUniqueTournamentDirectory(options.gameLogDir, startedAt);
  const files = [];

  function writeGame(result, gameNumber, lineup) {
    if (!result || !result.postGameLog) throw new Error('Tournament game is missing its post-game log state.');
    const lineupName = (lineup || result.players.map((player) => player.policy)).map(safeName).join('-vs-');
    const filename = 'game-' + String(gameNumber).padStart(3, '0') +
      '-seed-' + result.seed + '-' + lineupName + '.txt.gz';
    const filePath = path.join(directory, filename);
    fs.writeFileSync(filePath, zlib.gzipSync(finishedGameLogText(result.postGameLog)));
    files.push(filename);
    return filePath;
  }

  function writeSummary(summary) {
    const content = {
      savedAt: new Date().toISOString(),
      tournamentStartedAt: startedAt.toISOString(),
      logDirectory: directory,
      gameLogCompression: 'gzip',
      gameLogs: files.slice(),
      ...summary
    };
    const filePath = path.join(directory, 'tournament-summary.json');
    fs.writeFileSync(filePath, JSON.stringify(content, null, 2) + '\n', 'utf8');
    return filePath;
  }

  return { directory, files, writeGame, writeSummary };
}

module.exports = {
  safeName,
  createUniqueTournamentDirectory,
  createTournamentLogWriter
};
