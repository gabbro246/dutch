const { createOptimalDecisionLayer } = require('./bot-optimal.js');
const { createSimpleDecisionLayer } = require('./bot-simple-decisions.js');
const { createSimpleDecisionLayer: createSimpleDecisionLayerV1374 } = require('./bot-simple-decisions-1.3.74.js');
const { createSimpleDecisionLayer: createSimpleDecisionLayerV1375 } = require('./bot-simple-decisions-1.3.75.js');
const { createSimpleDecisionLayer: createSimpleDecisionLayerV1379 } = require('./bot-simple-decisions-1.3.79.js');
const { createSimpleDecisionLayer: createSimpleDecisionLayerV1380 } = require('./bot-simple-decisions-1.3.80.js');
const { createSimpleDecisionLayer: createSimpleDecisionLayerV1381 } = require('./bot-simple-decisions-1.3.81.js');
const { isSimpleBot } = require('./bot-strategy.js');

// Beta 1.3.81 is the default live strategy; newer snapshots remain available
// for version tournaments.
const DEFAULT_SIMPLE_STRATEGY_RELEASE = '1.3.81';

const SIMPLE_DECISION_SNAPSHOTS = new Map([
  ['1.3.74', createSimpleDecisionLayerV1374],
  ['1.3.75', createSimpleDecisionLayerV1375],
  // These labels previously shared the then-current 1.3.79 implementation.
  // Preserve that baseline instead of silently moving them to a new strategy.
  ['1.3.77', createSimpleDecisionLayerV1379],
  ['1.3.78', createSimpleDecisionLayerV1379],
  ['1.3.79', createSimpleDecisionLayerV1379],
  ['1.3.80', createSimpleDecisionLayerV1380],
  ['1.3.81', createSimpleDecisionLayerV1381]
]);

function createBotDecisions(deps) {
  const legacy = createOptimalDecisionLayer(deps);
  const simpleStrategyRelease = deps.simpleStrategyRelease || DEFAULT_SIMPLE_STRATEGY_RELEASE;
  const simpleFactory = SIMPLE_DECISION_SNAPSHOTS.get(simpleStrategyRelease) || createSimpleDecisionLayer;
  const simple = simpleFactory(deps);
  // Preserve 1.3.80's historical single-round fallback only in that snapshot.
  // Current Beta uses the same policy across all game lengths.
  const singleRoundSimple = simpleStrategyRelease === '1.3.80' ? createSimpleDecisionLayerV1379(deps) : simple;
  const decisions = {};
  const methodNames = new Set([...Object.keys(legacy), ...Object.keys(simple)]);

  for (const name of methodNames) {
    if (typeof legacy[name] !== 'function' && typeof simple[name] !== 'function') continue;
    decisions[name] = (...args) => {
      const useSimple = isSimpleBot(args[0]);
      const layer = useSimple ? (deps.getState().roundLimit === 1 ? singleRoundSimple : simple) : legacy;
      const method = layer[name] || (useSimple && simple[name]) || legacy[name];
      return method(...args);
    };
  }

  return decisions;
}

module.exports = { createBotDecisions, DEFAULT_SIMPLE_STRATEGY_RELEASE };
