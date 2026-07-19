function freshState() {
  return {
    phase: 'waiting',
    deckSetting: 'one',
    gameTarget: 100,
    players: [],
    log: [],
    botDiagnostics: [],
    botDiagnosticsDropped: 0,
    roundNumber: 0,
    scoreHistory: [],
    round: null,
    waitingMessage: 'A game is already active. Join after the game ends.',
    gameStartedAt: null,
    lastGameActivityAt: null
  };
}

module.exports = { freshState };
