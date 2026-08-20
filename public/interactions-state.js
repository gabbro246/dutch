(function initInteractionState(root, factory) {
  const api = factory(
    typeof module === 'object' && module.exports
      ? require('./shared.js')
      : root.DutchShared
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DutchInteractionState = api;
})(typeof window !== 'undefined' ? window : globalThis, function createInteractionState(shared) {
  const PLAYER_DEFINITIONS = Object.freeze([
    { id: 'you', name: 'You' },
    { id: 'player-2', name: 'Player 2' },
    { id: 'player-3', name: 'Player 3' }
  ]);
  const DEFAULT_CARDS_PER_PLAYER = 4;
  const SUITS = shared.SUITS;
  const RANKS = shared.RANKS;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function randomItem(items, random = Math.random) {
    return items[Math.floor(random() * items.length)];
  }

  function differentRank(rank, random = Math.random) {
    return randomItem(RANKS.filter((candidate) => candidate !== rank), random);
  }

  function actionTypeForRank(rank) {
    return ['A', 'Q', 'J'].includes(rank) ? rank : '';
  }

  function makeCard(id, options = {}) {
    const random = options.random || Math.random;
    const rank = options.rank || randomItem(RANKS, random);
    const suit = options.suit || randomItem(SUITS, random);
    return {
      id: String(id),
      rank,
      suit,
      symbol: shared.suitSymbol(suit),
      red: shared.isRedSuit(suit),
      points: shared.cardPoints({ rank, suit }),
      deckColor: options.deckColor || 'blue',
      back: options.back !== false,
      highlight: options.highlight || ''
    };
  }

  function setCardRank(card, rank, random = Math.random) {
    const suit = card.suit || randomItem(SUITS, random);
    return makeCard(card.id, {
      rank,
      suit,
      deckColor: card.deckColor,
      back: card.back,
      highlight: card.highlight,
      random
    });
  }

  function createPlayer(definition, nextId, random, cardCount = DEFAULT_CARDS_PER_PLAYER) {
    return {
      ...definition,
      cards: Array.from({ length: cardCount }, () => makeCard(nextId(), { random, back: true })),
      total: 0,
      roundPoints: null,
      connected: true
    };
  }

  function createInitialState(options = {}) {
    const random = options.random || Math.random;
    let counter = Number(options.counter) || 0;
    const nextId = () => 'lab-card-' + String(++counter);
    const cardCount = options.cardCount === undefined ? DEFAULT_CARDS_PER_PLAYER : options.cardCount;
    const players = PLAYER_DEFINITIONS.map((definition) => createPlayer(definition, nextId, random, cardCount));
    const discardTop = makeCard(nextId(), { random, back: false });
    return {
      phase: 'playing',
      joined: true,
      you: 'you',
      gameStartedAt: Number(options.gameStartedAt) || 1,
      roundNumber: Number(options.roundNumber) || 1,
      highlightChangedCards: true,
      preferences: {
        theme: 'light',
        language: 'en',
        sounds: true,
        settingsOpen: true
      },
      sequence: counter,
      round: {
        stage: 'peek',
        players,
        currentPlayerId: 'you',
        turnComplete: false,
        deckCount: 24,
        discardCount: 1,
        discardTop,
        deckBack: 'blue',
        drawn: null,
        pendingPileReveal: null,
        openingDiscardFlipMs: 260,
        reshuffleToken: 0,
        reshuffleCardCount: 0,
        wrongThrowIn: null,
        wrongThrowPenalty: null,
        cardAddEvent: null,
        peekEvent: null,
        special: null,
        infoEvent: null,
        dutchCallerId: '',
        roundWinnerIds: [],
        winnerId: ''
      }
    };
  }

  function nextCard(state, options = {}) {
    state.sequence = (Number(state.sequence) || 0) + 1;
    return makeCard('lab-card-' + String(state.sequence), options);
  }

  function nextEventId(state, label) {
    state.sequence = (Number(state.sequence) || 0) + 1;
    return label + '-' + String(state.sequence);
  }

  function playerById(state, playerId) {
    return state.round.players.find((player) => player.id === playerId) || null;
  }

  function cardLocation(state, cardId) {
    for (const player of state.round.players) {
      const index = player.cards.findIndex((card) => card.id === cardId);
      if (index >= 0) return { player, index, card: player.cards[index] };
    }
    return null;
  }

  function clearTransientEvents(state) {
    state.round.players.forEach((player) => player.cards.forEach((card) => {
      card.back = true;
      card.highlight = '';
    }));
    state.round.pendingPileReveal = null;
    state.round.wrongThrowIn = null;
    state.round.wrongThrowPenalty = null;
    state.round.cardAddEvent = null;
    state.round.peekEvent = null;
    state.round.special = null;
    state.round.infoEvent = null;
    state.round.roundWinnerIds = [];
    state.round.winnerId = '';
    if (state.round.stage !== 'opening') state.round.stage = 'turn';
    return state;
  }

  return {
    PLAYER_DEFINITIONS,
    DEFAULT_CARDS_PER_PLAYER,
    clone,
    randomItem,
    differentRank,
    actionTypeForRank,
    makeCard,
    setCardRank,
    createInitialState,
    nextCard,
    nextEventId,
    playerById,
    cardLocation,
    clearTransientEvents
  };
});
