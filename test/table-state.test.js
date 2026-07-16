const test = require('node:test');
const assert = require('node:assert/strict');
const { createTableState } = require('../lib/table-state.js');

function player(id, extra = {}) {
  return {
    id,
    name: id.toUpperCase(),
    total: 0,
    roundPoints: null,
    cards: [],
    left: false,
    isBot: false,
    isSpectator: false,
    ...extra
  };
}

function tableFor(state) {
  return createTableState({ getState: () => state });
}

test('player count helpers distinguish active, playable, human, and bot players', () => {
  const state = {
    players: [
      player('ada'),
      player('bot', { isBot: true }),
      player('spec', { isSpectator: true }),
      player('left', { left: true })
    ],
    round: null
  };
  const table = tableFor(state);

  assert.equal(table.publicPlayerCount(), 4);
  assert.deepEqual(table.activePlayers().map((item) => item.id), ['ada', 'bot', 'spec']);
  assert.equal(table.activePlayerCount(), 3);
  assert.deepEqual(table.activePlayablePlayers().map((item) => item.id), ['ada', 'bot']);
  assert.equal(table.activePlayablePlayerCount(), 2);
  assert.equal(table.activeHumanCount(), 2);
  assert.deepEqual(table.activeBots().map((item) => item.id), ['bot']);
  assert.equal(table.hasPlayableHumanGame(), true);
});

test('current player and active index skip spectators and left players', () => {
  const state = {
    players: [
      player('left', { left: true }),
      player('spec', { isSpectator: true }),
      player('ada'),
      player('ben')
    ],
    round: { currentPlayerIndex: 1 }
  };
  const table = tableFor(state);

  assert.equal(table.currentPlayer(), null);
  assert.equal(table.findActiveIndexFrom(0), 2);
  assert.equal(table.findActiveIndexFrom(3), 3);

  state.round.currentPlayerIndex = 2;
  assert.equal(table.currentPlayer().id, 'ada');
});

test('lookup helpers return players, names, cards, and score snapshots', () => {
  const a1 = { id: 'a1', rank: '5', suit: 'clubs' };
  const state = {
    players: [
      player('ada', { name: 'Ada', total: 12, roundPoints: 3, cards: [a1] }),
      player('ben', { name: 'Ben', total: 7, roundPoints: 2, cards: [] }),
      player('spec', { name: 'Spec', isSpectator: true, total: 99, roundPoints: 99, cards: [] })
    ],
    round: null
  };
  const table = tableFor(state);

  assert.equal(table.findPlayer('ada').name, 'Ada');
  assert.equal(table.findPlayer('missing'), undefined);
  assert.equal(table.isActivePlayer('ada'), true);
  assert.equal(table.isActivePlayer('spec'), false);
  assert.equal(table.nameOf('ben'), 'Ben');
  assert.equal(table.nameOf('missing'), 'A player');
  assert.deepEqual(table.playerByCardId('a1'), { player: state.players[0], index: 0, card: a1 });
  assert.equal(table.playerByCardId('missing'), null);
  assert.deepEqual(table.scoreSnapshot(), [
    { name: 'Ada', total: 12, roundPoints: 3 },
    { name: 'Ben', total: 7, roundPoints: 2 }
  ]);
});

test('empty tables have no active index or current player', () => {
  const table = tableFor({ players: [], round: { currentPlayerIndex: 0 } });

  assert.equal(table.findActiveIndexFrom(0), -1);
  assert.equal(table.currentPlayer(), null);
  assert.equal(table.hasPlayableHumanGame(), false);
});
