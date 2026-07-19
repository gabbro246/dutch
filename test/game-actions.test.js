const test = require('node:test');
const assert = require('node:assert/strict');
const { createGameActions } = require('../lib/game-actions.js');

function card(id, rank = '5', suit = 'clubs') {
  return { id, rank, suit, deckColor: 'blue' };
}

function player(id, cards, extra = {}) {
  return {
    id,
    name: id.toUpperCase(),
    cards,
    left: false,
    isBot: false,
    isSpectator: false,
    ...extra
  };
}

function stateWithTurn() {
  return {
    players: [
      player('ada', [card('a1', '8'), card('a2', '3')]),
      player('ben', [card('b1', '4')])
    ],
    round: {
      stage: 'turn',
      deck: [card('d1', '2'), card('d2', '9')],
      discard: [card('p1', 'Q')],
      currentPlayerIndex: 0,
      drawn: null,
      turnComplete: false,
      throwIn: { open: true, rank: '8' },
      specialQueue: [],
      reveals: [],
      pileHighlight: null
    }
  };
}

function actionsFor(state) {
  const calls = {
    logs: [],
    pileTakes: [],
    discards: [],
    rememberedAll: [],
    rememberedBot: [],
    forgottenAll: [],
    removedAll: [],
    unknownSlots: [],
    aceObservations: [],
    cardHighlights: [],
    pileHighlights: [],
    reveals: [],
    scheduled: [],
    broadcasts: 0
  };
  const deps = {
    getState: () => state,
    currentPlayer: () => state.round ? state.players[state.round.currentPlayerIndex] : null,
    topSpecial: () => state.round && state.round.specialQueue[0] ? state.round.specialQueue[0] : null,
    mustPlayerSayDutch: () => false,
    drawFromDeck: () => state.round.deck.pop() || null,
    observePileTakeForAllBots: (playerId, takenCard) => calls.pileTakes.push({ playerId, card: takenCard }),
    observeDiscardForAllBots: (discardedCard, source, actorId) => calls.discards.push({ card: discardedCard, source, actorId }),
    pushDiscard: (discardedCard, actorId, reason, options = {}) => {
      calls.pushDiscard = { card: discardedCard, actorId, reason, options };
      state.round.discard.push(discardedCard);
    },
    highlightCardForAll: (cardId, kind, ms, options = {}) => calls.cardHighlights.push({ cardId, kind, ms, options }),
    rememberSlotForAllBots: (ownerId, index, rememberedCard, source, confidence) => calls.rememberedAll.push({ ownerId, index, card: rememberedCard, source, confidence }),
    rememberSlotForBot: (bot, ownerId, index, rememberedCard, source, confidence) => calls.rememberedBot.push({ bot, ownerId, index, card: rememberedCard, source, confidence }),
    forgetSlotForAllBots: (ownerId, index, source) => calls.forgottenAll.push({ ownerId, index, source }),
    label: (labelCard) => labelCard.rank + labelCard.suit[0],
    rankValue: (rankCard) => rankCard ? rankCard.rank : null,
    isJackSwapInProgress: () => false,
    addUnknownSlotForAllBots: (ownerId, source) => calls.unknownSlots.push({ ownerId, source }),
    addLog: (text) => calls.logs.push(text),
    removeSlotForAllBots: (ownerId, index, source) => calls.removedAll.push({ ownerId, index, source }),
    highlightPileForAll: (kind, ms) => {
      calls.pileHighlights.push({ kind, ms });
      state.round.pileHighlight = { kind };
    },
    findPlayer: (playerId) => state.players.find((item) => item.id === playerId),
    isProtectedSpecialTarget: () => false,
    observeAceForAllBots: (actorId, targetId) => calls.aceObservations.push({ actorId, targetId }),
    finishSpecial: () => state.round.specialQueue.shift(),
    playerByCardId: (cardId) => {
      for (const item of state.players) {
        const index = item.cards.findIndex((itemCard) => itemCard.id === cardId);
        if (index >= 0) return { player: item, index, card: item.cards[index] };
      }
      return null;
    },
    revealCardTo: (playerId, cardId, ms) => calls.reveals.push({ playerId, cardId, ms }),
    setTimeoutFn: (fn, ms) => {
      calls.scheduled.push({ fn, ms });
      return { unref() {} };
    },
    broadcastState: () => { calls.broadcasts += 1; }
  };
  return { actions: createGameActions(deps), calls };
}

test('taking deck and pile cards sets drawn card and closes throw-in', () => {
  const state = stateWithTurn();
  const { actions, calls } = actionsFor(state);

  const deckCard = actions.takeDeckForPlayer(state.players[0]);
  assert.equal(deckCard.id, 'd2');
  assert.equal(state.round.drawn.card.id, 'd2');
  assert.equal(state.round.drawn.source, 'deck');
  assert.equal(state.round.throwIn.open, false);

  state.round.drawn = null;
  state.round.throwIn.open = true;
  const pileCard = actions.takePileForPlayer(state.players[0]);
  assert.equal(pileCard.id, 'p1');
  assert.equal(state.round.drawn.source, 'pile');
  assert.deepEqual(calls.pileTakes, [{ playerId: 'ada', card: pileCard }]);
});

test('discarding and swapping drawn cards complete the turn', () => {
  const state = stateWithTurn();
  const { actions, calls } = actionsFor(state);

  state.round.drawn = { playerId: 'ada', source: 'deck', card: card('d3', 'J') };
  const discarded = actions.discardDrawnForPlayer(state.players[0]);
  assert.equal(discarded.id, 'd3');
  assert.equal(state.round.drawn, null);
  assert.equal(state.round.turnComplete, true);
  assert.equal(calls.pushDiscard.reason, 'drew {card} from deck but discarded it');

  state.round.turnComplete = false;
  state.round.drawn = { playerId: 'ada', source: 'deck', card: card('d4', 'A') };
  const result = actions.swapDrawnForPlayer(state.players[0], 'a1');
  assert.equal(result.oldCard.id, 'a1');
  assert.equal(state.players[0].cards[0].id, 'd4');
  assert.equal(state.round.turnComplete, true);
  assert.deepEqual(calls.forgottenAll, [{ ownerId: 'ada', index: 0, source: 'deck swap' }]);
});

test('throw-in handles valid and wrong cards', () => {
  const state = stateWithTurn();
  const { actions, calls } = actionsFor(state);

  const valid = actions.throwInForPlayer(state.players[0], 'a1');
  assert.equal(valid.valid, true);
  assert.equal(state.players[0].cards.some((item) => item.id === 'a1'), false);
  assert.equal(state.round.throwIn.open, false);
  assert.equal(calls.pushDiscard.reason, 'threw in');
  assert.deepEqual(calls.removedAll, [{ ownerId: 'ada', index: 0, source: 'throw-in' }]);

  state.round.throwIn = { open: true, rank: 'K' };
  const wrong = actions.throwInForPlayer(state.players[0], 'a2');
  assert.equal(wrong.valid, false);
  assert.equal(wrong.penalty.id, 'd2');
  assert.equal(state.players[0].cards.some((item) => item.id === 'd2'), false);
  assert.equal(calls.unknownSlots.length, 0);
  assert.equal(calls.logs.length, 0);
  assert.equal(calls.scheduled.at(-1).ms, 1500);
  assert.deepEqual(calls.cardHighlights.at(-1), { cardId: 'a2', kind: 'wrong-throw', ms: 2200, options: { playerId: 'ada' } });

  calls.scheduled.at(-1).fn();
  assert.equal(state.players[0].cards.at(-1).id, 'd2');
  assert.deepEqual(calls.unknownSlots.at(-1), { ownerId: 'ada', source: 'wrong throw-in penalty' });
  assert.equal(calls.logs.at(-1), 'ADA made a wrong throw-in and took a penalty card');
  assert.equal(calls.broadcasts, 1);
});

test('Ace and Queen special actions mutate targets and finish the special', () => {
  const state = stateWithTurn();
  const { actions, calls } = actionsFor(state);

  state.round.stage = 'special';
  state.round.specialQueue = [{ type: 'A', actorId: 'ada' }];
  const aceUsed = actions.aceAddForPlayer(state.players[0], 'ben');
  assert.equal(aceUsed, true);
  assert.equal(state.players[1].cards.at(-1).id, 'd2');
  assert.deepEqual(calls.aceObservations, [{ actorId: 'ada', targetId: 'ben' }]);
  assert.equal(state.round.specialQueue.length, 0);

  state.round.specialQueue = [{ type: 'Q', actorId: 'ada' }];
  const queenUsed = actions.queenPeekForPlayer(state.players[0], 'b1');
  assert.equal(queenUsed, true);
  assert.deepEqual(calls.reveals.at(-1), { playerId: 'ada', cardId: 'b1', ms: 3000 });
  assert.deepEqual(calls.cardHighlights.at(-1), { cardId: 'b1', kind: 'peek', ms: 3000, options: { exceptViewerId: 'ada' } });
  assert.equal(state.round.specialQueue.length, 0);
});
