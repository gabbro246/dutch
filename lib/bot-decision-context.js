const { cardPoints } = require('../public/shared.js');
const { botProfile } = require('./bot-strategy.js');
const {
  buildBeliefState,
  slotCardDistribution,
  slotPointDistribution,
  convolveScoreDistributions,
  distributionMoments
} = require('./bot-belief-state.js');

function createDecisionContextFactory(deps) {
  const {
    getState,
    ensureBotMemory,
    botMemoryEntry,
    effectiveMemory,
    activePlayablePlayers
  } = deps;

  return function contextFor(bot) {
    const state = getState();
    const memory = ensureBotMemory(bot);
    const belief = buildBeliefState({ state, bot, memory, effectiveMemory });
    const slotCardCache = new Map();
    const slotCache = new Map();
    const effectiveSlotCache = new Map();
    const scoreCache = new Map();
    const withoutSlotCache = new Map();
    const effectiveSlotMemoryFor = (player, index) => {
      const key = player.id + ':' + index;
      if (!effectiveSlotCache.has(key)) {
        const entry = botMemoryEntry(bot, player.id, index);
        let effective = effectiveMemory(bot, entry);
        if (player.id !== bot.id) {
          const accuracy = botProfile(bot).opponentModelAccuracy ?? 1;
          effective = {
            ...effective,
            confidence: (effective.confidence || 0) * accuracy,
            distribution: (effective.distribution || []).map((candidate) => ({
              ...candidate,
              probability: candidate.probability * accuracy
            }))
          };
        }
        effectiveSlotCache.set(key, effective);
      }
      return effectiveSlotCache.get(key);
    };
    const storePositionEstimate = (player, index, distribution) => {
      const entry = botMemoryEntry(bot, player.id, index);
      const effective = effectiveSlotMemoryFor(player, index);
      const estimate = {
        ownerId: player.id,
        index,
        expectedValue: distributionMoments(distribution).mean,
        knownRank: effective.card && effective.card.rank || effective.knownRank || effective.rank || null,
        confidence: effective.confidence || 0,
        source: effective.source || entry.source || 'unknown',
        lastChangedEvent: entry.lastChangedEvent || entry.source || 'unknown',
        lastChangedTick: Number.isFinite(entry.lastChangedTick)
          ? entry.lastChangedTick
          : (entry.updatedTick || 0)
      };
      if (memory) {
        if (!memory.positionEstimates) memory.positionEstimates = {};
        if (!memory.positionEstimates[player.id]) memory.positionEstimates[player.id] = [];
        memory.positionEstimates[player.id][index] = estimate;
      }
      return estimate;
    };
    const slotDistributionFor = (player, index) => {
      const key = player.id + ':' + index;
      if (!slotCache.has(key)) {
        const distribution = slotPointDistribution(
          effectiveSlotMemoryFor(player, index),
          belief.drawDistribution
        );
        slotCache.set(key, distribution);
        storePositionEstimate(player, index, distribution);
      }
      return slotCache.get(key);
    };
    const slotCardDistributionFor = (player, index) => {
      const key = player.id + ':' + index;
      if (!slotCardCache.has(key)) {
        slotCardCache.set(key, slotCardDistribution(
          effectiveSlotMemoryFor(player, index),
          belief.drawDistribution
        ));
      }
      return slotCardCache.get(key);
    };
    const scoreDistributionFor = (player, overrides = new Map()) => {
      if (overrides.size === 0 && scoreCache.has(player.id)) return scoreCache.get(player.id);
      let distribution = [{ value: 0, probability: 1 }];
      for (let index = 0; index < player.cards.length; index += 1) {
        if (overrides.has(index) && overrides.get(index) === null) continue;
        const slot = overrides.has(index) ? overrides.get(index) : slotDistributionFor(player, index);
        distribution = convolveScoreDistributions(distribution, slot);
      }
      if (overrides.size === 0) scoreCache.set(player.id, distribution);
      return distribution;
    };
    const scoreWithoutSlotFor = (player, removedIndex) => {
      const key = player.id + ':' + removedIndex;
      if (!withoutSlotCache.has(key)) {
        let distribution = [{ value: 0, probability: 1 }];
        for (let index = 0; index < player.cards.length; index += 1) {
          if (index !== removedIndex) distribution = convolveScoreDistributions(distribution, slotDistributionFor(player, index));
        }
        withoutSlotCache.set(key, distribution);
      }
      return withoutSlotCache.get(key);
    };
    const playablePlayers = activePlayablePlayers();
    const opponents = playablePlayers.filter((player) => player.id !== bot.id);
    for (const player of playablePlayers) {
      for (let index = 0; index < player.cards.length; index += 1) slotDistributionFor(player, index);
    }
    const positionEstimateFor = (player, index) => (
      memory && memory.positionEstimates && memory.positionEstimates[player.id] &&
      memory.positionEstimates[player.id][index]
    ) || storePositionEstimate(player, index, slotDistributionFor(player, index));
    return {
      state,
      bot,
      memory,
      belief,
      slotCardDistributionFor,
      slotDistributionFor,
      positionEstimateFor,
      scoreDistributionFor,
      scoreWithoutSlotFor,
      opponents
    };
  };
}

module.exports = { createDecisionContextFactory };
