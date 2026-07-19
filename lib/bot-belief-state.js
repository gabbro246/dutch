const { SUITS, RANKS, cardPoints, isRedSuit } = require('../public/shared.js');

const CARD_ZONES = Object.freeze({
  KNOWN_OWN_SLOT: 'known own slot',
  UNCERTAIN_OWN_SLOT: 'uncertain own slot',
  KNOWN_OPPONENT_SLOT: 'known opponent slot',
  UNCERTAIN_OPPONENT_SLOT: 'uncertain opponent slot',
  TOP_DISCARD: 'top discard',
  BURIED_DISCARD: 'buried discard',
  DRAW_PILE: 'draw pile',
  REMOVED: 'removed or empty slot'
});

function cardKey(card) {
  return card && card.rank && card.suit ? card.rank + ':' + card.suit : '';
}

function publicCard(rank, suit) {
  return { rank, suit, red: isRedSuit(suit), points: cardPoints({ rank, suit }) };
}

function fullCardCounts(deckSetting = 'one') {
  const copies = deckSetting === 'two' ? 2 : 1;
  const counts = new Map();
  for (const suit of SUITS) {
    for (const rank of RANKS) counts.set(rank + ':' + suit, copies);
  }
  return counts;
}

function subtractMass(counts, card, mass = 1) {
  const key = cardKey(card);
  if (!key || !counts.has(key)) return;
  counts.set(key, Math.max(0, counts.get(key) - Math.max(0, mass)));
}

function normalizedCardDistribution(counts) {
  const total = Array.from(counts.values()).reduce((sum, value) => sum + value, 0);
  if (total <= 0) return [];
  return Array.from(counts.entries())
    .filter(([, count]) => count > 0)
    .map(([key, count]) => {
      const [rank, suit] = key.split(':');
      return { card: publicCard(rank, suit), count, probability: count / total };
    });
}

function buildBeliefState({ state, bot, memory, effectiveMemory }) {
  const counts = fullCardCounts(state.deckSetting);
  const zones = [];
  const usedPhysical = new Set();
  let unknownSlots = 0;

  for (const player of (state.players || []).filter((item) => !item.left && !item.isSpectator)) {
    const entries = memory && memory.slots && memory.slots[player.id] ? memory.slots[player.id] : [];
    for (let index = 0; index < player.cards.length; index += 1) {
      const entry = entries[index] || null;
      const effective = effectiveMemory(bot, entry);
      const own = player.id === bot.id;
      const known = !!(effective.card || (effective.distribution && effective.distribution.length));
      const zone = own
        ? (known ? CARD_ZONES.KNOWN_OWN_SLOT : CARD_ZONES.UNCERTAIN_OWN_SLOT)
        : (known ? CARD_ZONES.KNOWN_OPPONENT_SLOT : CARD_ZONES.UNCERTAIN_OPPONENT_SLOT);
      zones.push({ zone, ownerId: player.id, index, physicalId: entry && entry.physicalId || null, memory: effective });
      if (!known) unknownSlots += 1;
      if (entry && entry.physicalId && usedPhysical.has(entry.physicalId)) continue;
      if (entry && entry.physicalId) usedPhysical.add(entry.physicalId);
      if (effective.card) subtractMass(counts, effective.card, effective.confidence || 0);
      else {
        for (const candidate of effective.distribution || []) {
          subtractMass(counts, candidate.card, candidate.probability || 0);
        }
      }
    }
  }

  const discard = state.round && state.round.discard || [];
  discard.forEach((card, index) => {
    const zone = index === discard.length - 1 ? CARD_ZONES.TOP_DISCARD : CARD_ZONES.BURIED_DISCARD;
    zones.push({ zone, physicalId: card.id || null, card });
    if (card.id && usedPhysical.has(card.id)) return;
    if (card.id) usedPhysical.add(card.id);
    subtractMass(counts, card, 1);
  });

  for (const entry of memory && memory.removed || []) {
    zones.push({ zone: CARD_ZONES.REMOVED, ...entry });
  }

  const drawCount = state.round && Array.isArray(state.round.deck) ? state.round.deck.length : 0;
  const drawDistribution = normalizedCardDistribution(counts);
  zones.push({
    zone: CARD_ZONES.DRAW_PILE,
    count: drawCount,
    distribution: drawDistribution,
    reshuffles: memory && memory.reshuffles ? memory.reshuffles.slice() : []
  });

  const rankRemaining = {};
  for (const rank of RANKS) rankRemaining[rank] = 0;
  for (const [key, count] of counts) rankRemaining[key.split(':')[0]] += count;

  return {
    zones,
    counts,
    drawCount,
    unknownSlots,
    unknownPoolSize: drawCount + unknownSlots,
    drawDistribution,
    rankRemaining,
    expectedDrawPoints: drawDistribution.reduce((sum, item) => sum + item.probability * item.card.points, 0),
    probabilityOf(card) {
      const found = drawDistribution.find((item) => cardKey(item.card) === cardKey(card));
      return found ? found.probability : 0;
    },
    probabilityOfRank(rank) {
      return drawDistribution.reduce((sum, item) => sum + (item.card.rank === rank ? item.probability : 0), 0);
    }
  };
}

function slotPointDistribution(effective, drawDistribution) {
  const known = effective && effective.card;
  const confidence = known ? (effective.confidence || 0) : 0;
  const byPoints = new Map();
  const add = (points, probability) => {
    if (probability <= 0) return;
    byPoints.set(points, (byPoints.get(points) || 0) + probability);
  };
  if (known) add(known.points, confidence);
  for (const candidate of effective && effective.distribution || []) {
    if (!known || cardKey(candidate.card) !== cardKey(known)) add(candidate.card.points, candidate.probability || 0);
  }
  const specified = Array.from(byPoints.values()).reduce((sum, value) => sum + value, 0);
  const residual = Math.max(0, 1 - specified);
  for (const candidate of drawDistribution || []) add(candidate.card.points, residual * candidate.probability);
  if (byPoints.size === 0) add(6.4, 1);
  const total = Array.from(byPoints.values()).reduce((sum, value) => sum + value, 0);
  return Array.from(byPoints, ([value, probability]) => ({ value: Number(value), probability: probability / total }));
}

function slotCardDistribution(effective, drawDistribution) {
  const byCard = new Map();
  const add = (card, probability) => {
    const key = cardKey(card);
    if (!key || probability <= 0) return;
    const existing = byCard.get(key);
    byCard.set(key, {
      card: existing ? existing.card : publicCard(card.rank, card.suit),
      probability: (existing ? existing.probability : 0) + probability
    });
  };
  const known = effective && effective.card;
  const confidence = known ? (effective.confidence || 0) : 0;
  if (known) add(known, confidence);
  for (const candidate of effective && effective.distribution || []) {
    if (!known || cardKey(candidate.card) !== cardKey(known)) add(candidate.card, candidate.probability || 0);
  }
  const specified = Array.from(byCard.values()).reduce((sum, item) => sum + item.probability, 0);
  const residual = Math.max(0, 1 - specified);
  for (const candidate of drawDistribution || []) add(candidate.card, residual * candidate.probability);
  if (byCard.size === 0) {
    for (const candidate of drawDistribution || []) add(candidate.card, candidate.probability);
  }
  const total = Array.from(byCard.values()).reduce((sum, item) => sum + item.probability, 0) || 1;
  return Array.from(byCard.values()).map((item) => ({
    card: item.card,
    probability: item.probability / total
  }));
}

function convolveScoreDistributions(a, b) {
  const combined = new Map();
  for (const left of a) {
    for (const right of b) {
      const value = left.value + right.value;
      combined.set(value, (combined.get(value) || 0) + left.probability * right.probability);
    }
  }
  return Array.from(combined, ([value, probability]) => ({ value, probability }));
}

function handScoreDistribution(bot, player, memory, effectiveMemory, belief) {
  let distribution = [{ value: 0, probability: 1 }];
  const entries = memory && memory.slots && memory.slots[player.id] || [];
  for (let index = 0; index < player.cards.length; index += 1) {
    const slot = slotPointDistribution(effectiveMemory(bot, entries[index]), belief.drawDistribution);
    distribution = convolveScoreDistributions(distribution, slot);
  }
  return distribution.sort((a, b) => a.value - b.value);
}

function distributionMoments(distribution) {
  const mean = distribution.reduce((sum, item) => sum + item.value * item.probability, 0);
  const variance = distribution.reduce((sum, item) => sum + Math.pow(item.value - mean, 2) * item.probability, 0);
  return { mean, variance };
}

function sampleDistribution(distribution, random = Math.random) {
  let roll = random();
  for (const item of distribution) {
    roll -= item.probability;
    if (roll <= 0) return item.value;
  }
  return distribution.length ? distribution[distribution.length - 1].value : 0;
}

module.exports = {
  CARD_ZONES,
  cardKey,
  fullCardCounts,
  normalizedCardDistribution,
  buildBeliefState,
  slotCardDistribution,
  slotPointDistribution,
  convolveScoreDistributions,
  handScoreDistribution,
  distributionMoments,
  sampleDistribution
};
