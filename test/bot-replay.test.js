const test = require('node:test');
const assert = require('node:assert/strict');
const { createDeterministicRandom } = require('../lib/deterministic-rng.js');
const {
  createReplayArchive,
  recordReplayRoundStart,
  recordReplayDecision,
  counterfactualReplay,
  replayArchiveFromFinishedLog
} = require('../lib/bot-replay.js');
const { finishedGameLogText } = require('../lib/game-log.js');

function card(id, rank) {
  return { id, rank, suit: 'clubs', deckColor: 'blue' };
}

test('deterministic RNG restores the same random stream from seed and snapshot', () => {
  const first = createDeterministicRandom(123456);
  const prefix = [first(), first(), first()];
  const checkpoint = first.snapshot();
  const suffix = [first(), first()];

  const second = createDeterministicRandom(123456);
  assert.deepEqual([second(), second(), second()], prefix);
  second.restore(checkpoint);
  assert.deepEqual([second(), second()], suffix);
});

test('replay archive records full shuffle, initial hands, memory, and strategy checkpoints', () => {
  const bot = {
    id: 'bot',
    name: 'Bot',
    botType: 'roswell',
    isBot: true,
    left: false,
    isSpectator: false,
    total: 0,
    cards: [card('b1', '2')],
    botMemory: { slots: { bot: [{ knownRank: '2', confidence: 1 }] } }
  };
  const human = {
    id: 'human',
    name: 'Human',
    isBot: false,
    left: false,
    isSpectator: false,
    total: 0,
    cards: [card('h1', '9')]
  };
  const state = {
    phase: 'playing',
    deckSetting: 'one',
    deckColor: 'blue',
    gameTarget: 100,
    roundNumber: 1,
    scoreHistory: [],
    players: [bot, human],
    round: {
      stage: 'turn',
      strategyTick: 0,
      deck: [card('d1', '4'), card('d2', '5')],
      discard: [card('p1', '7')],
      currentPlayerIndex: 0
    },
    replayArchive: createReplayArchive(77, { seed: 77, state: 77, drawCount: 0 })
  };
  const shuffled = [
    card('d1', '4'), card('d2', '5'), card('b1', '2'), card('h1', '9')
  ];

  recordReplayRoundStart(
    state,
    shuffled,
    { seed: 77, state: 77, drawCount: 0 },
    { seed: 77, state: 99, drawCount: 3 }
  );
  const diagnostic = {
    strategyTick: 1,
    decision: 'draw-source',
    selected: 'draw-deck',
    selectedAction: { actionType: 'draw-deck', value: 4 },
    actions: [
      { actionType: 'draw-deck', value: 4, eligible: true },
      { actionType: 'take-pile', value: 3, eligible: true },
      { actionType: 'illegal', value: 99, eligible: false, legallyAvailable: false }
    ]
  };
  recordReplayDecision(state, bot, diagnostic, { seed: 77, state: 101, drawCount: 4 });

  const round = state.replayArchive.rounds[0];
  const decision = state.replayArchive.decisions[0];
  assert.deepEqual(round.shuffledDeckOrder, shuffled);
  assert.deepEqual(round.initialHands[0].cards, bot.cards);
  assert.equal(round.initialBotMemory[0].memory.slots.bot[0].knownRank, '2');
  assert.deepEqual(decision.checkpoint.round.deck, state.round.deck);
  assert.equal(decision.botMemory.slots.bot[0].confidence, 1);
  assert.equal(decision.candidates.length, 3);
  assert.equal(decision.selectedAction.actionType, 'draw-deck');
});

test('counterfactual replay starts every legal action from an isolated identical checkpoint', () => {
  const archive = createReplayArchive(9);
  archive.initialState = { round: { deck: ['initial-secret'] } };
  archive.decisions.push({
    round: 2,
    strategyTick: 14,
    botId: 'bot',
    decision: 'draw-response',
    randomState: { seed: 9, state: 99, drawCount: 7 },
    botMemory: { confidence: 1 },
    checkpoint: { round: { deck: ['hidden-a', 'hidden-b'] }, marker: 0 },
    selected: 'discard-drawn',
    candidates: [
      { actionType: 'discard-drawn', value: 5, eligible: true },
      { actionType: 'swap-drawn', value: 4, eligible: true },
      { actionType: 'blocked', value: 100, eligible: false, legallyAvailable: false }
    ]
  });
  const seen = [];
  const replay = counterfactualReplay(
    archive,
    { round: 2, strategyTick: 14, botId: 'bot' },
    ({ state, hiddenDeck, candidate, randomState, gameSeed }) => {
      seen.push({
        marker: state.marker,
        deck: hiddenDeck.slice(),
        randomState,
        gameSeed,
        actionType: candidate.actionType
      });
      state.marker = 99;
      hiddenDeck.pop();
      return { applied: candidate.actionType };
    }
  );

  assert.equal(replay.results.length, 2);
  assert.deepEqual(seen.map((entry) => entry.actionType), ['discard-drawn', 'swap-drawn']);
  assert.ok(seen.every((entry) => entry.marker === 0));
  assert.ok(seen.every((entry) => entry.deck.length === 2));
  assert.ok(seen.every((entry) => entry.randomState.drawCount === 7 && entry.gameSeed === 9));
  assert.deepEqual(archive.decisions[0].checkpoint.round.deck, ['hidden-a', 'hidden-b']);
});

test('private replay data is serialized only in the finished-game log and can be loaded', () => {
  const archive = createReplayArchive(314);
  archive.initialState = { round: { deck: [card('secret', 'K')] } };
  const text = finishedGameLogText({
    winnerName: 'Ada',
    gameTarget: 100,
    roundNumber: 1,
    scoreHistory: [],
    log: [],
    replayArchive: archive
  });

  assert.match(text, /Deterministic replay archive \(post-game only\):/);
  assert.deepEqual(replayArchiveFromFinishedLog(text), archive);
});
