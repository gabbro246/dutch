const express = require('express');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { Server } = require('socket.io');
const packageInfo = require('./package.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const DISCONNECT_GRACE_MS = 15 * 60 * 1000;
const WAITING_ROOM_TIMEOUT_MS = 15 * 60 * 1000;
const GAME_INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
const PLAYER_NAME_MAX_LENGTH = 16;
const ADMIN_LOG_PATH = path.join(__dirname, 'usage.log');
const APP_VERSION = packageInfo.version;

app.use(express.static('public'));

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SPECIALS = new Set(['A', 'Q', 'J']);
const RED_SUITS = new Set(['hearts', 'diamonds']);

const BOT_PROFILES = {
  strategic: {
    name: '🦉 Athena',
    label: 'strategic',
    cautious: 0.92,
    aggressive: 0.46,
    forgetful: 0.035,
    fast: 0.95,
    slow: 0.05,
    spiteful: 0.52,
    opportunistic: 0.94,
    mistake: 0.008,
    throwConfidence: 0.68,
    throwMiss: 0.005,
    pileMargin: 0.35,
    swapMargin: -0.15,
    dutchMargin: 1.05,
    queenOwnBias: 0.82,
    unknownOwnPenalty: 2.25,
    knownCardUtility: 1.05
  },
  roswell: {
    name: '👽 Roswell',
    label: 'elite',
    cautious: 0.98,
    aggressive: 0.58,
    forgetful: 0.005,
    fast: 0.99,
    slow: 0.01,
    spiteful: 0.70,
    opportunistic: 0.99,
    mistake: 0.001,
    throwConfidence: 0.56,
    throwMiss: 0.001,
    pileMargin: 0.18,
    swapMargin: -0.28,
    dutchMargin: 1.25,
    queenOwnBias: 0.92,
    unknownOwnPenalty: 2.75,
    knownCardUtility: 1.35
  },
  casual: {
    name: '🐑 Norman',
    label: 'casual',
    cautious: 0.60,
    aggressive: 0.48,
    forgetful: 0.20,
    fast: 0.56,
    slow: 0.45,
    spiteful: 0.45,
    opportunistic: 0.58,
    mistake: 0.075,
    throwConfidence: 0.76,
    throwMiss: 0.12,
    pileMargin: 0.35,
    swapMargin: 0.0,
    dutchMargin: 0.25,
    queenOwnBias: 0.58,
    unknownOwnPenalty: 1.35,
    knownCardUtility: 0.60
  },
  distracted: {
    name: '🐠 Dory',
    label: 'distracted',
    cautious: 0.38,
    aggressive: 0.50,
    forgetful: 0.42,
    fast: 0.28,
    slow: 0.78,
    spiteful: 0.28,
    opportunistic: 0.34,
    mistake: 0.17,
    throwConfidence: 0.72,
    throwMiss: 0.34,
    pileMargin: 0.05,
    swapMargin: -0.25,
    dutchMargin: -0.15,
    queenOwnBias: 0.62,
    unknownOwnPenalty: 0.75,
    knownCardUtility: 0.32
  }
};

const BOT_TYPES = Object.keys(BOT_PROFILES);
const botTimers = new Map();

let nextCardId = 1;
let nextTokenId = 1;
let state = freshState();

function freshState() {
  return {
    phase: 'waiting',
    deckSetting: 'one',
    gameTarget: 100,
    players: [],
    log: [],
    roundNumber: 0,
    scoreHistory: [],
    round: null,
    waitingMessage: 'A game is already active. Join after the game ends.',
    gameStartedAt: null,
    lastGameActivityAt: null
  };
}

function publicPlayerCount() {
  return state.players.length;
}

function markGameActivity() {
  if (state.phase === 'playing') state.lastGameActivityAt = Date.now();
}

function addLog(text, kind = 'game') {
  if (!text) return;
  if (kind === 'game') markGameActivity();
  if (state.round && kind === 'game') state.round.botTick = (state.round.botTick || 0) + 1;
  state.log.unshift({ text, kind });
  if (state.log.length > 80) state.log.length = 80;
}

function adminLog(event, data = {}) {
  const entry = {
    datetime: new Date().toISOString(),
    event,
    ...data
  };
  fs.appendFile(ADMIN_LOG_PATH, JSON.stringify(entry) + '\n', (error) => {
    if (error) console.error('Could not write admin usage log:', error.message);
  });
}

function hostAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((address) => address && address.family === 'IPv4' && !address.internal)
    .map((address) => "http://" + address.address + ":" + PORT);
}

function nameGraphemes(value) {
  const text = String(value || '').trim();
  if (!text) return [];
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (part) => part.segment);
  }
  return Array.from(text);
}

function isEmojiGrapheme(value) {
  return Array.from(String(value || '')).some((char) => {
    const code = char.codePointAt(0);
    return (code >= 0x1F000 && code <= 0x1FAFF) ||
      (code >= 0x1F1E6 && code <= 0x1F1FF) ||
      (code >= 0x2600 && code <= 0x27BF) ||
      (code >= 0x2300 && code <= 0x23FF);
  });
}

function shortPlayerName(name) {
  const graphemes = nameGraphemes(name);
  if (graphemes.length === 0) return '';
  if (isEmojiGrapheme(graphemes[0])) return graphemes[0];
  if (graphemes.length > 5) return graphemes.slice(0, 4).join('') + '.';
  return graphemes.join('');
}

function normalizedShortPlayerName(name) {
  return shortPlayerName(name).toLocaleLowerCase();
}

function playerShortNameTaken(name, ignoredId = '', ignoredBotType = '') {
  const normalized = normalizedShortPlayerName(name);
  if (!normalized) return false;
  const reservedByBot = BOT_TYPES.some((type) => type !== ignoredBotType && normalizedShortPlayerName(BOT_PROFILES[type].name) === normalized);
  if (reservedByBot) return true;
  return activePlayers().some((player) => player.id !== ignoredId && normalizedShortPlayerName(player.name) === normalized);
}

function activePlayers() {
  return state.players.filter((p) => !p.left);
}

function activePlayerCount() {
  return activePlayers().length;
}

function activeHumanCount() {
  return activePlayers().filter((p) => !p.isBot).length;
}

function hasPlayableHumanGame() {
  return activeHumanCount() >= 1 && activePlayerCount() >= 2;
}

function scoreSnapshot() {
  return activePlayers().map((p) => ({
    name: p.name,
    total: p.total,
    roundPoints: p.roundPoints
  }));
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


function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function botProfile(bot) {
  return BOT_PROFILES[bot && bot.botType] || BOT_PROFILES.casual;
}

function activeBots() {
  return activePlayers().filter((p) => p.isBot);
}

function publicMemoryCard(card) {
  if (!card) return null;
  return {
    rank: card.rank,
    suit: card.suit,
    red: isRedSuit(card.suit),
    points: cardPoints(card)
  };
}

function currentBotTick() {
  return state.round ? (state.round.botTick || 0) : 0;
}

function unknownMemory(source = 'unknown') {
  return {
    state: 'unknown',
    card: null,
    rank: null,
    confidence: 0,
    source,
    updatedTick: currentBotTick()
  };
}

function cardMemory(card, source, confidence = 0.9, stateName = 'known') {
  return {
    state: stateName,
    card: publicMemoryCard(card),
    rank: rankValue(card),
    confidence,
    source,
    updatedTick: currentBotTick()
  };
}

function ensureBotMemory(bot) {
  if (!bot || !bot.isBot || !state.round) return null;
  if (!bot.botMemory || bot.botMemory.roundNumber !== state.roundNumber) {
    bot.botMemory = {
      roundNumber: state.roundNumber,
      slots: {},
      discards: [],
      pendingPile: null,
      drawn: null,
      aceAttackers: {}
    };
  }
  for (const player of activePlayers()) {
    if (!bot.botMemory.slots[player.id]) bot.botMemory.slots[player.id] = [];
    const slots = bot.botMemory.slots[player.id];
    while (slots.length < player.cards.length) slots.push(unknownMemory('unknown'));
    if (slots.length > player.cards.length) slots.length = player.cards.length;
  }
  return bot.botMemory;
}

function syncBotMemories() {
  for (const bot of activeBots()) ensureBotMemory(bot);
}

function rememberSlotForBot(bot, ownerId, index, card, source, confidence = 0.9, stateName = 'known') {
  const memory = ensureBotMemory(bot);
  if (!memory || !memory.slots[ownerId]) return;
  memory.slots[ownerId][index] = cardMemory(card, source, confidence, stateName);
}

function rememberSlotForAllBots(ownerId, index, card, source, confidence = 0.88, stateName = 'known') {
  for (const bot of activeBots()) rememberSlotForBot(bot, ownerId, index, card, source, confidence, stateName);
}

function forgetSlotForAllBots(ownerId, index, source = 'unknown') {
  for (const bot of activeBots()) {
    const memory = ensureBotMemory(bot);
    if (memory && memory.slots[ownerId]) memory.slots[ownerId][index] = unknownMemory(source);
  }
}

function addUnknownSlotForAllBots(ownerId, source = 'unknown') {
  for (const bot of activeBots()) {
    const memory = ensureBotMemory(bot);
    if (memory && memory.slots[ownerId]) memory.slots[ownerId].push(unknownMemory(source));
  }
}

function removeSlotForAllBots(ownerId, index, source = 'removed') {
  for (const bot of activeBots()) {
    const memory = ensureBotMemory(bot);
    if (memory && memory.slots[ownerId]) memory.slots[ownerId].splice(index, 1);
    if (memory) memory.discards.push({ source, updatedTick: currentBotTick() });
  }
}

function moveSlotMemoryForAllBots(ownerA, indexA, ownerB, indexB, source = 'swap') {
  for (const bot of activeBots()) {
    const memory = ensureBotMemory(bot);
    if (!memory || !memory.slots[ownerA] || !memory.slots[ownerB]) continue;
    const a = memory.slots[ownerA][indexA] || unknownMemory();
    const b = memory.slots[ownerB][indexB] || unknownMemory();
    memory.slots[ownerA][indexA] = { ...b, source, updatedTick: currentBotTick() };
    memory.slots[ownerB][indexB] = { ...a, source, updatedTick: currentBotTick() };
  }
}

function observeDiscardForAllBots(card, source, actorId = null) {
  if (!card) return;
  for (const bot of activeBots()) {
    const memory = ensureBotMemory(bot);
    if (!memory) continue;
    memory.discards.push({ card: publicMemoryCard(card), rank: rankValue(card), source, actorId, updatedTick: currentBotTick() });
    if (memory.discards.length > 80) memory.discards.shift();
  }
}

function observePileTakeForAllBots(actorId, card) {
  for (const bot of activeBots()) {
    const memory = ensureBotMemory(bot);
    if (memory) memory.pendingPile = { actorId, card: publicMemoryCard(card), rank: rankValue(card), updatedTick: currentBotTick() };
  }
}

function observeAceForAllBots(actorId, targetId) {
  for (const bot of activeBots()) {
    const memory = ensureBotMemory(bot);
    if (!memory || targetId !== bot.id || actorId === bot.id) continue;
    memory.aceAttackers[actorId] = (memory.aceAttackers[actorId] || 0) + 1;
  }
}

function botMemoryEntry(bot, ownerId, index) {
  const memory = ensureBotMemory(bot);
  return memory && memory.slots[ownerId] ? memory.slots[ownerId][index] : unknownMemory();
}

function effectiveMemory(bot, entry) {
  const profile = botProfile(bot);
  if (!entry || !entry.card) return { state: 'unknown', confidence: 0, card: null, rank: entry ? entry.rank : null, source: entry ? entry.source : 'unknown' };
  const age = Math.max(0, currentBotTick() - (entry.updatedTick || 0));
  const decay = Math.pow(Math.max(0.2, 1 - profile.forgetful * 0.13), age);
  const confidence = Math.max(0, Math.min(1, entry.confidence * decay));
  const threshold = 0.24 + profile.forgetful * 0.22;
  if (confidence < threshold) return { ...entry, state: 'stale', confidence, card: null };
  return { ...entry, state: confidence > 0.65 ? 'known' : 'guessed', confidence };
}

function unknownExpectedPoints(bot = null) {
  if (!bot || !state.round) return 6.4;
  const memory = ensureBotMemory(bot);
  if (!memory) return 6.4;
  const decks = state.deckSetting === 'two' ? 2 : 1;
  const seen = new Map();
  const addSeen = (card) => {
    if (!card || !card.rank || !card.suit) return;
    const key = card.rank + ':' + card.suit;
    seen.set(key, Math.min(decks, (seen.get(key) || 0) + 1));
  };
  for (const discard of memory.discards || []) addSeen(discard.card);
  for (const slots of Object.values(memory.slots || {})) {
    for (const entry of slots) {
      const effective = effectiveMemory(bot, entry);
      if (effective.card) addSeen(effective.card);
    }
  }
  let remainingPoints = 0;
  let remainingCards = 0;
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      const key = rank + ':' + suit;
      const remaining = Math.max(0, decks - (seen.get(key) || 0));
      remainingCards += remaining;
      remainingPoints += remaining * cardPoints({ rank, suit });
    }
  }
  return remainingCards > 0 ? remainingPoints / remainingCards : 6.4;
}

function rankStatsForBot(bot, rank) {
  const decks = state.deckSetting === 'two' ? 2 : 1;
  const totalRankCards = decks * SUITS.length;
  const seenBySuit = new Map();
  const addSeen = (card) => {
    if (!card || card.rank !== rank || !card.suit) return;
    seenBySuit.set(card.suit, Math.min(decks, (seenBySuit.get(card.suit) || 0) + 1));
  };
  const memory = ensureBotMemory(bot);
  if (memory) {
    for (const discard of memory.discards || []) addSeen(discard.card);
    for (const slots of Object.values(memory.slots || {})) {
      for (const entry of slots) {
        const effective = effectiveMemory(bot, entry);
        if (effective.card) addSeen(effective.card);
      }
    }
  }
  const seen = Array.from(seenBySuit.values()).reduce((sum, count) => sum + count, 0);
  return {
    seen,
    total: totalRankCards,
    remaining: Math.max(0, totalRankCards - seen)
  };
}

function rankDiscardPressure(bot, rank) {
  let pressure = 0;
  for (const player of activePlayers()) {
    if (player.id === bot.id || isProtectedSpecialTarget(player.id)) continue;
    player.cards.forEach((card, index) => {
      const memory = effectiveMemory(bot, botMemoryEntry(bot, player.id, index));
      if (!memory.card || memory.card.rank !== rank) return;
      const points = memory.card.points;
      pressure += (memory.confidence || 0) * (0.25 + Math.min(1, Math.max(0, points) / 10));
    });
  }
  return pressure;
}

function throwInPotentialValue(bot, card) {
  if (!bot || !card || !card.rank) return 0;
  const stats = rankStatsForBot(bot, card.rank);
  const remainingRatio = stats.total > 0 ? stats.remaining / stats.total : 0;
  const pressure = Math.min(1.8, rankDiscardPressure(bot, card.rank));
  const points = typeof card.points === 'number' ? card.points : cardPoints(card);
  const cardCountUtility = card.rank === 'K' && card.red ? 0.55 : 0.22;
  const pointUtility = Math.min(1.25, Math.max(0, points) / 9);
  return (remainingRatio * 1.2 + pressure * 0.75) * (cardCountUtility + pointUtility);
}

function discardGiftPenalty(bot, card) {
  if (!card) return 0;
  const points = typeof card.points === 'number' ? card.points : cardPoints(card);
  let penalty = 0;
  if (card.rank === 'K' && (card.red || isRedSuit(card.suit))) penalty += 2.35;
  else if (points <= 2) penalty += 0.75;
  else if (points <= 4) penalty += 0.35;
  if (SPECIALS.has(card.rank)) penalty += specialActionValue(bot, card) * 0.2;
  const nextIndex = findActiveIndexFrom((state.round.currentPlayerIndex + 1) % Math.max(1, state.players.length));
  const next = nextIndex >= 0 ? state.players[nextIndex] : null;
  if (next && next.id !== bot.id) {
    const nextEstimate = botExpectedScore(bot, next);
    if (nextEstimate > 7 && points <= 3) penalty += 0.45;
  }
  return penalty;
}

function cardStrategicCost(bot, card, options = {}) {
  if (!card) return unknownExpectedPoints(bot);
  let cost = cardPoints(card);
  const publicCardView = publicMemoryCard(card) || card;
  if (card.rank === 'K' && isRedSuit(card.suit)) cost -= 1.15;
  if (card.rank === 'K' && !isRedSuit(card.suit)) cost += 0.85;
  if (SPECIALS.has(card.rank)) cost -= specialActionValue(bot, publicCardView) * (options.immediateSpecial ? 0.55 : 0.16);
  cost -= throwInPotentialValue(bot, publicCardView) * (options.ownCard ? 0.65 : 0.35);
  return cost;
}

function botSwapTargets(bot, incomingCard) {
  const incomingCost = cardStrategicCost(bot, incomingCard, { ownCard: true });
  const currentRoundScore = botExpectedRoundScore(bot, bot);
  const incomingRaw = cardPoints(incomingCard);
  const currentHalvingBonus = totalHalvingBonus(bot, currentRoundScore, { scale: 0.16 });
  const canTuneHalving = state.round && state.round.dutchCallerId && state.round.dutchCallerId !== bot.id;
  return botOwnSlots(bot)
    .map((slot) => {
      const effective = effectiveMemory(bot, slot.memory);
      const knownCard = effective.card || null;
      const currentCost = expectedEntryPoints(bot, slot.memory, { countSpecialUtility: true, ownDecision: true });
      const currentRaw = expectedEntryRawPoints(bot, slot.memory);
      const projectedRoundScore = currentRoundScore - currentRaw + incomingRaw;
      const halvingBonus = canTuneHalving
        ? totalHalvingBonus(bot, projectedRoundScore, { scale: 0.2 }) - currentHalvingBonus
        : 0;
      const giftPenalty = knownCard ? discardGiftPenalty(bot, knownCard) * Math.max(0.35, effective.confidence || 0) : 0;
      return {
        ...slot,
        expected: currentCost,
        improvement: currentCost - incomingCost - giftPenalty + halvingBonus,
        confidence: effective.confidence || 0
      };
    })
    .sort((a, b) => b.improvement - a.improvement || b.expected - a.expected);
}

function botBestSwapTarget(bot, incomingCard) {
  const targets = botSwapTargets(bot, incomingCard);
  if (targets.length === 0) return null;
  if (Math.random() < botProfile(bot).mistake && targets.length > 1) return targets[1];
  return targets[0];
}

function knownOwnCardUtility(bot, effective) {
  if (!effective || !effective.card) return 0;
  const profile = botProfile(bot);
  const points = effective.card.points;
  const confidence = effective.confidence || 0;
  let utility = profile.knownCardUtility * confidence;
  if (points >= 8) utility += Math.min(1.35, (points - 6) * 0.18) * confidence;
  if (SPECIALS.has(effective.card.rank)) utility += specialActionValue(bot, effective.card) * 0.22 * confidence;
  if (effective.card.rank === 'K' && effective.card.red) utility += 0.6 * confidence;
  return utility;
}

function specialActionValue(bot, card) {
  if (!card || !SPECIALS.has(card.rank)) return 0;
  const profile = botProfile(bot);
  if (card.rank === 'A') return 1.1 + profile.spiteful * 1.2 + profile.opportunistic * 0.6;
  if (card.rank === 'Q') return 1.0 + profile.cautious * 1.2;
  if (card.rank === 'J') return 1.3 + profile.opportunistic * 1.5 + profile.aggressive * 0.8;
  return 0;
}

function expectedEntryPoints(bot, entry, options = {}) {
  const effective = effectiveMemory(bot, entry);
  const unknown = unknownExpectedPoints(bot);
  const profile = botProfile(bot);
  if (!effective.card) return unknown + (options.ownDecision ? profile.unknownOwnPenalty : 0);
  let known = effective.card.points;
  if (effective.card.rank === 'K' && effective.card.red) known -= 0.7;
  if (effective.card.rank === 'K' && !effective.card.red) known += 0.7;
  if (options.ownDecision) known -= throwInPotentialValue(bot, effective.card) * 0.65;
  if (options.countSpecialUtility) known -= specialActionValue(bot, effective.card) * 0.35;
  if (options.ownDecision) known -= knownOwnCardUtility(bot, effective);
  return effective.confidence * known + (1 - effective.confidence) * unknown;
}

function botOwnSlots(bot) {
  ensureBotMemory(bot);
  return bot.cards.map((card, index) => ({ player: bot, index, card, memory: botMemoryEntry(bot, bot.id, index) }));
}

function botExpectedScore(bot, player) {
  ensureBotMemory(bot);
  return player.cards.reduce((sum, card, index) => sum + expectedEntryPoints(bot, botMemoryEntry(bot, player.id, index), { countSpecialUtility: player.id === bot.id }), 0);
}

function expectedEntryRawPoints(bot, entry) {
  const effective = effectiveMemory(bot, entry);
  const unknown = unknownExpectedPoints(bot);
  if (!effective.card) return unknown;
  return (effective.confidence || 0) * effective.card.points + (1 - (effective.confidence || 0)) * unknown;
}

function botExpectedRoundScore(bot, player) {
  ensureBotMemory(bot);
  return player.cards.reduce((sum, card, index) => sum + expectedEntryRawPoints(bot, botMemoryEntry(bot, player.id, index)), 0);
}

function botRoundScoreConfidence(bot) {
  const slots = botOwnSlots(bot);
  if (slots.length === 0) return 1;
  const total = slots.reduce((sum, slot) => sum + (effectiveMemory(bot, slot.memory).confidence || 0), 0);
  return total / slots.length;
}

function totalHalvingBonus(bot, projectedRoundScore, options = {}) {
  if (!bot || typeof projectedRoundScore !== 'number') return 0;
  const multiplier = options.multiplier || 1;
  const profile = botProfile(bot);
  const projectedTotal = bot.total + projectedRoundScore * multiplier;
  let best = 0;
  for (const target of [50, 100]) {
    if (target <= bot.total) continue;
    const distance = Math.abs(projectedTotal - target);
    const tolerance = options.tolerance ?? (0.65 + profile.aggressive * 0.35);
    if (distance > tolerance) continue;
    const payoff = target / 2;
    const saved = Math.max(0, projectedTotal - payoff);
    best = Math.max(best, saved * (options.scale || 0.22) * (1 - distance / (tolerance + 0.01)));
  }
  return best;
}

function botDeliberateDutchHalving(bot, expectedRoundScore) {
  const confidence = botRoundScoreConfidence(bot);
  const profile = botProfile(bot);
  const risk = botRiskMode(bot);
  if (confidence < 0.58 + profile.cautious * 0.12) return false;
  for (const target of [50, 100]) {
    const needed = target - bot.total;
    if (needed <= 10 || needed % 2 !== 0) continue;
    const desiredRaw = needed / 2;
    if (desiredRaw <= 5) continue;
    const tolerance = 0.45 + (1 - confidence) * 1.4 + profile.aggressive * 0.25;
    const distance = Math.abs(expectedRoundScore - desiredRaw);
    if (distance > tolerance) continue;
    const doubledTotal = bot.total + desiredRaw * 2;
    const missWouldLikelyLose = doubledTotal > state.gameTarget && target !== 100;
    if (missWouldLikelyLose && risk !== 'behind' && profile.aggressive < 0.5) continue;
    return true;
  }
  return false;
}

function botBestOwnSlot(bot, mode = 'highest') {
  const slots = botOwnSlots(bot).map((slot) => ({ ...slot, expected: expectedEntryPoints(bot, slot.memory, { countSpecialUtility: true, ownDecision: true }) }));
  if (slots.length === 0) return null;
  slots.sort((a, b) => mode === 'lowest' ? a.expected - b.expected : b.expected - a.expected);
  if (Math.random() < botProfile(bot).mistake && slots.length > 1) return slots[Math.min(slots.length - 1, 1 + Math.floor(Math.random() * (slots.length - 1)))];
  return slots[0];
}

function botLowOpponentSlot(bot) {
  const candidates = [];
  const profile = botProfile(bot);
  for (const player of activePlayers()) {
    if (player.id === bot.id || isProtectedSpecialTarget(player.id)) continue;
    player.cards.forEach((card, index) => {
      const memory = botMemoryEntry(bot, player.id, index);
      const effective = effectiveMemory(bot, memory);
      const expected = expectedEntryPoints(bot, memory);
      if (effective.card || Math.random() < profile.mistake * 0.8) {
        candidates.push({ player, index, expected, confidence: effective.confidence || 0, memory });
      }
    });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.expected - b.expected || b.confidence - a.confidence);
  return candidates[0];
}

function botOpponentEstimates(bot) {
  return activePlayers()
    .filter((p) => p.id !== bot.id && !isProtectedSpecialTarget(p.id))
    .map((player) => ({ player, expected: botExpectedScore(bot, player), cards: player.cards.length, total: player.total }))
    .sort((a, b) => a.expected - b.expected);
}

function botRiskMode(bot) {
  const totals = activePlayers().map((p) => p.total);
  const min = Math.min(...totals);
  const max = Math.max(...totals);
  if (bot.total >= max - 3 && bot.total > min + 10) return 'behind';
  if (bot.total <= min + 3 && max > bot.total + 8) return 'ahead';
  return 'middle';
}

function shouldBotTakePile(bot) {
  const round = state.round;
  const top = round && round.discard[round.discard.length - 1];
  if (!top) return false;
  const profile = botProfile(bot);
  const best = botBestSwapTarget(bot, top);
  if (!best) return false;
  let margin = best.improvement + discardGiftPenalty(bot, publicMemoryCard(top)) * 0.42;
  const risk = botRiskMode(bot);
  if (risk === 'behind') margin += profile.aggressive * 0.85;
  if (risk === 'ahead') margin -= profile.cautious * 0.65;
  if (Math.random() < profile.mistake) margin += randomBetween(-2.3, 1.3);
  return margin > profile.pileMargin;
}

function shouldBotSwapDrawn(bot, drawnCard) {
  const profile = botProfile(bot);
  const best = botBestSwapTarget(bot, drawnCard);
  if (!best || !drawnCard) return false;
  let improvement = best.improvement;
  const specialUtility = SPECIALS.has(drawnCard.rank) ? specialActionValue(bot, publicMemoryCard(drawnCard)) : 0;
  if (SPECIALS.has(drawnCard.rank)) improvement -= specialUtility * (0.42 + profile.opportunistic * 0.18);
  if (best.expected < 2.5 && cardPoints(drawnCard) > best.expected) improvement -= profile.cautious * 1.05;
  if (botRiskMode(bot) === 'behind') improvement += profile.aggressive * 0.35;
  if (Math.random() < profile.mistake) improvement += randomBetween(-2.4, 2.0);
  return improvement > profile.swapMargin;
}

function botThrowThreshold(bot) {
  const profile = botProfile(bot);
  let threshold = profile.throwConfidence;
  const risk = botRiskMode(bot);
  if (risk === 'behind') threshold -= 0.12;
  if (risk === 'ahead') threshold += 0.08;
  if (state.gameTarget - bot.total <= 20) threshold -= 0.05;
  return Math.max(0.45, Math.min(0.97, threshold));
}

function botReactionDelay(bot, confidence) {
  const profile = botProfile(bot);
  return Math.round(450 + profile.slow * 1200 - profile.fast * 260 + (1 - confidence) * 1100 + randomBetween(0, 850));
}

function botScheduleKey(parts) {
  return parts.join(':');
}

function scheduleBotTimer(key, delay, fn) {
  if (botTimers.has(key)) return;
  const timer = setTimeout(() => {
    botTimers.delete(key);
    fn();
  }, delay);
  botTimers.set(key, timer);
}

function clearBotTimers() {
  for (const timer of botTimers.values()) clearTimeout(timer);
  botTimers.clear();
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

function isJackSwapInProgress() {
  const round = state.round;
  const special = topSpecial();
  return !!(round && round.stage === 'special' && special && special.type === 'J' && (special.selected || []).length === 1);
}

function canPlayerSayDutch(playerId) {
  const round = state.round;
  const player = findPlayer(playerId);
  if (!round || !player || player.left || round.dutchCallerId) return false;
  const cp = currentPlayer();
  const noCards = player.cards.length === 0;
  if (noCards && !round.drawn) {
    if (!cp || cp.id !== playerId) return false;
    if (round.stage === 'turn') return true;
    const special = topSpecial();
    return !!(round.stage === 'special' && special && special.actorId === playerId);
  }
  if (!round.turnComplete) return false;
  if (!cp || cp.id !== playerId) return false;
  if (round.stage === 'turn') return true;
  const special = topSpecial();
  return !!(round.stage === 'special' && special && special.actorId === playerId);
}

function mustPlayerSayDutch(playerId) {
  const player = findPlayer(playerId);
  return !!(player && player.cards.length === 0 && canPlayerSayDutch(playerId));
}

function setDutchCaller(player) {
  const round = state.round;
  if (!round || !player) return;
  round.dutchCallerId = player.id;
  const callerIndex = state.players.findIndex((p) => p.id === player.id);
  const startIndex = callerIndex >= 0 ? callerIndex : round.currentPlayerIndex;
  const ordered = [];
  for (let i = 1; i < state.players.length; i += 1) {
    const p = state.players[(startIndex + i) % state.players.length];
    if (!p.left && p.id !== player.id) ordered.push(p.id);
  }
  round.dutchQueue = ordered;
  addLog(`${player.name} said Dutch`);
}

function callDutchForPlayer(player) {
  const round = state.round;
  const special = topSpecial();
  if (!round || !player || !canPlayerSayDutch(player.id)) return false;
  if (round.stage === 'special' && special && special.actorId === player.id) {
    addLog(`${player.name} skipped ${specialName(special.type)}`);
    finishSpecial();
  }
  setDutchCaller(player);
  advanceTurn();
  return true;
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
  const base = {
    you: playerId,
    joined,
    phase: state.phase,
    version: APP_VERSION,
    deckSetting: state.deckSetting,
    gameTarget: state.gameTarget,
    oneDeckDisabled: activePlayerCount() > 4,
    canJoin: state.phase === 'waiting' && activePlayerCount() < 9 && !joined,
    canStart: state.phase === 'waiting' && hasPlayableHumanGame(),
    waitingMessage: state.phase === 'playing' && !joined ? state.waitingMessage : '',
    gameStartedAt: state.gameStartedAt,
    players: activePlayers().map((p) => ({
      id: p.id,
      name: p.name,
      total: p.total,
      roundPoints: p.roundPoints,
      connected: p.connected,
      isBot: !!p.isBot,
      botType: p.botType || '',
      joinedAt: p.joinedAt || null,
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
  const pendingDutchIds = new Set(round.dutchQueue || []);

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
      card: publicCard(round.drawn.card, round.drawn.playerId === playerId || round.drawn.source === 'pile')
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
      isBot: !!p.isBot,
      botType: p.botType || '',
      isCurrent: !['peek', 'roundEnd', 'gameEnd'].includes(round.stage) && cp && cp.id === p.id,
      finalTurnDone: !!(round.dutchCallerId && !['roundEnd', 'gameEnd'].includes(round.stage) && p.id !== round.dutchCallerId && !pendingDutchIds.has(p.id) && (!cp || cp.id !== p.id || round.turnComplete)),
      cards: p.cards.map((card) => {
        const view = publicCard(card, canViewerSeeCard(playerId, p.id, card));
        if (view && p.id === playerId && p.startPeekedCardIds && p.startPeekedCardIds.includes(card.id)) view.startPeeked = true;
        return view;
      })
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
  const mustDutch = mustPlayerSayDutch(playerId);
  const jackSwapInProgress = isJackSwapInProgress();
  const beforeDraw = round.stage === 'turn' && isCurrent && !round.drawn && !round.turnComplete && !special && !mustDutch;
  return {
    canPeekStart: round.stage === 'peek' && !player.startPeekDone,
    canTake: beforeDraw,
    canDiscardDrawn: round.stage === 'turn' && isCurrent && round.drawn && round.drawn.source === 'deck' && !mustDutch,
    canSwapDrawn: round.stage === 'turn' && isCurrent && !!round.drawn && !mustDutch,
    canThrowIn: !!(round.throwIn && round.throwIn.open) && round.stage !== 'roundEnd' && round.stage !== 'gameEnd' && !jackSwapInProgress,
    canQueenPeek: round.stage === 'special' && actorForSpecial && special.type === 'Q' && !mustDutch,
    canJackSwap: round.stage === 'special' && actorForSpecial && special.type === 'J' && !mustDutch,
    canAceAdd: round.stage === 'special' && actorForSpecial && special.type === 'A' && !mustDutch,
    canDutch: canPlayerSayDutch(playerId),
    canEndTurn: !mustDutch && ((round.stage === 'turn' && isCurrent && round.turnComplete) || (round.stage === 'special' && actorForSpecial)),
    canNextRound: round.stage === 'roundEnd',
    canNewGame: round.stage === 'gameEnd'
  };
}

function broadcastState() {
  for (const socket of io.sockets.sockets.values()) {
    socket.emit('state', buildView(playerIdForSocket(socket)));
  }
  scheduleBotAutomation();
}


function scheduleBotAutomation() {
  if (state.phase !== 'playing' || !state.round) return;
  syncBotMemories();
  const round = state.round;
  if (round.stage === 'peek') {
    for (const bot of activeBots()) {
      if (!bot.startPeekDone) {
        scheduleBotTimer(botScheduleKey(['peek', state.roundNumber, bot.id]), randomBetween(700, 1800), () => botDoStartPeek(bot.id));
      }
    }
  }

  const special = topSpecial();
  if (round.stage === 'special' && special) {
    const actor = findPlayer(special.actorId);
    if (actor && actor.isBot) {
      scheduleBotTimer(botScheduleKey(['special', state.roundNumber, special.type, actor.id, round.specialQueue.length]), randomBetween(650, 1800), () => botResolveSpecial(actor.id));
    }
  }

  const current = currentPlayer();
  if (round.stage === 'turn' && current && current.isBot) {
    if (mustPlayerSayDutch(current.id)) {
      scheduleBotTimer(botScheduleKey(['dutch', state.roundNumber, current.id, round.botTick || 0]), randomBetween(650, 1200), () => botEndTurn(current.id));
    } else if (!round.drawn && !round.turnComplete && !special) {
      scheduleBotTimer(botScheduleKey(['turn', state.roundNumber, current.id, round.botTick || 0]), randomBetween(700, 1800), () => botTakeTurnAction(current.id));
    } else if (round.drawn && round.drawn.playerId === current.id) {
      scheduleBotTimer(botScheduleKey(['drawn', state.roundNumber, current.id, round.drawn.card.id]), randomBetween(650, 1700), () => botResolveDrawn(current.id));
    } else if (round.turnComplete) {
      scheduleBotTimer(botScheduleKey(['endturn', state.roundNumber, current.id, round.botTick || 0]), randomBetween(650, 1600), () => botEndTurn(current.id));
    }
  }

  if (round.throwIn && round.throwIn.open) scheduleBotThrowIns();
}

function scheduleBotThrowIns() {
  const round = state.round;
  if (!round || !round.throwIn || !round.throwIn.open || isJackSwapInProgress()) return;
  for (const bot of activeBots()) {
    const candidate = botThrowInCandidate(bot);
    if (!candidate) continue;
    const key = botScheduleKey(['throw', state.roundNumber, round.throwIn.token, bot.id, candidate.index]);
    scheduleBotTimer(key, botReactionDelay(bot, candidate.confidence), () => botDoThrowIn(bot.id, candidate.index, round.throwIn ? round.throwIn.token : null));
  }
}

function botDoStartPeek(botId) {
  const bot = findPlayer(botId);
  const round = state.round;
  if (!bot || !bot.isBot || !round || round.stage !== 'peek' || bot.startPeekDone) return;
  ensureBotMemory(bot);
  const indexes = shuffle(bot.cards.map((_, index) => index)).slice(0, 2);
  for (const index of indexes) {
    const card = bot.cards[index];
    if (!card) continue;
    bot.startPeekedCardIds.push(card.id);
    rememberSlotForBot(bot, bot.id, index, card, 'start peek', 0.96);
  }
  bot.startPeekDone = true;
  addLog(`${bot.name} finished start peek`);
  beginTurnsIfReady();
  broadcastState();
}

function botTakeTurnAction(botId) {
  const bot = findPlayer(botId);
  const round = state.round;
  if (!bot || !bot.isBot || !round || round.stage !== 'turn') return;
  if (currentPlayer()?.id !== bot.id || round.drawn || round.turnComplete || topSpecial() || mustPlayerSayDutch(bot.id)) return;
  if (shouldBotTakePile(bot)) botTakePile(bot);
  else botTakeDeck(bot);
}

function botTakeDeck(bot) {
  const round = state.round;
  if (!round || mustPlayerSayDutch(bot.id)) return;
  closeThrowInBecauseOfPlayingAction();
  const card = drawFromDeck();
  if (!card) return;
  round.drawn = { playerId: bot.id, source: 'deck', card };
  const memory = ensureBotMemory(bot);
  if (memory) memory.drawn = cardMemory(card, 'deck draw', 1);
  addLog(`${bot.name} drew from deck`);
  broadcastState();
}

function botTakePile(bot) {
  const round = state.round;
  if (!round || round.discard.length === 0 || mustPlayerSayDutch(bot.id)) return;
  closeThrowInBecauseOfPlayingAction();
  const card = round.discard.pop();
  round.drawn = { playerId: bot.id, source: 'pile', card };
  observePileTakeForAllBots(bot.id, card);
  const memory = ensureBotMemory(bot);
  if (memory) memory.drawn = cardMemory(card, 'pile observation', 1);
  addLog(`${bot.name} took pile`);
  broadcastState();
}

function botResolveDrawn(botId) {
  const bot = findPlayer(botId);
  const round = state.round;
  if (!bot || !bot.isBot || !round || currentPlayer()?.id !== bot.id || !round.drawn) return;
  const drawn = round.drawn.card;
  const best = botBestSwapTarget(bot, drawn);
  if (!best) return;
  if (round.drawn.source === 'pile' || shouldBotSwapDrawn(bot, drawn)) botSwapDrawn(bot, best.index);
  else botDiscardDrawn(bot);
}

function botDiscardDrawn(bot) {
  const round = state.round;
  if (!round || !round.drawn || round.drawn.playerId !== bot.id || round.drawn.source !== 'deck') return;
  const card = round.drawn.card;
  round.drawn = null;
  round.turnComplete = true;
  const memory = ensureBotMemory(bot);
  if (memory) memory.drawn = null;
  observeDiscardForAllBots(card, 'discarded', bot.id);
  pushDiscard(card, bot.id, 'discarded');
  broadcastState();
}

function botSwapDrawn(bot, index) {
  const round = state.round;
  if (!round || !round.drawn || round.drawn.playerId !== bot.id) return;
  if (index < 0 || index >= bot.cards.length) return;
  const oldCard = bot.cards[index];
  const newCard = round.drawn.card;
  const source = round.drawn.source;
  bot.cards[index] = newCard;
  round.drawn = null;
  round.turnComplete = true;
  const memory = ensureBotMemory(bot);
  if (memory) memory.drawn = null;
  if (source === 'pile') {
    rememberSlotForAllBots(bot.id, index, newCard, 'pile observation', 0.9);
    rememberSlotForBot(bot, bot.id, index, newCard, 'pile observation', 0.98);
  } else {
    forgetSlotForAllBots(bot.id, index, 'deck swap');
    rememberSlotForBot(bot, bot.id, index, newCard, 'deck draw', 1);
  }
  observeDiscardForAllBots(oldCard, 'swap discard', bot.id);
  pushDiscard(oldCard, bot.id, source === 'pile' ? 'replaced with pile card and discarded' : 'replaced a card and discarded');
  broadcastState();
}

function botResolveSpecial(botId) {
  const bot = findPlayer(botId);
  const round = state.round;
  const special = topSpecial();
  if (!bot || !bot.isBot || !round || round.stage !== 'special' || !special || special.actorId !== bot.id) return;
  if (Math.random() < botProfile(bot).mistake * 0.7) return botSkipSpecial(bot);
  if (special.type === 'A') return botUseAce(bot);
  if (special.type === 'Q') return botUseQueen(bot);
  if (special.type === 'J') return botUseJack(bot);
  botSkipSpecial(bot);
}

function botSkipSpecial(bot) {
  const special = topSpecial();
  if (special) addLog(`${bot.name} skipped ${specialName(special.type)}`);
  finishSpecial();
  if (state.round && state.round.stage === 'turn' && state.round.turnComplete && currentPlayer()?.id === bot.id) advanceTurn();
  broadcastState();
}

function botAceTargetScore(bot, estimate) {
  const memory = ensureBotMemory(bot);
  const profile = botProfile(bot);
  const player = estimate.player;
  const tableTotals = activePlayers().map((p) => p.total);
  const bestTotal = Math.min(...tableTotals);
  const scoreThreat = Math.max(0, 10 - estimate.expected) * 1.15;
  const cardCountThreat = Math.max(0, 5 - player.cards.length) * 1.2;
  const standingsThreat = Math.max(0, bot.total - player.total + 8) * 0.08 + Math.max(0, bestTotal + 5 - player.total) * 0.06;
  const revenge = memory && memory.aceAttackers ? (memory.aceAttackers[player.id] || 0) * (0.8 + profile.spiteful * 0.9) : 0;
  const finalTurnThreat = state.round && state.round.dutchQueue && state.round.dutchQueue.includes(player.id) ? 0.9 : 0;
  return scoreThreat + cardCountThreat + standingsThreat + revenge + finalTurnThreat;
}

function botUseAce(bot) {
  const round = state.round;
  const targets = botOpponentEstimates(bot).filter((entry) => entry.player.id !== round.dutchCallerId);
  if (targets.length === 0) return botSkipSpecial(bot);
  const scoredTargets = targets
    .map((entry) => ({ ...entry, aceScore: botAceTargetScore(bot, entry) }))
    .sort((a, b) => b.aceScore - a.aceScore || a.expected - b.expected || a.cards - b.cards);
  const target = scoredTargets[0];
  const unknown = unknownExpectedPoints(bot);
  if (target.aceScore < 1.6 && target.expected > unknown * Math.max(1.7, target.player.cards.length - 1) && Math.random() > botProfile(bot).aggressive) return botSkipSpecial(bot);
  const card = drawFromDeck();
  if (card) {
    target.player.cards.push(card);
    addUnknownSlotForAllBots(target.player.id, 'Ace');
    observeAceForAllBots(bot.id, target.player.id);
    addLog(`${bot.name} gave a card to ${target.player.name}`);
  }
  finishSpecial();
  broadcastState();
}

function botQueenTargets(bot) {
  const ownUnknown = bot.cards
    .map((card, index) => {
      const rawMemory = botMemoryEntry(bot, bot.id, index);
      return {
        player: bot,
        index,
        score: expectedEntryPoints(bot, rawMemory, { countSpecialUtility: true, ownDecision: true }),
        memory: effectiveMemory(bot, rawMemory)
      };
    })
    .filter((slot) => !slot.memory.card || slot.memory.state === 'stale');
  const opponentUnknown = [];
  for (const estimate of botOpponentEstimates(bot)) {
    estimate.player.cards.forEach((card, index) => {
      const rawMemory = botMemoryEntry(bot, estimate.player.id, index);
      const memory = effectiveMemory(bot, rawMemory);
      if (!memory.card || memory.state === 'stale') opponentUnknown.push({ player: estimate.player, index, memory, estimate: estimate.expected, total: estimate.total });
    });
  }
  ownUnknown.sort((a, b) => b.score - a.score);
  opponentUnknown.sort((a, b) => a.estimate - b.estimate || a.total - b.total);
  return { ownUnknown, opponentUnknown };
}

function botUseQueen(bot) {
  const targets = botQueenTargets(bot);
  const profile = botProfile(bot);
  const ownScore = botExpectedScore(bot, bot);
  let target = null;
  const ownNeed = targets.ownUnknown.length * (0.85 + profile.cautious * 0.6) + Math.max(0, ownScore - 5) * 0.16;
  const opponentNeed = targets.opponentUnknown.length > 0
    ? Math.max(0, 8 - targets.opponentUnknown[0].estimate) * 0.22 + Math.max(0, 4 - targets.opponentUnknown[0].player.cards.length) * 0.25
    : 0;
  if (targets.ownUnknown.length > 0 && (ownNeed >= opponentNeed || Math.random() < profile.queenOwnBias)) {
    target = targets.ownUnknown[0];
  } else if (targets.opponentUnknown.length > 0) {
    target = targets.opponentUnknown[0];
  } else if (targets.ownUnknown.length > 0) {
    target = targets.ownUnknown[0];
  }
  if (!target) return botSkipSpecial(bot);
  const card = target.player.cards[target.index];
  if (!card) return botSkipSpecial(bot);
  rememberSlotForBot(bot, target.player.id, target.index, card, 'Queen peek', 0.96);
  addLog(`${bot.name} used Queen peek`);
  finishSpecial();
  broadcastState();
}

function botJackCandidates(bot) {
  const candidates = [];
  const botScore = botExpectedScore(bot, bot);
  const ownSlots = botOwnSlots(bot).map((slot) => {
    const effective = effectiveMemory(bot, slot.memory);
    return {
      player: bot,
      index: slot.index,
      card: slot.card,
      expected: expectedEntryPoints(bot, slot.memory, { ownDecision: true }),
      confidence: effective.confidence || 0
    };
  });
  const opponentSlots = [];
  for (const player of activePlayers()) {
    if (player.id === bot.id || isProtectedSpecialTarget(player.id)) continue;
    const playerExpected = botExpectedScore(bot, player);
    player.cards.forEach((card, index) => {
      const memory = botMemoryEntry(bot, player.id, index);
      const effective = effectiveMemory(bot, memory);
      if (!effective.card) return;
      opponentSlots.push({
        player,
        index,
        card,
        expected: expectedEntryPoints(bot, memory),
        confidence: effective.confidence || 0,
        playerExpected
      });
    });
  }

  for (const own of ownSlots) {
    for (const opp of opponentSlots) {
      const threatBonus = Math.max(0, botScore + 2 - opp.playerExpected) * 0.18 + Math.max(0, 4 - opp.player.cards.length) * 0.18;
      const utility = own.expected - opp.expected + threatBonus - Math.max(0, 0.58 - opp.confidence);
      if (utility > 0) candidates.push({ type: 'self', a: own, b: opp, utility });
    }
  }

  for (const threat of opponentSlots) {
    if (threat.playerExpected > botScore + 3 && threat.player.total >= bot.total - 4) continue;
    for (const donor of opponentSlots) {
      if (donor.player.id === threat.player.id) continue;
      const diff = donor.expected - threat.expected;
      if (diff <= 0) continue;
      const threatPriority = Math.max(0, botScore + 3 - threat.playerExpected) * 0.28 + Math.max(0, 4 - threat.player.cards.length) * 0.25 + Math.max(0, bot.total - threat.player.total + 6) * 0.04;
      const donorCost = Math.max(0, botScore - donor.playerExpected) * 0.12;
      const utility = diff * 0.58 + threatPriority - donorCost - Math.max(0, 0.62 - Math.min(threat.confidence, donor.confidence));
      if (utility > 0) candidates.push({ type: 'sabotage', a: threat, b: donor, utility });
    }
  }

  return candidates.sort((a, b) => b.utility - a.utility);
}

function botUseJack(bot) {
  const profile = botProfile(bot);
  const candidates = botJackCandidates(bot);
  if (candidates.length === 0) return botSkipSpecial(bot);
  const candidate = candidates[0];
  const requiredImprovement = candidate.type === 'self'
    ? 1.75 - profile.opportunistic * 0.7
    : 1.25 - profile.spiteful * 0.55 - profile.opportunistic * 0.25;
  if (candidate.utility < requiredImprovement && Math.random() > profile.aggressive) return botSkipSpecial(bot);
  const a = { player: candidate.a.player, index: candidate.a.index, card: candidate.a.player.cards[candidate.a.index] };
  const b = { player: candidate.b.player, index: candidate.b.index, card: candidate.b.player.cards[candidate.b.index] };
  if (!a.card || !b.card || a.card.id === b.card.id || isProtectedSpecialTarget(a.player.id) || isProtectedSpecialTarget(b.player.id)) return botSkipSpecial(bot);
  [a.player.cards[a.index], b.player.cards[b.index]] = [b.player.cards[b.index], a.player.cards[a.index]];
  moveSlotMemoryForAllBots(a.player.id, a.index, b.player.id, b.index, 'Jack swap');
  addLog(`${bot.name} used Jack swap`);
  finishSpecial();
  broadcastState();
}

function estimatedTurnImprovement(bot, player) {
  const slots = player.cards.map((card, index) => ({
    expected: expectedEntryPoints(bot, botMemoryEntry(bot, player.id, index), { ownDecision: player.id === bot.id }),
    memory: effectiveMemory(bot, botMemoryEntry(bot, player.id, index))
  }));
  if (slots.length === 0) return 0;
  const highest = slots.sort((a, b) => b.expected - a.expected)[0];
  const unknown = unknownExpectedPoints(bot);
  const drawImprovement = Math.max(0, highest.expected - unknown) * 0.42;
  const top = state.round && state.round.discard[state.round.discard.length - 1];
  const pileImprovement = top ? Math.max(0, highest.expected - cardStrategicCost(bot, top, { ownCard: true })) * 0.65 : 0;
  const knowledgePenalty = slots.filter((slot) => !slot.memory.card).length * 0.18;
  return Math.max(0, Math.max(drawImprovement, pileImprovement) - knowledgePenalty);
}

function botShouldCallDutch(bot) {
  const expected = botExpectedRoundScore(bot, bot);
  const profile = botProfile(bot);
  const opponents = activePlayers()
    .filter((p) => p.id !== bot.id && !isProtectedSpecialTarget(p.id))
    .map((player) => ({ player, expected: botExpectedRoundScore(bot, player), cards: player.cards.length, total: player.total }))
    .sort((a, b) => a.expected - b.expected);
  const bestOpponent = opponents[0] || null;
  const unknownOwn = botOwnSlots(bot).filter((slot) => !effectiveMemory(bot, slot.memory).card).length;
  const projectedLower = opponents.some((entry) => entry.expected - estimatedTurnImprovement(bot, entry.player) < expected - 0.35);
  const alreadyLower = opponents.some((entry) => entry.expected < expected - 0.45);
  if (botDeliberateDutchHalving(bot, expected)) return true;
  const risk = botRiskMode(bot);
  let threshold = 5 - profile.cautious * 0.55 + profile.aggressive * 0.35 + profile.dutchMargin;
  if (state.gameTarget === 50) threshold -= 0.2;
  if (risk === 'behind') threshold += 0.35 + profile.aggressive * 0.35;
  if (risk === 'ahead') threshold -= 0.35 + profile.cautious * 0.25;
  if (unknownOwn === 0) threshold += 0.28 + profile.cautious * 0.28;
  else threshold -= unknownOwn * (0.45 + profile.cautious * 0.23);
  if (bestOpponent && expected < bestOpponent.expected - 2.0) threshold += profile.cautious * 0.32;
  if (alreadyLower) threshold -= 1.25 + profile.cautious * 0.8;
  if (projectedLower) threshold -= 0.9 + profile.cautious * 0.75;
  if (expected <= 2.2 && unknownOwn === 0 && !alreadyLower) threshold = Math.max(threshold, 2.6);
  const cap = unknownOwn === 0 ? 5.25 + (risk === 'behind' ? 0.2 : 0) : 4.75 - unknownOwn * 0.32;
  threshold = Math.min(threshold, cap);
  if (Math.random() < profile.mistake * 0.5) threshold += randomBetween(0.4, 1.4);
  return expected <= threshold;
}

function botEndTurn(botId) {
  const bot = findPlayer(botId);
  const round = state.round;
  if (!bot || !bot.isBot || !round || currentPlayer()?.id !== bot.id) return;
  if (canPlayerSayDutch(bot.id) && (bot.cards.length === 0 || botShouldCallDutch(bot))) {
    callDutchForPlayer(bot);
    broadcastState();
    return;
  }
  if (round.stage === 'turn' && round.turnComplete) {
    advanceTurn();
    broadcastState();
  }
}

function botThrowInCandidate(bot) {
  const round = state.round;
  if (!round || !round.throwIn || !round.throwIn.open) return null;
  const threshold = botThrowThreshold(bot);
  const candidates = [];
  bot.cards.forEach((card, index) => {
    const memory = effectiveMemory(bot, botMemoryEntry(bot, bot.id, index));
    if (!memory.rank && !memory.card) return;
    const rank = memory.rank || (memory.card && memory.card.rank);
    const confidence = memory.confidence || 0;
    if (rank === round.throwIn.rank && confidence >= threshold) candidates.push({ index, confidence, expected: expectedEntryPoints(bot, botMemoryEntry(bot, bot.id, index)) });
    else if (rank === round.throwIn.rank && confidence >= threshold - 0.18 && Math.random() < botProfile(bot).mistake) candidates.push({ index, confidence, expected: 99 });
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.expected - a.expected);
  if (Math.random() < botProfile(bot).throwMiss * (1.1 - candidates[0].confidence)) return null;
  return candidates[0];
}

function botDoThrowIn(botId, index, token) {
  const bot = findPlayer(botId);
  const round = state.round;
  if (!bot || !bot.isBot || !round || !round.throwIn || !round.throwIn.open || round.throwIn.token !== token || isJackSwapInProgress()) return;
  if (round.stage === 'roundEnd' || round.stage === 'gameEnd') return;
  if (index < 0 || index >= bot.cards.length) return;
  const card = bot.cards[index];
  const valid = rankValue(card) === round.throwIn.rank;
  if (!valid) {
    const penalty = drawFromDeck();
    if (penalty) {
      bot.cards.push(penalty);
      addUnknownSlotForAllBots(bot.id, 'wrong throw-in penalty');
    }
    addLog(`${bot.name} made a wrong throw-in and took a penalty card`);
    broadcastState();
    return;
  }
  round.throwIn.open = false;
  rememberSlotForAllBots(bot.id, index, card, 'throw-in', 0.98);
  bot.cards.splice(index, 1);
  removeSlotForAllBots(bot.id, index, 'throw-in');
  observeDiscardForAllBots(card, 'throw-in', bot.id);
  pushDiscard(card, bot.id, 'threw in', { allowThrowIn: false });
  broadcastState();
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
    player.startPeekDone = false;
    player.startPeekedCardIds = [];
  }

  for (let i = 0; i < 4; i += 1) {
    for (const player of state.players) {
      player.cards.push(drawFromDeck());
    }
  }

  syncBotMemories();
  addLog(`round ${state.roundNumber} started`);
}

function createOpeningDiscardAfterPeek() {
  const round = state.round;
  if (!round || round.discard.length > 0) return;
  const firstDiscard = drawFromDeck();
  if (!firstDiscard) return;
  round.discard.push(firstDiscard);
  observeDiscardForAllBots(firstDiscard, 'opening discard');
  round.throwIn = {
    open: true,
    token: nextTokenId++,
    topCardId: firstDiscard.id,
    rank: rankValue(firstDiscard)
  };
}

function startGame() {
  if (state.phase !== 'waiting' || !hasPlayableHumanGame()) return;
  state.phase = 'playing';
  const now = Date.now();
  state.gameStartedAt = now;
  state.lastGameActivityAt = now;
  state.log = [];
  state.roundNumber = 0;
  state.scoreHistory = [];
  for (const p of state.players) {
    p.total = 0;
    p.roundPoints = null;
  }
  const names = activePlayers().map((p) => p.name);
  adminLog('game_started', { players: names, target: state.gameTarget });
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
}

function advanceTurn() {
  const round = state.round;
  if (!round || round.stage === 'roundEnd' || round.stage === 'gameEnd') return;
  if (round.specialQueue.length > 0 || round.drawn) return;
  if (!hasPlayableHumanGame()) {
    resetToWaiting(true, 'game ended because no human-playable table remains', { adminEvent: 'game_ended_inactivity' });
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
        return;
      }
    }
    endRound();
    return;
  }

  const start = (round.currentPlayerIndex + 1) % state.players.length;
  const nextIndex = findActiveIndexFrom(start);
  if (nextIndex < 0) {
    resetToWaiting(true, 'game ended because no human-playable table remains', { adminEvent: 'game_ended_inactivity' });
    return;
  }
  round.currentPlayerIndex = nextIndex;
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

  const loser = scoringPlayers.find((p) => p.total > state.gameTarget);
  if (loser) {
    round.stage = 'gameEnd';
    const winner = scoringPlayers.slice().sort((a, b) => a.total - b.total)[0];
    round.winnerId = winner ? winner.id : null;
    addLog(`game ended. ${winner ? winner.name : 'No one'} won`);
    adminLog('game_ended_by_score', { target: state.gameTarget, winner: winner ? winner.name : null, scores: scoreSnapshot() });
  } else {
    addLog('round ended');
  }
}

function nextRound() {
  if (!state.round || state.round.stage !== 'roundEnd') return;
  startRound();
}

function resetToWaiting(keepPlayers = true, reason = 'returned to waiting room', options = {}) {
  clearBotTimers();
  if (state.phase === 'playing' && options.adminEvent) {
    adminLog(options.adminEvent, { reason, scores: scoreSnapshot() });
  }
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
    startPeekedCardIds: [],
    joinedAt: p.isBot ? null : Date.now(),
    isBot: !!p.isBot,
    botType: p.botType || '',
    botMemory: null
  })) : [];
  state = freshState();
  state.players = players;
  clampDeckSetting();
  addLog(reason, options.logKind || 'system');
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
  if (!hasPlayableHumanGame()) {
    resetToWaiting(true, 'game ended because no human-playable table remains', { adminEvent: 'game_ended_inactivity' });
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
  if (state.phase === 'playing' && state.lastGameActivityAt && now - state.lastGameActivityAt > GAME_INACTIVITY_TIMEOUT_MS) {
    resetToWaiting(true, 'game ended after 15 minutes without activity', { adminEvent: 'game_ended_inactivity_timeout' });
    broadcastState();
    return true;
  }
  if (state.phase === 'waiting') {
    const expiredWaiting = state.players.filter((p) => !p.isBot && p.joinedAt && now - p.joinedAt > WAITING_ROOM_TIMEOUT_MS);
    if (expiredWaiting.length > 0) {
      for (const player of expiredWaiting) removeWaitingPlayer(player.id, 'left after 15 minutes in the waiting room');
      broadcastState();
      return true;
    }
  }
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

  for (const player of expired) addLog(player.name + ' was removed after 15 minutes offline', 'system');
  clampDeckSetting();
  if (state.phase === 'playing' && !hasPlayableHumanGame()) {
    resetToWaiting(true, 'game ended because no human-playable table remains', { adminEvent: 'game_ended_inactivity' });
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

function setGameTarget(value) {
  if (state.phase !== 'waiting') return;
  const target = Number(value);
  if (![50, 100].includes(target)) return;
  state.gameTarget = target;
}

function removeWaitingPlayer(playerId, reason = 'removed from waiting room') {
  if (state.phase !== 'waiting') return false;
  const player = findPlayer(playerId);
  if (!player) return false;
  state.players = state.players.filter((p) => p.id !== playerId);
  clampDeckSetting();
  addLog(`${player.name} ${reason}`, 'system');
  return true;
}


function addBotPlayer(type, requesterId = '') {
  if (state.phase !== 'waiting') return { ok: false, message: 'Bots can only be added in the waiting room.' };
  if (!isActivePlayer(requesterId)) return { ok: false, message: 'Join the waiting room before adding bots.' };
  if (!BOT_PROFILES[type]) return { ok: false, message: 'Unknown bot type.' };
  if (activePlayerCount() >= 9) return { ok: false, message: 'The player list is full.' };
  if (activePlayers().some((p) => p.isBot && p.botType === type)) return { ok: false, message: 'That bot is already in the player list.' };
  const profile = BOT_PROFILES[type];
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
    joinedAt: null,
    isBot: true,
    botType: type,
    botMemory: null
  });
  clampDeckSetting();
  addLog(`${profile.name} joined`, 'system');
  return { ok: true };
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
      if (wasDisconnected) addLog(player.name + ' reconnected', 'system');
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
    const name = String(nameRaw || '').trim().slice(0, PLAYER_NAME_MAX_LENGTH);
    if (!name) return;
    if (state.phase !== 'waiting') {
      socket.emit('notice', state.waitingMessage);
      broadcastState();
      return;
    }
    if (activePlayerCount() >= 9) return;
    const playerId = playerIdForSocket(socket);
    const duplicateShortName = playerShortNameTaken(name, playerId);
    if (duplicateShortName) {
      broadcastState();
      return;
    }
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
      startPeekedCardIds: [],
      joinedAt: Date.now()
    });
    clampDeckSetting();
    addLog(`${name} joined`);
    broadcastState();
  });

  socket.on('leave', () => {
    const player = assertPlayer(socket);
    if (!player) return;
    if (state.phase === 'waiting') {
      removeWaitingPlayer(player.id, 'left');
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
    addLog(`${player.name} left`, 'system');
    if (state.phase === 'playing' && !hasPlayableHumanGame()) resetToWaiting(true, 'game ended because no human-playable table remains', { adminEvent: 'game_ended_inactivity' });
    else handleMissingPlayers();
    broadcastState();
  });

  socket.on('setDeckSetting', (value) => {
    if (!assertPlayer(socket)) return;
    setDeckSetting(value);
    broadcastState();
  });

  socket.on('setGameTarget', (value) => {
    if (!assertPlayer(socket)) return;
    setGameTarget(value);
    broadcastState();
  });

  socket.on('removeWaitingPlayer', (playerId) => {
    if (removeWaitingPlayer(String(playerId || ''), 'was removed from the waiting room')) broadcastState();
  });

  socket.on('addBot', (typeRaw) => {
    const player = assertPlayer(socket);
    const result = addBotPlayer(String(typeRaw || ''), player ? player.id : '');
    if (!result.ok && result.message) socket.emit('notice', result.message);
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
    markGameActivity();
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
    if (currentPlayer()?.id !== player.id || round.drawn || round.turnComplete || topSpecial() || mustPlayerSayDutch(player.id)) return;
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
    if (currentPlayer()?.id !== player.id || round.drawn || round.turnComplete || topSpecial() || mustPlayerSayDutch(player.id)) return;
    if (round.discard.length === 0) return;
    closeThrowInBecauseOfPlayingAction();
    const card = round.discard.pop();
    round.drawn = { playerId: player.id, source: 'pile', card };
    observePileTakeForAllBots(player.id, card);
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
    observeDiscardForAllBots(card, 'discarded', player.id);
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
    const newCard = round.drawn.card;
    player.cards[index] = newCard;
    const source = round.drawn.source;
    round.drawn = null;
    round.turnComplete = true;
    if (source === 'pile') rememberSlotForAllBots(player.id, index, newCard, 'pile observation', 0.9);
    else forgetSlotForAllBots(player.id, index, 'deck swap');
    observeDiscardForAllBots(oldCard, 'swap discard', player.id);
    pushDiscard(oldCard, player.id, source === 'pile' ? 'replaced with pile card and discarded' : 'replaced a card and discarded');
    broadcastState();
  });

  socket.on('throwIn', (cardId) => {
    const player = assertPlayer(socket);
    const round = state.round;
    if (!player || !round) return;
    if (!round.throwIn || !round.throwIn.open) return;
    if (round.stage === 'roundEnd' || round.stage === 'gameEnd' || isJackSwapInProgress()) return;
    const index = player.cards.findIndex((c) => c.id === cardId);
    if (index < 0) return;
    const card = player.cards[index];
    const valid = rankValue(card) === round.throwIn.rank;
    if (!valid) {
      const penalty = drawFromDeck();
      if (penalty) {
        player.cards.push(penalty);
        addUnknownSlotForAllBots(player.id, 'wrong throw-in penalty');
      }
      addLog(`${player.name} made a wrong throw-in and took a penalty card`);
      broadcastState();
      return;
    }
    round.throwIn.open = false;
    rememberSlotForAllBots(player.id, index, card, 'throw-in', 0.98);
    player.cards.splice(index, 1);
    removeSlotForAllBots(player.id, index, 'throw-in');
    observeDiscardForAllBots(card, 'throw-in', player.id);
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
      addUnknownSlotForAllBots(target.id, 'Ace');
      observeAceForAllBots(player.id, target.id);
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
    markGameActivity();
    if (special.selected.length < 2) {
      broadcastState();
      return;
    }
    const a = playerByCardId(special.selected[0]);
    const b = playerByCardId(special.selected[1]);
    if (a && b && !isProtectedSpecialTarget(a.player.id) && !isProtectedSpecialTarget(b.player.id) && a.card.id !== b.card.id) {
      [a.player.cards[a.index], b.player.cards[b.index]] = [b.player.cards[b.index], a.player.cards[a.index]];
      moveSlotMemoryForAllBots(a.player.id, a.index, b.player.id, b.index, 'Jack swap');
      addLog(`${player.name} used Jack swap`);
    }
    finishSpecial();
    broadcastState();
  });


  socket.on("sayDutch", () => {
    const player = assertPlayer(socket);
    const round = state.round;
    if (!player || !round) return;
    if (!callDutchForPlayer(player)) return;
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
    resetToWaiting(true, 'game cancelled by players', { adminEvent: 'game_cancelled' });
    broadcastState();
  });

  socket.on('disconnect', () => {
    const p = assertPlayer(socket);
    if (!p || p.socketId !== socket.id) return;
    p.connected = false;
    p.disconnectedAt = Date.now();
    p.socketId = null;
    addLog(p.name + ' disconnected', 'system');
    broadcastState();
  });
});

server.listen(PORT, () => {
  console.log("Dutch! 🂡 server running on http://localhost:" + PORT);
  for (const address of hostAddresses()) console.log("Dutch! 🂡 network address: " + address);
});
