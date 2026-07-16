const test = require('node:test');
const assert = require('node:assert/strict');
const { createBotDecisions } = require('../lib/bot-decisions.js');
const {
  cardMemory,
  unknownMemory,
  effectiveMemory: baseEffectiveMemory
} = require('../lib/bot-strategy.js');

function card(id, rank, suit = 'clubs') {
  return { id, rank, suit, deckColor: 'blue' };
}

function player(id, cards, total = 0, extra = {}) {
  return {
    id,
    name: id.toUpperCase(),
    cards,
    total,
    left: false,
    isSpectator: false,
    ...extra
  };
}

function setup() {
  const bot = player('bot', [card('b1', '10'), card('b2', '2')], 42, { isBot: true, botType: 'strategic' });
  const opponent = player('opp', [card('o1', '3'), card('o2', 'Q')], 58);
  const state = {
    deckSetting: 'one',
    gameTarget: 100,
    players: [bot, opponent],
    round: {
      currentPlayerIndex: 0,
      discard: [card('d1', '4')],
      dutchCallerId: ''
    }
  };
  const memory = {
    bot: {
      slots: {
        bot: [
          cardMemory(bot.cards[0], 'own peek', 1, 'known', 0),
          cardMemory(bot.cards[1], 'own peek', 1, 'known', 0)
        ],
        opp: [
          cardMemory(opponent.cards[0], 'seen', 1, 'known', 0),
          unknownMemory('unknown', 0)
        ]
      },
      discards: []
    }
  };
  const decisions = createBotDecisions({
    getState: () => state,
    ensureBotMemory: (item) => memory[item.id],
    botMemoryEntry: (viewer, ownerId, index) => memory[viewer.id].slots[ownerId][index],
    effectiveMemory: (viewer, entry) => baseEffectiveMemory(viewer, entry, 0),
    activePlayablePlayers: () => state.players.filter((item) => !item.left && !item.isSpectator),
    isProtectedSpecialTarget: () => false,
    findActiveIndexFrom: (start) => start,
    randomBetween: (min, max) => (min + max) / 2
  });
  return { state, bot, opponent, decisions };
}

test('bot decision scoring estimates known cards and unknown cards separately', () => {
  const { bot, opponent, decisions } = setup();

  assert.equal(decisions.botExpectedRoundScore(bot, bot), 12);
  assert.equal(decisions.botExpectedRoundScore(bot, opponent) > 3, true);
  assert.equal(decisions.botExpectedRoundScore(bot, opponent) < 10, true);
  assert.equal(decisions.botRoundScoreConfidence(bot), 1);
});

test('swap targets prefer replacing the highest-cost own card', () => {
  const { bot, decisions } = setup();

  const targets = decisions.botSwapTargets(bot, card('drawn', 'A', 'hearts'));

  assert.equal(targets[0].index, 0);
  assert.equal(targets[0].card.rank, '10');
  assert.equal(targets[0].improvement > targets[1].improvement, true);
});

test('risk mode and throw threshold use table position and target pressure', () => {
  const { state, bot, decisions } = setup();

  assert.equal(decisions.botRiskMode(bot), 'ahead');
  assert.equal(decisions.botThrowThreshold(bot) > 0.68, true);

  bot.total = 92;
  state.players[1].total = 40;
  assert.equal(decisions.botRiskMode(bot), 'behind');
  assert.equal(decisions.botThrowThreshold(bot) < 0.68, true);
});

test('rank stats and special utility stay available outside the server', () => {
  const { bot, decisions } = setup();

  assert.deepEqual(decisions.rankStatsForBot(bot, '10'), {
    seen: 1,
    total: 4,
    remaining: 3
  });
  assert.equal(decisions.specialActionValue(bot, { rank: 'Q' }) > 2, true);
});


test('special target helpers choose Ace, Queen, and Jack targets', () => {
  const { bot, opponent, decisions } = setup();

  const aceTarget = decisions.botAceTarget(bot);
  assert.equal(aceTarget.player.id, opponent.id);
  assert.equal(aceTarget.aceScore > 0, true);

  const queenTarget = decisions.botQueenTarget(bot);
  assert.equal(queenTarget.player.id, opponent.id);
  assert.equal(queenTarget.index, 1);

  const jackCandidates = decisions.botJackCandidates(bot);
  assert.equal(jackCandidates.length > 0, true);
  assert.equal(jackCandidates[0].type, 'self');
});

test('Dutch and throw-in helpers use expected scores and known ranks', () => {
  const { state, bot, decisions } = setup();

  assert.equal(decisions.botShouldCallDutch(bot), false);

  bot.cards = [card('b1', '2'), card('b2', 'K', 'hearts')];
  const memory = decisions.botOwnSlots(bot);
  memory[0].memory.card = { rank: '2', suit: 'clubs', red: false, points: 2 };
  memory[0].memory.rank = '2';
  memory[1].memory.card = { rank: 'K', suit: 'hearts', red: true, points: 0 };
  memory[1].memory.rank = 'K';
  assert.equal(decisions.botShouldCallDutch(bot), true);

  state.round.throwIn = { open: true, rank: '2' };
  const candidate = decisions.botThrowInCandidate(bot);
  assert.equal(candidate.index, 0);
});
