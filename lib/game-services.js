const { createServerRuntime } = require('./server-runtime.js');
const { freshState } = require('./game-state.js');
const { createIdCounter } = require('./id-counter.js');
const { createTableState } = require('./table-state.js');
const { createTableSettings } = require('./table-settings.js');
const { createCombinedDeck: createCombinedDeckForSetting, shuffle } = require('./deck.js');
const { BOT_PROFILES } = require('./bot-profiles.js');
const { createBotMemory } = require('./bot-memory.js');
const { applyRoundScoring, startingPlayerIndexForNextRound } = require('./game-rules.js');
const { saveFinishedGameLog: writeFinishedGameLog } = require('./game-log.js');
const { createGameView } = require('./game-view.js');
const { createGameActions } = require('./game-actions.js');
const { registerSocketHandlers } = require('./socket-handlers.js');
const { createPlayerSessions, playerIdForSocket } = require('./player-sessions.js');
const { createRoundLifecycle } = require('./round-lifecycle.js');
const { createPlayerCleanup } = require('./player-cleanup.js');
const { createTurnState } = require('./turn-state.js');
const { createCardFlow } = require('./card-flow.js');
const { rankValue } = require('./bot-strategy.js');
const { createBotDecisions } = require('./bot-decisions.js');
const { createBotRunner } = require('./bot-runner.js');
const {
  PLAYER_NAME_MAX_LENGTH,
  SPECIAL_RANKS,
  suitSymbol,
  specialName
} = require('../public/shared.js');

function createGameServices(options) {
  const io = options.io;
  const config = options.config;
  const setTimeoutFn = options.setTimeoutFn || setTimeout;
  const setIntervalFn = options.setIntervalFn || setInterval;
  const clearIntervalFn = options.clearIntervalFn || clearInterval;
  const nextThrowInToken = createIdCounter();
  let state = freshState();

  // State and table helpers.
  const tableState = createTableState({ getState: () => state });
  const {
    activePlayers,
    activePlayerCount,
    activePlayablePlayers,
    activePlayablePlayerCount,
    activeBots,
    hasPlayableHumanGame,
    scoreSnapshot,
    findPlayer,
    isActivePlayer,
    findActiveIndexFrom,
    currentPlayer,
    nameOf,
    playerByCardId
  } = tableState;

  // Runtime logging and table settings.
  const serverRuntime = createServerRuntime({
    getState: () => state,
    activePlayablePlayers,
    scoreSnapshot,
    adminLogPath: config.adminLogPath,
    port: config.port
  });
  const {
    adminLog,
    terminalGameStarted,
    terminalGameEnded,
    logServerStarted
  } = serverRuntime;

  function markGameActivity() {
    if (state.phase === 'playing') state.lastGameActivityAt = Date.now();
  }

  function addLog(text, kind = 'game') {
    if (!text) return;
    if (kind === 'game') markGameActivity();
    if (state.round && kind === 'game') state.round.botTick = (state.round.botTick || 0) + 1;
    state.log.unshift({ text, kind, at: new Date().toISOString() });
  }

  function isProtectedSpecialTarget(playerId) {
    const round = state.round;
    return !!(round && round.dutchCallerId && round.dutchCallerId === playerId);
  }

  const tableSettings = createTableSettings({
    getState: () => state,
    activePlayablePlayerCount,
    createCombinedDeck: createCombinedDeckForSetting
  });

  const {
    clampDeckSetting,
    createCombinedDeck,
    setDeckSetting,
    setGameTarget,
    setInactivityTimeout
  } = tableSettings;

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  // Bot memory and decision helpers.
  const botMemory = createBotMemory({
    getState: () => state,
    activeBots,
    activePlayablePlayers
  });
  const {
    cardMemory,
    ensureBotMemory,
    syncBotMemories,
    rememberSlotForBot,
    rememberSlotForAllBots,
    forgetSlotForAllBots,
    addUnknownSlotForAllBots,
    removeSlotForAllBots,
    moveSlotMemoryForAllBots,
    rememberHumanSlotForAllBots,
    effectiveHumanMemory,
    moveHumanKnowledgeForAllBots,
    observeDiscardForAllBots,
    observePileTakeForAllBots,
    observeReshuffleForAllBots,
    observeAceForAllBots,
    observeDecisionForAllBots,
    advanceMemoryTurn,
    botMemoryEntry,
    effectiveMemory
  } = botMemory;

  const botDecisions = createBotDecisions({
    getState: () => state,
    ensureBotMemory,
    botMemoryEntry,
    effectiveMemory,
    effectiveHumanMemory,
    activePlayablePlayers,
    isProtectedSpecialTarget,
    findActiveIndexFrom,
    randomBetween
  });
  const {
    shouldBotTakePile,
    botBestSwapTarget,
    shouldBotSwapDrawn,
    botReactionDelay,
    botAceTarget,
    botQueenTarget,
    botJackCandidates,
    botShouldCallDutch,
    botThrowInCandidate
  } = botDecisions;

  // Card flow and turn-state coordination.
  const cardFlow = createCardFlow({
    getState: () => state,
    specialRanks: SPECIAL_RANKS,
    shuffle,
    observeReshuffleForAllBots,
    addLog,
    nameOf,
    specialName,
    nextThrowInToken,
    rankValue,
    updateStageAfterQueue,
    broadcastState,
    suitSymbol
  });

  const {
    drawFromDeck,
    pushDiscard,
    label,
    removeExpiredReveals,
    revealCardTo,
    highlightCardForAll,
    highlightPileForAll
  } = cardFlow;

  const turnState = createTurnState({
    getState: () => state,
    jackSwapSelectionMs: config.jackSwapSelectionMs,
    playerByCardId,
    isProtectedSpecialTarget,
    moveSlotMemoryForAllBots,
    moveHumanKnowledgeForAllBots,
    observeDecisionForAllBots,
    addLog,
    nameOf,
    broadcastState,
    findPlayer,
    currentPlayer,
    specialName,
    advanceTurn
  });

  function updateStageAfterQueue() {
    return turnState.updateStageAfterQueue();
  }

  const {
    finishSpecial,
    topSpecial,
    isJackSwapSelectionActive,
    isJackSwapInProgress,
    beginJackSwapResolution,
    beginBotJackSwapSelection,
    canPlayerSayDutch,
    mustPlayerSayDutch,
    callDutchForPlayer
  } = turnState;

  // Game actions, view, and round lifecycle.
  const gameActions = createGameActions({
    getState: () => state,
    currentPlayer,
    topSpecial,
    mustPlayerSayDutch,
    drawFromDeck,
    observePileTakeForAllBots,
    observeDiscardForAllBots,
    observeDecisionForAllBots,
    publicMemoryCard: require('./bot-strategy.js').publicMemoryCard,
    pushDiscard,
    highlightCardForAll,
    rememberSlotForAllBots,
    rememberSlotForBot,
    rememberHumanSlotForAllBots,
    forgetSlotForAllBots,
    label,
    rankValue,
    isJackSwapInProgress,
    addUnknownSlotForAllBots,
    addLog,
    removeSlotForAllBots,
    highlightPileForAll,
    findPlayer,
    isProtectedSpecialTarget,
    observeAceForAllBots,
    finishSpecial,
    playerByCardId,
    revealCardTo,
    broadcastState,
    setTimeoutFn
  });
  const {
    takeDeckForPlayer,
    takePileForPlayer,
    discardDrawnForPlayer,
    swapDrawnForPlayer,
    throwInForPlayer,
    aceAddForPlayer,
    queenPeekForPlayer
  } = gameActions;

  const gameView = createGameView({
    appVersion: config.appVersion,
    getState: () => state,
    removeExpiredReveals,
    activePlayers,
    activePlayerCount,
    activePlayablePlayerCount,
    hasPlayableHumanGame,
    currentPlayer,
    topSpecial,
    findPlayer,
    nameOf,
    isJackSwapInProgress,
    isJackSwapSelectionActive,
    mustPlayerSayDutch,
    canPlayerSayDutch
  });

  const roundLifecycle = createRoundLifecycle({
    getState: () => state,
    setState: (nextState) => { state = nextState; },
    freshState,
    gameLogDir: config.gameLogDir,
    startingPlayerIndexForNextRound,
    applyRoundScoring,
    writeFinishedGameLog,
    createCombinedDeck,
    drawFromDeck,
    activePlayablePlayers,
    syncBotMemories,
    advanceMemoryTurn,
    addLog,
    clampDeckSetting,
    observeDiscardForAllBots,
    rankValue,
    nextThrowInToken,
    hasPlayableHumanGame,
    findActiveIndexFrom,
    terminalGameStarted,
    terminalGameEnded,
    adminLog,
    scoreSnapshot,
    clearBotTimers: () => clearBotTimers(),
    isActivePlayer,
    nameOf,
    specialName,
    updateStageAfterQueue,
    currentPlayer,
    openingDiscardTravelMs: config.openingDiscardTravelMs,
    setTimeoutFn,
    broadcastState
  });
  const {
    startGame,
    beginTurnsIfReady,
    nextRound,
    resetToWaiting,
    handleMissingPlayers
  } = roundLifecycle;

  // Bot automation.
  const botRunner = createBotRunner({
    getState: () => state,
    finishedGameResetMs: config.botFinishedGameResetMs,
    syncBotMemories,
    activeBots,
    activePlayablePlayers,
    randomBetween,
    shuffle,
    findPlayer,
    currentPlayer,
    topSpecial,
    isJackSwapSelectionActive,
    isJackSwapInProgress,
    mustPlayerSayDutch,
    canPlayerSayDutch,
    shouldBotTakePile,
    takeDeckForPlayer,
    takePileForPlayer,
    discardDrawnForPlayer,
    swapDrawnForPlayer,
    throwInForPlayer,
    ensureBotMemory,
    cardMemory,
    rememberSlotForBot,
    highlightCardForAll,
    addLog,
    beginTurnsIfReady,
    botBestSwapTarget,
    shouldBotSwapDrawn,
    finishSpecial,
    specialName,
    advanceTurn,
    botAceTarget,
    aceAddForPlayer,
    botQueenTarget,
    queenPeekForPlayer,
    botJackCandidates,
    isProtectedSpecialTarget,
    beginBotJackSwapSelection,
    botShouldCallDutch,
    callDutchForPlayer,
    botThrowInCandidate,
    botReactionDelay,
    nextRound,
    resetToWaiting,
    broadcastState
  });
  const { scheduleBotAutomation, clearBotTimers } = botRunner;

  function broadcastState() {
    for (const socket of io.sockets.sockets.values()) {
      socket.emit('state', gameView.buildView(playerIdForSocket(socket)));
    }
    scheduleBotAutomation();
  }

  function advanceTurn() {
    return roundLifecycle.advanceTurn();
  }

  function purgeExpiredDisconnectedPlayers() {
    return playerCleanup.purgeExpiredDisconnectedPlayers();
  }

  // Player sessions, cleanup, and socket events.
  const playerSessions = createPlayerSessions({
    getState: () => state,
    playerNameMaxLength: PLAYER_NAME_MAX_LENGTH,
    spectatorTriggerName: config.spectatorTriggerName,
    botProfiles: BOT_PROFILES,
    gameView,
    broadcastState,
    findPlayer,
    activePlayers,
    activePlayerCount,
    clampDeckSetting,
    addLog,
    hasPlayableHumanGame,
    resetToWaiting,
    handleMissingPlayers,
    updateStageAfterQueue
  });

  const playerCleanup = createPlayerCleanup({
    getState: () => state,
    disconnectGraceMs: config.disconnectGraceMs,
    waitingRoomTimeoutMs: config.waitingRoomTimeoutMs,
    gameInactivityTimeoutMs: config.gameInactivityTimeoutMs,
    playerSessions,
    currentPlayer,
    findActiveIndexFrom,
    addLog,
    clampDeckSetting,
    hasPlayableHumanGame,
    resetToWaiting,
    handleMissingPlayers,
    broadcastState
  });

  const purgeExpiredDisconnectedPlayersInterval = setIntervalFn(purgeExpiredDisconnectedPlayers, 60 * 1000);
  if (typeof purgeExpiredDisconnectedPlayersInterval.unref === 'function') purgeExpiredDisconnectedPlayersInterval.unref();

  registerSocketHandlers(io, {
    getState: () => state,
    playerSessions,
    specialName,
    broadcastState,
    addLog,
    setDeckSetting,
    setGameTarget,
    setInactivityTimeout,
    startGame,
    markGameActivity,
    revealCardTo,
    highlightCardForAll,
    rememberHumanSlotForAllBots,
    beginTurnsIfReady,
    takeDeckForPlayer,
    takePileForPlayer,
    discardDrawnForPlayer,
    swapDrawnForPlayer,
    throwInForPlayer,
    aceAddForPlayer,
    queenPeekForPlayer,
    topSpecial,
    playerByCardId,
    isProtectedSpecialTarget,
    beginJackSwapResolution,
    callDutchForPlayer,
    isJackSwapSelectionActive,
    finishSpecial,
    currentPlayer,
    advanceTurn,
    nextRound,
    resetToWaiting
  });

  function close() {
    clearBotTimers();
    clearIntervalFn(purgeExpiredDisconnectedPlayersInterval);
  }

  return {
    close,
    getState: () => state,
    logServerStarted
  };
}

module.exports = { createGameServices };
