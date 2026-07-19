const { botProfile } = require('./bot-strategy.js');

function strategyLimits(bot, decisive = false) {
  const profile = botProfile(bot);
  return {
    depth: decisive ? (profile.searchDepth || 1) : Math.max(1, (profile.searchDepth || 1) - 1),
    samples: decisive ? (profile.decisiveSamples || profile.monteCarloSamples || 64) : (profile.monteCarloSamples || 64),
    operationBudget: profile.operationBudget || 5000
  };
}

function chooseCharacterAction(bot, actions, random = Math.random) {
  const ranked = (actions || []).filter(Boolean).slice().sort((a, b) => b.actionValue - a.actionValue);
  if (ranked.length < 2) return ranked[0] || null;
  const profile = botProfile(bot);
  if (bot && bot.botType === 'roswell') return ranked[0];
  const window = Math.max(0, profile.equivalentWindow || 0);
  const near = ranked.filter((action) => ranked[0].actionValue - action.actionValue <= window);
  if (near.length < 2 || (profile.selectionTemperature || 0) <= 0) return ranked[0];
  const temperature = Math.max(0.01, profile.selectionTemperature);
  const weights = near.map((action) => Math.exp((action.actionValue - ranked[0].actionValue) / temperature));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = random() * total;
  for (let index = 0; index < near.length; index += 1) {
    roll -= weights[index];
    if (roll <= 0) return near[index];
  }
  return near[0];
}

module.exports = { strategyLimits, chooseCharacterAction };
