function createRoundLifecycle(deps) {
  const openingDiscardDelayMs = Number.isFinite(deps.openingDiscardDelayMs) ? deps.openingDiscardDelayMs : 1000;
  const openingDiscardTravelMs = Number.isFinite(deps.openingDiscardTravelMs) ? deps.openingDiscardTravelMs : 400;
  const openingDiscardFlipHalfMs = Number.isFinite(deps.openingDiscardFlipHalfMs) ? deps.openingDiscardFlipHalfMs : 130;
  const finalThrowInGraceMs = Number.isFinite(deps.finalThrowInGraceMs) ? deps.finalThrowInGraceMs : 500;
  const now = deps.nowFn || Date.now;
  const setTimeoutFn = deps.setTimeoutFn || setTimeout;

  function getState() {
    return deps.getState();
  }

  function hasPlayableGame() {
    return deps.hasPlayableGame ? deps.hasPlayableGame() : deps.hasPlayableHumanGame();
  }

  function startRound() {
    const state = getState();
    deps.clampDeckSetting();
    const starterIndex = deps.startingPlayerIndexForNextRound(state.players, state.roundNumber);
    const deck = deps.createCombinedDeck();
    const round = {
      stage: 'peek',
      deck,
      discard: [],
      currentPlayerIndex: starterIndex,
      drawn: null,
      turnComplete: false,
      throwIn: null,
      specialQueue: [],
      reveals: [],
      pileHighlight: null,
      infoEvent: null,
      handHighlights: [],
      botTick: 0,
      strategyTick: 0,
      dutchCallerId: null,
      roundEndPending: false,
      roundEndAt: null,
      pendingWrongThrowPenalties: 0,
      wrongThrowPenalty: null,
      cardAddEvent: null,
      peekEvent: null,
      peekSequence: 0,
      pendingDeckDraws: [],
      needsReshuffle: false,
      reshuffleToken: 0,
      reshuffleCardCount: 0,
      dutchQueue: [],
      roundWinnerIds: [],
      winnerId: null
    };
    state.round = round;
    state.roundNumber += 1;

    for (const player of state.players) {
      player.cards = [];
      player.roundPoints = null;
      player.startPeekDone = !!player.isSpectator;
      player.startPeekedCardIds = [];
    }

    for (let i = 0; i < 4; i += 1) {
      for (const player of deps.activePlayablePlayers()) {
        player.cards.push(deps.drawFromDeck());
      }
    }

    deps.syncBotMemories();
    deps.addLog(`round ${state.roundNumber} started`, 'system');
  }

  function createOpeningDiscardAfterPeek() {
    const state = getState();
    const round = state.round;
    if (!round || round.discard.length > 0 || round.openingDiscardScheduled) return;
    round.openingDiscardScheduled = true;
    setTimeoutFn(() => {
      const currentRound = getState().round;
      if (!currentRound || currentRound !== round || currentRound.stage !== 'opening' || currentRound.discard.length > 0) return;
      currentRound.openingDiscardScheduled = false;
      const firstDiscard = deps.drawFromDeck();
      if (!firstDiscard) return;
      currentRound.discard.push(firstDiscard);
      currentRound.openingDiscardPending = firstDiscard.id;
      if (deps.broadcastState) deps.broadcastState();
      setTimeoutFn(() => {
        const latestRound = getState().round;
        if (!latestRound || latestRound !== round || latestRound.openingDiscardPending !== firstDiscard.id) return;
        latestRound.openingDiscardPending = null;
        latestRound.openingDiscardAwaitingMidpoint = firstDiscard.id;
        setTimeoutFn(() => completeOpeningDiscardReveal(null, firstDiscard.id, { fallback: true }), 1500);
        latestRound.openingDiscardMidpointEligibleAt = now() + openingDiscardFlipHalfMs;
        if (deps.broadcastState) deps.broadcastState();
      }, openingDiscardTravelMs);
    }, openingDiscardDelayMs);
  }

  function completeOpeningDiscardReveal(playerId, cardId, options = {}) {
    const state = getState();
    const round = state.round;
    if (!round || round.stage !== 'opening' || round.openingDiscardAwaitingMidpoint !== cardId) return false;
    const firstDiscard = round.discard[round.discard.length - 1];
    if (!firstDiscard || firstDiscard.id !== cardId) return false;
    if (!options.fallback) {
      const player = state.players.find((item) => item.id === playerId);
      if (!player || player.left || player.isBot || player.isSpectator || !player.connected) return false;
      if (!options.reducedMotion && now() < round.openingDiscardMidpointEligibleAt) return false;
    }
    round.openingDiscardAwaitingMidpoint = null;
    round.openingDiscardMidpointEligibleAt = null;
    deps.observeDiscardForAllBots(firstDiscard, 'opening discard');
    round.throwIn = {
      open: true,
      token: deps.nextThrowInToken(),
      topCardId: firstDiscard.id,
      rank: deps.rankValue(firstDiscard)
    };
    round.stage = 'turn';
    if (deps.broadcastState) deps.broadcastState();
    return true;
  }

  function startGame() {
    const state = getState();
    if (state.phase !== 'waiting' || !deps.hasPlayableHumanGame()) return;
    state.phase = 'playing';
    const startedAt = now();
    state.gameStartedAt = startedAt;
    state.lastGameActivityAt = startedAt;
    state.log = [];
    state.logSequence = 0;
    if (deps.beginGameRandom) deps.beginGameRandom();
    state.roundNumber = 0;
    state.scoreHistory = [];
    for (const player of state.players) {
      player.total = 0;
      player.roundPoints = null;
    }
    const names = deps.activePlayablePlayers().map((player) => player.name);
    deps.terminalGameStarted();
    deps.adminLog('game_started', { players: names, target: state.singleRound ? 'single round' : state.gameTarget });
    deps.addLog('game started', 'system');
    startRound();
  }

  function allPlayersPeeked() {
    return getState().players.every((player) => player.left || player.isSpectator || player.startPeekDone);
  }

  function beginTurnsIfReady() {
    const state = getState();
    if (!state.round || state.round.stage !== 'peek') return;
    if (!allPlayersPeeked()) return;
    const firstConnectedIndex = deps.findActiveIndexFrom(state.round.currentPlayerIndex);
    if (firstConnectedIndex < 0) return;
    state.round.currentPlayerIndex = firstConnectedIndex;
    createOpeningDiscardAfterPeek();
    state.round.stage = 'opening';
    state.round.turnComplete = false;
    state.round.drawn = null;
    deps.addLog('all active players finished peeking');
  }

  function advanceTurn() {
    const state = getState();
    const round = state.round;
    if (!round || round.stage === 'roundEnd' || round.stage === 'gameEnd' || round.roundEndPending) return;
    if (deps.advanceMemoryTurn) deps.advanceMemoryTurn();
    if (round.specialQueue.length > 0 || round.drawn) return;
    if (!hasPlayableGame()) {
      resetToWaiting(true, 'game ended because no human-playable table remains', { adminEvent: 'game_ended_inactivity' });
      return;
    }

    if (round.dutchCallerId) {
      while (round.dutchQueue.length > 0) {
        const nextId = round.dutchQueue.shift();
        const nextIndex = state.players.findIndex((player) => player.id === nextId && !player.left && !player.isSpectator);
        if (nextIndex >= 0) {
          round.turnComplete = false;
          round.stage = 'turn';
          round.currentPlayerIndex = nextIndex;
          deps.clearHandHighlightsForPlayer(nextId);
          return;
        }
      }
      if (round.throwIn && round.throwIn.open) scheduleEndRoundAfterThrowIn();
      else endRound();
      return;
    }

    const start = (round.currentPlayerIndex + 1) % state.players.length;
    const nextIndex = deps.findActiveIndexFrom(start);
    if (nextIndex < 0) {
      resetToWaiting(true, 'game ended because no human-playable table remains', { adminEvent: 'game_ended_inactivity' });
      return;
    }
    round.turnComplete = false;
    round.stage = 'turn';
    round.currentPlayerIndex = nextIndex;
    deps.clearHandHighlightsForPlayer(state.players[nextIndex].id);
  }

  function scheduleEndRoundAfterThrowIn() {
    const round = getState().round;
    if (!round || round.roundEndPending) return;
    round.roundEndPending = true;
    round.roundEndAt = now() + finalThrowInGraceMs;

    function finishWhenSettled() {
      if (getState().round !== round || !round.roundEndPending) return;
      if (round.pendingPileReveal || (round.pendingWrongThrowPenalties || 0) > 0 || (round.pendingDeckDraws || []).length > 0 || round.needsReshuffle || round.specialQueue.length > 0 || round.stage === 'revealing' || round.stage === 'special') {
        const retryTimer = setTimeoutFn(finishWhenSettled, 100);
        if (retryTimer && typeof retryTimer.unref === 'function') retryTimer.unref();
        return;
      }
      round.roundEndPending = false;
      round.roundEndAt = null;
      endRound();
      if (deps.broadcastState) deps.broadcastState();
    }

    const timer = setTimeoutFn(finishWhenSettled, finalThrowInGraceMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  function endRound() {
    const state = getState();
    const round = state.round;
    if (!round) return;
    round.stage = 'roundEnd';
    round.drawn = null;
    round.turnComplete = false;
    round.roundEndPending = false;
    round.roundEndAt = null;
    if (round.throwIn) round.throwIn.open = false;
    round.specialQueue = [];

    const scoring = deps.applyRoundScoring(state.players, {
      callerId: round.dutchCallerId,
      gameTarget: state.gameTarget,
      singleRound: state.singleRound
    });
    for (const player of scoring.halvings) deps.addLog(player.name + "'s total was halved");

    state.scoreHistory.push({
      round: state.roundNumber,
      players: scoring.scoreHistoryPlayers
    });

    round.roundWinnerIds = scoring.roundWinnerIds;
    deps.addLog('round ended. ' + scoring.pointChanges.join(', '), 'system');

    if (scoring.gameEnded) {
      round.stage = 'gameEnd';
      round.winnerId = scoring.winnerId;
      const winnerName = scoring.winnerName || 'No one';
      deps.addLog('game ended. ' + winnerName + ' won', 'system');
      const endReason = state.singleRound ? 'single round completed' : 'score target reached';
      deps.terminalGameEnded(endReason, winnerName);
      deps.adminLog(state.singleRound ? 'game_ended_single_round' : 'game_ended_by_score', { target: state.singleRound ? 'single round' : state.gameTarget, winner: scoring.winnerName, scores: deps.scoreSnapshot() });
      deps.writeFinishedGameLog(deps.gameLogDir, state, scoring.winnerName);
    }
  }

  function nextRound() {
    const state = getState();
    if (!state.round || state.round.stage !== 'roundEnd') return;
    startRound();
  }

  function resetToWaiting(keepPlayers = true, reason = 'returned to waiting room', options = {}) {
    const state = getState();
    deps.clearBotTimers();
    const wasPlaying = state.phase === 'playing';
    const alreadyFinished = state.round ? state.round.stage === 'gameEnd' : false;
    if (wasPlaying) {
      if (alreadyFinished === false) deps.terminalGameEnded(reason);
      if (options.adminEvent) {
        deps.adminLog(options.adminEvent, { reason, scores: deps.scoreSnapshot() });
      }
    }
    const players = keepPlayers ? state.players.filter((player) => player.connected && !player.left).map((player) => ({
      id: player.id,
      name: player.name,
      connected: true,
      disconnectedAt: null,
      socketId: player.socketId,
      left: false,
      total: 0,
      roundPoints: null,
      cards: [],
      startPeekDone: false,
      startPeekedCardIds: [],
      joinedAt: now(),
      isBot: !!player.isBot,
      botType: player.botType || '',
      botMemory: null,
      isSpectator: !!player.isSpectator
    })) : [];
    const nextState = deps.freshState();
    nextState.players = players;
    deps.setState(nextState);
    deps.clampDeckSetting();
    deps.addLog(reason, options.logKind || 'system');
  }

  function removeDisconnectedSpecials() {
    const state = getState();
    const round = state.round;
    if (!round) return;
    let removedAny = false;
    while (round.specialQueue.length > 0 && !deps.isActivePlayer(round.specialQueue[0].actorId)) {
      const special = round.specialQueue.shift();
      deps.addLog(`${deps.nameOf(special.actorId)} skipped ${deps.specialName(special.type)} because they left`);
      removedAny = true;
    }
    if (removedAny) deps.updateStageAfterQueue();
  }

  function handleMissingPlayers() {
    const state = getState();
    const round = state.round;
    if (state.phase !== 'playing' || !round) return false;
    if (!hasPlayableGame()) {
      resetToWaiting(true, 'game ended because no human-playable table remains', { adminEvent: 'game_ended_inactivity' });
      return true;
    }

    removeDisconnectedSpecials();

    if (round.stage === 'peek') {
      beginTurnsIfReady();
      return false;
    }

    if (round.stage !== 'turn') return false;

    const current = deps.currentPlayer();
    if (current && !current.left) return false;

    if (current) deps.addLog(current.name + ' left, turn skipped');
    round.drawn = null;
    round.turnComplete = false;
    if (round.throwIn) round.throwIn.open = false;
    advanceTurn();
    return false;
  }

  return {
    startRound,
    startGame,
    beginTurnsIfReady,
    advanceTurn,
    endRound,
    nextRound,
    resetToWaiting,
    completeOpeningDiscardReveal,
    handleMissingPlayers
  };
}

module.exports = { createRoundLifecycle };
