const path = require('node:path');
const { Worker } = require('node:worker_threads');
const {
  createTournamentJobs,
  runTournament,
  summarizeTournamentGames
} = require('./bot-simulation.js');

function normalizedJobCount(value, totalGames) {
  const requested = Number(value);
  if (!Number.isInteger(requested) || requested < 1) {
    throw new Error('Tournament worker count must be a whole number of at least 1.');
  }
  return Math.min(requested, totalGames);
}

function runTournamentInWorkers(options = {}) {
  const jobs = createTournamentJobs(options);
  const workerCount = normalizedJobCount(options.jobs || 1, jobs.length);
  if (workerCount === 1) return Promise.resolve(runTournament(options));

  const games = new Array(jobs.length);
  const workers = [];
  let nextJobIndex = 0;
  let completed = 0;
  let settled = false;

  return new Promise((resolve, reject) => {
    function stopWorkers() {
      for (const worker of workers) worker.terminate();
    }

    function fail(error) {
      if (settled) return;
      settled = true;
      stopWorkers();
      reject(error);
    }

    function assign(worker) {
      if (nextJobIndex >= jobs.length) return;
      const jobIndex = nextJobIndex++;
      const { simulationOptions } = jobs[jobIndex];
      const serializableOptions = { ...simulationOptions };
      delete serializableOptions.onGameComplete;
      delete serializableOptions.jobs;
      delete serializableOptions.tournamentRunner;
      worker.postMessage({ jobIndex, simulationOptions: serializableOptions });
    }

    function completedJob(worker, message) {
      if (settled) return;
      if (message.error) {
        const error = new Error(message.error.message);
        if (message.error.stack) error.stack = message.error.stack;
        fail(error);
        return;
      }
      const job = jobs[message.jobIndex];
      const result = message.result;
      try {
        if (typeof options.onGameComplete === 'function') {
          options.onGameComplete(result, job.gameNumber, job.lineup.slice());
          delete result.postGameLog;
        }
      } catch (error) {
        fail(error);
        return;
      }
      games[message.jobIndex] = result;
      completed += 1;
      if (completed === jobs.length) {
        settled = true;
        stopWorkers();
        resolve(summarizeTournamentGames(games));
        return;
      }
      assign(worker);
    }

    const workerPath = path.join(__dirname, 'bot-tournament-worker.js');
    for (let index = 0; index < workerCount; index += 1) {
      const worker = new Worker(workerPath);
      workers.push(worker);
      worker.on('message', (message) => completedJob(worker, message));
      worker.on('error', fail);
      worker.on('exit', (code) => {
        if (!settled && code !== 0) fail(new Error('Tournament worker stopped with exit code ' + code + '.'));
      });
      assign(worker);
    }
  });
}

module.exports = { normalizedJobCount, runTournamentInWorkers };
