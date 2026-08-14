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

function actionsFor(state, overrides = {}) {
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
    changedCards: [],
    pileHighlights: [],
    reveals: [],
    infoEvents: [],
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
    markHandCardChanged: (ownerId, cardId) => calls.changedCards.push({ ownerId, cardId }),
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
    showInfoEvent: (text) => calls.infoEvents.push(text),
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
    broadcastState: () => { calls.broadcasts += 1; },
    ...overrides
  };
  return { actions: createGameActions(deps), calls };
}

test('taking a deck card keeps throw-in open while taking the pile closes it', () => {
  const state = stateWithTurn();
  const { actions, calls } = actionsFor(state);

  const deckCard = actions.takeDeckForPlayer(state.players[0]);
  assert.equal(deckCard.id, 'd2');
  assert.equal(state.round.drawn.card.id, 'd2');
  assert.equal(state.round.drawn.source, 'deck');
  assert.equal(state.round.throwIn.open, true);

  state.round.drawn = null;
  const pileCard = actions.takePileForPlayer(state.players[0]);
  assert.equal(pileCard.id, 'p1');
  assert.equal(state.round.drawn.source, 'pile');
  assert.equal(state.round.throwIn.open, false);
  assert.deepEqual(calls.pileTakes, [{ playerId: 'ada', card: pileCard }]);
});

function explicitShuffleDeps(state) {
  return {
    drawFromDeck: () => {
      const round = state.round;
      if (round.deck.length === 0) {
        round.needsReshuffle = round.discard.length > 1;
        return null;
      }
      const drawn = round.deck.pop();
      round.needsReshuffle = round.deck.length === 0 && round.discard.length > 1;
      return drawn;
    },
    reshuffleDrawPile: () => {
      const round = state.round;
      if (round.deck.length > 0 || round.discard.length <= 1) return false;
      const top = round.discard.pop();
      round.deck = round.discard.splice(0).reverse();
      round.discard = [top];
      round.needsReshuffle = false;
      round.reshuffleToken = (round.reshuffleToken || 0) + 1;
      return true;
    },
    activePlayablePlayers: () => state.players.filter((item) => !item.left && !item.isSpectator)
  };
}

test('Ace draw pauses for shuffle and continues against the original target', () => {
  const state = stateWithTurn();
  const top = state.round.discard[0];
  state.round.deck = [];
  state.round.discard = [card('buried-1', '2'), card('buried-2', '3'), top];
  state.round.stage = 'special';
  state.round.specialQueue = [{ type: 'A', actorId: 'ada' }];
  const { actions, calls } = actionsFor(state, explicitShuffleDeps(state));
  const targetCount = state.players[1].cards.length;

  assert.equal(actions.aceAddForPlayer(state.players[0], 'ben'), true);
  assert.equal(state.round.needsReshuffle, true);
  assert.equal(state.round.specialQueue.length, 1);
  assert.equal(state.players[1].cards.length, targetCount);

  assert.equal(actions.shuffleForPlayer(state.players[0]), true);

  assert.equal(state.round.discard[0], top);
  assert.equal(state.players[1].cards.length, targetCount + 1);
  assert.equal(state.players[1].cards.at(-1).id, 'buried-1');
  assert.deepEqual(state.round.cardAddEvent, {
    id: 'buried-1:ace',
    playerId: 'ben',
    source: 'ace'
  });
  assert.equal(state.round.specialQueue.length, 0);
  assert.deepEqual(calls.aceObservations, [{ actorId: 'ada', targetId: 'ben' }]);
});

test('wrong-throw penalty pauses for shuffle and is still applied afterward', () => {
  const state = stateWithTurn();
  const top = state.round.discard[0];
  state.round.deck = [];
  state.round.discard = [card('penalty', '7'), card('buried', '6'), top];
  state.round.throwIn.rank = 'K';
  const { actions, calls } = actionsFor(state, explicitShuffleDeps(state));
  const handCount = state.players[0].cards.length;

  const result = actions.throwInForPlayer(state.players[0], 'a2');
  assert.equal(result.pending, true);
  assert.equal(state.round.needsReshuffle, true);
  assert.equal(calls.scheduled.length, 0);

  assert.equal(actions.shuffleForPlayer(state.players[1]), true);
  assert.equal(calls.scheduled.length, 1);
  calls.scheduled[0].fn();

  assert.equal(state.round.discard[0], top);
  assert.equal(state.players[0].cards.length, handCount + 1);
  assert.equal(state.players[0].cards.at(-1).id, 'penalty');
  assert.deepEqual(state.round.wrongThrowPenalty, {
    id: 'penalty:a2',
    cardId: 'penalty',
    playerId: 'ada',
    wrongThrowCardId: 'a2'
  });
  assert.deepEqual(state.round.cardAddEvent, {
    id: 'penalty:wrong-throw:a2',
    playerId: 'ada',
    source: 'wrong-throw'
  });
  assert.equal(calls.logs.at(-1), 'ADA made a wrong throw-in and took a penalty card');
});

test('a player can throw in after the current player draws from the deck', () => {
  const state = stateWithTurn();
  const { actions } = actionsFor(state);

  state.players[1].cards[0].rank = '8';
  assert.ok(actions.takeDeckForPlayer(state.players[0]));
  const result = actions.throwInForPlayer(state.players[1], 'b1');

  assert.equal(result.valid, true);
  assert.equal(state.round.drawn.card.id, 'd2');
  assert.equal(state.players[1].cards.some((item) => item.id === 'b1'), false);
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
  assert.deepEqual(calls.pushDiscard.options, { observationSource: 'discarded', observationActorId: 'ada' });
  assert.deepEqual(calls.discards, []);

  state.round.turnComplete = false;
  state.round.drawn = { playerId: 'ada', source: 'deck', card: card('d4', 'A') };
  const result = actions.swapDrawnForPlayer(state.players[0], 'a1');
  assert.equal(result.oldCard.id, 'a1');
  assert.equal(state.players[0].cards[0].id, 'd4');
  assert.equal(state.round.turnComplete, true);
  assert.deepEqual(calls.forgottenAll, [{ ownerId: 'ada', index: 0, source: 'deck swap' }]);
  assert.deepEqual(calls.changedCards, [{ ownerId: 'ada', cardId: 'd4' }]);
  assert.deepEqual(calls.pushDiscard.options, { observationSource: 'swap discard', observationActorId: 'ada' });
  assert.deepEqual(calls.discards, []);
});

test('throw-in handles valid and wrong cards', () => {
  const state = stateWithTurn();
  const { actions, calls } = actionsFor(state);

  const valid = actions.throwInForPlayer(state.players[0], 'a1');
  assert.equal(valid.valid, true);
  assert.equal(state.players[0].cards.some((item) => item.id === 'a1'), false);
  assert.equal(state.round.throwIn.open, false);
  assert.deepEqual(calls.pushDiscard.options, {
    allowThrowIn: false,
    observationSource: 'throw-in',
    observationActorId: 'ada',
    removedSlotOwnerId: 'ada',
    removedSlotIndex: 0,
    removedSlotSource: 'throw-in',
    infoEventText: 'ADA threw in an 8c'
  });
  assert.equal(calls.pushDiscard.reason, 'threw in');
  assert.deepEqual(calls.removedAll, []);

  state.round.throwIn = { open: true, rank: 'K' };
  const wrong = actions.throwInForPlayer(state.players[0], 'a2');
  assert.equal(wrong.valid, false);
  assert.equal(wrong.penalty.id, 'd2');
  assert.equal(state.players[0].cards.some((item) => item.id === 'd2'), false);
  assert.equal(state.round.pendingWrongThrowPenalties, 1);
  assert.equal(calls.unknownSlots.length, 0);
  assert.equal(calls.logs.length, 0);
  assert.equal(calls.scheduled.at(-1).ms, 1500);
  assert.deepEqual(calls.cardHighlights.at(-1), { cardId: 'a2', kind: 'wrong-throw', ms: 2200, options: { playerId: 'ada' } });

  calls.scheduled.at(-1).fn();
  assert.equal(state.round.pendingWrongThrowPenalties, 0);
  assert.equal(state.players[0].cards.at(-1).id, 'd2');
  assert.deepEqual(state.round.wrongThrowPenalty, {
    id: 'd2:a2',
    cardId: 'd2',
    playerId: 'ada',
    wrongThrowCardId: 'a2'
  });
  assert.deepEqual(state.round.cardAddEvent, {
    id: 'd2:wrong-throw:a2',
    playerId: 'ada',
    source: 'wrong-throw'
  });
  assert.deepEqual(calls.unknownSlots.at(-1), { ownerId: 'ada', source: 'wrong throw-in penalty' });
  assert.deepEqual(calls.changedCards.at(-1), { ownerId: 'ada', cardId: 'd2' });
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
  assert.deepEqual(state.round.cardAddEvent, {
    id: 'd2:ace',
    playerId: 'ben',
    source: 'ace'
  });
  assert.deepEqual(calls.aceObservations, [{ actorId: 'ada', targetId: 'ben' }]);
  assert.deepEqual(calls.changedCards, [{ ownerId: 'ben', cardId: 'd2' }]);
  assert.equal(state.round.specialQueue.length, 0);
  assert.deepEqual(calls.infoEvents, ['ADA used Ace add']);

  state.round.specialQueue = [{ type: 'Q', actorId: 'ada' }];
  const queenUsed = actions.queenPeekForPlayer(state.players[0], 'b1');
  assert.equal(queenUsed, true);
  assert.deepEqual(calls.reveals.at(-1), { playerId: 'ada', cardId: 'b1', ms: 3000 });
  assert.deepEqual(calls.cardHighlights.at(-1), { cardId: 'b1', kind: 'peek', ms: 3000, options: { exceptViewerId: 'ada' } });
  assert.deepEqual(calls.infoEvents, ['ADA used Ace add', 'ADA used Queen peek']);
  assert.equal(state.round.specialQueue.length, 0);
});
