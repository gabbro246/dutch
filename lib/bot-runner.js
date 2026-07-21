const { chooseCharacterAction } = require('./bot-character.js');

function botScheduleKey(parts) {
  return parts.join(':');
}

function createBotRunner(deps) {
  const {
    getState,
    finishedGameResetMs,
    syncBotMemories,
    activeBots,
    activePlayablePlayers,
    randomBetween,
    shuffle,
    findPlayer,
    currentPlayer,
    topSpecial,
    isJackSwapSelectionActive,
    isJackSwapInProgress,
    mustPlayerSayDutch,
    canPlayerSayDutch,
    shouldBotTakePile,
    takeDeckForPlayer,
    takePileForPlayer,
    discardDrawnForPlayer,
    swapDrawnForPlayer,
    throwInForPlayer,
    ensureBotMemory,
    cardMemory,
    rememberSlotForBot,
    highlightCardForAll,
    addLog,
    beginTurnsIfReady,
    botBestSwapTarget,
    shouldBotSwapDrawn,
    finishSpecial,
    specialName,
    advanceTurn,
    botAceTarget,
    aceAddForPlayer,
    botQueenTarget,
    queenPeekForPlayer,
    botJackCandidates,
    isProtectedSpecialTarget,
    beginBotJackSwapSelection,
    botShouldCallDutch,
    callDutchForPlayer,
    botThrowInCandidate,
    botReactionDelay,
    nextRound,
    resetToWaiting,
    broadcastState,
    setTimer = setTimeout,
    clearTimer = clearTimeout
  } = deps;

  const botTimers = new Map();

  function onlyBotsArePlaying() {
    const players = activePlayablePlayers();
    return players.length >= 2 && players.every((player) => player.isBot);
  }

  function scheduleBotTimer(key, delay, fn) {
    if (botTimers.has(key)) return;
    const timer = setTimer(() => {
      botTimers.delete(key);
      fn();
    }, delay);
    botTimers.set(key, timer);
  }

  function clearBotTimers() {
    for (const timer of botTimers.values()) clearTimer(timer);
    botTimers.clear();
  }

  function scheduleBotAutomation() {
    const state = getState();
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
      if (actor && actor.isBot && !isJackSwapSelectionActive(special)) {
        scheduleBotTimer(botScheduleKey(['special', state.roundNumber, special.type, actor.id, round.specialQueue.length]), randomBetween(650, 1800), () => botResolveSpecial(actor.id));
      }
    }

    if (round.stage === 'roundEnd' && onlyBotsArePlaying()) {
      scheduleBotTimer(botScheduleKey(['nextRound', state.roundNumber]), randomBetween(1400, 2600), () => {
        const currentState = getState();
        if (currentState.phase === 'playing' && currentState.round && currentState.round.stage === 'roundEnd' && onlyBotsArePlaying()) {
          nextRound();
          broadcastState();
        }
      });
    }

    if (round.stage === 'gameEnd' && onlyBotsArePlaying()) {
      scheduleBotTimer(botScheduleKey(['finishedGameReset', state.roundNumber]), finishedGameResetMs, () => {
        const currentState = getState();
        if (currentState.phase === 'playing' && currentState.round && currentState.round.stage === 'gameEnd' && onlyBotsArePlaying()) {
          resetToWaiting(true, 'finished bot game returned to waiting room', { adminEvent: 'game_auto_reset_after_bot_finish' });
          broadcastState();
        }
      });
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
    const state = getState();
    const round = state.round;
    if (!round || !round.throwIn || !round.throwIn.open || isJackSwapInProgress()) return;
    for (const bot of activeBots()) {
      const candidate = botThrowInCandidate(bot);
      if (!candidate) continue;
      const key = botScheduleKey(['throw', state.roundNumber, round.throwIn.token, bot.id, candidate.index]);
      scheduleBotTimer(key, botReactionDelay(bot, candidate.confidence), () => botDoThrowIn(bot.id, candidate, getState().round ? getState().round.throwIn && getState().round.throwIn.token : null));
    }
  }

  function botDoStartPeek(botId) {
    const state = getState();
    const bot = findPlayer(botId);
    const round = state.round;
    if (!bot || !bot.isBot || !round || round.stage !== 'peek' || bot.startPeekDone) return;
    ensureBotMemory(bot);
    const indexes = shuffle(bot.cards.map((_, index) => index)).slice(0, 2);
    for (const index of indexes) {
      const card = bot.cards[index];
      if (!card) continue;
      bot.startPeekedCardIds.push(card.id);
      rememberSlotForBot(bot, bot.id, index, card, 'start peek', 1);
      highlightCardForAll(card.id, 'peek', 3000, { exceptViewerId: bot.id });
    }
    bot.startPeekDone = true;
    addLog(`${bot.name} finished start peek`);
    beginTurnsIfReady();
    broadcastState();
  }

  function botTakeTurnAction(botId) {
    const state = getState();
    const bot = findPlayer(botId);
    const round = state.round;
    if (!bot || !bot.isBot || !round || round.stage !== 'turn') return;
    if (currentPlayer()?.id !== bot.id || round.drawn || round.turnComplete || topSpecial() || mustPlayerSayDutch(bot.id)) return;
    if (shouldBotTakePile(bot)) botTakePile(bot);
    else botTakeDeck(bot);
  }

  function botTakeDeck(bot) {
    const card = takeDeckForPlayer(bot);
    if (!card) return;
    const memory = ensureBotMemory(bot);
    if (memory) memory.drawn = cardMemory(card, 'deck draw', 1);
    broadcastState();
  }

  function botTakePile(bot) {
    const card = takePileForPlayer(bot);
    if (!card) return;
    const memory = ensureBotMemory(bot);
    if (memory) {
      memory.drawn = cardMemory(card, 'pile observation', 1);
      if (memory.pendingRedKingRecovery && (
        !memory.pendingRedKingRecovery.cardId || memory.pendingRedKingRecovery.cardId === card.id
      )) memory.pendingRedKingRecovery = null;
    }
    broadcastState();
  }

  function botResolveDrawn(botId) {
    const state = getState();
    const bot = findPlayer(botId);
    const round = state.round;
    if (!bot || !bot.isBot || !round || currentPlayer()?.id !== bot.id || !round.drawn) return;
    const drawn = round.drawn.card;
    const source = round.drawn.source;
    if (source === 'deck' && !shouldBotSwapDrawn(bot, drawn)) {
      botDiscardDrawn(bot);
      return;
    }
    const best = botBestSwapTarget(bot, drawn, { required: source === 'pile' });
    if (best) botSwapDrawn(bot, best.index);
    else botDiscardDrawn(bot);
  }

  function botDiscardDrawn(bot) {
    const card = discardDrawnForPlayer(bot);
    if (!card) return;
    const memory = ensureBotMemory(bot);
    if (memory) memory.drawn = null;
    broadcastState();
  }

  function botSwapDrawn(bot, index) {
    const target = bot.cards[index];
    if (!target) return;
    const result = swapDrawnForPlayer(bot, target.id, { rememberOwnCard: true });
    if (!result) return;
    const memory = ensureBotMemory(bot);
    if (memory) memory.drawn = null;
    broadcastState();
  }

  function botResolveSpecial(botId) {
    const state = getState();
    const bot = findPlayer(botId);
    const round = state.round;
    const special = topSpecial();
    if (!bot || !bot.isBot || !round || round.stage !== 'special' || !special || special.actorId !== bot.id) return;
    if (special.type === 'A') return botUseAce(bot);
    if (special.type === 'Q') return botUseQueen(bot);
    if (special.type === 'J') return botUseJack(bot);
    botSkipSpecial(bot);
  }

  function botSkipSpecial(bot) {
    const state = getState();
    const special = topSpecial();
    if (special) addLog(`${bot.name} skipped ${specialName(special.type)}`);
    finishSpecial();
    if (state.round && state.round.stage === 'turn' && state.round.turnComplete && currentPlayer()?.id === bot.id) advanceTurn();
    broadcastState();
  }

  function botUseAce(bot) {
    const target = botAceTarget(bot);
    if (!target) return botSkipSpecial(bot);
    if (!aceAddForPlayer(bot, target.player.id)) return botSkipSpecial(bot);
    broadcastState();
  }

  function botUseQueen(bot) {
    const target = botQueenTarget(bot);
    if (!target) return botSkipSpecial(bot);
    const card = target.player.cards[target.index];
    if (!card) return botSkipSpecial(bot);
    rememberSlotForBot(bot, target.player.id, target.index, card, 'Queen peek', 1);
    if (!queenPeekForPlayer(bot, card.id)) return botSkipSpecial(bot);
    broadcastState();
  }

  function botUseJack(bot) {
    const candidates = botJackCandidates(bot);
    if (candidates.length === 0) return botSkipSpecial(bot);
    const candidate = chooseCharacterAction(bot, candidates);
    if (!candidate || candidate.utility <= 0) return botSkipSpecial(bot);
    const a = { player: candidate.a.player, index: candidate.a.index, card: candidate.a.player.cards[candidate.a.index] };
    const b = { player: candidate.b.player, index: candidate.b.index, card: candidate.b.player.cards[candidate.b.index] };
    if (!a.card || !b.card || a.card.id === b.card.id || isProtectedSpecialTarget(a.player.id) || isProtectedSpecialTarget(b.player.id)) return botSkipSpecial(bot);
    if (!beginBotJackSwapSelection(bot.id, a.card.id, b.card.id)) return botSkipSpecial(bot);
  }

  function botEndTurn(botId) {
    const state = getState();
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

  function botDoThrowIn(botId, candidate, token) {
    const state = getState();
    const bot = findPlayer(botId);
    const round = state.round;
    const index = candidate && candidate.index;
    if (!bot || !bot.isBot || !round || !round.throwIn || !round.throwIn.open || round.throwIn.token !== token || isJackSwapInProgress()) return;
    if (round.stage === 'roundEnd' || round.stage === 'gameEnd') return;
    const card = bot.cards[index];
    if (!card) return;
    const result = throwInForPlayer(bot, card.id);
    if (!result) return;
    if (result.valid && candidate.recoveryPlan) {
      const memory = ensureBotMemory(bot);
      if (memory) memory.pendingRedKingRecovery = {
        ...candidate.recoveryPlan,
        cardId: result.card && result.card.id
      };
    }
    broadcastState();
  }

  return {
    scheduleBotAutomation,
    clearBotTimers,
    onlyBotsArePlaying,
    _private: {
      botScheduleKey,
      scheduleBotTimer
    }
  };
}

module.exports = { createBotRunner };
