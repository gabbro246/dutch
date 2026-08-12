function createTableSettings(deps) {
  let nextCardId = deps.initialCardId || 1;

  function actorName(actor) {
    return actor && actor.name ? actor.name : 'Someone';
  }

  function gameLengthLabel(singleRound, gameTarget) {
    return singleRound ? 'single round' : `${gameTarget} points`;
  }

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
    if (state.phase !== 'waiting') return false;
    if (!['one', 'two'].includes(value)) return false;
    const previousSetting = state.deckSetting;
    state.deckSetting = value;
    clampDeckSetting();
    return state.deckSetting !== previousSetting;
  }

  function setGameTarget(value, actor) {
    const state = deps.getState();
    const selectingSingleRound = value === 'single';
    const target = Number(value);
    if (!selectingSingleRound && ![50, 100, 200].includes(target)) return false;
    if (state.phase === 'playing') {
      const gameEnded = state.round && state.round.stage === 'gameEnd';
      const firstRoundOver = state.roundNumber > 1 || (state.round && ['roundEnd', 'gameEnd'].includes(state.round.stage));
      const reachedFifty = state.players.some((player) => !player.left && !player.isSpectator && player.total >= 50);
      if (gameEnded || (selectingSingleRound ? firstRoundOver : reachedFifty)) return false;
    } else if (state.phase !== 'waiting') {
      return false;
    }
    const previousSingleRound = !!state.singleRound;
    const previousTarget = state.gameTarget;
    if (previousSingleRound === selectingSingleRound && (selectingSingleRound || previousTarget === target)) return false;
    state.singleRound = selectingSingleRound;
    if (!selectingSingleRound) state.gameTarget = target;
    if (state.phase === 'playing' && deps.addLog) {
      deps.addLog(
        `${actorName(actor)} changed game length from ${gameLengthLabel(previousSingleRound, previousTarget)} to ${gameLengthLabel(selectingSingleRound, target)}`,
        'system'
      );
    }
    return true;
  }

  function setInactivityTimeout(value, actor) {
    const state = deps.getState();
    const minutes = Number(value);
    if (![15, 30, 60, 90].includes(minutes)) return false;
    const previousMinutes = state.inactivityTimeoutMinutes;
    if (previousMinutes === minutes) return false;
    state.inactivityTimeoutMinutes = minutes;
    if (state.phase === 'playing' && deps.addLog) {
      deps.addLog(`${actorName(actor)} changed inactivity timeout from ${previousMinutes} to ${minutes} minutes`, 'system');
    }
    return true;
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
