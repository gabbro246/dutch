const { convolveScoreDistributions } = require('./bot-belief-state.js');

function seedFromText(text) {
  let hash = 2166136261;
  for (const character of String(text)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let next = value;
    next = Math.imul(next ^ next >>> 15, next | 1);
    next ^= next + Math.imul(next ^ next >>> 7, next | 61);
    return ((next ^ next >>> 14) >>> 0) / 4294967296;
  };
}

function entropy(distribution) {
  return (distribution || []).reduce((sum, item) => {
    const probability = item.probability || 0;
    return probability > 0 ? sum - probability * Math.log2(probability) : sum;
  }, 0);
}

function deterministicPointDistribution(points) {
  return [{ value: points, probability: 1 }];
}

function addPointDistributions(base, added) {
  return convolveScoreDistributions(base, added);
}

module.exports = {
  addPointDistributions,
  deterministicPointDistribution,
  entropy,
  seededRandom,
  seedFromText
};
