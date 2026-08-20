const test = require('node:test');
const assert = require('node:assert/strict');
const { BOT_TIMING_PERCENTAGES, normalizeBotTimingPercent, scaledBotDelay, scaledBotDelayRange } = require('../lib/bot-timing.js');

test('bot timing accepts only the five shared percentage choices', () => {
  assert.deepEqual(BOT_TIMING_PERCENTAGES, [0, 25, 50, 75, 100]);
  assert.equal(normalizeBotTimingPercent('25'), 25);
  assert.equal(normalizeBotTimingPercent(75), 75);
  assert.equal(normalizeBotTimingPercent(10), 50);
  assert.equal(normalizeBotTimingPercent(undefined), 50);
});

test('scaled delays cover 0%, 25%, 50%, 75%, and 100%', () => {
  const state = {};
  const expected = new Map([[0, 0], [25, 250], [50, 500], [75, 750], [100, 1000]]);
  for (const [percent, delay] of expected) {
    state.botTimingPercent = percent;
    assert.equal(scaledBotDelay(state, 1000), delay);
  }
  assert.equal(scaledBotDelay({ botTimingPercent: 0 }, 1000, 130), 130);
});

test('scaled random ranges use the currently selected percentage', () => {
  const calls = [];
  const randomBetween = (min, max) => {
    calls.push([min, max]);
    return max;
  };
  const state = { botTimingPercent: 50 };
  assert.equal(scaledBotDelayRange(state, randomBetween, 650, 1700), 850);
  assert.deepEqual(calls.at(-1), [325, 850]);
  state.botTimingPercent = 0;
  assert.equal(scaledBotDelayRange(state, randomBetween, 650, 1700), 0);
  assert.deepEqual(calls.at(-1), [0, 0]);
});
