const test = require('node:test');
const assert = require('node:assert/strict');
const { createDutchRollout } = require('../lib/bot-dutch-rollout.js');

test('current Dutch rollout assigns shared unknown cards without replacement', () => {
  const bot = { id: 'bot', cards: [{}] };
  const opponent = { id: 'opponent', cards: [{}] };
  const cards = [
    { rank: 'A', suit: 'clubs', points: 1 },
    { rank: 'K', suit: 'spades', points: 13 }
  ];
  const distribution = cards.map((card) => ({ card, probability: 0.5 }));
  const ctx = {
    bot,
    opponents: [opponent],
    belief: {
      counts: new Map([
        ['A:clubs', 1],
        ['K:spades', 1]
      ]),
      drawDistribution: distribution
    },
    slotCardDistributionFor: () => distribution
  };
  const rollout = createDutchRollout({
    activePlayablePlayers: () => [bot, opponent],
    botMemoryEntry: () => null,
    currentEvaluation: () => ({}),
    effectiveMemory: () => ({ confidence: 0, card: null }),
    isRedKing: () => false,
    opponentDistributions: () => [],
    opponentThreatState: () => ({ profiles: [] }),
    strategyRelease: '1.3.65'
  });

  for (let sample = 0; sample < 20; sample += 1) {
    let roll = (sample + 0.5) / 20;
    const world = rollout.sampleRolloutWorld(ctx, () => {
      roll = (roll * 1.7 + 0.19) % 1;
      return roll;
    });
    const assigned = [
      world.hands.get(bot.id)[0],
      world.hands.get(opponent.id)[0]
    ].map((card) => card.rank + ':' + card.suit);
    assert.equal(new Set(assigned).size, 2);
    assert.equal(Array.from(world.remainingCounts.values()).reduce((sum, count) => sum + count, 0), 0);
  }
});
