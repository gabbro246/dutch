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
    return round ? (round.botTick || 0) : 0;
  }

  function unknownMemory(source = 'unknown') {
    return createUnknownMemory(source, currentBotTick());
  }

  function cardMemory(card, source, confidence = 0.9, stateName = 'known') {
    return createCardMemory(card, source, confidence, stateName, currentBotTick());
  }

  function ensureBotMemory(bot) {
    const state = deps.getState();
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
    for (const player of deps.activePlayablePlayers()) {
      if (!bot.botMemory.slots[player.id]) bot.botMemory.slots[player.id] = [];
      const slots = bot.botMemory.slots[player.id];
      while (slots.length < player.cards.length) slots.push(unknownMemory('unknown'));
      if (slots.length > player.cards.length) slots.length = player.cards.length;
    }
    return bot.botMemory;
  }

  function syncBotMemories() {
    for (const bot of deps.activeBots()) ensureBotMemory(bot);
  }

  function rememberSlotForBot(bot, ownerId, index, card, source, confidence = 0.9, stateName = 'known') {
    const memory = ensureBotMemory(bot);
    if (!memory || !memory.slots[ownerId]) return;
    memory.slots[ownerId][index] = cardMemory(card, source, confidence, stateName);
  }

  function rememberSlotForAllBots(ownerId, index, card, source, confidence = 0.88, stateName = 'known') {
    for (const bot of deps.activeBots()) rememberSlotForBot(bot, ownerId, index, card, source, confidence, stateName);
  }

  function forgetSlotForAllBots(ownerId, index, source = 'unknown') {
    for (const bot of deps.activeBots()) {
      const memory = ensureBotMemory(bot);
      if (memory && memory.slots[ownerId]) memory.slots[ownerId][index] = unknownMemory(source);
    }
  }

  function addUnknownSlotForAllBots(ownerId, source = 'unknown') {
    for (const bot of deps.activeBots()) {
      const memory = ensureBotMemory(bot);
      if (memory && memory.slots[ownerId]) memory.slots[ownerId].push(unknownMemory(source));
    }
  }

  function removeSlotForAllBots(ownerId, index, source = 'removed') {
    for (const bot of deps.activeBots()) {
      const memory = ensureBotMemory(bot);
      if (memory && memory.slots[ownerId]) memory.slots[ownerId].splice(index, 1);
      if (memory) memory.discards.push({ source, updatedTick: currentBotTick() });
    }
  }

  function moveSlotMemoryForAllBots(ownerA, indexA, ownerB, indexB, source = 'swap') {
    for (const bot of deps.activeBots()) {
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
    for (const bot of deps.activeBots()) {
      const memory = ensureBotMemory(bot);
      if (!memory) continue;
      memory.discards.push({ card: publicMemoryCard(card), rank: rankValue(card), source, actorId, updatedTick: currentBotTick() });
      if (memory.discards.length > 80) memory.discards.shift();
    }
  }

  function observePileTakeForAllBots(actorId, card) {
    for (const bot of deps.activeBots()) {
      const memory = ensureBotMemory(bot);
      if (memory) memory.pendingPile = { actorId, card: publicMemoryCard(card), rank: rankValue(card), updatedTick: currentBotTick() };
    }
  }

  function observeAceForAllBots(actorId, targetId) {
    for (const bot of deps.activeBots()) {
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
    return createEffectiveMemory(bot, entry, currentBotTick());
  }

  return {
    currentBotTick,
    unknownMemory,
    cardMemory,
    ensureBotMemory,
    syncBotMemories,
    rememberSlotForBot,
    rememberSlotForAllBots,
    forgetSlotForAllBots,
    addUnknownSlotForAllBots,
    removeSlotForAllBots,
    moveSlotMemoryForAllBots,
    observeDiscardForAllBots,
    observePileTakeForAllBots,
    observeAceForAllBots,
    botMemoryEntry,
    effectiveMemory
  };
}

module.exports = { createBotMemory };
