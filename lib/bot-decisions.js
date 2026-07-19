const { createOptimalDecisionLayer } = require('./bot-optimal.js');

function createBotDecisions(deps) {
  return createOptimalDecisionLayer(deps);
}

module.exports = { createBotDecisions };
