const test = require('node:test');
const assert = require('node:assert/strict');
const { createCardFlow } = require('../lib/card-flow.js');
const { rankValue } = require('../lib/bot-strategy.js');

function card(id, rank = '5', suit = 'clubs') {
  return { id, rank, suit, deckColor: 'blue' };
}

function flowFor(state, overrides = {}) {
  let nextToken = 1;
  let currentTime = 1000;
  const calls = {
    logs: [],
    stages: 0,
    broadcasts: 0,
    discards: [],
    remembered: [],
    removed: [],
    timeouts: []
  };
  const deps = {
    getState: () => state,
    specialRanks: ['A', 'Q', 'J'],
    shuffle: (cards) => cards.reverse(),
    addLog: (text) => calls.logs.push(text),
    nameOf: (playerId) => ({ ada: 'Ada', ben: 'Ben' })[playerId] || 'A player',
    specialName: (rank) => ({ A: 'Ace', Q: 'Queen', J: 'Jack' })[rank] || rank,
    nextThrowInToken: () => nextToken++,
    rankValue,
    updateStageAfterQueue: () => {
      calls.stages += 1;
    },
    findPlayer: (playerId) => (state.players || []).find((player) => player.id === playerId),
    rememberSlotForAllBots: (ownerId, index, rememberedCard, source) => calls.remembered.push({ ownerId, index, card: rememberedCard, source }),
    removeSlotForAllBots: (ownerId, index, source) => calls.removed.push({ ownerId, index, source }),
    observeDiscardForAllBots: (discarded, source, actorId) => calls.discards.push({ card: discarded, source, actorId }),
    broadcastState: () => {
      calls.broadcasts += 1;
    },
    suitSymbol: (suit) => ({ clubs: 'C', hearts: 'H' })[suit] || suit,
    now: () => currentTime,
    setTimeoutFn: (fn, delay) => {
      calls.timeouts.push({ fn, delay });
    },
    ...overrides
  };

  return {
    flow: createCardFlow(deps),
    calls,
    setNow: (value) => {
      currentTime = value;
    }
  };
}

test('drawFromDeck reshuffles discard under the top card when the deck is empty', () => {
  const top = card('top', 'K');
  const state = {
    round: {
      deck: [],
      discard: [card('d1', '2'), card('d2', '3'), top]
    }
  };
  const { flow, calls } = flowFor(state);

  const drawn = flow.drawFromDeck();

  assert.equal(drawn.id, 'd1');
  assert.deepEqual(state.round.deck.map((item) => item.id), ['d2']);
  assert.deepEqual(state.round.discard, [top]);
  assert.deepEqual(calls.logs, ['discard pile reshuffled into draw pile']);
});

test('pushDiscard creates throw-in state, queues specials, logs, and updates stage', () => {
  const state = {
    players: [{ id: 'ada', connected: true, left: false, isBot: false, isSpectator: false }],
    round: {
      stage: 'turn',
      discard: [],
      throwIn: null,
      specialQueue: []
    }
  };
  const { flow, calls, setNow } = flowFor(state);

  const queen = card('q1', 'Q', 'hearts');
  flow.pushDiscard(queen, 'ada', 'discarded', { observationSource: 'discarded', observationActorId: 'ada' });

  assert.deepEqual(state.round.discard.map((item) => item.id), ['q1']);
  assert.equal(state.round.stage, 'revealing');
  assert.equal(state.round.throwIn, null);
  assert.deepEqual(state.round.specialQueue, []);
  assert.deepEqual(calls.logs, []);
  assert.deepEqual(calls.discards, []);
  assert.equal(calls.stages, 0);
  assert.equal(calls.timeouts[0].delay, 1800);
  assert.equal(flow.completePileReveal('ada', 'q1'), false);

  setNow(1490);
  assert.equal(flow.completePileReveal('ada', 'q1'), true);
  assert.deepEqual(state.round.throwIn, {
    open: true,
    token: 1,
    topCardId: 'q1',
    rank: 'Q'
  });
  assert.deepEqual(state.round.specialQueue, [{ type: 'Q', actorId: 'ada', selected: [] }]);
  assert.deepEqual(calls.logs, ['Ada discarded QH and may use Queen']);
  assert.deepEqual(calls.discards, [{ card: queen, source: 'discarded', actorId: 'ada' }]);
  assert.equal(calls.stages, 1);
  assert.equal(calls.broadcasts, 1);

  const thrown = card('n1', '4');
  flow.pushDiscard(thrown, 'ben', 'threw in', {
    allowThrowIn: false,
    removedSlotOwnerId: 'ben',
    removedSlotIndex: 2,
    removedSlotSource: 'throw-in'
  });
  assert.equal(state.round.stage, 'revealing');
  assert.deepEqual(calls.removed, []);
  calls.timeouts[1].fn();
  assert.deepEqual(calls.remembered, [{ ownerId: 'ben', index: 2, card: thrown, source: 'throw-in' }]);
  assert.deepEqual(calls.removed, [{ ownerId: 'ben', index: 2, source: 'throw-in' }]);
  assert.equal(state.round.throwIn.open, false);
});

test('discardLogText replaces explicit card placeholders and labels missing cards', () => {
  const state = { round: null };
  const { flow } = flowFor(state);

  assert.equal(flow.label(null), 'card');
  assert.equal(flow.discardLogText('ada', card('a1', '5'), 'drew {card} from deck'), 'Ada drew 5C from deck');
  assert.equal(flow.discardLogText('ben', card('b1', '7'), ''), 'Ben placed 7C');
});

test('reveal and highlight helpers schedule cleanup and remove expired state', () => {
  const state = {
    round: {
      reveals: [],
      pileHighlight: null
    }
  };
  const { flow, calls, setNow } = flowFor(state);

  flow.revealCardTo('ada', 'a1', 300);
  flow.highlightCardForAll('b1', 'event', 400, { exceptViewerId: 'ben' });
  flow.highlightPileForAll('peek', 500);

  assert.deepEqual(calls.timeouts.map((item) => item.delay), [350, 450, 550]);
  assert.deepEqual(state.round.reveals, [
    { viewerId: 'ada', cardId: 'a1', until: 1300 },
    { public: true, kind: 'event', cardId: 'b1', exceptViewerId: 'ben', playerId: '', until: 1400 }
  ]);
  assert.deepEqual(state.round.pileHighlight, { kind: 'peek', until: 1500 });

  setNow(1450);
  calls.timeouts[1].fn();

  assert.deepEqual(state.round.reveals, []);
  assert.deepEqual(state.round.pileHighlight, { kind: 'peek', until: 1500 });
  assert.equal(calls.broadcasts, 1);

  calls.timeouts[0].fn();
  assert.equal(calls.broadcasts, 1);

  setNow(1550);
  flow.removeExpiredReveals();
  assert.equal(state.round.pileHighlight, null);
});

test('hand change highlights follow a card owner and clear at that owners next turn', () => {
  const state = { round: { handHighlights: [] } };
  const { flow } = flowFor(state);

  flow.markHandCardChanged('ada', 'c1');
  flow.markHandCardChanged('ben', 'c2');
  flow.markHandCardChanged('ben', 'c1');

  assert.deepEqual(state.round.handHighlights, [
    { ownerId: 'ben', cardId: 'c2' },
    { ownerId: 'ben', cardId: 'c1' }
  ]);

  flow.clearHandHighlightsForPlayer('ben');
  assert.deepEqual(state.round.handHighlights, []);
});
