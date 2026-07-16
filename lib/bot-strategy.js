const { BOT_PROFILES } = require('./bot-profiles.js');
const { isRedSuit, cardPoints } = require('../public/shared.js');

function botProfile(bot) {
  return BOT_PROFILES[bot && bot.botType] || BOT_PROFILES.casual;
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

function rankValue(card) {
  return card ? card.rank : null;
}

function unknownMemory(source = 'unknown', updatedTick = 0) {
  return {
    state: 'unknown',
    card: null,
    rank: null,
    confidence: 0,
    source,
    updatedTick
  };
}

function cardMemory(card, source, confidence = 0.9, stateName = 'known', updatedTick = 0) {
  return {
    state: stateName,
    card: publicMemoryCard(card),
    rank: rankValue(card),
    confidence,
    source,
    updatedTick
  };
}

function effectiveMemory(bot, entry, currentTick = 0) {
  const profile = botProfile(bot);
  if (!entry || !entry.card) {
    return {
      state: 'unknown',
      confidence: 0,
      card: null,
      rank: entry ? entry.rank : null,
      source: entry ? entry.source : 'unknown'
    };
  }
  const age = Math.max(0, currentTick - (entry.updatedTick || 0));
  const decay = Math.pow(Math.max(0.2, 1 - profile.forgetful * 0.13), age);
  const confidence = Math.max(0, Math.min(1, entry.confidence * decay));
  const threshold = 0.24 + profile.forgetful * 0.22;
  if (confidence < threshold) return { ...entry, state: 'stale', confidence, card: null };
  return { ...entry, state: confidence > 0.65 ? 'known' : 'guessed', confidence };
}

module.exports = {
  botProfile,
  publicMemoryCard,
  rankValue,
  unknownMemory,
  cardMemory,
  effectiveMemory
};
