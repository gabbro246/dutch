const REPLAY_SCHEMA_VERSION = 1;

function cloneReplayValue(value) {
  if (value == null) return value;
  const ancestors = [];
  return JSON.parse(JSON.stringify(value, function replayReplacer(key, item) {
    if (!item || typeof item !== 'object') return item;
    while (ancestors.length && ancestors[ancestors.length - 1] !== this) ancestors.pop();
    if (ancestors.includes(item)) return '[Circular]';
    ancestors.push(item);
    return item;
  }));
}

function replayMemorySnapshot(memory) {
  if (!memory) return memory;
  const snapshot = { ...memory };
  delete snapshot.lastDecision;
  return cloneReplayValue(snapshot);
}

function replayPlayerSnapshot(player) {
  return cloneReplayValue({
    ...player,
    botMemory: player && player.isBot ? replayMemorySnapshot(player.botMemory) : undefined
  });
}

function replayStateSnapshot(state) {
  if (!state) return null;
  return cloneReplayValue({
    phase: state.phase,
    deckSetting: state.deckSetting,
    deckColor: state.deckColor,
    gameTarget: state.gameTarget,
    roundNumber: state.roundNumber,
    scoreHistory: state.scoreHistory,
    players: state.players.map(replayPlayerSnapshot),
    round: state.round
  });
}

function createReplayArchive(seed, initialRandomState = null) {
  return {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    gameSeed: Number(seed) >>> 0,
    initialRandomState: cloneReplayValue(initialRandomState),
    initialState: null,
    nextStrategyTick: 0,
    rounds: [],
    decisions: []
  };
}

function recordReplayRoundStart(state, shuffledDeckOrder, randomBeforeShuffle, randomAfterDeal) {
  const archive = state && state.replayArchive;
  if (!archive || !state.round) return null;
  const entry = {
    round: state.roundNumber,
    randomBeforeShuffle: cloneReplayValue(randomBeforeShuffle),
    randomAfterDeal: cloneReplayValue(randomAfterDeal),
    shuffledDeckOrder: cloneReplayValue(shuffledDeckOrder),
    initialHands: state.players.filter((player) => !player.left && !player.isSpectator).map((player) => ({
      playerId: player.id,
      cards: cloneReplayValue(player.cards)
    })),
    initialBotMemory: state.players.filter((player) => player.isBot).map((player) => ({
      playerId: player.id,
      memory: replayMemorySnapshot(player.botMemory)
    })),
    initialState: replayStateSnapshot(state)
  };
  archive.rounds.push(entry);
  if (!archive.initialState) archive.initialState = cloneReplayValue(entry.initialState);
  return entry;
}

function recordReplayDecision(state, bot, diagnostic, randomState = null) {
  const archive = state && state.replayArchive;
  if (!archive || !state.round || !bot || !diagnostic) return null;
  const entry = {
    round: state.roundNumber,
    strategyTick: diagnostic.strategyTick,
    botId: bot.id,
    botName: bot.name,
    botType: bot.botType,
    decision: diagnostic.decision,
    randomState: cloneReplayValue(randomState),
    botMemory: replayMemorySnapshot(bot.botMemory),
    candidates: cloneReplayValue(diagnostic.actions || []),
    selected: diagnostic.selected,
    selectedAction: cloneReplayValue(diagnostic.selectedAction),
    exception: cloneReplayValue(diagnostic.exception),
    checkpoint: replayStateSnapshot(state)
  };
  archive.decisions.push(entry);
  return entry;
}

function findReplayDecision(archive, query = {}) {
  if (!archive || !Array.isArray(archive.decisions)) return null;
  const tick = Number(query.strategyTick);
  return archive.decisions.find((entry) => (
    (!Number.isFinite(tick) || entry.strategyTick === tick) &&
    (query.round == null || entry.round === Number(query.round)) &&
    (!query.botId || entry.botId === query.botId) &&
    (!query.decision || entry.decision === query.decision)
  )) || null;
}

function counterfactualReplay(archive, query = {}, evaluateCandidate = null) {
  const decision = findReplayDecision(archive, query);
  if (!decision) throw new Error('Strategy tick was not found in the replay archive.');
  const legalCandidates = (decision.candidates || []).filter((candidate) => candidate.legallyAvailable !== false);
  const evaluate = typeof evaluateCandidate === 'function'
    ? evaluateCandidate
    : ({ candidate }) => ({
      recordedActionValue: candidate.value,
      expectedPostRoundTotal: candidate.expectedPostRoundTotal,
      expectedThresholdAdjustedTotal: candidate.expectedThresholdAdjustedTotal,
      estimatedGameWinProbability: candidate.estimatedGameWinProbability
    });
  const results = legalCandidates.map((candidate) => {
    const state = cloneReplayValue(decision.checkpoint);
    const botMemory = cloneReplayValue(decision.botMemory);
    const randomState = cloneReplayValue(decision.randomState);
    return {
      candidate: cloneReplayValue(candidate),
      result: evaluate({
        state,
        botMemory,
        randomState,
        candidate: cloneReplayValue(candidate),
        hiddenDeck: state && state.round ? state.round.deck : [],
        initialState: cloneReplayValue(archive.initialState),
        gameSeed: archive.gameSeed
      })
    };
  });
  return {
    schemaVersion: archive.schemaVersion,
    gameSeed: archive.gameSeed,
    round: decision.round,
    strategyTick: decision.strategyTick,
    botId: decision.botId,
    decision: decision.decision,
    selected: decision.selected,
    checkpoint: cloneReplayValue(decision.checkpoint),
    results
  };
}

function replayArchiveFromFinishedLog(text) {
  const marker = 'Deterministic replay archive (post-game only):';
  const lines = String(text || '').split(/\r?\n/);
  const index = lines.findIndex((line) => line.trim() === marker);
  if (index < 0) return null;
  const json = lines.slice(index + 1).find((line) => line.trim());
  return json ? JSON.parse(json) : null;
}

module.exports = {
  REPLAY_SCHEMA_VERSION,
  cloneReplayValue,
  replayMemorySnapshot,
  replayStateSnapshot,
  createReplayArchive,
  recordReplayRoundStart,
  recordReplayDecision,
  findReplayDecision,
  counterfactualReplay,
  replayArchiveFromFinishedLog
};
