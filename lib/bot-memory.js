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

  function ensureHumanKnowledge(memory) {
    if (!memory.humanKnowledge) memory.humanKnowledge = {};
    const players = deps.activePlayablePlayers();
    for (const human of players.filter((player) => !player.isBot)) {
      if (!memory.humanKnowledge[human.id]) {
        memory.humanKnowledge[human.id] = {
          slots: {},
          dutchReadiness: 0,
          swapsObserved: 0,
          updatedTick: currentBotTick()
        };
      }
      const model = memory.humanKnowledge[human.id];
      for (const owner of players) {
        if (!model.slots[owner.id]) model.slots[owner.id] = [];
        const slots = model.slots[owner.id];
        while (slots.length < owner.cards.length) slots.push(unknownMemory('human unknown', owner.id));
        if (slots.length > owner.cards.length) slots.length = owner.cards.length;
      }
    }
  }

  function bumpHumanKnowledgeRevision(memory) {
    memory.humanKnowledgeRevision = (memory.humanKnowledgeRevision || 0) + 1;
  }

  function forEachHumanModel(memory, callback) {
    ensureHumanKnowledge(memory);
    for (const human of deps.activePlayablePlayers().filter((player) => !player.isBot)) {
      const model = memory.humanKnowledge[human.id];
      if (model) callback(model, human);
    }
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
        pendingRedKingRecovery: null,
        pendingAceDiscardAssessment: null,
        drawn: null,
        aceAttackers: {},
        inference: {},
        humanKnowledge: {},
        humanKnowledgeRevision: 0,
        positionEstimates: {}
      };
    }
    if (!bot.botMemory.positionEstimates) bot.botMemory.positionEstimates = {};
    for (const player of deps.activePlayablePlayers()) {
      if (!bot.botMemory.slots[player.id]) bot.botMemory.slots[player.id] = [];
      const slots = bot.botMemory.slots[player.id];
      while (slots.length < player.cards.length) slots.push(unknownMemory('unknown', player.id));
      if (slots.length > player.cards.length) slots.length = player.cards.length;
      if (!bot.botMemory.positionEstimates[player.id]) bot.botMemory.positionEstimates[player.id] = [];
      bot.botMemory.positionEstimates[player.id].length = player.cards.length;
    }
    ensureHumanKnowledge(bot.botMemory);
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
    for (const bot of deps.activeBots()) {
      rememberSlotForBot(bot, ownerId, index, card, source, confidence, stateName);
      const memory = ensureBotMemory(bot);
      if (!memory || !String(source).toLowerCase().includes('pile')) continue;
      forEachHumanModel(memory, (model) => {
        if (!model.slots[ownerId]) return;
        model.slots[ownerId][index] = cardMemory(card, source, 0.96, 'known', ownerId);
        model.updatedTick = currentBotTick();
      });
      bumpHumanKnowledgeRevision(memory);
    }
  }

  function forgetSlotForAllBots(ownerId, index, source = 'unknown') {
    for (const bot of deps.activeBots()) {
      const memory = ensureBotMemory(bot);
      if (!memory) continue;
      if (memory.slots[ownerId]) memory.slots[ownerId][index] = unknownMemory(source, ownerId);
      forEachHumanModel(memory, (model) => {
        if (model.slots[ownerId]) model.slots[ownerId][index] = unknownMemory(source, ownerId);
      });
      bumpHumanKnowledgeRevision(memory);
    }
  }

  function addUnknownSlotForAllBots(ownerId, source = 'unknown') {
    for (const bot of deps.activeBots()) {
      const memory = ensureBotMemory(bot);
      if (!memory) continue;
      if (memory.slots[ownerId]) memory.slots[ownerId].push(unknownMemory(source, ownerId));
      forEachHumanModel(memory, (model) => {
        if (model.slots[ownerId]) model.slots[ownerId].push(unknownMemory(source, ownerId));
      });
      bumpHumanKnowledgeRevision(memory);
    }
  }

  function removeSlotForAllBots(ownerId, index, source = 'removed') {
    for (const bot of deps.activeBots()) {
      const memory = ensureBotMemory(bot);
      if (!memory || !memory.slots[ownerId]) continue;
      const removed = memory.slots[ownerId].splice(index, 1)[0] || unknownMemory(source, ownerId);
      memory.removed.push({ ...removed, zone: 'removed or empty slot', source, updatedTick: currentBotTick() });
      memory.discards.push({ source, updatedTick: currentBotTick() });
      forEachHumanModel(memory, (model) => {
        if (model.slots[ownerId]) model.slots[ownerId].splice(index, 1);
      });
      bumpHumanKnowledgeRevision(memory);
    }
  }

  function rememberHumanSlotForAllBots(humanId, ownerId, index, card, source, confidence = 1) {
    const human = deps.activePlayablePlayers().find((player) => player.id === humanId && !player.isBot);
    if (!human || !card) return;
    for (const bot of deps.activeBots()) {
      const memory = ensureBotMemory(bot);
      const model = memory && memory.humanKnowledge[humanId];
      if (!model || !model.slots[ownerId]) continue;
      model.slots[ownerId][index] = cardMemory(card, source, confidence, 'known', ownerId);
      model.updatedTick = currentBotTick();
      bumpHumanKnowledgeRevision(memory);
    }
  }

  function effectiveHumanMemory(bot, humanId, ownerId, index) {
    const memory = ensureBotMemory(bot);
    const model = memory && memory.humanKnowledge && memory.humanKnowledge[humanId];
    const entry = model && model.slots[ownerId] && model.slots[ownerId][index];
    if (!entry || !entry.card) {
      return { state: 'unknown', confidence: 0, card: null, source: entry && entry.source || 'human unknown' };
    }
    const age = Math.max(0, currentBotTick() - (entry.updatedTick || 0));
    const confidence = Math.max(0, Math.min(1, (entry.confidence || 0) * Math.pow(0.985, age)));
    return {
      ...entry,
      confidence,
      state: confidence >= 0.68 ? 'known' : confidence >= 0.28 ? 'guessed' : 'stale',
      card: confidence >= 0.28 ? entry.card : null
    };
  }

  function moveHumanKnowledgeForAllBots(ownerA, indexA, ownerB, indexB, actorId = null) {
    for (const bot of deps.activeBots()) {
      const memory = ensureBotMemory(bot);
      if (!memory) continue;
      forEachHumanModel(memory, (model, human) => {
        if (!model.slots[ownerA] || !model.slots[ownerB]) return;
        const a = model.slots[ownerA][indexA] || unknownMemory('human unknown', ownerA);
        const b = model.slots[ownerB][indexB] || unknownMemory('human unknown', ownerB);
        const tracking = human.id === actorId ? 0.92 : 0.78;
        model.slots[ownerA][indexA] = {
          ...b,
          ownerId: ownerA,
          confidence: (b.confidence || 0) * tracking,
          source: 'visible Jack swap',
          updatedTick: currentBotTick(),
          lastChangedEvent: 'visible Jack swap',
          lastChangedTick: currentBotTick()
        };
        model.slots[ownerB][indexB] = {
          ...a,
          ownerId: ownerB,
          confidence: (a.confidence || 0) * tracking,
          source: 'visible Jack swap',
          updatedTick: currentBotTick(),
          lastChangedEvent: 'visible Jack swap',
          lastChangedTick: currentBotTick()
        };
        model.swapsObserved = (model.swapsObserved || 0) + 1;
        model.updatedTick = currentBotTick();
      });
      bumpHumanKnowledgeRevision(memory);
    }
  }

  function moveSlotMemoryForAllBots(ownerA, indexA, ownerB, indexB, source = 'swap') {
    for (const bot of deps.activeBots()) {
      const memory = ensureBotMemory(bot);
      if (!memory || !memory.slots[ownerA] || !memory.slots[ownerB]) continue;
      const a = memory.slots[ownerA][indexA] || unknownMemory('unknown', ownerA);
      const b = memory.slots[ownerB][indexB] || unknownMemory('unknown', ownerB);
      memory.slots[ownerA][indexA] = {
        ...b,
        ownerId: ownerA,
        source,
        updatedTick: currentBotTick(),
        lastChangedEvent: source,
        lastChangedTick: currentBotTick()
      };
      memory.slots[ownerB][indexB] = {
        ...a,
        ownerId: ownerB,
        source,
        updatedTick: currentBotTick(),
        lastChangedEvent: source,
        lastChangedTick: currentBotTick()
      };
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
      bumpHumanKnowledgeRevision(memory);
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
      bumpHumanKnowledgeRevision(memory);
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
      targetInterest: {},
      recentActions: []
    };
    if (!Array.isArray(inference.recentActions)) inference.recentActions = [];
    if (['take-pile', 'reject-pile', 'throw-in', 'ace-target', 'queen-target', 'jack-target', 'call-dutch'].includes(type)) {
      const points = data.card && Number.isFinite(data.card.points) ? data.card.points : null;
      const low = (type === 'take-pile' && points !== null && points <= 5) ||
        (type === 'throw-in' && data.valid !== false);
      inference.recentActions.push({
        type,
        low,
        points,
        valid: data.valid !== false,
        updatedTick: currentBotTick()
      });
      if (inference.recentActions.length > 8) inference.recentActions.splice(0, inference.recentActions.length - 8);
    }
    if (type === 'take-pile' && data.card) {
      inference.lowCardBelief += Math.max(0, 6 - data.card.points) * 0.04;
    } else if (type === 'reject-pile' && data.card) {
      inference.lowCardBelief -= Math.max(0, 6 - data.card.points) * 0.025;
    } else if (type === 'call-dutch') {
      inference.dutchReadiness = Math.min(1, inference.dutchReadiness * 0.35 + 0.65);
      const humanModel = memory.humanKnowledge && memory.humanKnowledge[actorId];
      if (humanModel) humanModel.dutchReadiness = Math.min(1, humanModel.dutchReadiness * 0.35 + 0.65);
    } else if (type === 'throw-in' && data.rank) {
      inference.rankConfidence[data.rank] = Math.min(1, (inference.rankConfidence[data.rank] || 0) + 0.45);
    } else if ((type === 'queen-target' || type === 'jack-target') && data.targetId) {
      inference.targetInterest[data.targetId] = (inference.targetInterest[data.targetId] || 0) + 0.2;
    }
    memory.inference[actorId] = inference;
    if (['throw-in', 'ace-target', 'queen-target', 'jack-target', 'call-dutch', 'take-pile'].includes(type)) {
      bumpHumanKnowledgeRevision(memory);
    }
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
    rememberHumanSlotForAllBots,
    effectiveHumanMemory,
    moveHumanKnowledgeForAllBots,
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
