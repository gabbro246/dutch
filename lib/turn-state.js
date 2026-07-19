function createTurnState(deps) {
  const getState = deps.getState;
  const setTimeoutFn = deps.setTimeoutFn || setTimeout;
  const jackSwapSelectionMs = deps.jackSwapSelectionMs;

  function round() {
    return getState().round;
  }

  function updateStageAfterQueue() {
    const currentRound = round();
    if (!currentRound) return;
    if (currentRound.stage === 'roundEnd' || currentRound.stage === 'gameEnd') return;
    if (currentRound.specialQueue.length > 0) {
      currentRound.stage = 'special';
    } else if (currentRound.stage !== 'peek') {
      currentRound.stage = 'turn';
    }
  }

  function finishSpecial() {
    const currentRound = round();
    if (!currentRound) return;
    currentRound.specialQueue.shift();
    updateStageAfterQueue();
  }

  function topSpecial() {
    const currentRound = round();
    if (!currentRound) return null;
    return currentRound.specialQueue[0] || null;
  }

  function isJackSwapSelectionActive(special = topSpecial()) {
    return !!(special && special.type === 'J' && (special.resolving || (special.selected || []).length > 0));
  }

  function isJackSwapInProgress() {
    const currentRound = round();
    return !!(currentRound && currentRound.stage === 'special' && isJackSwapSelectionActive());
  }

  function activeJackSpecialFor(actorId) {
    const currentRound = round();
    const special = topSpecial();
    if (!currentRound || currentRound.stage !== 'special' || !special || special.type !== 'J' || special.actorId !== actorId) return null;
    return special;
  }

  function sameSelectedCards(a, b) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((cardId, index) => cardId === b[index]);
  }

  function completeJackSwap(actorId, selectedIds) {
    const special = activeJackSpecialFor(actorId);
    if (!special || !sameSelectedCards(special.selected, selectedIds)) return;

    const a = deps.playerByCardId(selectedIds[0]);
    const b = deps.playerByCardId(selectedIds[1]);
    if (
      a &&
      b &&
      !deps.isProtectedSpecialTarget(a.player.id) &&
      !deps.isProtectedSpecialTarget(b.player.id) &&
      a.card.id !== b.card.id
    ) {
      [a.player.cards[a.index], b.player.cards[b.index]] = [b.player.cards[b.index], a.player.cards[a.index]];
      deps.moveSlotMemoryForAllBots(a.player.id, a.index, b.player.id, b.index, 'Jack swap');
      if (deps.observeDecisionForAllBots) {
        deps.observeDecisionForAllBots(actorId, 'jack-target', { targetId: a.player.id });
        deps.observeDecisionForAllBots(actorId, 'jack-target', { targetId: b.player.id });
      }
      deps.addLog(deps.nameOf(actorId) + ' used Jack swap');
    }

    finishSpecial();
    deps.broadcastState();
  }

  function beginJackSwapResolution(actorId, selectedIds, delay = jackSwapSelectionMs) {
    const special = activeJackSpecialFor(actorId);
    const selected = (selectedIds || (special && special.selected) || []).slice(0, 2);
    if (!special || selected.length < 2) return;
    special.selected = selected;
    special.resolving = true;
    deps.broadcastState();
    setTimeoutFn(() => completeJackSwap(actorId, selected), delay);
  }

  function beginBotJackSwapSelection(actorId, firstCardId, secondCardId) {
    const special = activeJackSpecialFor(actorId);
    if (!special || !firstCardId || !secondCardId || firstCardId === secondCardId) return false;
    special.selected = [firstCardId];
    special.resolving = true;
    deps.broadcastState();
    setTimeoutFn(() => {
      const active = activeJackSpecialFor(actorId);
      if (!active || !sameSelectedCards(active.selected, [firstCardId])) return;
      beginJackSwapResolution(actorId, [firstCardId, secondCardId]);
    }, jackSwapSelectionMs);
    return true;
  }

  function canPlayerSayDutch(playerId) {
    const currentRound = round();
    const player = deps.findPlayer(playerId);
    if (!currentRound || !player || player.left || player.isSpectator || currentRound.dutchCallerId) return false;
    const cp = deps.currentPlayer();
    const noCards = player.cards.length === 0;
    if (noCards && !currentRound.drawn) {
      if (!cp || cp.id !== playerId) return false;
      if (currentRound.stage === 'turn') return true;
      const special = topSpecial();
      return !!(currentRound.stage === 'special' && special && special.actorId === playerId && !isJackSwapSelectionActive(special));
    }
    if (!currentRound.turnComplete) return false;
    if (!cp || cp.id !== playerId) return false;
    if (currentRound.stage === 'turn') return true;
    const special = topSpecial();
    return !!(currentRound.stage === 'special' && special && special.actorId === playerId && !isJackSwapSelectionActive(special));
  }

  function mustPlayerSayDutch(playerId) {
    const player = deps.findPlayer(playerId);
    return !!(player && player.cards.length === 0 && canPlayerSayDutch(playerId));
  }

  function setDutchCaller(player) {
    const currentState = getState();
    const currentRound = currentState.round;
    if (!currentRound || !player) return;
    currentRound.dutchCallerId = player.id;
    if (deps.observeDecisionForAllBots) deps.observeDecisionForAllBots(player.id, 'call-dutch');
    const callerIndex = currentState.players.findIndex((p) => p.id === player.id);
    const startIndex = callerIndex >= 0 ? callerIndex : currentRound.currentPlayerIndex;
    const ordered = [];
    for (let i = 1; i < currentState.players.length; i += 1) {
      const p = currentState.players[(startIndex + i) % currentState.players.length];
      if (!p.left && !p.isSpectator && p.id !== player.id) ordered.push(p.id);
    }
    currentRound.dutchQueue = ordered;
    deps.addLog(`${player.name} said Dutch`);
  }

  function callDutchForPlayer(player) {
    const currentRound = round();
    const special = topSpecial();
    if (!currentRound || !player || !canPlayerSayDutch(player.id)) return false;
    if (currentRound.stage === 'special' && special && special.actorId === player.id) {
      deps.addLog(`${player.name} skipped ${deps.specialName(special.type)}`);
      finishSpecial();
    }
    setDutchCaller(player);
    deps.advanceTurn();
    return true;
  }

  return {
    updateStageAfterQueue,
    finishSpecial,
    topSpecial,
    isJackSwapSelectionActive,
    isJackSwapInProgress,
    activeJackSpecialFor,
    sameSelectedCards,
    completeJackSwap,
    beginJackSwapResolution,
    beginBotJackSwapSelection,
    canPlayerSayDutch,
    mustPlayerSayDutch,
    setDutchCaller,
    callDutchForPlayer
  };
}

module.exports = { createTurnState };
