const {
  publicMemoryCard,
  rankValue,
  unknownMemory: createUnknownMemory,
  cardMemory: createCardMemory,
  effectiveMemory: createEffectiveMemory
} = require('./bot-strategy.js');

function createBotMemory(deps) {
  function currentBotTick() {
    const round = deps.getState().round;
    if (!round) return 0;
    return round.strategyTick ?? round.botTick ?? 0;
  }

  function unknownMemory(source = 'unknown', ownerId = null) {
    const entry = createUnknownMemory(source, currentBotTick());
    if (ownerId) entry.ownerId = ownerId;
    return entry;
  }

  function cardMemory(card, source, confidence = 0.9, stateName = 'known', ownerId = null) {
    const entry = createCardMemory(card, source, confidence, stateName, currentBotTick());
    if (ownerId) entry.ownerId = ownerId;
    if (card && card.id) entry.physicalId = card.id;
    return entry;
  }

  function ensureBotMemory(bot) {
    const state = deps.getState();
    if (!bot || !bot.isBot || !state.round) return null;
    if (!bot.botMemory || bot.botMemory.roundNumber !== state.roundNumber) {
      bot.botMemory = {
        roundNumber: state.roundNumber,
        slots: {},
        discards: [],
        removed: [],
        reshuffles: [],
        pendingPile: null,
        drawn: null,
        aceAttackers: {},
        inference: {}
      };
    }
    for (const player of deps.activePlayablePlayers()) {
      if (!bot.botMemory.slots[player.id]) bot.botMemory.slots[player.id] = [];
      const slots = bot.botMemory.slots[player.id];
      while (slots.length < player.cards.length) slots.push(unknownMemory('unknown', player.id));
      if (slots.length > player.cards.length) slots.length = player.cards.length;
    }
    return bot.botMemory;
  }

  function syncBotMemories() {
    for (const bot of deps.activeBots()) ensureBotMemory(bot);
  }

  function advanceMemoryTurn() {
    const round = deps.getState().round;
    if (round) round.strategyTick = (round.strategyTick || 0) + 1;
  }

  function rememberSlotForBot(bot, ownerId, index, card, source, confidence = 0.9, stateName = 'known') {
    const memory = ensureBotMemory(bot);
    if (!memory || !memory.slots[ownerId]) return;
    memory.slots[ownerId][index] = cardMemory(card, source, confidence, stateName, ownerId);
  }

  function rememberSlotForAllBots(ownerId, index, card, source, confidence = 0.88, stateName = 'known') {
    for (const bot of deps.activeBots()) rememberSlotForBot(bot, ownerId, index, card, source, confidence, stateName);
  }

  function forgetSlotForAllBots(ownerId, index, source = 'unknown') {
    for (const bot of deps.activeBots()) {
      const memory = ensureBotMemory(bot);
      if (memory && memory.slots[ownerId]) memory.slots[ownerId][index] = unknownMemory(source, ownerId);
    }
  }

  function addUnknownSlotForAllBots(ownerId, source = 'unknown') {
    for (const bot of deps.activeBots()) {
      const memory = ensureBotMemory(bot);
      if (memory && memory.slots[ownerId]) memory.slots[ownerId].push(unknownMemory(source, ownerId));
    }
  }

  function removeSlotForAllBots(ownerId, index, source = 'removed') {
    for (const bot of deps.activeBots()) {
      const memory = ensureBotMemory(bot);
      if (!memory || !memory.slots[ownerId]) continue;
      const removed = memory.slots[ownerId].splice(index, 1)[0] || unknownMemory(source, ownerId);
      memory.removed.push({ ...removed, zone: 'removed or empty slot', source, updatedTick: currentBotTick() });
      memory.discards.push({ source, updatedTick: currentBotTick() });
    }
  }

  function moveSlotMemoryForAllBots(ownerA, indexA, ownerB, indexB, source = 'swap') {
    for (const bot of deps.activeBots()) {
      const memory = ensureBotMemory(bot);
      if (!memory || !memory.slots[ownerA] || !memory.slots[ownerB]) continue;
      const a = memory.slots[ownerA][indexA] || unknownMemory('unknown', ownerA);
      const b = memory.slots[ownerB][indexB] || unknownMemory('unknown', ownerB);
      memory.slots[ownerA][indexA] = { ...b, ownerId: ownerA, source, updatedTick: currentBotTick() };
      memory.slots[ownerB][indexB] = { ...a, ownerId: ownerB, source, updatedTick: currentBotTick() };
    }
  }

  function markPreviousTop(memory) {
    for (let index = memory.discards.length - 1; index >= 0; index -= 1) {
      if (memory.discards[index].zone === 'top discard') {
        memory.discards[index].zone = 'buried discard';
        return;
      }
    }
  }

  function observeDiscardForAllBots(card, source, actorId = null) {
    if (!card) return;
    for (const bot of deps.activeBots()) {
      const memory = ensureBotMemory(bot);
      if (!memory) continue;
      markPreviousTop(memory);
      for (const entry of memory.discards) {
        if (card.id && entry.physicalId === card.id && entry.zone !== 'draw pile') entry.zone = 'moved';
      }
      memory.discards.push({
        card: publicMemoryCard(card),
        physicalId: card.id || null,
        rank: rankValue(card),
        source,
        actorId,
        zone: 'top discard',
        updatedTick: currentBotTick()
      });
    }
  }

  function observePileTakeForAllBots(actorId, card) {
    for (const bot of deps.activeBots()) {
      const memory = ensureBotMemory(bot);
      if (!memory) continue;
      for (let index = memory.discards.length - 1; index >= 0; index -= 1) {
        const entry = memory.discards[index];
        if (entry.zone === 'top discard') {
          entry.zone = 'moved';
          break;
        }
      }
      memory.pendingPile = {
        actorId,
        card: publicMemoryCard(card),
        physicalId: card && card.id || null,
        rank: rankValue(card),
        updatedTick: currentBotTick()
      };
      observePlayerDecision(bot, actorId, 'take-pile', { card: publicMemoryCard(card) });
    }
  }

  function observeReshuffleForAllBots(cards, topCard) {
    const movedIds = new Set((cards || []).map((card) => card && card.id).filter(Boolean));
    for (const bot of deps.activeBots()) {
      const memory = ensureBotMemory(bot);
      if (!memory) continue;
      const knownCards = [];
      for (const entry of memory.discards) {
        if ((entry.physicalId && movedIds.has(entry.physicalId)) || entry.zone === 'buried discard') {
          entry.zone = 'draw pile';
          knownCards.push(entry.card);
        }
      }
      memory.reshuffles.push({
        updatedTick: currentBotTick(),
        cards: knownCards.filter(Boolean),
        topCard: publicMemoryCard(topCard)
      });
    }
  }

  function observeAceForAllBots(actorId, targetId) {
    for (const bot of deps.activeBots()) {
      const memory = ensureBotMemory(bot);
      if (!memory) continue;
      if (targetId === bot.id && actorId !== bot.id) {
        memory.aceAttackers[actorId] = (memory.aceAttackers[actorId] || 0) + 1;
      }
      observePlayerDecision(bot, actorId, 'ace-target', { targetId });
    }
  }

  function observePlayerDecision(bot, actorId, type, data = {}) {
    if (!bot || actorId === bot.id) return;
    const memory = ensureBotMemory(bot);
    if (!memory) return;
    const inference = memory.inference[actorId] || {
      lowCardBelief: 0,
      dutchReadiness: 0,
      rankConfidence: {},
      targetInterest: {}
    };
    if (type === 'take-pile' && data.card) {
      inference.lowCardBelief += Math.max(0, 6 - data.card.points) * 0.04;
    } else if (type === 'reject-pile' && data.card) {
      inference.lowCardBelief -= Math.max(0, 6 - data.card.points) * 0.025;
    } else if (type === 'call-dutch') {
      inference.dutchReadiness = Math.min(1, inference.dutchReadiness * 0.35 + 0.65);
    } else if (type === 'throw-in' && data.rank) {
      inference.rankConfidence[data.rank] = Math.min(1, (inference.rankConfidence[data.rank] || 0) + 0.45);
    } else if ((type === 'queen-target' || type === 'jack-target') && data.targetId) {
      inference.targetInterest[data.targetId] = (inference.targetInterest[data.targetId] || 0) + 0.2;
    }
    memory.inference[actorId] = inference;
  }

  function observeDecisionForAllBots(actorId, type, data = {}) {
    for (const bot of deps.activeBots()) observePlayerDecision(bot, actorId, type, data);
  }

  function botMemoryEntry(bot, ownerId, index) {
    const memory = ensureBotMemory(bot);
    return memory && memory.slots[ownerId] ? memory.slots[ownerId][index] : unknownMemory('unknown', ownerId);
  }

  function effectiveMemory(bot, entry) {
    return createEffectiveMemory(bot, entry, currentBotTick());
  }

  return {
    currentBotTick,
    unknownMemory,
    cardMemory,
    ensureBotMemory,
    syncBotMemories,
    advanceMemoryTurn,
    rememberSlotForBot,
    rememberSlotForAllBots,
    forgetSlotForAllBots,
    addUnknownSlotForAllBots,
    removeSlotForAllBots,
    moveSlotMemoryForAllBots,
    observeDiscardForAllBots,
    observePileTakeForAllBots,
    observeReshuffleForAllBots,
    observeAceForAllBots,
    observeDecisionForAllBots,
    botMemoryEntry,
    effectiveMemory
  };
}

module.exports = { createBotMemory };
