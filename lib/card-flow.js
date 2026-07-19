function createCardFlow(deps) {
  const getState = deps.getState;
  const specialRanks = new Set(deps.specialRanks || []);
  const now = deps.now || (() => Date.now());
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
    if (allowThrowIn) {
      currentRound.throwIn = {
        open: true,
        token: deps.nextThrowInToken(),
        topCardId: card.id,
        rank: deps.rankValue(card)
      };
    } else if (currentRound.throwIn) {
      currentRound.throwIn.open = false;
    }
    if (specialRanks.has(card.rank)) {
      currentRound.specialQueue.push({ type: card.rank, actorId, selected: [] });
    }
    if (reason || specialRanks.has(card.rank)) deps.addLog(discardLogText(actorId, card, reason));
    deps.updateStageAfterQueue();
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

  return {
    label,
    ensureDrawPile,
    drawFromDeck,
    discardLogText,
    pushDiscard,
    removeExpiredReveals,
    scheduleRevealCleanup,
    revealCardTo,
    highlightCardForAll,
    highlightPileForAll
  };
}

module.exports = { createCardFlow };
