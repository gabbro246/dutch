const { cardPoints } = require('../public/shared.js');

function activePlayablePlayers(players = []) {
  return players.filter((player) => !player.left && !player.isSpectator);
}

function startingPlayerIndexForNextRound(players = [], roundNumber = 0) {
  if (roundNumber <= 0) return 0;
  let bestIndex = 0;
  let bestScore = -Infinity;
  players.forEach((player, index) => {
    if (player.left || player.isSpectator) return;
    const score = typeof player.roundPoints === 'number' ? player.roundPoints : -Infinity;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function pointChangeText(player, delta) {
  const amount = Math.abs(delta);
  const verb = delta < 0 ? 'lost' : 'gained';
  const noun = amount === 1 ? 'point' : 'points';
  return player.name + ' ' + verb + ' ' + amount + ' ' + noun;
}

function applyRoundScoring(players = [], options = {}) {
  const scoringPlayers = activePlayablePlayers(players);
  const scores = scoringPlayers.map((player) => ({
    player,
    raw: player.cards.reduce((sum, card) => sum + cardPoints(card), 0)
  }));
  const min = scores.length ? Math.min(...scores.map((score) => score.raw)) : Infinity;
  const callerId = options.callerId || '';
  const gameTarget = Number(options.gameTarget) || 100;
  const pointChanges = [];
  const halvings = [];
  let reachedFifty = false;

  for (const score of scores) {
    const totalBefore = score.player.total;
    let roundScore = score.raw;
    if (callerId && score.player.id === callerId) {
      roundScore = score.raw <= 5 && score.raw === min ? 0 : score.raw * 2;
    }
    score.player.roundPoints = roundScore;
    score.player.total += roundScore;
    if (score.player.total >= 50) reachedFifty = true;
    if (score.player.total === 50 || score.player.total === 100) {
      score.player.total = Math.floor(score.player.total / 2);
      halvings.push(score.player);
    }
    pointChanges.push(pointChangeText(score.player, score.player.total - totalBefore));
  }

  const bestRoundScore = scoringPlayers.length ? Math.min(...scoringPlayers.map((player) => player.roundPoints)) : Infinity;
  const roundWinnerIds = scoringPlayers
    .filter((player) => player.roundPoints === bestRoundScore)
    .map((player) => player.id);
  const loser = scoringPlayers.find((player) => player.total > gameTarget);
  const winner = loser ? scoringPlayers.slice().sort((a, b) => a.total - b.total)[0] : null;

  return {
    scoringPlayers,
    pointChanges,
    halvings,
    reachedFifty,
    scoreHistoryPlayers: scoringPlayers.map((player) => ({
      id: player.id,
      name: player.name,
      total: player.total,
      roundPoints: player.roundPoints
    })),
    roundWinnerIds,
    gameEnded: !!loser,
    winnerId: winner ? winner.id : null,
    winnerName: winner ? winner.name : null
  };
}

module.exports = {
  activePlayablePlayers,
  startingPlayerIndexForNextRound,
  applyRoundScoring
};
