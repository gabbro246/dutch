const express = require('express');
const http = require('http');
const os = require('os');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const DISCONNECT_GRACE_MS = 15 * 60 * 1000;

app.use(express.static('public'));

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SPECIALS = new Set(['A', 'Q', 'J']);
const RED_SUITS = new Set(['hearts', 'diamonds']);

let nextCardId = 1;
let nextTokenId = 1;
let state = freshState();

function freshState() {
  return {
    phase: 'waiting',
    deckSetting: 'one',
    players: [],
    log: [],
    roundNumber: 0,
    scoreHistory: [],
    round: null,
    waitingMessage: 'A game is already active. Join after the game ends.'
  };
}

function publicPlayerCount() {
  return state.players.length;
}

function addLog(text) {
  if (!text) return;
  state.log.unshift(text);
  if (state.log.length > 80) state.log.length = 80;
}

function hostAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((address) => address && address.family === 'IPv4' && !address.internal)
    .map((address) => "http://" + address.address + ":" + PORT);
}

function activePlayers() {
  return state.players.filter((p) => !p.left);
}

function activePlayerCount() {
  return activePlayers().length;
}

function playerIdForSocket(socket) {
  return socket.data.playerId || socket.id;
}

function normalizePlayerToken(value) {
  return String(value || '').trim().slice(0, 80);
}

function isActivePlayer(playerId) {
  const player = findPlayer(playerId);
  return !!(player && !player.left);
}

function isProtectedSpecialTarget(playerId) {
  const round = state.round;
  return !!(round && round.dutchCallerId && round.dutchCallerId === playerId);
}

function findActiveIndexFrom(startIndex) {
  if (state.players.length === 0) return -1;
  for (let offset = 0; offset < state.players.length; offset += 1) {
    const index = (startIndex + offset + state.players.length) % state.players.length;
    if (state.players[index] && !state.players[index].left) return index;
  }
  return -1;
}

function findPlayer(playerId) {
  return state.players.find((p) => p.id === playerId);
}

function currentPlayer() {
  if (!state.round) return null;
  return state.players[state.round.currentPlayerIndex] || null;
}

function clampDeckSetting() {
  if (activePlayerCount() > 4) state.deckSetting = 'two';
}

function createDeck(deckColor) {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({
        id: `c${nextCardId++}`,
        rank,
        suit,
        deckColor
      });
    }
  }
  return deck;
}

function createCombinedDeck() {
  let cards;
  if (state.deckSetting === 'one') {
    const color = Math.random() < 0.5 ? 'red' : 'blue';
    cards = createDeck(color);
    state.deckColor = color;
  } else {
    cards = createDeck('red').concat(createDeck('blue'));
    state.deckColor = 'red+blue';
  }
  return shuffle(cards);
}

function shuffle(cards) {
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function suitSymbol(suit) {
  return {
    hearts: '♥',
    diamonds: '♦',
    clubs: '♣',
    spades: '♠'
  }[suit];
}

function isRedSuit(suit) {
  return RED_SUITS.has(suit);
}

function cardPoints(card) {
  if (!card) return 0;
  if (card.rank === 'A') return 1;
  if (card.rank === 'J') return 11;
  if (card.rank === 'Q') return 12;
  if (card.rank === 'K') return isRedSuit(card.suit) ? 0 : 13;
  return Number(card.rank);
}

function rankValue(card) {
  return card ? card.rank : null;
}

function ensureDrawPile() {
  const round = state.round;
  if (!round) return;
  if (round.deck.length > 0) return;
  if (round.discard.length <= 1) return;
  const top = round.discard.pop();
  round.deck = shuffle(round.discard.splice(0));
  round.discard = [top];
  addLog('discard pile reshuffled into draw pile');
}

function drawFromDeck() {
  ensureDrawPile();
  if (!state.round || state.round.deck.length === 0) return null;
  return state.round.deck.pop();
}

function pushDiscard(card, actorId, reason, options = {}) {
  const round = state.round;
  if (!round || !card) return;
  const allowThrowIn = options.allowThrowIn !== false;
  round.discard.push(card);
  if (allowThrowIn) {
    round.throwIn = {
      open: true,
      token: nextTokenId++,
      topCardId: card.id,
      rank: rankValue(card)
    };
  } else if (round.throwIn) {
    round.throwIn.open = false;
  }
  if (SPECIALS.has(card.rank)) {
    round.specialQueue.push({ type: card.rank, actorId, selected: [] });
    addLog(`${nameOf(actorId)} placed ${label(card)} and may use ${specialName(card.rank)}`);
  } else if (reason) {
    addLog(`${nameOf(actorId)} ${reason} ${label(card)}`);
  }
  updateStageAfterQueue();
}

function updateStageAfterQueue() {
  const round = state.round;
  if (!round) return;
  if (round.stage === 'roundEnd' || round.stage === 'gameEnd') return;
  if (round.specialQueue.length > 0) {
    round.stage = 'special';
  } else if (round.stage !== 'peek') {
    round.stage = 'turn';
  }
}

function finishSpecial() {
  const round = state.round;
  if (!round) return;
  round.specialQueue.shift();
  updateStageAfterQueue();
}

function topSpecial() {
  if (!state.round) return null;
  return state.round.specialQueue[0] || null;
}

function specialName(rank) {
  return rank === 'A' ? 'Ace' : rank === 'Q' ? 'Queen' : 'Jack';
}

function label(card) {
  if (!card) return 'card';
  return `${card.rank}${suitSymbol(card.suit)}`;
}

function nameOf(playerId) {
  const p = findPlayer(playerId);
  return p ? p.name : 'A player';
}

function playerByCardId(cardId) {
  for (const player of state.players) {
    const index = player.cards.findIndex((card) => card.id === cardId);
    if (index >= 0) return { player, index, card: player.cards[index] };
  }
  return null;
}

function closeThrowInBecauseOfPlayingAction() {
  if (state.round && state.round.throwIn) state.round.throwIn.open = false;
}

function removeExpiredReveals() {
  if (!state.round) return;
  const now = Date.now();
  state.round.reveals = state.round.reveals.filter((r) => r.until > now);
}

function revealCardTo(playerId, cardId, ms = 3000) {
  if (!state.round) return;
  state.round.reveals.push({ viewerId: playerId, cardId, until: Date.now() + ms });
  setTimeout(() => {
    removeExpiredReveals();
    broadcastState();
  }, ms + 50);
}

function canViewerSeeCard(viewerId, ownerId, card) {
  const round = state.round;
  if (!round) return false;
  if (round.stage === 'roundEnd' || round.stage === 'gameEnd') return true;
  if (round.drawn && round.drawn.card.id === card.id && round.drawn.playerId === viewerId) return true;
  return round.reveals.some((r) => r.viewerId === viewerId && r.cardId === card.id && r.until > Date.now());
}

function publicCard(card, visible) {
  if (!card) return null;
  if (!visible) {
    return {
      id: card.id,
      back: true,
      deckColor: card.deckColor
    };
  }
  return {
    id: card.id,
    back: false,
    rank: card.rank,
    suit: card.suit,
    symbol: suitSymbol(card.suit),
    red: isRedSuit(card.suit),
    deckColor: card.deckColor,
    points: cardPoints(card)
  };
}

function buildView(playerId) {
  removeExpiredReveals();
  const joined = state.players.some((p) => p.id === playerId && !p.left);
  const viewer = findPlayer(playerId);
  const base = {
    you: playerId,
    joined,
    phase: state.phase,
    deckSetting: state.deckSetting,
    oneDeckDisabled: activePlayerCount() > 4,
    canJoin: state.phase === 'waiting' && activePlayerCount() < 9 && !joined,
    canStart: state.phase === 'waiting' && activePlayerCount() >= 2,
    waitingMessage: state.phase === 'playing' && !joined ? state.waitingMessage : '',
    players: activePlayers().map((p) => ({
      id: p.id,
      name: p.name,
      total: p.total,
      roundPoints: p.roundPoints,
      connected: p.connected,
      startPeekCount: p.startPeekedCardIds ? p.startPeekedCardIds.length : 0,
      startPeekDone: !!p.startPeekDone,
      cardCount: p.cards.length
    })),
    log: state.log,
    roundNumber: state.roundNumber,
    scoreHistory: state.scoreHistory,
    round: null
  };

  if (!state.round) return base;

  const round = state.round;
  const cp = currentPlayer();
  const special = topSpecial();
  const dutchCaller = round.dutchCallerId ? findPlayer(round.dutchCallerId) : null;

  base.round = {
    stage: round.stage,
    currentPlayerId: cp ? cp.id : null,
    currentPlayerName: cp ? cp.name : '',
    protectedSpecialTargetIds: round.dutchCallerId ? [round.dutchCallerId] : [],
    deckCount: round.deck.length,
    discardCount: round.discard.length,
    discardTop: publicCard(round.discard[round.discard.length - 1], true),
    deckBack: state.deckSetting === 'one' ? (state.deckColor || 'blue') : 'mixed',
    drawn: round.drawn ? {
      source: round.drawn.source,
      card: publicCard(round.drawn.card, round.drawn.playerId === playerId)
    } : null,
    anyDrawn: !!round.drawn,
    turnComplete: !!round.turnComplete,
    throwInOpen: !!(round.throwIn && round.throwIn.open),
    special: special ? {
      type: special.type,
      actorId: special.actorId,
      actorName: nameOf(special.actorId),
      selected: special.selected || []
    } : null,
    dutchCallerId: round.dutchCallerId,
    dutchCallerName: dutchCaller ? dutchCaller.name : '',
    dutchTurnsRemaining: round.dutchQueue ? round.dutchQueue.length : 0,
    roundWinnerIds: round.roundWinnerIds || [],
    winnerId: round.winnerId,
    winnerName: round.winnerId ? nameOf(round.winnerId) : '',
    players: activePlayers().map((p) => ({
      id: p.id,
      name: p.name,
      total: p.total,
      roundPoints: p.roundPoints,
      connected: p.connected,
      isCurrent: !['peek', 'roundEnd', 'gameEnd'].includes(round.stage) && cp && cp.id === p.id,
      cards: p.cards.map((card) => publicCard(card, canViewerSeeCard(playerId, p.id, card)))
    })),
    controls: controlsFor(playerId)
  };
  return base;
}

function controlsFor(playerId) {
  const round = state.round;
  const player = findPlayer(playerId);
  if (!round || !player || player.left) return {};
  const cp = currentPlayer();
  const isCurrent = cp && cp.id === playerId;
  const special = topSpecial();
  const actorForSpecial = special && special.actorId === playerId;
  const beforeDraw = round.stage === 'turn' && isCurrent && !round.drawn && !round.turnComplete && !special;
  return {
    canPeekStart: round.stage === 'peek' && !player.startPeekDone,
    canTake: beforeDraw,
    canDiscardDrawn: round.stage === 'turn' && isCurrent && round.drawn && round.drawn.source === 'deck',
    canSwapDrawn: round.stage === 'turn' && isCurrent && !!round.drawn,
    canThrowIn: !!(round.throwIn && round.throwIn.open) && round.stage !== 'roundEnd' && round.stage !== 'gameEnd',
    canQueenPeek: round.stage === 'special' && actorForSpecial && special.type === 'Q',
    canJackSwap: round.stage === 'special' && actorForSpecial && special.type === 'J',
    canAceAdd: round.stage === 'special' && actorForSpecial && special.type === 'A',
    canDutch: round.stage === 'turn' && isCurrent && round.turnComplete && !round.dutchCallerId,
    canEndTurn: (round.stage === 'turn' && isCurrent && round.turnComplete) || (round.stage === 'special' && actorForSpecial),
    canNextRound: round.stage === 'roundEnd',
    canNewGame: round.stage === 'gameEnd'
  };
}

function broadcastState() {
  for (const socket of io.sockets.sockets.values()) {
    socket.emit('state', buildView(playerIdForSocket(socket)));
  }
}

function startingPlayerIndexForNextRound() {
  if (state.roundNumber <= 0) return 0;
  let bestIndex = 0;
  let bestScore = -Infinity;
  state.players.forEach((player, index) => {
    const score = typeof player.roundPoints === 'number' ? player.roundPoints : -Infinity;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function startRound() {
  clampDeckSetting();
  const starterIndex = startingPlayerIndexForNextRound();
  const deck = createCombinedDeck();
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
    player.startPeekDone = false;
    player.startPeekedCardIds = [];
  }

  for (let i = 0; i < 4; i += 1) {
    for (const player of state.players) {
      player.cards.push(drawFromDeck());
    }
  }

  addLog(`round ${state.roundNumber} started`);
}

function createOpeningDiscardAfterPeek() {
  const round = state.round;
  if (!round || round.discard.length > 0) return;
  const firstDiscard = drawFromDeck();
  if (!firstDiscard) return;
  round.discard.push(firstDiscard);
  round.throwIn = {
    open: true,
    token: nextTokenId++,
    topCardId: firstDiscard.id,
    rank: rankValue(firstDiscard)
  };
}

function startGame() {
  if (state.phase !== 'waiting' || activePlayerCount() < 2) return;
  state.phase = 'playing';
  state.log = [];
  state.roundNumber = 0;
  state.scoreHistory = [];
  for (const p of state.players) {
    p.total = 0;
    p.roundPoints = null;
  }
  addLog('game started');
  startRound();
}

function allPlayersPeeked() {
  return state.players.every((p) => p.left || p.startPeekDone);
}

function beginTurnsIfReady() {
  if (!state.round || state.round.stage !== 'peek') return;
  if (!allPlayersPeeked()) return;
  const firstConnectedIndex = findActiveIndexFrom(state.round.currentPlayerIndex);
  if (firstConnectedIndex < 0) return;
  state.round.currentPlayerIndex = firstConnectedIndex;
  createOpeningDiscardAfterPeek();
  state.round.stage = 'turn';
  state.round.turnComplete = false;
  state.round.drawn = null;
  addLog('all active players finished peeking');
  const first = currentPlayer();
  if (first) addLog(`${first.name}'s turn started`);
}

function advanceTurn() {
  const round = state.round;
  if (!round || round.stage === 'roundEnd' || round.stage === 'gameEnd') return;
  if (round.specialQueue.length > 0 || round.drawn) return;
  if (activePlayerCount() <= 1) {
    resetToWaiting(true, 'game ended because fewer than two players remain');
    return;
  }

  round.turnComplete = false;
  round.stage = 'turn';

  if (round.dutchCallerId) {
    while (round.dutchQueue.length > 0) {
      const nextId = round.dutchQueue.shift();
      const nextIndex = state.players.findIndex((p) => p.id === nextId && !p.left);
      if (nextIndex >= 0) {
        round.currentPlayerIndex = nextIndex;
        addLog(`${state.players[nextIndex].name}'s final turn started`);
        return;
      }
    }
    endRound();
    return;
  }

  const start = (round.currentPlayerIndex + 1) % state.players.length;
  const nextIndex = findActiveIndexFrom(start);
  if (nextIndex < 0) {
    resetToWaiting(true, 'game ended because fewer than two players remain');
    return;
  }
  round.currentPlayerIndex = nextIndex;
  addLog(`${currentPlayer().name}'s turn started`);
}

function endRound() {
  const round = state.round;
  if (!round) return;
  round.stage = 'roundEnd';
  round.drawn = null;
  round.turnComplete = false;
  if (round.throwIn) round.throwIn.open = false;
  round.specialQueue = [];

  const scoringPlayers = activePlayers();
  const scores = scoringPlayers.map((p) => ({
    player: p,
    raw: p.cards.reduce((sum, card) => sum + cardPoints(card), 0)
  }));
  const min = Math.min(...scores.map((s) => s.raw));
  const callerId = round.dutchCallerId;

  for (const score of scores) {
    let roundScore = score.raw;
    if (callerId && score.player.id === callerId) {
      roundScore = score.raw <= 5 && score.raw === min ? 0 : score.raw * 2;
    }
    score.player.roundPoints = roundScore;
    score.player.total += roundScore;
    if (score.player.total === 50 || score.player.total === 100) {
      score.player.total = Math.floor(score.player.total / 2);
      addLog(`${score.player.name}'s total was halved`);
    }
  }

  state.scoreHistory.push({
    round: state.roundNumber,
    players: scoringPlayers.map((p) => ({
      id: p.id,
      name: p.name,
      total: p.total,
      roundPoints: p.roundPoints
    }))
  });

  const bestRoundScore = Math.min(...scoringPlayers.map((p) => p.roundPoints));
  round.roundWinnerIds = scoringPlayers
    .filter((p) => p.roundPoints === bestRoundScore)
    .map((p) => p.id);

  const loser = scoringPlayers.find((p) => p.total > 100);
  if (loser) {
    round.stage = 'gameEnd';
    const winner = scoringPlayers.slice().sort((a, b) => a.total - b.total)[0];
    round.winnerId = winner ? winner.id : null;
    addLog(`game ended. ${winner ? winner.name : 'No one'} won`);
  } else {
    addLog('round ended');
  }
}

function nextRound() {
  if (!state.round || state.round.stage !== 'roundEnd') return;
  startRound();
}

function resetToWaiting(keepPlayers = true, reason = 'returned to waiting room') {
  const players = keepPlayers ? state.players.filter((p) => p.connected && !p.left).map((p) => ({
    id: p.id,
    name: p.name,
    connected: true,
    disconnectedAt: null,
    socketId: null,
    left: false,
    total: 0,
    roundPoints: null,
    cards: [],
    startPeekDone: false,
    startPeekedCardIds: []
  })) : [];
  state = freshState();
  state.players = players;
  clampDeckSetting();
  addLog(reason);
}


function removeDisconnectedSpecials() {
  const round = state.round;
  if (!round) return;
  let removedAny = false;
  while (round.specialQueue.length > 0 && !isActivePlayer(round.specialQueue[0].actorId)) {
    const special = round.specialQueue.shift();
    addLog(`${nameOf(special.actorId)} skipped ${specialName(special.type)} because they left`);
    removedAny = true;
  }
  if (removedAny) updateStageAfterQueue();
}

function handleMissingPlayers() {
  const round = state.round;
  if (state.phase !== 'playing' || !round) return false;
  if (activePlayerCount() <= 1) {
    resetToWaiting(true, 'game ended because fewer than two players remain');
    return true;
  }

  removeDisconnectedSpecials();

  if (round.stage === 'peek') {
    beginTurnsIfReady();
    return false;
  }

  if (round.stage !== 'turn') return false;

  const cp = currentPlayer();
  if (cp && !cp.left) return false;

  if (cp) addLog(cp.name + ' left, turn skipped');
  round.drawn = null;
  round.turnComplete = false;
  if (round.throwIn) round.throwIn.open = false;
  advanceTurn();
  return false;
}


function purgeExpiredDisconnectedPlayers() {
  const now = Date.now();
  const expired = state.players.filter((p) => !p.connected && p.disconnectedAt && now - p.disconnectedAt > DISCONNECT_GRACE_MS);
  if (expired.length === 0) return false;

  const currentId = currentPlayer() ? currentPlayer().id : null;
  state.players = state.players.filter((p) => !expired.includes(p));
  if (state.round) {
    const remainingIds = new Set(state.players.map((p) => p.id));
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
      state.round.currentPlayerIndex = state.players.findIndex((p) => p.id === currentId);
    } else if (state.round.currentPlayerIndex >= state.players.length) {
      state.round.currentPlayerIndex = 0;
    }
  }

  for (const player of expired) addLog(player.name + ' was removed after 15 minutes offline');
  clampDeckSetting();
  if (state.phase === 'playing' && activePlayerCount() <= 1) {
    resetToWaiting(true, 'game ended because fewer than two players remain');
  } else {
    handleMissingPlayers();
  }
  broadcastState();
  return true;
}

setInterval(purgeExpiredDisconnectedPlayers, 60 * 1000);

function setDeckSetting(value) {
  if (state.phase !== 'waiting') return;
  if (!['one', 'two'].includes(value)) return;
  state.deckSetting = value;
  clampDeckSetting();
}

function assertPlayer(socket) {
  return findPlayer(playerIdForSocket(socket));
}

io.on('connection', (socket) => {
  socket.on('identify', (tokenRaw) => {
    const playerId = normalizePlayerToken(tokenRaw) || socket.id;
    socket.data.playerId = playerId;
    const player = findPlayer(playerId);
    if (player && player.left) {
      socket.emit('state', buildView(playerId));
      return;
    }
    if (player) {
      const wasDisconnected = !player.connected;
      player.connected = true;
      player.disconnectedAt = null;
      player.socketId = socket.id;
      if (wasDisconnected) addLog(player.name + ' reconnected');
      broadcastState();
      return;
    }
    socket.emit('state', buildView(playerId));
  });

  socket.on('join', (joinRaw) => {
    const nameRaw = joinRaw && typeof joinRaw === 'object' ? joinRaw.name : joinRaw;
    const tokenRaw = joinRaw && typeof joinRaw === 'object' ? joinRaw.token : '';
    const joinToken = normalizePlayerToken(tokenRaw);
    if (joinToken) socket.data.playerId = joinToken;
    const name = String(nameRaw || '').trim().slice(0, 24);
    if (!name) return;
    if (state.phase !== 'waiting') {
      socket.emit('notice', state.waitingMessage);
      broadcastState();
      return;
    }
    if (activePlayerCount() >= 9) return;
    const playerId = playerIdForSocket(socket);
    const existing = findPlayer(playerId);
    if (existing) {
      existing.connected = true;
      existing.disconnectedAt = null;
      existing.socketId = socket.id;
      broadcastState();
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
      startPeekedCardIds: []
    });
    clampDeckSetting();
    addLog(`${name} joined`);
    broadcastState();
  });

  socket.on('leave', () => {
    const player = assertPlayer(socket);
    if (!player) return;
    if (state.phase === 'waiting') {
      state.players = state.players.filter((p) => p.id !== player.id);
      clampDeckSetting();
      addLog(`${player.name} left`);
      broadcastState();
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
      if (round.stage === 'special' && round.specialQueue.length === 0) updateStageAfterQueue();
      round.roundWinnerIds = (round.roundWinnerIds || []).filter((id) => id !== player.id);
      if (round.dutchCallerId === player.id) round.dutchCallerId = null;
      if (round.winnerId === player.id) round.winnerId = null;
      if (round.drawn && round.drawn.playerId === player.id) {
        round.drawn = null;
        round.turnComplete = false;
      }
      if (round.throwIn) round.throwIn.open = false;
    }
    addLog(`${player.name} left`);
    if (state.phase === 'playing' && activePlayerCount() <= 1) resetToWaiting(true, 'game ended because fewer than two players remain');
    else handleMissingPlayers();
    broadcastState();
  });

  socket.on('setDeckSetting', (value) => {
    if (!assertPlayer(socket)) return;
    setDeckSetting(value);
    broadcastState();
  });

  socket.on('startGame', () => {
    if (!assertPlayer(socket)) return;
    startGame();
    broadcastState();
  });

  socket.on('peekStart', (cardId) => {
    const player = assertPlayer(socket);
    const round = state.round;
    if (!player || !round || round.stage !== 'peek') return;
    if (player.startPeekDone) return;
    const card = player.cards.find((c) => c.id === cardId);
    if (!card) return;
    if (player.startPeekedCardIds.includes(cardId)) return;
    if (player.startPeekedCardIds.length >= 2) return;
    player.startPeekedCardIds.push(cardId);
    revealCardTo(player.id, cardId, 3000);
    if (player.startPeekedCardIds.length === 2) {
      player.startPeekDone = true;
      addLog(`${player.name} finished start peek`);
    }
    beginTurnsIfReady();
    broadcastState();
  });

  socket.on('takeDeck', () => {
    const player = assertPlayer(socket);
    const round = state.round;
    if (!player || !round || round.stage !== 'turn') return;
    if (currentPlayer()?.id !== player.id || round.drawn || round.turnComplete || topSpecial()) return;
    closeThrowInBecauseOfPlayingAction();
    const card = drawFromDeck();
    if (!card) return;
    round.drawn = { playerId: player.id, source: 'deck', card };
    addLog(`${player.name} drew from deck`);
    broadcastState();
  });

  socket.on('takePile', () => {
    const player = assertPlayer(socket);
    const round = state.round;
    if (!player || !round || round.stage !== 'turn') return;
    if (currentPlayer()?.id !== player.id || round.drawn || round.turnComplete || topSpecial()) return;
    if (round.discard.length === 0) return;
    closeThrowInBecauseOfPlayingAction();
    const card = round.discard.pop();
    round.drawn = { playerId: player.id, source: 'pile', card };
    addLog(`${player.name} took pile`);
    broadcastState();
  });

  socket.on('discardDrawn', () => {
    const player = assertPlayer(socket);
    const round = state.round;
    if (!player || !round || round.stage !== 'turn') return;
    if (currentPlayer()?.id !== player.id || !round.drawn || round.drawn.source !== 'deck') return;
    const card = round.drawn.card;
    round.drawn = null;
    round.turnComplete = true;
    pushDiscard(card, player.id, 'discarded');
    broadcastState();
  });

  socket.on('swapDrawn', (cardId) => {
    const player = assertPlayer(socket);
    const round = state.round;
    if (!player || !round || round.stage !== 'turn') return;
    if (currentPlayer()?.id !== player.id || !round.drawn) return;
    const index = player.cards.findIndex((c) => c.id === cardId);
    if (index < 0) return;
    const oldCard = player.cards[index];
    player.cards[index] = round.drawn.card;
    const source = round.drawn.source;
    round.drawn = null;
    round.turnComplete = true;
    pushDiscard(oldCard, player.id, source === 'pile' ? 'replaced with pile card and discarded' : 'replaced a card and discarded');
    broadcastState();
  });

  socket.on('throwIn', (cardId) => {
    const player = assertPlayer(socket);
    const round = state.round;
    if (!player || !round) return;
    if (!round.throwIn || !round.throwIn.open) return;
    if (round.stage === 'roundEnd' || round.stage === 'gameEnd') return;
    const index = player.cards.findIndex((c) => c.id === cardId);
    if (index < 0) return;
    const card = player.cards[index];
    const valid = rankValue(card) === round.throwIn.rank;
    if (!valid) {
      const penalty = drawFromDeck();
      if (penalty) player.cards.push(penalty);
      addLog(`${player.name} made a wrong throw-in and took a penalty card`);
      broadcastState();
      return;
    }
    round.throwIn.open = false;
    player.cards.splice(index, 1);
    pushDiscard(card, player.id, 'threw in', { allowThrowIn: false });
    broadcastState();
  });

  socket.on('aceAdd', (targetId) => {
    const player = assertPlayer(socket);
    const round = state.round;
    const special = topSpecial();
    if (!player || !round || round.stage !== 'special' || !special) return;
    if (special.actorId !== player.id || special.type !== 'A') return;
    const target = findPlayer(targetId);
    if (!target || isProtectedSpecialTarget(target.id)) return;
    const card = drawFromDeck();
    if (card) {
      target.cards.push(card);
      addLog(`${player.name} gave a card to ${target.name}`);
    }
    finishSpecial();
    broadcastState();
  });

  socket.on('queenPeek', (cardId) => {
    const player = assertPlayer(socket);
    const round = state.round;
    const special = topSpecial();
    if (!player || !round || round.stage !== 'special' || !special) return;
    if (special.actorId !== player.id || special.type !== 'Q') return;
    const target = playerByCardId(cardId);
    if (!target) return;
    revealCardTo(player.id, cardId, 3000);
    addLog(`${player.name} used Queen peek`);
    finishSpecial();
    broadcastState();
  });

  socket.on('jackSelect', (cardId) => {
    const player = assertPlayer(socket);
    const round = state.round;
    const special = topSpecial();
    if (!player || !round || round.stage !== 'special' || !special) return;
    if (special.actorId !== player.id || special.type !== 'J') return;
    const target = playerByCardId(cardId);
    if (!target || isProtectedSpecialTarget(target.player.id)) return;
    special.selected = special.selected || [];
    if (special.selected.includes(cardId)) return;
    special.selected.push(cardId);
    if (special.selected.length < 2) {
      broadcastState();
      return;
    }
    const a = playerByCardId(special.selected[0]);
    const b = playerByCardId(special.selected[1]);
    if (a && b && !isProtectedSpecialTarget(a.player.id) && !isProtectedSpecialTarget(b.player.id) && a.card.id !== b.card.id) {
      [a.player.cards[a.index], b.player.cards[b.index]] = [b.player.cards[b.index], a.player.cards[a.index]];
      addLog(`${player.name} used Jack swap`);
    }
    finishSpecial();
    broadcastState();
  });


  socket.on('sayDutch', () => {
    const player = assertPlayer(socket);
    const round = state.round;
    if (!player || !round || round.stage !== 'turn') return;
    if (currentPlayer()?.id !== player.id || !round.turnComplete || round.dutchCallerId) return;
    round.dutchCallerId = player.id;
    const ordered = [];
    for (let i = 1; i < state.players.length; i += 1) {
      const p = state.players[(round.currentPlayerIndex + i) % state.players.length];
      if (!p.left && p.id !== player.id) ordered.push(p.id);
    }
    round.dutchQueue = ordered;
    addLog(`${player.name} said Dutch`);
    advanceTurn();
    broadcastState();
  });

  socket.on("endTurn", () => {
    const player = assertPlayer(socket);
    const round = state.round;
    const special = topSpecial();
    if (!player || !round) return;
    if (round.stage === "special" && special && special.actorId === player.id) {
      addLog(`${player.name} skipped ${specialName(special.type)}`);
      finishSpecial();
      if (round.stage === "turn" && round.turnComplete && currentPlayer()?.id === player.id) advanceTurn();
      broadcastState();
      return;
    }
    if (round.stage !== "turn") return;
    if (currentPlayer()?.id !== player.id || !round.turnComplete) return;
    addLog(`${player.name} ended turn`);
    advanceTurn();
    broadcastState();
  });

  socket.on('nextRound', () => {
    if (!assertPlayer(socket)) return;
    nextRound();
    broadcastState();
  });

  socket.on('newGame', () => {
    if (!assertPlayer(socket)) return;
    resetToWaiting(true);
    broadcastState();
  });

  socket.on('endGameForAll', () => {
    if (!assertPlayer(socket)) return;
    resetToWaiting(true);
    broadcastState();
  });

  socket.on('disconnect', () => {
    const p = assertPlayer(socket);
    if (!p || p.socketId !== socket.id) return;
    p.connected = false;
    p.disconnectedAt = Date.now();
    p.socketId = null;
    addLog(p.name + ' disconnected');
    broadcastState();
  });
});

server.listen(PORT, () => {
  console.log("Dutch! 🂡 server running on http://localhost:" + PORT);
  for (const address of hostAddresses()) console.log("Dutch! 🂡 network address: " + address);
});
