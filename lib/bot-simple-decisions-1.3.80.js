const {
  RANKS,
  SUITS,
  cardPoints,
  isRedSuit
} = require('../public/shared.js');
const { botProfile } = require('./bot-strategy.js');

const MEMORY_THRESHOLD = 0.5;

function createSimpleDecisionLayer(deps) {
  const {
    getState,
    ensureBotMemory,
    botMemoryEntry,
    activePlayablePlayers
  } = deps;
  const randomBetween = deps.randomBetween || ((min, max) => min + Math.random() * (max - min));
  const random = deps.random || Math.random;

  function state() {
    return getState();
  }

  function players() {
    return activePlayablePlayers();
  }

  function pickRandom(items) {
    if (!items.length) return null;
    return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
  }

  function falseMemoryCard(previous) {
    const candidates = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        if (previous && previous.rank === rank && previous.suit === suit) continue;
        const card = { rank, suit };
        candidates.push({
          rank,
          suit,
          red: isRedSuit(suit),
          points: cardPoints(card)
        });
      }
    }
    return pickRandom(candidates);
  }

  function recallEntry(bot, ownerId, index) {
    ensureBotMemory(bot);
    const entry = botMemoryEntry(bot, ownerId, index);
    if (!entry || !entry.card) {
      return {
        ...(entry || {}),
        state: 'unknown',
        card: null,
        confidence: 0
      };
    }

    const profile = botProfile(bot);
    const round = state().round || {};
    const tick = round.strategyTick ?? round.botTick ?? 0;
    const cycleLength = Math.max(1, players().length);
    const cycles = Math.max(0, tick - (entry.updatedTick || 0)) / cycleLength;
    const decayRate = ownerId === bot.id
      ? profile.memoryCycleDecay
      : profile.memoryOpponentCycleDecay;
    const confidence = Math.max(0, Math.min(1, (entry.confidence || 0) - (decayRate || 0) * cycles));

    if (confidence < MEMORY_THRESHOLD) {
      entry.state = 'stale';
      entry.card = null;
      entry.rank = null;
      entry.knownRank = null;
      entry.confidence = confidence;
      return { ...entry, card: null, confidence };
    }

    if (entry.recallCheckedTick !== tick) {
      entry.recallCheckedTick = tick;
      if (random() > confidence) {
        const mistakenCard = falseMemoryCard(entry.card);
        entry.card = mistakenCard;
        entry.rank = mistakenCard.rank;
        entry.knownRank = mistakenCard.rank;
        entry.expectedValue = mistakenCard.points;
        entry.confidence = confidence;
        entry.updatedTick = tick;
        entry.falseMemory = true;
      }
    }

    return {
      ...entry,
      state: 'known',
      confidence,
      card: entry.card && { ...entry.card }
    };
  }

  function recallObservedEntry(bot, entry) {
    if (!entry || !entry.card) return null;
    if (!Number.isFinite(entry.confidence)) entry.confidence = 1;
    const profile = botProfile(bot);
    const round = state().round || {};
    const tick = round.strategyTick ?? round.botTick ?? 0;
    const cycles = Math.max(0, tick - (entry.updatedTick || 0)) / Math.max(1, players().length);
    const confidence = Math.max(
      0,
      Math.min(1, entry.confidence - (profile.memoryCycleDecay || 0) * cycles)
    );

    if (confidence < MEMORY_THRESHOLD) {
      entry.state = 'stale';
      entry.card = null;
      entry.rank = null;
      entry.confidence = confidence;
      return null;
    }

    if (entry.recallCheckedTick !== tick) {
      entry.recallCheckedTick = tick;
      if (random() > confidence) {
        const mistakenCard = falseMemoryCard(entry.card);
        entry.card = mistakenCard;
        entry.rank = mistakenCard.rank;
        entry.confidence = confidence;
        entry.updatedTick = tick;
        entry.falseMemory = true;
      }
    }
    return { ...entry, confidence, card: { ...entry.card } };
  }

  function ownSlots(bot) {
    return bot.cards.map((physicalCard, index) => {
      const memory = recallEntry(bot, bot.id, index);
      return {
        player: bot,
        index,
        physicalCard,
        card: memory.card || null,
        memory,
        known: !!memory.card,
        expected: memory.card ? cardPoints(memory.card) : unknownExpectedPoints(bot)
      };
    });
  }

  function playerSlots(bot, player) {
    return player.cards.map((physicalCard, index) => {
      const memory = recallEntry(bot, player.id, index);
      return {
        player,
        index,
        physicalCard,
        card: memory.card || null,
        memory,
        known: !!memory.card,
        expected: memory.card ? cardPoints(memory.card) : unknownExpectedPoints(bot)
      };
    });
  }

  function rememberedCardEntries(bot) {
    const memory = ensureBotMemory(bot);
    if (!memory) return [];
    const profile = botProfile(bot);
    const entries = [];
    for (const player of players()) {
      for (let index = 0; index < player.cards.length; index += 1) {
        const recalled = recallEntry(bot, player.id, index);
        if (recalled.card) entries.push({ ...recalled, zone: 'hand' });
      }
    }
    for (const collection of [memory.discards || [], memory.removed || []]) {
      for (const entry of collection) {
        if (!entry || !entry.card) continue;
        if (profile.countDeckCards && ['draw pile', 'moved'].includes(entry.zone)) continue;
        const recalled = recallObservedEntry(bot, entry);
        if (recalled) entries.push(recalled);
      }
    }
    const drawn = state().round && state().round.drawn;
    if (drawn && drawn.playerId === bot.id && memory.drawn && memory.drawn.card) {
      const recalledDrawn = recallObservedEntry(bot, memory.drawn);
      if (recalledDrawn) entries.push({ ...recalledDrawn, physicalId: drawn.card.id, deckColor: drawn.card.deckColor, zone: 'drawn' });
    }

    const unique = new Map();
    entries.forEach((entry, index) => {
      const key = entry.physicalId || [
        entry.deckColor || '?',
        entry.card.rank,
        entry.card.suit,
        entry.zone || '?',
        index
      ].join(':');
      unique.set(key, entry);
    });
    return Array.from(unique.values());
  }

  function remainingUnknownCards(bot) {
    const currentState = state();
    const colors = currentState.deckSetting === 'two'
      ? ['red', 'blue']
      : [currentState.deckColor === 'red' ? 'red' : 'blue'];
    const remaining = [];
    for (const deckColor of colors) {
      for (const suit of SUITS) {
        for (const rank of RANKS) remaining.push({ rank, suit, deckColor });
      }
    }

    const profile = botProfile(bot);
    if (profile.expectedUnknownValue !== 'counted' && !profile.countDeckCards) return remaining;
    for (const entry of rememberedCardEntries(bot)) {
      const remembered = entry.card;
      let index = remaining.findIndex((card) => (
        card.rank === remembered.rank &&
        card.suit === remembered.suit &&
        (!entry.deckColor || card.deckColor === entry.deckColor)
      ));
      if (index < 0) {
        index = remaining.findIndex((card) => card.rank === remembered.rank && card.suit === remembered.suit);
      }
      if (index >= 0) remaining.splice(index, 1);
    }
    return remaining;
  }

  const { createSimpleTactics } = require('./bot-simple-tactics-1.3.80.js');
  // Cache only within one synchronous decision. Public events may change a
  // memory or a hand without advancing the normal-turn counter.
  let decisionCache = null;
  function cached(key, read) {
    if (!decisionCache) return read();
    if (!decisionCache.has(key)) decisionCache.set(key, read());
    return decisionCache.get(key);
  }
  function countedUnknownPoints(bot) {
    const remaining = cached('remaining', () => remainingUnknownCards(bot));
    return remaining.length
      ? remaining.reduce((sum, card) => sum + cardPoints(card), 0) / remaining.length
      : 6.5;
  }
  function unknownExpectedPoints(bot) {
    const configured = botProfile(bot).expectedUnknownValue;
    return configured === 'counted' ? countedUnknownPoints(bot) : Number(configured) || 6.5;
  }
  const tactics = createSimpleTactics({
    ...deps,
    ownSlots: bot => cached('own', () => ownSlots(bot)),
    playerSlots: (bot, player) => cached('slots:' + player.id, () => playerSlots(bot, player)),
    remainingCards: bot => cached('remaining', () => remainingUnknownCards(bot)),
    unknownExpectedPoints,
    random,
    randomBetween
  });
  const methods = { ...tactics, unknownExpectedPoints, countedUnknownPoints, recallEntry };
  return Object.fromEntries(Object.entries(methods).map(([name, method]) => [name, (...args) => {
    const previous = decisionCache;
    decisionCache = new Map();
    try { return method(...args); }
    finally { decisionCache = previous; }
  }]));
}

module.exports = { createSimpleDecisionLayer };
