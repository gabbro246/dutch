const BOT_TIMING_PERCENTAGES = Object.freeze([0, 25, 50, 75, 100]);

function normalizeBotTimingPercent(value, fallback = 50) {
  const percent = Number(value);
  return BOT_TIMING_PERCENTAGES.includes(percent) ? percent : fallback;
}

function botTimingScale(state) {
  return normalizeBotTimingPercent(state && state.botTimingPercent) / 100;
}

function scaledBotDelay(state, originalMs, minimumMs = 0) {
  return Math.max(minimumMs, Math.round((Number(originalMs) || 0) * botTimingScale(state)));
}

function scaledBotDelayRange(state, randomBetween, originalMin, originalMax) {
  const scale = botTimingScale(state);
  return randomBetween(
    Math.round(originalMin * scale),
    Math.round(originalMax * scale)
  );
}

module.exports = {
  BOT_TIMING_PERCENTAGES,
  normalizeBotTimingPercent,
  botTimingScale,
  scaledBotDelay,
  scaledBotDelayRange
};
