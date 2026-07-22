function createCardFlow(deps) {
  const getState = deps.getState;
  const specialRanks = new Set(deps.specialRanks || []);
  const now = deps.now || (() => Date.now());
  const pileRevealMoveMs = Number.isFinite(deps.pileRevealMoveMs) ? deps.pileRevealMoveMs : 360;
  const pileRevealFlipHalfMs = Number.isFinite(deps.pileRevealFlipHalfMs) ? deps.pileRevealFlipHalfMs : 130;
  const setTimeoutFn = deps.setTimeoutFn || setTimeout;

  function round() {
    return getState().round;
  }

  function label(card) {
    if (!card) return 'card';
    return `${card.rank}${deps.suitSymbol(card.suit)}`;
  }

  function ensureDrawPile() {
    const currentRound = round();
    if (!currentRound) return;
    if (currentRound.deck.length > 0) return;
    if (currentRound.discard.length <= 1) return;
    const top = currentRound.discard.pop();
    const reshuffled = currentRound.discard.splice(0);
    currentRound.deck = deps.shuffle(reshuffled);
    currentRound.discard = [top];
    if (deps.observeReshuffleForAllBots) deps.observeReshuffleForAllBots(reshuffled, top);
    deps.addLog('discard pile reshuffled into draw pile');
  }

  function drawFromDeck() {
    ensureDrawPile();
    const currentRound = round();
    if (!currentRound || currentRound.deck.length === 0) return null;
    return currentRound.deck.pop();
  }

  function discardLogText(actorId, card, reason = '') {
    const action = reason
      ? (reason.includes('{card}') ? reason.replace(/\{card\}/g, label(card)) : `${reason} ${label(card)}`)
      : `placed ${label(card)}`;
    const special = specialRanks.has(card.rank) ? ` and may use ${deps.specialName(card.rank)}` : '';
    return `${deps.nameOf(actorId)} ${action}${special}`;
  }

  function pushDiscard(card, actorId, reason, options = {}) {
    const currentRound = round();
    if (!currentRound || !card) return;
    const allowThrowIn = options.allowThrowIn !== false;
    currentRound.discard.push(card);
    if (currentRound.throwIn) currentRound.throwIn.open = false;
    const pendingReveal = {
      cardId: card.id,
      actorId,
      reason: reason || '',
      allowThrowIn,
      observationSource: options.observationSource || '',
      observationActorId: options.observationActorId || actorId || null,
      removedSlotOwnerId: options.removedSlotOwnerId || '',
      removedSlotIndex: Number.isInteger(options.removedSlotIndex) ? options.removedSlotIndex : null,
      removedSlotSource: options.removedSlotSource || '',
      midpointEligibleAt: now() + pileRevealMoveMs + pileRevealFlipHalfMs
    };
    currentRound.pendingPileReveal = pendingReveal;
    currentRound.stage = 'revealing';
    setTimeoutFn(() => {
      if (round() !== currentRound || currentRound.pendingPileReveal !== pendingReveal) return;
      completePileReveal(null, card.id, { fallback: true });
    }, 1800);
  }

  function completePileReveal(playerId, cardId, options = {}) {
    const currentRound = round();
    const pending = currentRound && currentRound.pendingPileReveal;
    if (!currentRound || !pending || pending.cardId !== cardId || currentRound.stage !== 'revealing') return false;
    const topCard = currentRound.discard[currentRound.discard.length - 1];
    if (!topCard || topCard.id !== cardId) return false;
    if (!options.fallback) {
      const player = deps.findPlayer(playerId);
      if (!player || player.left || player.isBot || player.isSpectator || !player.connected) return false;
      if (!options.reducedMotion && now() < pending.midpointEligibleAt) return false;
    }
    currentRound.pendingPileReveal = null;
    if (pending.removedSlotOwnerId && pending.removedSlotIndex !== null) {
      deps.rememberSlotForAllBots(pending.removedSlotOwnerId, pending.removedSlotIndex, topCard, pending.removedSlotSource, 1);
      deps.removeSlotForAllBots(pending.removedSlotOwnerId, pending.removedSlotIndex, pending.removedSlotSource);
    }
    if (pending.observationSource) {
      deps.observeDiscardForAllBots(topCard, pending.observationSource, pending.observationActorId);
    }
    if (pending.allowThrowIn) {
      currentRound.throwIn = {
        open: true,
        token: deps.nextThrowInToken(),
        topCardId: topCard.id,
        rank: deps.rankValue(topCard)
      };
    } else if (currentRound.throwIn) {
      currentRound.throwIn.open = false;
    }
    if (specialRanks.has(topCard.rank)) {
      currentRound.specialQueue.push({ type: topCard.rank, actorId: pending.actorId, selected: [] });
    }
    if (pending.reason || specialRanks.has(topCard.rank)) {
      deps.addLog(discardLogText(pending.actorId, topCard, pending.reason));
    }
    deps.updateStageAfterQueue();
    deps.broadcastState();
    return true;
  }

  function removeExpiredReveals() {
    const currentRound = round();
    if (!currentRound) return false;
    const currentTime = now();
    const revealCount = currentRound.reveals.length;
    const pileHighlightExpired = !!(currentRound.pileHighlight && currentRound.pileHighlight.until <= currentTime);
    currentRound.reveals = currentRound.reveals.filter((reveal) => reveal.until > currentTime);
    if (pileHighlightExpired) currentRound.pileHighlight = null;
    return currentRound.reveals.length !== revealCount || pileHighlightExpired;
  }

  function scheduleRevealCleanup(ms) {
    setTimeoutFn(() => {
      if (removeExpiredReveals()) deps.broadcastState();
    }, ms + 50);
  }

  function revealCardTo(playerId, cardId, ms = 3000) {
    const currentRound = round();
    if (!currentRound) return;
    currentRound.reveals.push({ viewerId: playerId, cardId, until: now() + ms });
    scheduleRevealCleanup(ms);
  }

  function highlightCardForAll(cardId, kind = 'peek', ms = 3000, options = {}) {
    const currentRound = round();
    if (!currentRound || !cardId) return;
    currentRound.reveals.push({
      public: true,
      kind,
      cardId,
      exceptViewerId: options.exceptViewerId || '',
      playerId: options.playerId || '',
      until: now() + ms
    });
    scheduleRevealCleanup(ms);
  }

  function highlightPileForAll(kind = 'event', ms = 3000) {
    const currentRound = round();
    if (!currentRound) return;
    currentRound.pileHighlight = { kind, until: now() + ms };
    scheduleRevealCleanup(ms);
  }

  function markHandCardChanged(ownerId, cardId) {
    const currentRound = round();
    if (!currentRound || !ownerId || !cardId) return;
    const highlights = currentRound.handHighlights || [];
    currentRound.handHighlights = highlights.filter((item) => item.cardId !== cardId);
    currentRound.handHighlights.push({ ownerId, cardId });
  }

  function clearHandHighlightsForPlayer(playerId) {
    const currentRound = round();
    if (!currentRound || !playerId || !currentRound.handHighlights) return;
    currentRound.handHighlights = currentRound.handHighlights.filter((item) => item.ownerId !== playerId);
  }

  return {
    label,
    ensureDrawPile,
    drawFromDeck,
    discardLogText,
    pushDiscard,
    completePileReveal,
    removeExpiredReveals,
    scheduleRevealCleanup,
    revealCardTo,
    highlightCardForAll,
    highlightPileForAll,
    markHandCardChanged,
    clearHandHighlightsForPlayer
  };
}

module.exports = { createCardFlow };
