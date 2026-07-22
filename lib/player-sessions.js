const { normalizedShortPlayerName } = require('../public/shared.js');

function playerIdForSocket(socket) {
  return socket.data.playerId || socket.id;
}

function normalizePlayerToken(value) {
  return String(value || '').trim().slice(0, 80);
}

function createPlayerSessions(deps) {
  const botTypes = Object.keys(deps.botProfiles);

  function getState() {
    return deps.getState();
  }

  function playerShortNameTaken(name, ignoredId = '', ignoredBotType = '') {
    const normalized = normalizedShortPlayerName(name);
    if (!normalized) return false;
    const reservedByBot = botTypes.some((type) => (
      type !== ignoredBotType &&
      normalizedShortPlayerName(deps.botProfiles[type].name) === normalized
    ));
    if (reservedByBot) return true;
    return deps.activePlayers().some((player) => (
      player.id !== ignoredId &&
      normalizedShortPlayerName(player.name) === normalized
    ));
  }

  function isSpectatorName(name) {
    return String(name || '').trim().toLowerCase() === deps.spectatorTriggerName;
  }

  function reconnectNameMatches(player, name, isSpectator) {
    return !!(
      player &&
      !player.left &&
      !player.isBot &&
      !!player.isSpectator === !!isSpectator &&
      String(player.name || '').trim().toLocaleLowerCase() === String(name || '').trim().toLocaleLowerCase()
    );
  }

  function reconnectPlayer(socket, player) {
    const wasDisconnected = !player.connected;
    player.connected = true;
    player.disconnectedAt = null;
    player.socketId = socket.id;
    socket.data.playerId = player.id;
    if (wasDisconnected) deps.addLog(player.name + ' reconnected', 'system');
  }

  function findActiveGameReconnectPlayer(playerId, name, isSpectator) {
    const existing = deps.findPlayer(playerId);
    if (reconnectNameMatches(existing, name, isSpectator)) return existing;

    return deps.activePlayers().find((player) => (
      !player.connected && reconnectNameMatches(player, name, isSpectator)
    )) || null;
  }

  function assertPlayer(socket) {
    const player = deps.findPlayer(playerIdForSocket(socket));
    return player && player.socketId === socket.id ? player : undefined;
  }

  function identify(socket, tokenRaw) {
    const playerId = normalizePlayerToken(tokenRaw) || socket.id;
    socket.data.playerId = playerId;
    const player = deps.findPlayer(playerId);
    if (player && player.left) {
      socket.emit('state', deps.gameView.buildView(playerId));
      return;
    }
    if (player) {
      reconnectPlayer(socket, player);
      deps.broadcastState();
      return;
    }
    socket.emit('state', deps.gameView.buildView(playerId));
  }

  function join(socket, joinRaw) {
    const state = getState();
    const nameRaw = joinRaw && typeof joinRaw === 'object' ? joinRaw.name : joinRaw;
    const tokenRaw = joinRaw && typeof joinRaw === 'object' ? joinRaw.token : '';
    const joinToken = normalizePlayerToken(tokenRaw);
    if (joinToken) socket.data.playerId = joinToken;
    const name = String(nameRaw || '').trim().slice(0, deps.playerNameMaxLength);
    if (!name) return;
    const isSpectator = isSpectatorName(name);
    const playerId = playerIdForSocket(socket);
    const existing = deps.findPlayer(playerId);
    if (state.phase !== 'waiting') {
      const reconnectPlayerTarget = findActiveGameReconnectPlayer(playerId, name, isSpectator);
      if (reconnectPlayerTarget) {
        reconnectPlayer(socket, reconnectPlayerTarget);
        deps.broadcastState();
        return;
      }
      socket.emit('notice', state.waitingMessage);
      deps.broadcastState();
      return;
    }
    if (existing) {
      reconnectPlayer(socket, existing);
      deps.broadcastState();
      return;
    }
    if (deps.activePlayerCount() >= 9) return;
    const duplicateShortName = !isSpectator && playerShortNameTaken(name, playerId);
    if (duplicateShortName) {
      deps.broadcastState();
      return;
    }
    state.players.push({
      id: playerId,
      name,
      connected: true,
      disconnectedAt: null,
      socketId: socket.id,
      left: false,
      total: 0,
      roundPoints: null,
      cards: [],
      startPeekDone: false,
      startPeekedCardIds: [],
      joinedAt: Date.now(),
      isSpectator
    });
    deps.clampDeckSetting();
    deps.addLog(isSpectator ? `${name} joined as a spectator` : `${name} joined`);
    deps.broadcastState();
  }

  function removeWaitingPlayer(playerId, reason = 'removed from waiting room') {
    const state = getState();
    if (state.phase !== 'waiting') return false;
    const player = deps.findPlayer(playerId);
    if (!player) return false;
    state.players = state.players.filter((p) => p.id !== playerId);
    deps.clampDeckSetting();
    deps.addLog(`${player.name} ${reason}`, 'system');
    return true;
  }

  function moveWaitingPlayer(playerId, direction) {
    const state = getState();
    if (state.phase !== 'waiting') return false;
    const index = state.players.findIndex((p) => p.id === playerId && !p.left);
    if (index < 0) return false;
    const offset = direction === 'up' ? -1 : direction === 'down' ? 1 : 0;
    if (!offset) return false;
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= state.players.length) return false;
    const [player] = state.players.splice(index, 1);
    state.players.splice(nextIndex, 0, player);
    return true;
  }

  function addBotPlayer(type) {
    const state = getState();
    if (state.phase !== 'waiting') return { ok: false, message: 'Bots can only be added in the waiting room.' };
    if (!deps.botProfiles[type]) return { ok: false, message: 'Unknown bot type.' };
    if (deps.activePlayerCount() >= 9) return { ok: false, message: 'The player list is full.' };
    if (deps.activePlayers().some((p) => p.isBot && p.botType === type)) return { ok: false, message: 'That bot is already in the player list.' };
    const profile = deps.botProfiles[type];
    if (playerShortNameTaken(profile.name, `bot-${type}`, type)) {
      return { ok: false, message: `${profile.name} cannot be added because that table name is already used.` };
    }
    state.players.push({
      id: `bot-${type}`,
      name: profile.name,
      connected: true,
      disconnectedAt: null,
      socketId: null,
      left: false,
      total: 0,
      roundPoints: null,
      cards: [],
      startPeekDone: false,
      startPeekedCardIds: [],
      joinedAt: Date.now(),
      isBot: true,
      botType: type,
      botMemory: null
    });
    deps.clampDeckSetting();
    deps.addLog(`${profile.name} joined`, 'system');
    return { ok: true };
  }

  function leave(socket) {
    const state = getState();
    const player = assertPlayer(socket);
    if (!player) return;
    if (state.phase === 'waiting') {
      removeWaitingPlayer(player.id, 'left');
      deps.broadcastState();
      return;
    }

    player.left = true;
    player.connected = false;
    player.disconnectedAt = null;
    player.socketId = null;
    const round = state.round;
    if (round) {
      round.dutchQueue = (round.dutchQueue || []).filter((id) => id !== player.id);
      round.specialQueue = (round.specialQueue || []).filter((special) => special.actorId !== player.id);
      if (round.stage === 'special' && round.specialQueue.length === 0) deps.updateStageAfterQueue();
      round.roundWinnerIds = (round.roundWinnerIds || []).filter((id) => id !== player.id);
      if (round.dutchCallerId === player.id) round.dutchCallerId = null;
      if (round.winnerId === player.id) round.winnerId = null;
      if (round.drawn && round.drawn.playerId === player.id) {
        round.drawn = null;
        round.turnComplete = false;
      }
      if (round.throwIn) round.throwIn.open = false;
    }
    deps.addLog(`${player.name} left`, 'system');
    if (state.phase === 'playing' && !deps.hasPlayableHumanGame()) deps.resetToWaiting(true, 'game ended because no human-playable table remains', { adminEvent: 'game_ended_inactivity' });
    else deps.handleMissingPlayers();
    deps.broadcastState();
  }

  function disconnect(socket) {
    const player = assertPlayer(socket);
    if (!player || player.socketId !== socket.id) return;
    player.connected = false;
    player.disconnectedAt = Date.now();
    player.socketId = null;
    deps.addLog(player.name + ' disconnected', 'system');
    deps.broadcastState();
  }

  return {
    assertPlayer,
    identify,
    join,
    leave,
    disconnect,
    removeWaitingPlayer,
    moveWaitingPlayer,
    addBotPlayer
  };
}

module.exports = {
  createPlayerSessions,
  playerIdForSocket,
  normalizePlayerToken
};
