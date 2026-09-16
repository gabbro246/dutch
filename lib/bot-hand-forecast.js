const data = require('./bot-hand-values.json');
const { cardPoints } = require('../public/shared.js');

const forecasts = new WeakMap();
function handForecast(hand) {
  if (forecasts.has(hand)) return forecasts.get(hand);
  const key = hand.map(slot => slot.card ? cardPoints(slot.card) : 14).sort((a, b) => a - b).join(',');
  const values = data.values[key];
  if (!values) return null;
  // Counted pools can differ from the reference deck. Correct the unresolved
  // part conservatively; the immediate action tree uses the actual belief pool.
  const correction = hand.filter(slot => !slot.card).reduce((sum, slot) => sum + slot.expected - 6.5, 0);
  const result = { finalTurn: Math.max(0, values[0] + correction * 0.6), oneTurn: Math.max(0, values[1] + correction * 0.5), twoTurns: Math.max(0, values[2] + correction * 0.35), threeTurns: Math.max(0, values[3] + correction * 0.2) };
  forecasts.set(hand,result);
  return result;
}

module.exports = { handForecast };
