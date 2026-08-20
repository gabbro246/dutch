const test = require('node:test');
const assert = require('node:assert/strict');
const { LIVE_LOG_WINDOW, LIVE_SCORE_HISTORY_WINDOW, createGameView, publicCard } = require('../lib/game-view.js');

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

test('live views bound log payloads while initial views include complete history', () => {
  const log = Array.from({ length: LIVE_LOG_WINDOW + 5 }, (_, index) => ({ id: index + 1 }));
  const scoreHistory = Array.from({ length: LIVE_SCORE_HISTORY_WINDOW + 3 }, (_, index) => ({ round: index + 1 }));
  const state = {
    phase: 'waiting',
    players: [],
    log,
    roundNumber: 0,
    scoreHistory,
    gameStartedAt: null
  };
  const gameView = viewFor(state);

  const initial = gameView.buildView(null);
  const live = gameView.buildView(null, { liveUpdate: true });

  assert.equal(initial.log.length, log.length);
  assert.equal(initial.logComplete, true);
  assert.equal(live.log.length, LIVE_LOG_WINDOW);
  assert.equal(live.logLength, log.length);
  assert.equal(live.logComplete, false);
  assert.equal(initial.scoreHistory.length, scoreHistory.length);
  assert.equal(initial.scoreHistoryComplete, true);
  assert.deepEqual(live.scoreHistory.map((entry) => entry.round), [4, 5, 6, 7]);
  assert.equal(live.scoreHistoryLength, scoreHistory.length);
  assert.equal(live.scoreHistoryStart, 3);
  assert.equal(live.scoreHistoryComplete, false);
  assert.equal(live.botTimingPercent, 50);
});

test('build view reveals only cards visible to the viewer', () => {
  const state = {
    phase: 'playing',
    deckSetting: 'one',
    deckColor: 'blue',
    gameTarget: 100,
    singleRound: false,
    botTimingPercent: 25,
    highlightChangedCards: true,
    players: [
      player('ada', [card('a1', '2'), card('a2', '3')]),
      player('ben', [card('b1', '9'), card('b2', 'K', 'hearts')])
    ],
    log: [],
    botDiagnostics: [{ actualHands: [{ score: 2 }] }],
    replayArchive: { gameSeed: 123, rounds: [{ shuffledDeckOrder: ['secret'] }] },
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
      wrongThrowPenalty: {
        id: 'd1:b1',
        cardId: 'd1',
        playerId: 'ben',
        wrongThrowCardId: 'b1'
      },
      specialQueue: [],
      reveals: [
        { viewerId: 'ada', cardId: 'a1', until: Date.now() + 60_000 },
        { public: true, kind: 'peek', cardId: 'a2', exceptViewerId: 'ada', playerId: '', until: Date.now() + 60_000 },
        { public: true, kind: 'wrong-throw', cardId: 'b1', exceptViewerId: '', playerId: 'ben', until: Date.now() + 60_000 }
      ],
      pileHighlight: null,
      infoEvent: { text: 'BEN used Queen peek', until: Date.now() + 60_000 },
      pendingPileReveal: { cardId: 'p1', actorId: 'ben' },
      cardAddEvent: { id: 'd1:wrong-throw:b1', playerId: 'ben', source: 'wrong-throw' },
      peekEvent: { id: 2, playerId: 'ada', cardId: 'a1' },
      handHighlights: [{ ownerId: 'ben', cardId: 'b2' }],
      dutchCallerId: null,
      dutchQueue: [],
      roundWinnerIds: [],
      winnerId: null
    }
  };

  const view = viewFor(state).buildView('ada');

  assert.equal(view.version, 'test-version');
  assert.equal(view.inactivityTimeoutMinutes, 15);
  assert.equal(view.botTimingPercent, 25);
  assert.equal(view.highlightChangedCards, true);
  assert.equal(view.canChangeGameTarget, true);
  assert.equal(view.canSelectSingleRound, true);
  assert.equal(view.singleRound, false);
  assert.equal(Object.hasOwn(view, 'botDiagnostics'), false);
  assert.equal(Object.hasOwn(view, 'replayArchive'), false);
  assert.equal(view.round.players[0].cards[0].back, false);
  assert.equal(view.round.players[0].cards[0].rank, '2');
  assert.equal(view.round.players[0].cards[1].back, true);
  assert.equal(view.round.players[1].cards[0].back, true);
  assert.equal(view.round.wrongThrowIn.playerId, 'ben');
  assert.equal(view.round.wrongThrowIn.playerName, 'BEN');
  assert.equal(view.round.wrongThrowIn.cardId, 'b1');
  assert.equal(view.round.wrongThrowIn.card.back, false);
  assert.equal(view.round.wrongThrowIn.card.rank, '9');
  assert.deepEqual(view.round.wrongThrowPenalty, {
    id: 'd1:b1',
    cardId: 'd1',
    playerId: 'ben',
    wrongThrowCardId: 'b1'
  });
  assert.equal(view.round.discardTop.rank, 'Q');
  assert.equal(view.round.pendingPileReveal.actorId, 'ben');
  assert.equal(view.round.pendingPileReveal.kind, 'discard');
  assert.equal(view.round.cardAddEvent, null);
  assert.deepEqual(view.round.peekEvent, { id: '2', cardId: 'a1' });

  state.round.stage = 'revealing';
  assert.equal(viewFor(state).buildView('ada').round.players[0].isCurrent, true);
  state.round.stage = 'peek';
  assert.equal(viewFor(state).buildView('ada').round.players[0].isCurrent, false);
  state.round.stage = 'turn';
  assert.deepEqual(view.round.infoEvent, { text: 'BEN used Queen peek' });

  state.players[0].total = 50;
  assert.deepEqual(viewFor(state).buildView('ada').selectableGameTargets, [50, 100, 200]);
  state.players[0].total = 51;
  assert.equal(viewFor(state).buildView('ada').canChangeGameTarget, true);
  assert.deepEqual(viewFor(state).buildView('ada').selectableGameTargets, [100, 200]);
  state.players[0].left = true;
  assert.equal(viewFor(state).buildView('ada').canChangeGameTarget, true);
  assert.deepEqual(viewFor(state).buildView('ada').selectableGameTargets, [50, 100, 200]);
  state.players[0].left = false;
  state.players[0].total = 0;

  state.round.stage = 'roundEnd';
  assert.equal(viewFor(state).buildView('ada').canSelectSingleRound, false);
  state.round.stage = 'gameEnd';
  assert.equal(viewFor(state).buildView('ada').canChangeGameTarget, false);
  assert.deepEqual(viewFor(state).buildView('ada').selectableGameTargets, []);
  state.round.stage = 'turn';
  state.roundNumber = 2;
  assert.equal(viewFor(state).buildView('ada').canSelectSingleRound, false);
  state.roundNumber = 1;

  const observerView = viewFor(state).buildView('ben');
  assert.equal(observerView.round.peekEvent, null);
  assert.deepEqual(observerView.round.cardAddEvent, {
    id: 'd1:wrong-throw:b1',
    playerId: 'ben',
    source: 'wrong-throw'
  });
  assert.equal(observerView.round.players[0].cards[1].back, true);
  assert.equal(observerView.round.players[0].cards[1].highlight, 'peek');
  assert.equal(observerView.round.players[1].cards[1].highlight, 'changed');
  assert.equal(Object.hasOwn(observerView.round.players[0].cards[1], 'rank'), false);

  state.highlightChangedCards = false;
  const disabledView = viewFor(state).buildView('ben');
  assert.equal(disabledView.highlightChangedCards, false);
  assert.equal(disabledView.round.players[1].cards[1].highlight, '');
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
  assert.equal(afterDraw.round.drawn.playerId, 'ada');

  const observerAfterDraw = viewFor(state).buildView('ben');
  assert.equal(observerAfterDraw.round.drawn.card.back, true);

  state.round.drawn = null;
  state.round.turnComplete = true;
  state.round.roundEndPending = true;
  state.round.roundEndAt = 2500;
  const graceView = viewFor(state).buildView('ada');
  assert.equal(graceView.round.controls.canThrowIn, true);
  assert.equal(graceView.round.controls.canEndTurn, false);
  assert.equal(graceView.round.roundEndPending, true);
  assert.equal(graceView.round.roundEndAt, 2500);
  state.round.stage = 'special';
  state.round.specialQueue = [{ type: 'Q', actorId: 'ada', selected: [] }];
  const specialGraceView = viewFor(state).buildView('ada');
  assert.equal(specialGraceView.round.controls.canEndTurn, true);
});

test('an empty deck exposes human reshuffle controls and pauses other actions', () => {
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
      deck: [],
      discard: [card('p1'), card('p2')],
      currentPlayerIndex: 0,
      drawn: null,
      turnComplete: false,
      throwIn: { open: true },
      specialQueue: [],
      reveals: [],
      pileHighlight: null,
      needsReshuffle: true,
      reshuffleToken: 0,
      dutchCallerId: null,
      dutchQueue: [],
      roundWinnerIds: [],
      winnerId: null
    }
  };

  const view = viewFor(state, { canPlayerSayDutch: () => true }).buildView('ada');

  assert.equal(view.round.needsReshuffle, true);
  assert.equal(view.round.controls.canReshuffle, true);
  assert.equal(view.round.controls.canTake, false);
  assert.equal(view.round.controls.canThrowIn, false);
  assert.equal(view.round.controls.canDutch, false);
});
