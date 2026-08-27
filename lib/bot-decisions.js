const { createOptimalDecisionLayer } = require('./bot-optimal.js');
const { createSimpleDecisionLayer } = require('./bot-simple-decisions.js');
const { createSimpleDecisionLayer: createSimpleDecisionLayerV1374 } = require('./bot-simple-decisions-1.3.74.js');
const { isSimpleBot } = require('./bot-strategy.js');

function createBotDecisions(deps) {
  const legacy = createOptimalDecisionLayer(deps);
  const simple = deps.simpleStrategyRelease === '1.3.74'
    ? createSimpleDecisionLayerV1374(deps)
    : createSimpleDecisionLayer(deps);
  const decisions = {};
  const methodNames = new Set([...Object.keys(legacy), ...Object.keys(simple)]);

  for (const name of methodNames) {
    if (typeof legacy[name] !== 'function' && typeof simple[name] !== 'function') continue;
    decisions[name] = (...args) => {
      const layer = isSimpleBot(args[0]) ? simple : legacy;
      const method = layer[name] || legacy[name];
      return method(...args);
    };
  }

  return decisions;
}

module.exports = { createBotDecisions };
