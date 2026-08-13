const POINT_GAME_TARGETS = [50, 100, 200];

function highestActivePlayerTotal(state) {
  return (state.players || []).reduce((highest, player) => {
    if (player.left || player.isSpectator) return highest;
    return Math.max(highest, Number(player.total) || 0);
  }, 0);
}

function selectablePointGameTargets(state) {
  if (state.phase === 'waiting') return POINT_GAME_TARGETS.slice();
  if (state.phase !== 'playing' || !state.round || state.round.stage === 'gameEnd') return [];
  const highestTotal = highestActivePlayerTotal(state);
  return POINT_GAME_TARGETS.filter((target) => highestTotal <= target);
}

module.exports = {
  POINT_GAME_TARGETS,
  selectablePointGameTargets
};
