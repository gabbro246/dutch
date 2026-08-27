const { createOptimalDecisionLayer } = require('./bot-optimal.js');
const { createSimpleDecisionLayer } = require('./bot-simple-decisions.js');
const { createSimpleDecisionLayer: createSimpleDecisionLayerV1374 } = require('./bot-simple-decisions-1.3.74.js');
const { createSimpleDecisionLayer: createSimpleDecisionLayerV1375 } = require('./bot-simple-decisions-1.3.75.js');
const { isSimpleBot } = require('./bot-strategy.js');

const SIMPLE_DECISION_SNAPSHOTS = new Map([
  ['1.3.74', createSimpleDecisionLayerV1374],
  ['1.3.75', createSimpleDecisionLayerV1375]
]);

function createBotDecisions(deps) {
  const legacy = createOptimalDecisionLayer(deps);
  const simpleFactory = SIMPLE_DECISION_SNAPSHOTS.get(deps.simpleStrategyRelease) || createSimpleDecisionLayer;
  const simple = simpleFactory(deps);
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
