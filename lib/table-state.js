function createTableState(deps) {
  function getState() {
    return deps.getState();
  }

  function publicPlayerCount() {
    return getState().players.length;
  }

  function activePlayers() {
    return getState().players.filter((player) => !player.left);
  }

  function activePlayerCount() {
    return activePlayers().length;
  }

  function activePlayablePlayers() {
    return activePlayers().filter((player) => !player.isSpectator);
  }

  function activePlayablePlayerCount() {
    return activePlayablePlayers().length;
  }

  function activeHumanCount() {
    return activePlayers().filter((player) => !player.isBot).length;
  }

  function activeBots() {
    return activePlayers().filter((player) => player.isBot);
  }

  function hasPlayableHumanGame() {
    return activeHumanCount() >= 1 && activePlayablePlayerCount() >= 2;
  }

  function scoreSnapshot() {
    return activePlayablePlayers().map((player) => ({
      name: player.name,
      total: player.total,
      roundPoints: player.roundPoints
    }));
  }

  function findPlayer(playerId) {
    return getState().players.find((player) => player.id === playerId);
  }

  function isActivePlayer(playerId) {
    const player = findPlayer(playerId);
    return !!(player && !player.left && !player.isSpectator);
  }

  function findActiveIndexFrom(startIndex) {
    const state = getState();
    if (state.players.length === 0) return -1;
    for (let offset = 0; offset < state.players.length; offset += 1) {
      const index = (startIndex + offset + state.players.length) % state.players.length;
      if (state.players[index] && !state.players[index].left && !state.players[index].isSpectator) return index;
    }
    return -1;
  }

  function currentPlayer() {
    const state = getState();
    if (!state.round) return null;
    const player = state.players[state.round.currentPlayerIndex] || null;
    return player && !player.isSpectator ? player : null;
  }

  function nameOf(playerId) {
    const player = findPlayer(playerId);
    return player ? player.name : 'A player';
  }

  function playerByCardId(cardId) {
    for (const player of getState().players) {
      const index = player.cards.findIndex((card) => card.id === cardId);
      if (index >= 0) return { player, index, card: player.cards[index] };
    }
    return null;
  }

  return {
    publicPlayerCount,
    activePlayers,
    activePlayerCount,
    activePlayablePlayers,
    activePlayablePlayerCount,
    activeHumanCount,
    activeBots,
    hasPlayableHumanGame,
    scoreSnapshot,
    findPlayer,
    isActivePlayer,
    findActiveIndexFrom,
    currentPlayer,
    nameOf,
    playerByCardId
  };
}

module.exports = { createTableState };
