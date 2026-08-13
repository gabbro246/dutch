(function initClientState(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DutchClientState = api;
})(typeof window !== 'undefined' ? window : globalThis, function createClientState() {
  function mergeIncrementalState(previousState, state) {
    if (!previousState || previousState.gameStartedAt !== state.gameStartedAt) return state;
    let mergedState = state;
    if (state.logComplete === false) {
      const recent = Array.isArray(state.log) ? state.log : [];
      const prior = Array.isArray(previousState.log) ? previousState.log : [];
      const recentIds = new Set(recent.map((entry) => entry && entry.id).filter(Number.isFinite));
      const mergedLog = recent.concat(prior.filter((entry) => (
        !entry || !Number.isFinite(entry.id) || !recentIds.has(entry.id)
      ))).slice(0, Number(state.logLength) || undefined);
      mergedState = {
        ...mergedState,
        log: mergedLog,
        logComplete: mergedLog.length >= (Number(state.logLength) || 0)
      };
    }
    if (state.scoreHistoryComplete === false) {
      const recent = Array.isArray(state.scoreHistory) ? state.scoreHistory : [];
      const prior = Array.isArray(previousState.scoreHistory) ? previousState.scoreHistory : [];
      const byRound = new Map();
      for (const entry of prior.concat(recent)) {
        const round = Number(entry && entry.round);
        if (Number.isFinite(round)) byRound.set(round, entry);
      }
      const mergedHistory = Array.from(byRound.entries())
        .sort((left, right) => left[0] - right[0])
        .map(([, entry]) => entry)
        .slice(0, Number(state.scoreHistoryLength) || undefined);
      mergedState = {
        ...mergedState,
        scoreHistory: mergedHistory,
        scoreHistoryComplete: mergedHistory.length >= (Number(state.scoreHistoryLength) || 0)
      };
    }
    return mergedState;
  }

  function cardAnimationSignature(state) {
    const round = state && state.round;
    if (!round) return '';
    return JSON.stringify({
      roundNumber: state.roundNumber,
      stage: round.stage,
      players: (round.players || []).map((player) => [
        player.id,
        (player.cards || []).map((card) => card && [card.id, !!card.back, card.highlight || ''])
      ]),
      discardTop: round.discardTop && [round.discardTop.id, !!round.discardTop.back],
      discardCount: round.discardCount,
      reshuffleToken: round.reshuffleToken || 0,
      drawn: round.drawn && [round.drawn.source, round.drawn.card && round.drawn.card.id, !!(round.drawn.card && round.drawn.card.back)],
      wrongThrowPenalty: round.wrongThrowPenalty && round.wrongThrowPenalty.id,
      wrongThrowIn: round.wrongThrowIn && round.wrongThrowIn.id
    });
  }

  return { mergeIncrementalState, cardAnimationSignature };
});
