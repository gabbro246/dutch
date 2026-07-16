const { SUITS, RANKS } = require('../public/shared.js');

function createDeck(deckColor, nextCardId) {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({
        id: `c${nextCardId()}`,
        rank,
        suit,
        deckColor
      });
    }
  }
  return deck;
}

function shuffle(cards, random = Math.random) {
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function createCombinedDeck(deckSetting, deps) {
  const random = deps.random || Math.random;
  const nextCardId = deps.nextCardId;
  let cards;
  let deckColor;
  if (deckSetting === 'one') {
    deckColor = random() < 0.5 ? 'red' : 'blue';
    cards = createDeck(deckColor, nextCardId);
  } else {
    deckColor = 'red+blue';
    cards = createDeck('red', nextCardId).concat(createDeck('blue', nextCardId));
  }
  return {
    cards: shuffle(cards, random),
    deckColor
  };
}

module.exports = {
  createDeck,
  createCombinedDeck,
  shuffle
};
