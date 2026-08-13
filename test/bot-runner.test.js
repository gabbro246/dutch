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
    swapped: 0,
    shuffled: 0
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
    shuffleForPlayer: (player, options) => {
      calls.shuffled += 1;
      calls.shufflePlayer = player;
      calls.shuffleOptions = options;
      state.round.needsReshuffle = false;
      return true;
    },
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
    botDeckCardDecision: () => ({ swapTarget: null }),
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
  assert.ok(calls.remembered.every((args) => args[5] === 1));
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

test('bot runner discards a deck card when protection leaves no swap target', () => {
  const { runner, calls } = createHarness({
    state: {
      round: {
        stage: 'turn',
        botTick: 3,
        specialQueue: [],
        drawn: { playerId: 'bot', source: 'deck', card: card('drawn-high', '10') },
        turnComplete: false,
        throwIn: null
      }
    },
    deps: {
      botDeckCardDecision: () => ({ swapTarget: null })
    }
  });

  runner.scheduleBotAutomation();
  assert.equal(calls.timers.length, 1);
  calls.timers[0].fn();

  assert.equal(calls.discarded, 1);
  assert.equal(calls.swapped, 0);
  assert.equal(calls.broadcasts, 1);
});

test('bot runner reuses the selected deck response without evaluating a second target', () => {
  let decisionCalls = 0;
  let legacyTargetCalls = 0;
  const { runner, calls } = createHarness({
    state: {
      round: {
        stage: 'turn',
        botTick: 4,
        specialQueue: [],
        drawn: { playerId: 'bot', source: 'deck', card: card('drawn-low', '2') },
        turnComplete: false,
        throwIn: null
      }
    },
    deps: {
      botDeckCardDecision: () => {
        decisionCalls += 1;
        return { swapTarget: { index: 1 } };
      },
      botBestSwapTarget: () => {
        legacyTargetCalls += 1;
        return { index: 0 };
      }
    }
  });

  runner.scheduleBotAutomation();
  calls.timers[0].fn();

  assert.equal(decisionCalls, 1);
  assert.equal(legacyTargetCalls, 0);
  assert.equal(calls.swapped, 1);
  assert.equal(calls.discarded, 0);
});

test('bot runner records a red King recovery only after a successful throw-in', () => {
  const recoveryMemory = {};
  const redKing = { id: 'red-king', rank: 'K', suit: 'hearts' };
  const { runner, bot, calls } = createHarness({
    state: {
      round: {
        stage: 'turn',
        botTick: 3,
        specialQueue: [],
        drawn: null,
        turnComplete: true,
        throwIn: { open: true, token: 'king-window', rank: 'K' }
      }
    },
    deps: {
      ensureBotMemory: () => recoveryMemory,
      botThrowInCandidate: () => ({
        index: 0,
        confidence: 1,
        recoveryPlan: { replacementIndex: 1, expectedHandImprovement: 5 }
      }),
      botReactionDelay: () => 100,
      throwInForPlayer: () => ({ valid: true, card: redKing })
    }
  });
  bot.cards[0] = redKing;

  runner.scheduleBotAutomation();
  const throwTimer = calls.timers.find((timer) => timer.delay === 100);
  assert.ok(throwTimer);
  throwTimer.fn();

  assert.deepEqual(recoveryMemory.pendingRedKingRecovery, {
    replacementIndex: 1,
    expectedHandImprovement: 5,
    cardId: redKing.id
  });
  assert.equal(calls.broadcasts, 1);
});

test('bot runner clears scheduled timers', () => {
  const { runner, calls } = createHarness();

  runner.scheduleBotAutomation();
  runner.clearBotTimers();

  assert.equal(calls.cleared.length, 1);
});

test('bot-only tables automatically schedule the shared shuffle action', () => {
  const { runner, state, bot, calls } = createHarness();
  state.players.push({ ...bot, id: 'bot-2', name: 'BOT 2', cards: [card('x1')] });
  state.round = {
    stage: 'turn',
    botTick: 5,
    specialQueue: [],
    drawn: null,
    turnComplete: false,
    throwIn: null,
    needsReshuffle: true,
    reshuffleToken: 2
  };

  runner.scheduleBotAutomation();

  assert.equal(calls.timers.length, 1);
  assert.equal(calls.timers[0].delay, 925);
  calls.timers[0].fn();
  assert.equal(calls.shuffled, 1);
  assert.equal(calls.shufflePlayer, bot);
  assert.deepEqual(calls.shuffleOptions, { automatic: true });
  assert.equal(calls.broadcasts, 1);
});

test('bots wait for a human to shuffle when a human remains in the game', () => {
  const { runner, state, bot, calls } = createHarness();
  state.players.push({ ...bot, id: 'human', name: 'HUMAN', isBot: false, cards: [card('h1')] });
  state.round.needsReshuffle = true;

  runner.scheduleBotAutomation();

  assert.equal(calls.timers.length, 0);
  assert.equal(calls.shuffled, 0);
});
