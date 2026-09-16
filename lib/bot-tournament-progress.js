function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours) return hours + 'h ' + minutes + 'm';
  if (minutes) return minutes + 'm ' + remainder + 's';
  return remainder + 's';
}

function createTournamentProgress(options) {
  const totalGames = options.totalGames;
  const workerCount = options.workerCount;
  const stream = options.stream || process.stderr;
  const now = options.now || Date.now;
  const startedAt = now();
  const reportEvery = Math.max(1, Math.ceil(totalGames / 20));
  let completed = 0;

  function start(label) {
    stream.write(
      'Tournament: ' + label + ' · ' + totalGames + ' games · ' +
      workerCount + (workerCount === 1 ? ' worker' : ' workers') + '\n'
    );
  }

  function gameComplete(lineup) {
    completed += 1;
    const shouldReport = stream.isTTY ||
      completed === 1 ||
      completed === totalGames ||
      completed % reportEvery === 0;
    if (!shouldReport) return;

    const elapsedSeconds = Math.max(0.001, (now() - startedAt) / 1000);
    const gamesPerSecond = completed / elapsedSeconds;
    const etaSeconds = (totalGames - completed) / gamesPerSecond;
    const percent = Math.round(completed / totalGames * 100);
    const seatOrder = (lineup || []).join(' vs ');
    const line =
      'Games: ' + completed + '/' + totalGames + ' (' + percent + '%)' +
      ' · elapsed ' + formatDuration(elapsedSeconds) +
      ' · ' + gamesPerSecond.toFixed(2) + ' games/s' +
      ' · ETA ' + formatDuration(etaSeconds) +
      (seatOrder ? ' · finished: ' + seatOrder : '');
    stream.write((stream.isTTY ? '\r\x1b[K' : '') + line + (stream.isTTY && completed < totalGames ? '' : '\n'));
  }

  return { gameComplete, start };
}

module.exports = { createTournamentProgress, formatDuration };
