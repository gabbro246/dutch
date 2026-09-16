const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createTournamentProgress,
  formatDuration
} = require('../lib/bot-tournament-progress.js');

test('tournament progress reports workers, completion, speed, ETA, and seat order', () => {
  let output = '';
  const times = [0, 1000, 3000];
  const stream = {
    isTTY: false,
    write(value) {
      output += value;
    }
  };
  const progress = createTournamentProgress({
    totalGames: 2,
    workerCount: 2,
    stream,
    now: () => times.shift()
  });

  progress.start('candidate vs baseline');
  progress.gameComplete(['candidate', 'baseline']);
  progress.gameComplete(['baseline', 'candidate']);

  assert.match(output, /Tournament: candidate vs baseline · 2 games · 2 workers/);
  assert.match(output, /Games: 1\/2 \(50%\).*ETA 1s.*finished: candidate vs baseline/);
  assert.match(output, /Games: 2\/2 \(100%\).*ETA 0s.*finished: baseline vs candidate/);
});

test('progress durations stay compact for long tournaments', () => {
  assert.equal(formatDuration(8), '8s');
  assert.equal(formatDuration(68), '1m 8s');
  assert.equal(formatDuration(7384), '2h 3m');
});
