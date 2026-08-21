const test = require('node:test');
const assert = require('node:assert/strict');
const { createTurnState } = require('../lib/turn-state.js');

function card(id, rank = '5') {
  return { id, rank, suit: 'clubs', deckColor: 'blue' };
}

function player(id, cards = [], extra = {}) {
  return {
    id,
    name: id.toUpperCase(),
    cards,
    left: false,
    isSpectator: false,
    ...extra
  };
}

function turnStateFor(state, overrides = {}) {
  const calls = {
    logs: [],
    broadcasts: 0,
    movedSlots: [],
    changedCards: [],
    infoEvents: [],
    advancedTurns: 0,
    timeouts: []
  };
  const deps = {
    getState: () => state,
    jackSwapSelectionMs: 500,
    playerByCardId: (cardId) => {
      for (const item of state.players) {
        const index = item.cards.findIndex((candidate) => candidate.id === cardId);
        if (index >= 0) return { player: item, index, card: item.cards[index] };
      }
      return null;
    },
    isProtectedSpecialTarget: () => false,
    moveSlotMemoryForAllBots: (...args) => calls.movedSlots.push(args),
    markHandCardChanged: (ownerId, cardId) => calls.changedCards.push({ ownerId, cardId }),
    addLog: (text) => calls.logs.push(text),
    showInfoEvent: (text) => calls.infoEvents.push(text),
    nameOf: (playerId) => {
      const found = state.players.find((item) => item.id === playerId);
      return found ? found.name : 'A player';
    },
    broadcastState: () => {
      calls.broadcasts += 1;
    },
    findPlayer: (playerId) => state.players.find((item) => item.id === playerId),
    currentPlayer: () => state.round ? state.players[state.round.currentPlayerIndex] || null : null,
    specialName: (rank) => ({ A: 'Ace', Q: 'Queen', J: 'Jack' })[rank] || rank,
    advanceTurn: () => {
      calls.advancedTurns += 1;
    },
    setTimeoutFn: (fn, delay) => {
      calls.timeouts.push(delay);
      fn();
    },
    ...overrides
  };

  return {
    turnState: createTurnState(deps),
    calls
  };
}

test('special queue helpers move between special and turn stages', () => {
  const state = {
    players: [],
    round: {
      stage: 'turn',
      specialQueue: [{ type: 'Q', actorId: 'ada', selected: [] }]
    }
  };
  const { turnState } = turnStateFor(state);

  turnState.updateStageAfterQueue();
  assert.equal(state.round.stage, 'special');
  assert.deepEqual(turnState.topSpecial(), { type: 'Q', actorId: 'ada', selected: [] });

  turnState.finishSpecial();
  assert.equal(state.round.stage, 'turn');
  assert.equal(turnState.topSpecial(), null);

  state.round.stage = 'roundEnd';
  state.round.specialQueue.push({ type: 'A', actorId: 'ben', selected: [] });
  turnState.updateStageAfterQueue();
  assert.equal(state.round.stage, 'roundEnd');
});

test('Jack swap resolution swaps cards, moves memory, logs, and finishes the special', () => {
  const a1 = card('a1', '2');
  const b1 = card('b1', 'K');
  const state = {
    players: [player('ada', [a1]), player('ben', [b1])],
    round: {
      stage: 'special',
      currentPlayerIndex: 0,
      specialQueue: [{ type: 'J', actorId: 'ada', selected: [] }]
    }
  };
  const { turnState, calls } = turnStateFor(state);

  turnState.beginJackSwapResolution('ada', ['a1', 'b1'], 0);

  assert.deepEqual(state.players[0].cards, [b1]);
  assert.deepEqual(state.players[1].cards, [a1]);
  assert.deepEqual(calls.movedSlots, [['ada', 0, 'ben', 0, 'Jack swap']]);
  assert.deepEqual(calls.changedCards, [
    { ownerId: 'ada', cardId: 'b1' },
    { ownerId: 'ben', cardId: 'a1' }
  ]);
  assert.deepEqual(calls.logs, ['ADA used Jack swap']);
  assert.deepEqual(calls.infoEvents, ['ADA used Jack swap']);
  assert.equal(state.round.specialQueue.length, 0);
  assert.equal(state.round.stage, 'turn');
  assert.equal(calls.broadcasts, 2);
});

test('bot Jack keeps its first selection stable before adding the second and swapping', () => {
  const a1 = card('a1', '2');
  const b1 = card('b1', 'K');
  const state = {
    players: [player('ada', [a1]), player('ben', [b1])],
    round: {
      stage: 'special',
      currentPlayerIndex: 0,
      specialQueue: [{ type: 'J', actorId: 'ada', selected: [] }]
    }
  };
  const scheduled = [];
  const { turnState, calls } = turnStateFor(state, {
    jackSwapSelectionMs: 500,
    setTimeoutFn: (fn, delay) => {
      scheduled.push({ fn, delay });
    }
  });

  assert.equal(turnState.beginBotJackSwapSelection('ada', 'a1', 'b1'), true);
  assert.deepEqual(state.round.specialQueue[0].selected, ['a1']);
  assert.equal(calls.broadcasts, 1);
  assert.equal(scheduled[0].delay, 360);

  scheduled[0].fn();
  assert.deepEqual(state.round.specialQueue[0].selected, ['a1', 'b1']);
  assert.equal(calls.broadcasts, 2);
  assert.equal(scheduled[1].delay, 360);

  scheduled[1].fn();
  assert.deepEqual(state.players[0].cards, [b1]);
  assert.deepEqual(state.players[1].cards, [a1]);
  assert.equal(state.round.specialQueue.length, 0);
});

test('bot Jack selections stay visible at minimum bot timing', () => {
  const a1 = card('a1', '2');
  const b1 = card('b1', 'K');
  const state = {
    botTimingPercent: 0,
    players: [player('ada', [a1]), player('ben', [b1])],
    round: {
      stage: 'special',
      currentPlayerIndex: 0,
      specialQueue: [{ type: 'J', actorId: 'ada', selected: [] }]
    }
  };
  const scheduled = [];
  const { turnState } = turnStateFor(state, {
    cardMoveMs: 360,
    setTimeoutFn: (fn, delay) => scheduled.push({ fn, delay })
  });

  assert.equal(turnState.beginBotJackSwapSelection('ada', 'a1', 'b1'), true);
  assert.equal(scheduled[0].delay, 360);
  scheduled[0].fn();
  assert.equal(scheduled[1].delay, 360);
});

test('Dutch call sets the caller, builds the final-turn queue, and advances', () => {
  const state = {
    players: [
      player('ada', [card('a1')]),
      player('ben', [card('b1')]),
      player('spec', [], { isSpectator: true }),
      player('left', [], { left: true })
    ],
    round: {
      stage: 'turn',
      currentPlayerIndex: 0,
      drawn: null,
      turnComplete: true,
      specialQueue: [],
      dutchCallerId: null,
      dutchQueue: []
    }
  };
  const { turnState, calls } = turnStateFor(state);

  assert.equal(turnState.canPlayerSayDutch('ada'), true);
  assert.equal(turnState.callDutchForPlayer(state.players[0]), true);

  assert.equal(state.round.dutchCallerId, 'ada');
  assert.deepEqual(state.round.dutchQueue, ['ben']);
  assert.deepEqual(calls.logs, ['ADA said Dutch']);
  assert.equal(calls.advancedTurns, 1);
  assert.equal(turnState.canPlayerSayDutch('ada'), false);
});

test('Dutch call during an available special skips the special first', () => {
  const state = {
    players: [player('ada', []), player('ben', [card('b1')])],
    round: {
      stage: 'special',
      currentPlayerIndex: 0,
      drawn: null,
      turnComplete: true,
      specialQueue: [{ type: 'Q', actorId: 'ada', selected: [] }],
      dutchCallerId: null,
      dutchQueue: []
    }
  };
  const { turnState, calls } = turnStateFor(state);

  assert.equal(turnState.mustPlayerSayDutch('ada'), true);
  assert.equal(turnState.callDutchForPlayer(state.players[0]), true);

  assert.equal(state.round.stage, 'turn');
  assert.deepEqual(state.round.specialQueue, []);
  assert.deepEqual(calls.logs, ['ADA skipped Queen', 'ADA said Dutch']);
  assert.equal(calls.advancedTurns, 1);
});

test('bot Jack selection cannot be started again while it is resolving', () => {
  const state = {
    players: [player('ada', [card('a1')]), player('ben', [card('b1')])],
    round: {
      stage: 'special',
      currentPlayerIndex: 0,
      specialQueue: [{ type: 'J', actorId: 'ada', selected: ['a1'], resolving: true }]
    }
  };
  const { turnState, calls } = turnStateFor(state);

  assert.equal(turnState.beginBotJackSwapSelection('ada', 'a1', 'b1'), false);
  assert.deepEqual(state.round.specialQueue[0].selected, ['a1']);
  assert.equal(calls.broadcasts, 0);
  assert.deepEqual(calls.timeouts, []);
});
