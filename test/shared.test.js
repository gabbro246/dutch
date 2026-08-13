const test = require('node:test');
const assert = require('node:assert/strict');
const shared = require('../public/shared.js');

test('card point values match Dutch rules', () => {
  assert.equal(shared.cardPoints({ rank: 'A', suit: 'spades' }), 1);
  assert.equal(shared.cardPoints({ rank: '10', suit: 'clubs' }), 10);
  assert.equal(shared.cardPoints({ rank: 'J', suit: 'hearts' }), 11);
  assert.equal(shared.cardPoints({ rank: 'Q', suit: 'diamonds' }), 12);
  assert.equal(shared.cardPoints({ rank: 'K', suit: 'hearts' }), 0);
  assert.equal(shared.cardPoints({ rank: 'K', suit: 'diamonds' }), 0);
  assert.equal(shared.cardPoints({ rank: 'K', suit: 'clubs' }), 13);
  assert.equal(shared.cardPoints({ rank: 'K', suit: 'spades' }), 13);
});

test('halving totals include the double-game threshold', () => {
  assert.deepEqual(shared.HALVING_TOTALS, [50, 100, 200]);
  assert.equal(shared.isHalvingTotal(200), true);
  assert.equal(shared.isHalvingTotal(150), false);
});

test('short player names preserve emoji and abbreviate long names', () => {
  assert.equal(shared.shortPlayerName('🦉 Athena'), '🦉');
  assert.equal(shared.shortPlayerName('Gabriel'), 'Gabr.');
  assert.equal(shared.shortPlayerName('Lea'), 'Lea');
  assert.equal(shared.normalizedShortPlayerName('GABRIEL'), 'gabr.');
});

test('relative log timestamps keep the current text format', () => {
  const base = Date.parse('2026-01-01T00:00:00.000Z');
  assert.equal(shared.formatRelativeLogTime(base, base), '+00:00.000');
  assert.equal(shared.formatRelativeLogTime(base + 65_432, base), '+01:05.432');
  assert.equal(shared.formatRelativeLogTime(base + 3_665_001, base), '+1:01:05.001');
  assert.equal(shared.formatRelativeLogTime(null, base), '+--:--.---');
});

test('point colors are a stable shuffled permutation for each game', () => {
  const colors = shared.shuffledPointColorIndices('2026-08-12T12:00:00.000Z', 9);
  assert.deepEqual(colors.slice().sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(shared.shuffledPointColorIndices('2026-08-12T12:00:00.000Z', 9), colors);
  assert.notDeepEqual(
    shared.shuffledPointColorIndices('2026-08-12T12:00:00.001Z', 9),
    colors
  );
});

test('points chart maximum always includes the target and observed scores', () => {
  assert.equal(shared.pointsChartMaximum(42, 50), 50);
  assert.equal(shared.pointsChartMaximum(42, 100), 100);
  assert.equal(shared.pointsChartMaximum(101, 200), 200);
  assert.equal(shared.pointsChartMaximum(137, 200), 200);
  assert.equal(shared.pointsChartMaximum(137, 100), 137);
  assert.equal(shared.pointsChartMaximum(201, 200), 201);
});

test('points chart geometry shares stable ticks and coordinates across renderers', () => {
  const geometry = shared.pointsChartGeometry({ width: 300, height: 180, maxRound: 9, maxTotal: 73, target: 100 });

  assert.deepEqual(geometry.xTicks, [0, 2, 4, 6, 8, 9]);
  assert.equal(geometry.yTicks.length, 6);
  assert.equal(geometry.coordinate(geometry.x(9)), 290);
  assert.equal(geometry.coordinate(geometry.y(geometry.yMax)), 12);
});


test('points chart keeps a 200-point target inside the plot above 100 observed points', () => {
  const geometry = shared.pointsChartGeometry({ width: 300, height: 180, maxRound: 4, maxTotal: 137, target: 200 });

  assert.equal(geometry.yMax, 200);
  assert.equal(geometry.coordinate(geometry.y(200)), geometry.margin.top);
  assert.ok(geometry.y(200) >= geometry.margin.top);
});
test('score history series start at zero and stop when a player leaves', () => {
  const series = shared.scoreHistorySeries([
    { round: 1, players: [{ id: 'ada', name: 'Ada', total: 8 }, { id: 'ben', name: 'Ben', total: 12 }] },
    { round: 2, players: [{ id: 'ada', name: 'Ada', total: 4 }] }
  ], [{ id: 'ada', name: 'Ada' }, { id: 'spectator', name: 'Sam', isSpectator: true }]);

  assert.deepEqual(series, [
    { id: 'ada', name: 'Ada', points: [{ round: 0, total: 0 }, { round: 1, total: 8 }, { round: 2, total: 4 }] },
    { id: 'ben', name: 'Ben', points: [{ round: 0, total: 0 }, { round: 1, total: 12 }] }
  ]);
});

test('score history rows keep markdown table shape', () => {
  const rows = shared.scoreHistoryRows([
    { round: 1, players: [{ name: 'Ada', total: 4 }, { name: 'Ben', total: 7 }] },
    { round: 2, players: [{ name: 'Ada', total: 9 }, { name: 'Ben', total: 8 }] }
  ]);
  assert.deepEqual(rows, [
    'Round | Ada | Ben',
    '--- | --- | ---',
    'Round 1 | 4 | 7',
    'Round 2 | 9 | 8'
  ]);
});
