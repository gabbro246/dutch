function freshState() {
  return {
    phase: 'waiting',
    deckSetting: 'one',
    gameTarget: 100,
    singleRound: false,
    highlightChangedCards: true,
    inactivityTimeoutMinutes: 15,
    players: [],
    log: [],
    logSequence: 0,
    roundNumber: 0,
    scoreHistory: [],
    round: null,
    waitingMessage: 'A game is already active. Join after the game ends.',
    gameStartedAt: null,
    lastGameActivityAt: null
  };
}

module.exports = { freshState };
