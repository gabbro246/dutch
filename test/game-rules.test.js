const test = require('node:test');
const assert = require('node:assert/strict');
const { applyRoundScoring, startingPlayerIndexForNextRound } = require('../lib/game-rules.js');

function card(rank, suit = 'clubs') {
  return { rank, suit };
}

function player(id, cards, total = 0, extra = {}) {
  return {
    id,
    name: id.toUpperCase(),
    cards,
    total,
    roundPoints: null,
    ...extra
  };
}

test('Dutch caller scores zero only when nobody has fewer points', () => {
  const players = [
    player('ada', [card('2'), card('3')]),
    player('ben', [card('5'), card('K', 'hearts')])
  ];

  const scoring = applyRoundScoring(players, { callerId: 'ada', gameTarget: 100 });

  assert.equal(players[0].roundPoints, 0);
  assert.equal(players[0].total, 0);
  assert.equal(players[1].roundPoints, 5);
  assert.deepEqual(scoring.roundWinnerIds, ['ada']);
});

test('Dutch caller is doubled when another player has fewer points', () => {
  const players = [
    player('ada', [card('2'), card('3')]),
    player('ben', [card('4'), card('K', 'hearts')])
  ];

  applyRoundScoring(players, { callerId: 'ada', gameTarget: 100 });

  assert.equal(players[0].roundPoints, 10);
  assert.equal(players[0].total, 10);
  assert.equal(players[1].roundPoints, 4);
});

test('exact 50, 100, and 200 totals are halved after scoring', () => {
  const players = [
    player('ada', [card('2')], 48),
    player('ben', [card('K', 'spades')], 87),
    player('cy', [card('5')], 195)
  ];

  const scoring = applyRoundScoring(players, { gameTarget: 200 });

  assert.equal(players[0].total, 25);
  assert.equal(players[1].total, 50);
  assert.equal(players[2].total, 100);
  assert.deepEqual(scoring.halvings.map((item) => item.id), ['ada', 'ben', 'cy']);
  assert.deepEqual(scoring.pointChanges, ['ADA lost 23 points', 'BEN lost 37 points', 'CY lost 95 points']);
});

test('game ends once a player passes the target and lowest total wins', () => {
  const players = [
    player('ada', [card('10')], 96),
    player('ben', [card('2')], 70),
    player('cy', [card('K', 'spades')], 75)
  ];

  const scoring = applyRoundScoring(players, { gameTarget: 100 });

  assert.equal(scoring.gameEnded, true);
  assert.equal(scoring.winnerId, 'ben');
  assert.equal(scoring.winnerName, 'BEN');
});

test('single-round scoring ends after one round and lowest total wins', () => {
  const players = [
    player('ada', [card('9')]),
    player('ben', [card('3')]),
    player('cy', [card('5')])
  ];

  const scoring = applyRoundScoring(players, { gameTarget: 100, singleRound: true });

  assert.equal(scoring.gameEnded, true);
  assert.equal(scoring.winnerId, 'ben');
  assert.equal(scoring.winnerName, 'BEN');
});

test('five-round scoring ends on the fifth round and ignores point targets', () => {
  const earlyPlayers = [
    player('ada', [card('10')], 196),
    player('ben', [card('2')], 70)
  ];

  const early = applyRoundScoring(earlyPlayers, { gameTarget: 100, roundLimit: 5, roundNumber: 4 });
  assert.equal(early.gameEnded, false);
  assert.equal(early.winnerId, null);

  const finalPlayers = [
    player('ada', [card('9')], 20),
    player('ben', [card('3')], 15)
  ];
  const final = applyRoundScoring(finalPlayers, { gameTarget: 100, roundLimit: 5, roundNumber: 5 });
  assert.equal(final.gameEnded, true);
  assert.equal(final.winnerId, 'ben');
});

test('highest previous round score starts the next round', () => {
  const players = [
    player('ada', [], 0, { roundPoints: 7 }),
    player('ben', [], 0, { roundPoints: 11, isSpectator: true }),
    player('cy', [], 0, { roundPoints: 9 }),
    player('dee', [], 0, { roundPoints: 12, left: true })
  ];

  assert.equal(startingPlayerIndexForNextRound(players, 0), 0);
  assert.equal(startingPlayerIndexForNextRound(players, 3), 2);
});
