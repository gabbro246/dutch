const test = require('node:test');
const assert = require('node:assert/strict');
const { createRoundLifecycle } = require('../lib/round-lifecycle.js');
const { applyRoundScoring, startingPlayerIndexForNextRound } = require('../lib/game-rules.js');
const { rankValue } = require('../lib/bot-strategy.js');

function freshState() {
  return {
    phase: 'waiting',
    deckSetting: 'one',
    gameTarget: 100,
    players: [],
    log: [],
    roundNumber: 0,
    scoreHistory: [],
    round: null,
    waitingMessage: 'A game is already active. Join after the game ends.',
    gameStartedAt: null,
    lastGameActivityAt: null
  };
}

function card(id, rank = '5', suit = 'clubs') {
  return { id, rank, suit, deckColor: 'blue' };
}

function player(id, cards = [], extra = {}) {
  return {
    id,
    name: id.toUpperCase(),
    connected: true,
    disconnectedAt: null,
    socketId: id + '-socket',
    left: false,
    total: 0,
    roundPoints: null,
    cards,
    startPeekDone: false,
    startPeekedCardIds: [],
    isSpectator: false,
    ...extra
  };
}

function lifecycleFor(initialState) {
  let state = initialState;
  let nextToken = 1;
  let now = 1000;
  const calls = {
    logs: [],
    admin: [],
    terminal: [],
    savedLogs: 0,
    clearedTimers: 0,
    discardObservations: [],
    synced: 0,
    timeouts: [],
    broadcasts: 0,
    clearedHandHighlights: []
  };
  const deps = {
    getState: () => state,
    setState: (nextState) => {
      state = nextState;
    },
    freshState,
    gameLogDir: '/tmp/dutch-game-logs-test',
    startingPlayerIndexForNextRound,
    applyRoundScoring,
    writeFinishedGameLog: () => {
      calls.savedLogs += 1;
    },
    createCombinedDeck: () => [
      card('d1', '2'), card('d2', '3'), card('d3', '4'), card('d4', '5'),
      card('d5', '6'), card('d6', '7'), card('d7', '8'), card('d8', '9'),
      card('d9', '10'), card('d10', 'J'), card('d11', 'Q'), card('d12', 'K')
    ],
    drawFromDeck: () => state.round.deck.pop(),
    activePlayablePlayers: () => state.players.filter((item) => !item.left && !item.isSpectator),
    syncBotMemories: () => {
      calls.synced += 1;
    },
    addLog: (text, kind = 'game') => calls.logs.push({ text, kind }),
    clampDeckSetting: () => {},
    observeDiscardForAllBots: (discardedCard, source) => calls.discardObservations.push({ card: discardedCard, source }),
    rankValue,
    nextThrowInToken: () => nextToken++,
    hasPlayableHumanGame: () => state.players.filter((item) => !item.left && !item.isBot && !item.isSpectator).length >= 1 && state.players.filter((item) => !item.left && !item.isSpectator).length >= 2,
    findActiveIndexFrom: (startIndex) => {
      for (let offset = 0; offset < state.players.length; offset += 1) {
        const index = (startIndex + offset + state.players.length) % state.players.length;
        const candidate = state.players[index];
        if (candidate && !candidate.left && !candidate.isSpectator) return index;
      }
      return -1;
    },
    terminalGameStarted: () => calls.terminal.push('started'),
    terminalGameEnded: (reason, winner) => calls.terminal.push({ reason, winner }),
    adminLog: (event, data) => calls.admin.push({ event, data }),
    scoreSnapshot: () => state.players.filter((item) => !item.left && !item.isSpectator).map((item) => ({
      name: item.name,
      total: item.total,
      roundPoints: item.roundPoints
    })),
    clearBotTimers: () => {
      calls.clearedTimers += 1;
    },
    isActivePlayer: (playerId) => state.players.some((item) => item.id === playerId && !item.left && !item.isSpectator),
    nameOf: (playerId) => {
      const found = state.players.find((item) => item.id === playerId);
      return found ? found.name : 'A player';
    },
    specialName: (rank) => rank,
    updateStageAfterQueue: () => {},
    currentPlayer: () => state.round ? state.players[state.round.currentPlayerIndex] || null : null,
    clearHandHighlightsForPlayer: (playerId) => {
      calls.clearedHandHighlights.push(playerId);
      state.round.handHighlights = (state.round.handHighlights || []).filter((item) => item.ownerId !== playerId);
    },
    openingDiscardDelayMs: 500,
    openingDiscardTravelMs: 500,
    openingDiscardFlipHalfMs: 130,
    nowFn: () => now,
    setTimeoutFn: (fn, delay) => calls.timeouts.push({ fn, delay }),
    broadcastState: () => { calls.broadcasts += 1; }
  };
  return {
    lifecycle: createRoundLifecycle(deps),
    calls,
    getState: () => state,
    advanceNow: (ms) => { now += ms; }
  };
}

test('start game deals a round and begins turns after all peeks', () => {
  const state = freshState();
  state.players = [player('ada'), player('ben')];
  const { lifecycle, calls, getState, advanceNow } = lifecycleFor(state);

  lifecycle.startGame();

  assert.equal(getState().phase, 'playing');
  assert.equal(getState().roundNumber, 1);
  assert.equal(getState().round.stage, 'peek');
  assert.deepEqual(getState().players.map((item) => item.cards.length), [4, 4]);
  assert.equal(calls.synced, 1);
  assert.equal(calls.admin[0].event, 'game_started');

  for (const item of getState().players) item.startPeekDone = true;
  lifecycle.beginTurnsIfReady();

  assert.equal(getState().round.stage, 'opening');
  assert.equal(getState().round.discard.length, 0);
  assert.equal(getState().round.throwIn, null);
  assert.equal(calls.discardObservations.length, 0);
  assert.equal(calls.timeouts[0].delay, 500);

  calls.timeouts[0].fn();

  assert.equal(getState().round.stage, 'opening');
  assert.equal(getState().round.discard.length, 1);
  assert.equal(calls.discardObservations.length, 0);
  assert.equal(calls.broadcasts, 1);
  assert.equal(calls.timeouts[1].delay, 500);

  calls.timeouts[1].fn();

  const openingCardId = getState().round.discard[0].id;
  assert.equal(getState().round.stage, 'opening');
  assert.equal(getState().round.openingDiscardPending, null);
  assert.equal(getState().round.openingDiscardAwaitingMidpoint, openingCardId);
  assert.equal(getState().round.throwIn, null);
  assert.equal(calls.discardObservations.length, 0);
  assert.equal(calls.broadcasts, 2);
  assert.equal(calls.timeouts[2].delay, 1500);

  assert.equal(lifecycle.completeOpeningDiscardReveal('missing', openingCardId), false);
  assert.equal(calls.discardObservations.length, 0);
  assert.equal(lifecycle.completeOpeningDiscardReveal('ada', openingCardId), false);
  assert.equal(calls.discardObservations.length, 0);
  advanceNow(130);
  assert.equal(lifecycle.completeOpeningDiscardReveal('ada', openingCardId), true);
  assert.equal(getState().round.stage, 'turn');
  assert.equal(getState().round.throwIn.token, 1);
  assert.equal(calls.discardObservations[0].source, 'opening discard');
  assert.equal(calls.broadcasts, 3);
  assert.equal(lifecycle.completeOpeningDiscardReveal('ben', openingCardId), false);
  calls.timeouts[2].fn();
  assert.equal(calls.discardObservations.length, 1);
});

test('advance turn completes Dutch queue and ends the round', () => {
  const state = freshState();
  state.phase = 'playing';
  state.players = [
    player('ada', [card('a1', '2')]),
    player('ben', [card('b1', '9')])
  ];
  state.roundNumber = 1;
  state.round = {
    stage: 'turn',
    deck: [],
    discard: [],
    currentPlayerIndex: 0,
    drawn: null,
    turnComplete: true,
    throwIn: { open: true },
    specialQueue: [],
    reveals: [],
    pileHighlight: null,
    handHighlights: [
      { ownerId: 'ada', cardId: 'a1' },
      { ownerId: 'ben', cardId: 'b1' }
    ],
    dutchCallerId: 'ada',
    dutchQueue: ['ben'],
    roundWinnerIds: [],
    winnerId: null
  };
  const { lifecycle, calls, getState } = lifecycleFor(state);

  lifecycle.advanceTurn();
  assert.equal(getState().round.currentPlayerIndex, 1);
  assert.deepEqual(getState().round.handHighlights, [{ ownerId: 'ada', cardId: 'a1' }]);
  assert.deepEqual(calls.clearedHandHighlights, ['ben']);

  lifecycle.advanceTurn();
  assert.equal(getState().round.stage, 'roundEnd');
  assert.equal(getState().players[0].roundPoints, 0);
  assert.equal(getState().players[1].roundPoints, 9);
  assert.equal(getState().scoreHistory.length, 1);
});

test('normal turn rotation clears changed-card highlights for the incoming player', () => {
  const state = freshState();
  state.phase = 'playing';
  state.players = [
    player('ada', [card('a1')]),
    player('ben', [card('b1')])
  ];
  state.round = {
    stage: 'turn',
    deck: [],
    discard: [],
    currentPlayerIndex: 0,
    drawn: null,
    turnComplete: true,
    throwIn: null,
    specialQueue: [],
    reveals: [],
    pileHighlight: null,
    handHighlights: [
      { ownerId: 'ada', cardId: 'a1' },
      { ownerId: 'ben', cardId: 'b1' }
    ],
    dutchCallerId: null,
    dutchQueue: [],
    roundWinnerIds: [],
    winnerId: null
  };
  const { lifecycle, calls, getState } = lifecycleFor(state);

  lifecycle.advanceTurn();

  assert.equal(getState().round.currentPlayerIndex, 1);
  assert.deepEqual(getState().round.handHighlights, [{ ownerId: 'ada', cardId: 'a1' }]);
  assert.deepEqual(calls.clearedHandHighlights, ['ben']);
});

test('reset to waiting replaces state and keeps connected players', () => {
  const state = freshState();
  state.phase = 'playing';
  state.players = [
    player('ada', [card('a1')]),
    player('ben', [card('b1')], { connected: false }),
    player('bot-norman', [card('c1')], { isBot: true })
  ];
  state.round = { stage: 'turn' };
  const { lifecycle, calls, getState } = lifecycleFor(state);

  lifecycle.resetToWaiting(true, 'table reset', { adminEvent: 'manual_reset' });

  assert.equal(getState().phase, 'waiting');
  assert.deepEqual(getState().players.map((item) => item.id), ['ada', 'bot-norman']);
  assert.deepEqual(getState().players.map((item) => item.cards.length), [0, 0]);
  assert.equal(getState().players.every((item) => typeof item.joinedAt === 'number'), true);
  assert.equal(calls.clearedTimers, 1);
  assert.equal(calls.admin[0].event, 'manual_reset');
  assert.equal(calls.logs.at(-1).text, 'table reset');
});
