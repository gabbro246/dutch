function normalizeSeed(seed) {
  const value = Number(seed);
  return Number.isFinite(value) ? value >>> 0 : 0;
}

function createDeterministicRandom(seed) {
  const initialSeed = normalizeSeed(seed);
  let value = initialSeed;
  let drawCount = 0;

  function random() {
    value = (value + 0x6D2B79F5) >>> 0;
    let next = value;
    next = Math.imul(next ^ next >>> 15, next | 1);
    next ^= next + Math.imul(next ^ next >>> 7, next | 61);
    drawCount += 1;
    return ((next ^ next >>> 14) >>> 0) / 4294967296;
  }

  random.snapshot = () => ({ seed: initialSeed, state: value, drawCount });
  random.restore = (snapshot = {}) => {
    value = normalizeSeed(snapshot.state ?? initialSeed);
    drawCount = Math.max(0, Number(snapshot.drawCount) || 0);
  };

  return random;
}

module.exports = { createDeterministicRandom, normalizeSeed };
