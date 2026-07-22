const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { runTournament } = require('../lib/bot-simulation.js');
const { createTournamentLogWriter } = require('../lib/bot-tournament-log.js');
const { replayArchiveFromFinishedLog } = require('../lib/bot-replay.js');

test('tournaments stream every captured game into one timestamped log subfolder', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dutch-tournament-logs-'));
  const startedAt = new Date('2026-07-22T12:34:56.000Z');
  const writer = createTournamentLogWriter({ gameLogDir: root, startedAt });
  const captured = [];
  const result = runTournament({
    seeds: [41],
    lineups: [['roswell', 'always-draw']],
    gameTarget: 50,
    maxRounds: 1,
    maxTurnsPerRound: 12,
    capturePostGameLog: true,
    tournamentStartedAt: startedAt,
    onGameComplete(game, gameNumber, lineup) {
      captured.push({ gameNumber, lineup, hasLog: !!game.postGameLog });
      writer.writeGame(game, gameNumber, lineup);
    }
  });
  const report = {
    totalGames: result.games.length,
    truncatedGames: result.games.filter((game) => game.truncated).length,
    summary: result.summary
  };
  const summaryPath = writer.writeSummary(report);

  assert.match(path.basename(writer.directory), /^tournament-2026-07-22_\d{2}-34-56/);
  assert.deepEqual(captured, [{
    gameNumber: 1,
    lineup: ['roswell', 'always-draw'],
    hasLog: true
  }]);
  assert.equal(Object.hasOwn(result.games[0], 'postGameLog'), false);
  assert.equal(writer.files.length, 1);
  assert.match(writer.files[0], /^game-001-seed-41-roswell-vs-always-draw\.txt\.gz$/);

  const compressed = fs.readFileSync(path.join(writer.directory, writer.files[0]));
  const logText = zlib.gunzipSync(compressed).toString('utf8');
  const archive = replayArchiveFromFinishedLog(logText);
  assert.match(logText, /Game log:/);
  assert.match(logText, /Bot strategy diagnostics:/);
  assert.ok(archive);
  assert.equal(archive.gameSeed, 41);
  assert.equal(archive.rounds.length, 1);
  assert.ok(archive.decisions.length > 0);

  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  assert.equal(summary.gameLogCompression, 'gzip');
  assert.deepEqual(summary.gameLogs, writer.files);
  assert.equal(summary.totalGames, 1);
});
