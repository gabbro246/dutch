const test = require('node:test');
const assert = require('node:assert/strict');
const { createGameView, publicCard } = require('../lib/game-view.js');

function card(id, rank = '5', suit = 'clubs') {
  return { id, rank, suit, deckColor: 'blue' };
}

function player(id, cards, extra = {}) {
  return {
    id,
    name: id.toUpperCase(),
    total: 0,
    roundPoints: null,
    connected: true,
    left: false,
    isSpectator: false,
    isBot: false,
    botType: '',
    joinedAt: null,
    startPeekDone: false,
    startPeekedCardIds: [],
    cards,
    ...extra
  };
}

function viewFor(state, overrides = {}) {
  const deps = {
    appVersion: 'test-version',
    getState: () => state,
    removeExpiredReveals: () => {},
    activePlayers: () => state.players.filter((item) => !item.left),
    activePlayerCount: () => state.players.filter((item) => !item.left).length,
    activePlayablePlayerCount: () => state.players.filter((item) => !item.left && !item.isSpectator).length,
    hasPlayableHumanGame: () => true,
    currentPlayer: () => state.round ? state.players[state.round.currentPlayerIndex] : null,
    topSpecial: () => state.round && state.round.specialQueue[0] ? state.round.specialQueue[0] : null,
    findPlayer: (playerId) => state.players.find((item) => item.id === playerId),
    nameOf: (playerId) => (state.players.find((item) => item.id === playerId) || { name: 'A player' }).name,
    isJackSwapInProgress: () => false,
    isJackSwapSelectionActive: () => false,
    mustPlayerSayDutch: () => false,
    canPlayerSayDutch: () => false,
    ...overrides
  };
  return createGameView(deps);
}

test('public card hides card details unless visible', () => {
  assert.deepEqual(publicCard(card('c1', 'K', 'hearts'), false), {
    id: 'c1',
    back: true,
    deckColor: 'blue'
  });
  assert.deepEqual(publicCard(card('c1', 'K', 'hearts'), true), {
    id: 'c1',
    back: false,
    rank: 'K',
    suit: 'hearts',
    symbol: '♥',
    red: true,
    deckColor: 'blue',
    points: 0
  });
});

test('build view reveals only cards visible to the viewer', () => {
  const state = {
    phase: 'playing',
    deckSetting: 'one',
    deckColor: 'blue',
    gameTarget: 100,
    players: [
      player('ada', [card('a1', '2'), card('a2', '3')]),
      player('ben', [card('b1', '9'), card('b2', 'K', 'hearts')])
    ],
    log: [],
    botDiagnostics: [{ actualHands: [{ score: 2 }] }],
    roundNumber: 1,
    scoreHistory: [],
    gameStartedAt: 0,
    waitingMessage: '',
    round: {
      stage: 'turn',
      deck: [card('d1')],
      discard: [card('p1', 'Q', 'spades')],
      currentPlayerIndex: 0,
      drawn: null,
      turnComplete: false,
      throwIn: null,
      specialQueue: [],
      reveals: [
        { viewerId: 'ada', cardId: 'a1', until: Date.now() + 60_000 },
        { public: true, kind: 'peek', cardId: 'a2', exceptViewerId: 'ada', until: Date.now() + 60_000 }
      ],
      pileHighlight: null,
      dutchCallerId: null,
      dutchQueue: [],
      roundWinnerIds: [],
      winnerId: null
    }
  };

  const view = viewFor(state).buildView('ada');

  assert.equal(view.version, 'test-version');
  assert.equal(Object.hasOwn(view, 'botDiagnostics'), false);
  assert.equal(view.round.players[0].cards[0].back, false);
  assert.equal(view.round.players[0].cards[0].rank, '2');
  assert.equal(view.round.players[0].cards[1].back, true);
  assert.equal(view.round.players[1].cards[0].back, true);
  assert.equal(view.round.discardTop.rank, 'Q');

  const observerView = viewFor(state).buildView('ben');
  assert.equal(observerView.round.players[0].cards[1].back, true);
  assert.equal(observerView.round.players[0].cards[1].highlight, 'peek');
  assert.equal(Object.hasOwn(observerView.round.players[0].cards[1], 'rank'), false);
});

test('controls reflect current player draw and turn-complete states', () => {
  const state = {
    phase: 'playing',
    deckSetting: 'one',
    gameTarget: 100,
    players: [player('ada', [card('a1')]), player('ben', [card('b1')])],
    log: [],
    roundNumber: 1,
    scoreHistory: [],
    gameStartedAt: 0,
    waitingMessage: '',
    round: {
      stage: 'turn',
      deck: [card('d1')],
      discard: [card('p1')],
      currentPlayerIndex: 0,
      drawn: null,
      turnComplete: false,
      throwIn: { open: true },
      specialQueue: [],
      reveals: [],
      pileHighlight: null,
      dutchCallerId: null,
      dutchQueue: [],
      roundWinnerIds: [],
      winnerId: null
    }
  };

  const view = viewFor(state, { canPlayerSayDutch: () => true }).buildView('ada');
  assert.equal(view.round.controls.canTake, true);
  assert.equal(view.round.controls.canThrowIn, true);
  assert.equal(view.round.controls.canDutch, true);
  assert.equal(view.round.controls.canEndTurn, false);

  state.round.drawn = { playerId: 'ada', source: 'deck', card: card('d2') };
  const afterDraw = viewFor(state).buildView('ada');
  assert.equal(afterDraw.round.controls.canTake, false);
  assert.equal(afterDraw.round.controls.canDiscardDrawn, true);
  assert.equal(afterDraw.round.drawn.card.back, false);
});
