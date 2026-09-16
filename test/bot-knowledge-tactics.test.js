const test = require('node:test');
const assert = require('node:assert/strict');
const { createSimpleTactics } = require('../lib/bot-simple-tactics.js');
const { cardPoints } = require('../public/shared.js');

const card = (rank, suit = 'clubs') => ({ rank, suit });

function finalTurn(own, opponents, draw) {
  const bot = { id: 'bot', botType: 'roswell-beta', isBot: true, total: 0, cards: own };
  const rival = { id: 'rival', isBot: true, total: 0, cards: opponents };
  const state = { players: [bot, rival], gameTarget: 100, round: { dutchCallerId: rival.id, discard: [draw], currentPlayerIndex: 0 } };
  const decisions = createSimpleTactics({
    getState: () => state,
    remainingCards: () => [draw, draw, draw],
    unknownExpectedPoints: () => cardPoints(draw),
    activePlayablePlayers: () => state.players,
    playerSlots: (_, player) => player.cards.map((known, index) => ({ player, index, card: known, memory: { source: 'peek', confidence: known ? 1 : 0 } }))
  });
  return decisions.evaluateDrawSources(bot).deck.utility;
}

test('a final-turn Queen peek can reveal and throw a matching Queen', () => {
  // All unseen cards are Queens. The slot is still unobserved until the peek.
  assert.equal(finalTurn([null], [card('10')], card('Q')), 0);
});

test('a Queen chain can peek again but cannot throw twice in the same opening', () => {
  assert.equal(finalTurn([null, null], [card('10')], card('Q')), -12);
  assert.equal(finalTurn([card('Q'), null], [card('10')], card('Q')), -12);
});

test('an opponent matching throw is valued using the matching card only', () => {
  const before = finalTurn([card('K', 'hearts')], [card('7'), card('8')], card('7'));
  const after = finalTurn([card('K', 'hearts')], [card('7'), card('K')], card('7'));
  assert.equal(after, before);
  assert.equal(after, -8 * 0.55);
});
