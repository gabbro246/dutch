const test = require('node:test');
const assert = require('node:assert/strict');
const { chooseCharacterAction, strategyLimits } = require('../lib/bot-character.js');
const { cardMemory, effectiveMemory } = require('../lib/bot-strategy.js');

function card(rank = '7', suit = 'clubs') {
  return { id: rank + suit, rank, suit };
}

test('own memory lasts about twice as long as opponent memory for ordinary characters', () => {
  const own = { ...cardMemory(card('8'), 'own peek', 1, 'known', 0), ownerId: 'bot' };
  const opponent = { ...cardMemory(card('8'), 'Queen peek', 1, 'known', 0), ownerId: 'opponent' };
  const bot = { id: 'bot', botType: 'casual' };
  const ownEffective = effectiveMemory(bot, own, 24);
  const opponentEffective = effectiveMemory(bot, opponent, 24);

  assert.ok(ownEffective.confidence > opponentEffective.confidence);
  assert.ok(opponentEffective.confidence <= ownEffective.confidence * ownEffective.confidence + 0.03);
  assert.ok(opponentEffective.distribution.length > 0);
});

test('Roswell keeps legitimate observations without artificial decay', () => {
  const observed = { ...cardMemory(card('Q'), 'Queen peek', 0.97, 'known', 0), ownerId: 'opponent' };
  const effective = effectiveMemory({ id: 'bot', botType: 'roswell' }, observed, 10000);

  assert.equal(effective.confidence, 0.97);
  assert.equal(effective.card.rank, 'Q');
  assert.equal(effective.state, 'known');
});

test('character selection cannot override a clearly better common action', () => {
  const actions = [
    { actionType: 'best', actionValue: 12 },
    { actionType: 'near', actionValue: 11.8 },
    { actionType: 'bad', actionValue: 3 }
  ];
  const weak = { botType: 'distracted' };
  for (let index = 0; index < 20; index += 1) {
    assert.notEqual(chooseCharacterAction(weak, actions, () => index / 20).actionType, 'bad');
  }
  assert.equal(chooseCharacterAction({ botType: 'roswell' }, actions, () => 0.99).actionType, 'best');
  assert.ok(strategyLimits({ botType: 'roswell' }, true).samples > strategyLimits(weak, true).samples);
  assert.ok(strategyLimits({ botType: 'roswell' }, true).depth > strategyLimits({ botType: 'roswell' }, false).depth);
});
