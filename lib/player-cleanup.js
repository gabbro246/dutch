function createPlayerCleanup(deps) {
  function getState() {
    return deps.getState();
  }

  function purgeExpiredDisconnectedPlayers(now = Date.now()) {
    const state = getState();
    if (state.phase === 'playing' && state.lastGameActivityAt && now - state.lastGameActivityAt > deps.gameInactivityTimeoutMs) {
      deps.resetToWaiting(true, 'game ended after 15 minutes without activity', { adminEvent: 'game_ended_inactivity_timeout' });
      deps.broadcastState();
      return true;
    }

    if (state.phase === 'waiting') {
      const expiredWaiting = state.players.filter((player) => !player.isBot && player.joinedAt && now - player.joinedAt > deps.waitingRoomTimeoutMs);
      if (expiredWaiting.length > 0) {
        for (const player of expiredWaiting) deps.playerSessions.removeWaitingPlayer(player.id, 'left after 15 minutes in the waiting room');
        deps.broadcastState();
        return true;
      }
    }

    const expired = state.players.filter((player) => !player.connected && player.disconnectedAt && now - player.disconnectedAt > deps.disconnectGraceMs);
    if (expired.length === 0) return false;

    const current = deps.currentPlayer();
    const currentId = current ? current.id : null;
    state.players = state.players.filter((player) => !expired.includes(player));
    if (state.round) {
      const remainingIds = new Set(state.players.map((player) => player.id));
      state.round.dutchQueue = (state.round.dutchQueue || []).filter((id) => remainingIds.has(id));
      state.round.specialQueue = (state.round.specialQueue || []).filter((special) => remainingIds.has(special.actorId));
      state.round.roundWinnerIds = (state.round.roundWinnerIds || []).filter((id) => remainingIds.has(id));
      if (state.round.dutchCallerId && !remainingIds.has(state.round.dutchCallerId)) state.round.dutchCallerId = null;
      if (state.round.winnerId && !remainingIds.has(state.round.winnerId)) state.round.winnerId = null;
      if (state.round.drawn && !remainingIds.has(state.round.drawn.playerId)) {
        state.round.drawn = null;
        state.round.turnComplete = false;
      }
      if (currentId && remainingIds.has(currentId)) {
        state.round.currentPlayerIndex = state.players.findIndex((player) => player.id === currentId);
      } else if (state.round.currentPlayerIndex >= state.players.length || deps.currentPlayer() === null) {
        state.round.currentPlayerIndex = deps.findActiveIndexFrom(state.round.currentPlayerIndex);
      }
    }

    for (const player of expired) deps.addLog(player.name + ' was removed after 15 minutes offline', 'system');
    deps.clampDeckSetting();
    if (state.phase === 'playing' && !deps.hasPlayableHumanGame()) {
      deps.resetToWaiting(true, 'game ended because no human-playable table remains', { adminEvent: 'game_ended_inactivity' });
    } else {
      deps.handleMissingPlayers();
    }
    deps.broadcastState();
    return true;
  }

  return { purgeExpiredDisconnectedPlayers };
}

module.exports = { createPlayerCleanup };
