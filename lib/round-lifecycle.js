function createRoundLifecycle(deps) {
  function getState() {
    return deps.getState();
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
      botTick: 0,
      dutchCallerId: null,
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
    if (!round || round.discard.length > 0) return;
    const firstDiscard = deps.drawFromDeck();
    if (!firstDiscard) return;
    round.discard.push(firstDiscard);
    deps.observeDiscardForAllBots(firstDiscard, 'opening discard');
    round.throwIn = {
      open: true,
      token: deps.nextThrowInToken(),
      topCardId: firstDiscard.id,
      rank: deps.rankValue(firstDiscard)
    };
  }

  function startGame() {
    const state = getState();
    if (state.phase !== 'waiting' || !deps.hasPlayableHumanGame()) return;
    state.phase = 'playing';
    const now = Date.now();
    state.gameStartedAt = now;
    state.lastGameActivityAt = now;
    state.log = [];
    state.roundNumber = 0;
    state.scoreHistory = [];
    for (const player of state.players) {
      player.total = 0;
      player.roundPoints = null;
    }
    const names = deps.activePlayablePlayers().map((player) => player.name);
    deps.terminalGameStarted();
    deps.adminLog('game_started', { players: names, target: state.gameTarget });
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
    state.round.stage = 'turn';
    state.round.turnComplete = false;
    state.round.drawn = null;
    deps.addLog('all active players finished peeking');
  }

  function advanceTurn() {
    const state = getState();
    const round = state.round;
    if (!round || round.stage === 'roundEnd' || round.stage === 'gameEnd') return;
    if (round.specialQueue.length > 0 || round.drawn) return;
    if (!deps.hasPlayableHumanGame()) {
      resetToWaiting(true, 'game ended because no human-playable table remains', { adminEvent: 'game_ended_inactivity' });
      return;
    }

    round.turnComplete = false;
    round.stage = 'turn';

    if (round.dutchCallerId) {
      while (round.dutchQueue.length > 0) {
        const nextId = round.dutchQueue.shift();
        const nextIndex = state.players.findIndex((player) => player.id === nextId && !player.left && !player.isSpectator);
        if (nextIndex >= 0) {
          round.currentPlayerIndex = nextIndex;
          return;
        }
      }
      endRound();
      return;
    }

    const start = (round.currentPlayerIndex + 1) % state.players.length;
    const nextIndex = deps.findActiveIndexFrom(start);
    if (nextIndex < 0) {
      resetToWaiting(true, 'game ended because no human-playable table remains', { adminEvent: 'game_ended_inactivity' });
      return;
    }
    round.currentPlayerIndex = nextIndex;
  }

  function endRound() {
    const state = getState();
    const round = state.round;
    if (!round) return;
    round.stage = 'roundEnd';
    round.drawn = null;
    round.turnComplete = false;
    if (round.throwIn) round.throwIn.open = false;
    round.specialQueue = [];

    const scoring = deps.applyRoundScoring(state.players, {
      callerId: round.dutchCallerId,
      gameTarget: state.gameTarget
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
      deps.terminalGameEnded('score target reached', winnerName);
      deps.adminLog('game_ended_by_score', { target: state.gameTarget, winner: scoring.winnerName, scores: deps.scoreSnapshot() });
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
      socketId: null,
      left: false,
      total: 0,
      roundPoints: null,
      cards: [],
      startPeekDone: false,
      startPeekedCardIds: [],
      joinedAt: player.isBot ? null : Date.now(),
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
    if (!deps.hasPlayableHumanGame()) {
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
    handleMissingPlayers
  };
}

module.exports = { createRoundLifecycle };
