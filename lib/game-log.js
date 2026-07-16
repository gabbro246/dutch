const fs = require('fs');
const path = require('path');
const {
  logTimestamp,
  logEntryTimeMs,
  logRelativeBaseMs,
  formatRelativeLogTime,
  scoreHistoryRows
} = require('../public/shared.js');

function gameLogStartDate(gameStartedAt, fallbackDate = new Date()) {
  if (!gameStartedAt) return fallbackDate;
  const startedAt = new Date(gameStartedAt);
  return Number.isNaN(startedAt.getTime()) ? fallbackDate : startedAt;
}

function gameLogLineText(entry, index, baseMs) {
  const line = typeof entry === 'string' ? { text: entry, kind: 'game' } : entry;
  const moveNumber = index + 1;
  const kind = line.kind && line.kind !== 'game' ? ' [' + line.kind + ']' : '';
  return formatRelativeLogTime(logEntryTimeMs(line), baseMs) + ' ' + moveNumber + '.' + kind + ' ' + String(line.text || '');
}

function finishedGameLogText(options = {}) {
  const savedAt = options.savedAt || new Date();
  const startedTimestamp = logTimestamp(gameLogStartDate(options.gameStartedAt, savedAt));
  const exportedTimestamp = logTimestamp(savedAt);
  const lines = options.log || [];
  const relativeBaseMs = logRelativeBaseMs(lines);
  const orderedLines = lines.slice().reverse();
  return [
    'Dutch game log ' + startedTimestamp,
    'Exported: ' + exportedTimestamp,
    'Winner: ' + (options.winnerName || 'No one'),
    'Target: ' + options.gameTarget,
    'Rounds: ' + options.roundNumber,
    '',
    'Points table:',
    ...scoreHistoryRows(options.scoreHistory || []),
    '',
    'Game log:',
    ...orderedLines.map((entry, index) => gameLogLineText(entry, index, relativeBaseMs))
  ].join('\n') + '\n';
}

function finishedGameLogFilename(gameStartedAt, savedAt = new Date()) {
  return 'dutch-game-log-' + logTimestamp(gameLogStartDate(gameStartedAt, savedAt)) + '.txt';
}

function saveFinishedGameLog(gameLogDir, gameState, winnerName, onError = console.error) {
  const savedAt = new Date();
  const filename = finishedGameLogFilename(gameState.gameStartedAt, savedAt);
  const filePath = path.join(gameLogDir, filename);
  const content = finishedGameLogText({
    savedAt,
    winnerName,
    gameStartedAt: gameState.gameStartedAt,
    gameTarget: gameState.gameTarget,
    roundNumber: gameState.roundNumber,
    scoreHistory: gameState.scoreHistory,
    log: gameState.log
  });
  fs.mkdir(gameLogDir, { recursive: true }, (dirError) => {
    if (dirError) {
      onError('Could not create game log directory:', dirError.message);
      return;
    }
    fs.writeFile(filePath, content, 'utf8', (writeError) => {
      if (writeError) onError('Could not write finished game log:', writeError.message);
    });
  });
  return { filename, filePath, content };
}

module.exports = {
  gameLogStartDate,
  gameLogLineText,
  finishedGameLogText,
  finishedGameLogFilename,
  saveFinishedGameLog
};
