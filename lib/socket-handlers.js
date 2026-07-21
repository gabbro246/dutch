function registerSocketHandlers(io, deps) {
  function getState() {
    return deps.getState();
  }

  function assertPlayer(socket) {
    return deps.playerSessions.assertPlayer(socket);
  }

  function runSocketAction(socket, action, options = {}) {
    const player = options.requirePlayer === false ? null : assertPlayer(socket);
    if (options.requirePlayer !== false && !player) return;
    const result = action(player);
    if (result !== false) deps.broadcastState();
  }

  io.on('connection', (socket) => {
    socket.on('identify', (tokenRaw) => {
      deps.playerSessions.identify(socket, tokenRaw);
    });

    socket.on('join', (joinRaw) => {
      deps.playerSessions.join(socket, joinRaw);
    });

    socket.on('leave', () => {
      const state = getState();
      if (state.phase === 'playing' && state.round && state.round.stage === 'gameEnd') return;
      deps.playerSessions.leave(socket);
    });

    socket.on('setDeckSetting', (value) => {
      runSocketAction(socket, () => deps.setDeckSetting(value), { requirePlayer: false });
    });

    socket.on('setGameTarget', (value) => {
      runSocketAction(socket, () => deps.setGameTarget(value), { requirePlayer: false });
    });

    socket.on('removeWaitingPlayer', (playerId) => {
      runSocketAction(socket, () => deps.playerSessions.removeWaitingPlayer(String(playerId || ''), 'was removed from the waiting room'), { requirePlayer: false });
    });

    socket.on('moveWaitingPlayer', (moveRaw) => {
      runSocketAction(socket, () => {
        const playerId = moveRaw && typeof moveRaw === 'object' ? moveRaw.playerId : '';
        const direction = moveRaw && typeof moveRaw === 'object' ? moveRaw.direction : '';
        return deps.playerSessions.moveWaitingPlayer(String(playerId || ''), String(direction || ''));
      }, { requirePlayer: false });
    });

    socket.on('addBot', (typeRaw) => {
      runSocketAction(socket, () => {
        const result = deps.playerSessions.addBotPlayer(String(typeRaw || ''));
        if (!result.ok && result.message) socket.emit('notice', result.message);
      }, { requirePlayer: false });
    });

    socket.on('startGame', () => {
      runSocketAction(socket, () => deps.startGame());
    });

    socket.on('peekStart', (cardId) => {
      const state = getState();
      const player = assertPlayer(socket);
      const round = state.round;
      if (!player || !round || round.stage !== 'peek') return;
      if (player.startPeekDone) return;
      const card = player.cards.find((c) => c.id === cardId);
      if (!card) return;
      if (player.startPeekedCardIds.includes(cardId)) return;
      if (player.startPeekedCardIds.length >= 2) return;
      player.startPeekedCardIds.push(cardId);
      deps.markGameActivity();
      deps.revealCardTo(player.id, cardId, 3000);
      deps.highlightCardForAll(cardId, 'peek', 3000, { exceptViewerId: player.id });
      if (player.startPeekedCardIds.length === 2) {
        player.startPeekDone = true;
        deps.addLog(`${player.name} finished start peek`);
      }
      deps.beginTurnsIfReady();
      deps.broadcastState();
    });

    socket.on('takeDeck', () => {
      const player = assertPlayer(socket);
      if (!deps.takeDeckForPlayer(player)) return;
      deps.broadcastState();
    });

    socket.on('takePile', () => {
      const player = assertPlayer(socket);
      if (!deps.takePileForPlayer(player)) return;
      deps.broadcastState();
    });

    socket.on('discardDrawn', () => {
      const player = assertPlayer(socket);
      if (!deps.discardDrawnForPlayer(player)) return;
      deps.broadcastState();
    });

    socket.on('swapDrawn', (cardId) => {
      const player = assertPlayer(socket);
      if (!deps.swapDrawnForPlayer(player, cardId)) return;
      deps.broadcastState();
    });

    socket.on('throwIn', (cardId) => {
      const player = assertPlayer(socket);
      if (!deps.throwInForPlayer(player, cardId)) return;
      deps.broadcastState();
    });

    socket.on('aceAdd', (targetId) => {
      const player = assertPlayer(socket);
      if (!deps.aceAddForPlayer(player, targetId)) return;
      deps.broadcastState();
    });

    socket.on('queenPeek', (cardId) => {
      const player = assertPlayer(socket);
      if (!deps.queenPeekForPlayer(player, cardId)) return;
      deps.broadcastState();
    });

    socket.on('jackSelect', (cardId) => {
      const state = getState();
      const player = assertPlayer(socket);
      const round = state.round;
      const special = deps.topSpecial();
      if (!player || !round || round.stage !== 'special' || !special) return;
      if (special.actorId !== player.id || special.type !== 'J') return;
      const target = deps.playerByCardId(cardId);
      if (!target || deps.isProtectedSpecialTarget(target.player.id)) return;
      special.selected = special.selected || [];
      const selectedIndex = special.selected.indexOf(cardId);
      if (selectedIndex >= 0) {
        special.selected.splice(selectedIndex, 1);
        special.resolving = false;
        special.resolutionToken = (special.resolutionToken || 0) + 1;
        deps.markGameActivity();
        deps.broadcastState();
        return;
      }
      if (special.resolving || special.selected.length >= 2) return;
      special.selected.push(cardId);
      deps.markGameActivity();
      if (special.selected.length < 2) {
        deps.broadcastState();
        return;
      }
      deps.beginJackSwapResolution(player.id, special.selected);
    });

    socket.on('sayDutch', () => {
      const state = getState();
      const player = assertPlayer(socket);
      const round = state.round;
      if (!player || !round) return;
      if (!deps.callDutchForPlayer(player)) return;
      deps.broadcastState();
    });

    socket.on('endTurn', () => {
      const state = getState();
      const player = assertPlayer(socket);
      const round = state.round;
      const special = deps.topSpecial();
      if (!player || !round) return;
      if (round.stage === 'special' && special && special.actorId === player.id && !deps.isJackSwapSelectionActive(special)) {
        deps.addLog(`${player.name} skipped ${deps.specialName(special.type)}`);
        deps.finishSpecial();
        if (round.stage === 'turn' && round.turnComplete && deps.currentPlayer()?.id === player.id) deps.advanceTurn();
        deps.broadcastState();
        return;
      }
      if (round.stage !== 'turn') return;
      if (deps.currentPlayer()?.id !== player.id || !round.turnComplete) return;
      deps.advanceTurn();
      deps.broadcastState();
    });

    socket.on('nextRound', () => {
      runSocketAction(socket, () => deps.nextRound());
    });

    socket.on('newGame', () => {
      runSocketAction(socket, () => {
        const state = getState();
        if (state.phase !== 'playing' || !state.round || state.round.stage !== 'gameEnd') return false;
        deps.resetToWaiting(true);
      });
    });

    socket.on('endGameForAll', () => {
      runSocketAction(socket, () => {
        const state = getState();
        if (state.phase === 'playing' && state.round && state.round.stage === 'gameEnd') return false;
        deps.resetToWaiting(true, 'game cancelled by players', { adminEvent: 'game_cancelled' });
      });
    });

    socket.on('disconnect', () => {
      deps.playerSessions.disconnect(socket);
    });
  });
}

module.exports = {
  registerSocketHandlers
};
