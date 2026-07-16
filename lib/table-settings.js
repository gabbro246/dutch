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
    if (state.phase !== 'waiting') return;
    const target = Number(value);
    if (![50, 100].includes(target)) return;
    state.gameTarget = target;
  }

  return {
    clampDeckSetting,
    createCombinedDeck,
    setDeckSetting,
    setGameTarget
  };
}

module.exports = { createTableSettings };
