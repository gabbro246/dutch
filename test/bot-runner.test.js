const test = require('node:test');
const assert = require('node:assert/strict');
const { createBotRunner } = require('../lib/bot-runner.js');

function card(id, rank = '5') {
  return { id, rank, suit: 'clubs' };
}

function createHarness(overrides = {}) {
  const bot = {
    id: 'bot',
    name: 'BOT',
    isBot: true,
    cards: [card('b1'), card('b2'), card('b3')],
    startPeekDone: false,
    startPeekedCardIds: [],
    total: 0
  };
  const state = {
    phase: 'playing',
    roundNumber: 1,
    players: [bot],
    round: {
      stage: 'peek',
      botTick: 0,
      specialQueue: [],
      drawn: null,
      turnComplete: false,
      throwIn: null
    },
    ...overrides.state
  };
  const calls = {
    timers: [],
    cleared: [],
    logs: [],
    remembered: [],
    highlighted: [],
    broadcasts: 0,
    beganTurns: 0,
    tookDeck: 0,
    tookPile: 0,
    discarded: 0,
    swapped: 0
  };
  const runner = createBotRunner({
    getState: () => state,
    finishedGameResetMs: 60000,
    syncBotMemories: () => {},
    activeBots: () => state.players.filter((player) => player.isBot),
    activePlayablePlayers: () => state.players,
    randomBetween: (min, max) => Math.round((min + max) / 2),
    shuffle: (items) => items,
    findPlayer: (id) => state.players.find((player) => player.id === id),
    currentPlayer: () => state.players[0],
    topSpecial: () => state.round.specialQueue[0] || null,
    isJackSwapSelectionActive: () => false,
    isJackSwapInProgress: () => false,
    mustPlayerSayDutch: () => false,
    canPlayerSayDutch: () => false,
    shouldBotTakePile: () => false,
    takeDeckForPlayer: () => {
      calls.tookDeck += 1;
      state.round.drawn = { playerId: bot.id, source: 'deck', card: card('drawn') };
      return state.round.drawn.card;
    },
    takePileForPlayer: () => {
      calls.tookPile += 1;
      return card('pile');
    },
    discardDrawnForPlayer: () => {
      calls.discarded += 1;
      return state.round.drawn ? state.round.drawn.card : null;
    },
    swapDrawnForPlayer: () => {
      calls.swapped += 1;
      return { oldCard: bot.cards[0], newCard: state.round.drawn.card };
    },
    throwInForPlayer: () => true,
    ensureBotMemory: () => ({}),
    cardMemory: (item) => ({ card: item }),
    rememberSlotForBot: (...args) => calls.remembered.push(args),
    highlightCardForAll: (...args) => calls.highlighted.push(args),
    addLog: (text) => calls.logs.push(text),
    beginTurnsIfReady: () => { calls.beganTurns += 1; },
    botBestSwapTarget: () => ({ index: 0 }),
    shouldBotSwapDrawn: () => false,
    finishSpecial: () => {},
    specialName: (rank) => rank,
    advanceTurn: () => {},
    botAceTarget: () => null,
    aceAddForPlayer: () => false,
    botQueenTarget: () => null,
    queenPeekForPlayer: () => false,
    botJackCandidates: () => [],
    isProtectedSpecialTarget: () => false,
    beginBotJackSwapSelection: () => false,
    botShouldCallDutch: () => false,
    callDutchForPlayer: () => {},
    botThrowInCandidate: () => null,
    botReactionDelay: () => 500,
    nextRound: () => {},
    resetToWaiting: () => {},
    broadcastState: () => { calls.broadcasts += 1; },
    setTimer: (fn, delay) => {
      const timer = { fn, delay };
      calls.timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => calls.cleared.push(timer),
    ...overrides.deps
  });
  return { runner, state, bot, calls };
}

test('bot runner schedules and performs the start peek', () => {
  const { runner, bot, calls } = createHarness();

  runner.scheduleBotAutomation();
  assert.equal(calls.timers.length, 1);
  assert.equal(calls.timers[0].delay, 1250);

  calls.timers[0].fn();
  assert.equal(bot.startPeekDone, true);
  assert.deepEqual(bot.startPeekedCardIds, ['b1', 'b2']);
  assert.equal(calls.remembered.length, 2);
  assert.equal(calls.highlighted.length, 2);
  assert.equal(calls.beganTurns, 1);
  assert.equal(calls.broadcasts, 1);
});

test('bot runner dispatches a turn draw action through injected game actions', () => {
  const { runner, state, calls } = createHarness({
    state: {
      round: {
        stage: 'turn',
        botTick: 2,
        specialQueue: [],
        drawn: null,
        turnComplete: false,
        throwIn: null
      }
    }
  });

  runner.scheduleBotAutomation();
  assert.equal(calls.timers.length, 1);

  calls.timers[0].fn();
  assert.equal(calls.tookDeck, 1);
  assert.equal(state.round.drawn.card.id, 'drawn');
  assert.equal(calls.broadcasts, 1);
});

test('bot runner clears scheduled timers', () => {
  const { runner, calls } = createHarness();

  runner.scheduleBotAutomation();
  runner.clearBotTimers();

  assert.equal(calls.cleared.length, 1);
});
