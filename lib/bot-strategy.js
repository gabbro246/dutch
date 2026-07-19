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

function memoryDecayRate(bot, entry) {
  const profile = botProfile(bot);
  if (profile.memoryOwnDecay === 0 && profile.memoryOpponentDecay === 0) return 0;
  const source = String(entry && entry.source || '').toLowerCase();
  const isOwn = entry && entry.ownerId && bot && entry.ownerId === bot.id;
  if (isOwn || source.includes('own') || source.includes('deck draw') || source.includes('start peek')) {
    return profile.memoryOwnDecay ?? profile.forgetful * 0.06;
  }
  if (source.includes('discard') || source.includes('pile') || source.includes('throw-in')) {
    return profile.memoryPublicDecay ?? profile.forgetful * 0.09;
  }
  return profile.memoryOpponentDecay ?? profile.forgetful * 0.12;
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
  const decay = Math.pow(Math.max(0.01, 1 - memoryDecayRate(bot, entry)), age);
  const confidence = Math.max(0, Math.min(1, entry.confidence * decay));
  const threshold = 0.24 + profile.forgetful * 0.22;
  const rememberedCard = entry.card ? publicMemoryCard(entry.card) : null;
  const distribution = rememberedCard
    ? [{ card: rememberedCard, probability: confidence }]
    : (entry.distribution || []);
  if (confidence < threshold) return { ...entry, state: 'stale', confidence, card: null, distribution };
  return { ...entry, state: confidence > 0.65 ? 'known' : 'guessed', confidence, distribution };
}

module.exports = {
  botProfile,
  publicMemoryCard,
  rankValue,
  unknownMemory,
  cardMemory,
  memoryDecayRate,
  effectiveMemory
};
