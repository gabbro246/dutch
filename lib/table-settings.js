function createTableSettings(deps) {
  let nextCardId = deps.initialCardId || 1;

  function clampDeckSetting() {
    const state = deps.getState();
    if (deps.activePlayablePlayerCount() > 4) state.deckSetting = 'two';
  }

  function createCombinedDeck() {
    const state = deps.getState();
    const combined = deps.createCombinedDeck(state.deckSetting, {
      nextCardId: () => nextCardId++,
      random: deps.random
    });
    state.deckColor = combined.deckColor;
    return combined.cards;
  }

  function setDeckSetting(value) {
    const state = deps.getState();
    if (state.phase !== 'waiting') return;
    if (!['one', 'two'].includes(value)) return;
    state.deckSetting = value;
    clampDeckSetting();
  }

  function setGameTarget(value) {
    const state = deps.getState();
    const selectingSingleRound = value === 'single';
    const target = Number(value);
    if (!selectingSingleRound && ![50, 100].includes(target)) return;
    if (state.phase === 'playing') {
      const gameEnded = state.round && state.round.stage === 'gameEnd';
      const firstRoundOver = state.roundNumber > 1 || (state.round && ['roundEnd', 'gameEnd'].includes(state.round.stage));
      const reachedFifty = state.players.some((player) => !player.left && !player.isSpectator && player.total >= 50);
      if (gameEnded || (selectingSingleRound ? firstRoundOver : reachedFifty)) return;
    } else if (state.phase !== 'waiting') {
      return;
    }
    state.singleRound = selectingSingleRound;
    if (selectingSingleRound) return;
    state.gameTarget = target;
  }

  function setInactivityTimeout(value) {
    const minutes = Number(value);
    if (![15, 30, 60, 90].includes(minutes)) return;
    deps.getState().inactivityTimeoutMinutes = minutes;
  }

  return {
    clampDeckSetting,
    createCombinedDeck,
    setDeckSetting,
    setGameTarget,
    setInactivityTimeout
  };
}

module.exports = { createTableSettings };
