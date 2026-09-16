const { parentPort } = require('node:worker_threads');
const { simulateGame } = require('./bot-simulation.js');

parentPort.on('message', ({ jobIndex, simulationOptions }) => {
  try {
    parentPort.postMessage({
      jobIndex,
      result: simulateGame(simulationOptions)
    });
  } catch (error) {
    parentPort.postMessage({
      jobIndex,
      error: {
        message: error && error.message ? error.message : String(error),
        stack: error && error.stack ? error.stack : null
      }
    });
  }
});
