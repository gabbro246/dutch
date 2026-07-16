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
    round: {
      discard: [],
      throwIn: null,
      specialQueue: []
    }
  };
  const { flow, calls } = flowFor(state);

  flow.pushDiscard(card('q1', 'Q', 'hearts'), 'ada', 'discarded');

  assert.deepEqual(state.round.discard.map((item) => item.id), ['q1']);
  assert.deepEqual(state.round.throwIn, {
    open: true,
    token: 1,
    topCardId: 'q1',
    rank: 'Q'
  });
  assert.deepEqual(state.round.specialQueue, [{ type: 'Q', actorId: 'ada', selected: [] }]);
  assert.deepEqual(calls.logs, ['Ada discarded QH and may use Queen']);
  assert.equal(calls.stages, 1);

  flow.pushDiscard(card('n1', '4'), 'ben', 'threw in', { allowThrowIn: false });
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
    { public: true, kind: 'event', cardId: 'b1', exceptViewerId: 'ben', until: 1400 }
  ]);
  assert.deepEqual(state.round.pileHighlight, { kind: 'peek', until: 1500 });

  setNow(1450);
  calls.timeouts[1].fn();

  assert.deepEqual(state.round.reveals, []);
  assert.deepEqual(state.round.pileHighlight, { kind: 'peek', until: 1500 });
  assert.equal(calls.broadcasts, 1);

  setNow(1550);
  flow.removeExpiredReveals();
  assert.equal(state.round.pileHighlight, null);
});
