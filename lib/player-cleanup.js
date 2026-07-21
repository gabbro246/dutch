function createPlayerCleanup(deps) {
  function getState() {
    return deps.getState();
  }

  function timeoutDetails(fallbackMs) {
    const configuredMinutes = Number(getState().inactivityTimeoutMinutes);
    if ([15, 30, 60, 90].includes(configuredMinutes)) {
      return { milliseconds: configuredMinutes * 60 * 1000, minutes: configuredMinutes };
    }
    return { milliseconds: fallbackMs, minutes: 15 };
  }

  function purgeExpiredDisconnectedPlayers(now = Date.now()) {
    const state = getState();
    const gameTimeout = timeoutDetails(deps.gameInactivityTimeoutMs);
    if (state.phase === 'playing' && state.lastGameActivityAt && now - state.lastGameActivityAt > gameTimeout.milliseconds) {
      deps.resetToWaiting(true, `game ended after ${gameTimeout.minutes} minutes without activity`, { adminEvent: 'game_ended_inactivity_timeout' });
      deps.broadcastState();
      return true;
    }

    if (state.phase === 'waiting') {
      const waitingTimeout = timeoutDetails(deps.waitingRoomTimeoutMs);
      const expiredWaiting = state.players.filter((player) => player.joinedAt && now - player.joinedAt >= waitingTimeout.milliseconds);
      if (expiredWaiting.length > 0) {
        for (const player of expiredWaiting) deps.playerSessions.removeWaitingPlayer(player.id, `left after ${waitingTimeout.minutes} minutes in the waiting room`);
        deps.broadcastState();
        return true;
      }
    }

    const disconnectTimeout = timeoutDetails(deps.disconnectGraceMs);
    const expired = state.players.filter((player) => !player.connected && player.disconnectedAt && now - player.disconnectedAt > disconnectTimeout.milliseconds);
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

    for (const player of expired) deps.addLog(`${player.name} was removed after ${disconnectTimeout.minutes} minutes offline`, 'system');
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
