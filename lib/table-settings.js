const { POINT_GAME_TARGETS, selectablePointGameTargets } = require('./game-targets.js');
const { BOT_TIMING_PERCENTAGES, botSpeedLabel } = require('./bot-timing.js');

function createTableSettings(deps) {
  let nextCardId = deps.initialCardId || 1;

  function actorName(actor) {
    return actor && actor.name ? actor.name : 'Someone';
  }

  function configuredRoundLimit(state) {
    const limit = Number(state.roundLimit);
    if (Number.isInteger(limit) && limit > 0) return limit;
    return state.singleRound ? 1 : 0;
  }

  function gameLengthLabel(roundLimit, gameTarget) {
    if (roundLimit === 1) return 'single round';
    if (roundLimit === 5) return 'five rounds';
    return `${gameTarget} points`;
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
    const selectedRoundLimit = value === 'single' ? 1 : value === 'five' ? 5 : 0;
    const selectingFixedRounds = selectedRoundLimit > 0;
    const target = Number(value);
    if (!selectingFixedRounds && !POINT_GAME_TARGETS.includes(target)) return false;
    if (state.phase === 'playing') {
      if (!state.round || state.round.stage === 'gameEnd') return false;
      const currentRoundComplete = state.round.stage === 'roundEnd';
      const completedRounds = Math.max(0, state.roundNumber - (currentRoundComplete ? 0 : 1));
      if (selectingFixedRounds ? completedRounds >= selectedRoundLimit : !selectablePointGameTargets(state).includes(target)) return false;
    } else if (state.phase !== 'waiting') {
      return false;
    }
    const previousRoundLimit = configuredRoundLimit(state);
    const previousTarget = state.gameTarget;
    if (previousRoundLimit === selectedRoundLimit && (selectingFixedRounds || previousTarget === target)) return false;
    state.roundLimit = selectingFixedRounds ? selectedRoundLimit : null;
    state.singleRound = selectedRoundLimit === 1;
    if (!selectingFixedRounds) state.gameTarget = target;
    if (state.phase === 'playing' && deps.addLog) {
      deps.addLog(
        `${actorName(actor)} changed game length from ${gameLengthLabel(previousRoundLimit, previousTarget)} to ${gameLengthLabel(selectedRoundLimit, target)}`,
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

  function setBotTimingPercent(value, actor) {
    const state = deps.getState();
    const percent = Number(value);
    if (!BOT_TIMING_PERCENTAGES.includes(percent)) return false;
    const previousPercent = state.botTimingPercent ?? 50;
    if (previousPercent === percent) return false;
    state.botTimingPercent = percent;
    if (state.phase === 'playing' && deps.addLog) {
      deps.addLog(`${actorName(actor)} changed bot speed from ${botSpeedLabel(previousPercent)} to ${botSpeedLabel(percent)}`, 'system');
    }
    return true;
  }

  return {
    clampDeckSetting,
    createCombinedDeck,
    setDeckSetting,
    setGameTarget,
    setInactivityTimeout,
    setBotTimingPercent
  };
}

module.exports = { createTableSettings };
