const { suitSymbol, isRedSuit, cardPoints } = require('../public/shared.js');

function publicCard(card, visible) {
  if (!card) return null;
  if (!visible) {
    return {
      id: card.id,
      back: true,
      deckColor: card.deckColor
    };
  }
  return {
    id: card.id,
    back: false,
    rank: card.rank,
    suit: card.suit,
    symbol: suitSymbol(card.suit),
    red: isRedSuit(card.suit),
    deckColor: card.deckColor,
    points: cardPoints(card)
  };
}

function createGameView(deps) {
  function canViewerSeeCard(viewerId, ownerId, card) {
    const round = deps.getState().round;
    if (!round) return false;
    if (round.stage === 'roundEnd' || round.stage === 'gameEnd') return true;
    if (round.drawn && round.drawn.card.id === card.id && round.drawn.playerId === viewerId) return true;
    return round.reveals.some((reveal) => (
      !reveal.public &&
      reveal.viewerId === viewerId &&
      reveal.cardId === card.id &&
      reveal.until > Date.now()
    ));
  }

  function cardHighlight(cardId, viewerId = '') {
    const round = deps.getState().round;
    if (!round || !cardId) return '';
    const active = round.reveals.find((reveal) => (
      reveal.public &&
      reveal.cardId === cardId &&
      reveal.until > Date.now() &&
      reveal.exceptViewerId !== viewerId
    ));
    return active ? String(active.kind || 'peek') : '';
  }

  function controlsFor(playerId) {
    const state = deps.getState();
    const round = state.round;
    const player = deps.findPlayer(playerId);
    if (!round || !player || player.left || player.isSpectator) return {};
    const cp = deps.currentPlayer();
    const isCurrent = cp && cp.id === playerId;
    const special = deps.topSpecial();
    const actorForSpecial = special && special.actorId === playerId;
    const mustDutch = deps.mustPlayerSayDutch(playerId);
    const jackSwapInProgress = deps.isJackSwapInProgress();
    const jackSwapSelectionActive = deps.isJackSwapSelectionActive(special);
    const beforeDraw = round.stage === 'turn' && isCurrent && !round.drawn && !round.turnComplete && !special && !mustDutch;
    return {
      canPeekStart: round.stage === 'peek' && !player.startPeekDone,
      canTake: beforeDraw,
      canDiscardDrawn: round.stage === 'turn' && isCurrent && round.drawn && round.drawn.source === 'deck' && !mustDutch,
      canSwapDrawn: round.stage === 'turn' && isCurrent && !!round.drawn && !mustDutch,
      canThrowIn: !!(round.throwIn && round.throwIn.open) && round.stage !== 'roundEnd' && round.stage !== 'gameEnd' && !jackSwapInProgress,
      canQueenPeek: round.stage === 'special' && actorForSpecial && special.type === 'Q' && !mustDutch,
      canJackSwap: round.stage === 'special' && actorForSpecial && special.type === 'J' && !mustDutch && !special.resolving && (special.selected || []).length < 2,
      canAceAdd: round.stage === 'special' && actorForSpecial && special.type === 'A' && !mustDutch,
      canDutch: deps.canPlayerSayDutch(playerId),
      canEndTurn: !mustDutch && ((round.stage === 'turn' && isCurrent && round.turnComplete) || (round.stage === 'special' && actorForSpecial && !jackSwapSelectionActive)),
      canNextRound: round.stage === 'roundEnd',
      canNewGame: round.stage === 'gameEnd'
    };
  }

  function buildView(playerId) {
    deps.removeExpiredReveals();
    const state = deps.getState();
    const joined = state.players.some((player) => player.id === playerId && !player.left);
    const base = {
      you: playerId,
      joined,
      phase: state.phase,
      version: deps.appVersion,
      deckSetting: state.deckSetting,
      gameTarget: state.gameTarget,
      oneDeckDisabled: deps.activePlayablePlayerCount() > 4,
      canJoin: state.phase === 'waiting' && deps.activePlayerCount() < 9 && !joined,
      canStart: state.phase === 'waiting' && deps.hasPlayableHumanGame(),
      waitingMessage: state.phase === 'playing' && !joined ? state.waitingMessage : '',
      gameStartedAt: state.gameStartedAt,
      players: deps.activePlayers().map((player) => ({
        id: player.id,
        name: player.name,
        total: player.total,
        roundPoints: player.roundPoints,
        connected: player.connected,
        isBot: !!player.isBot,
        botType: player.botType || '',
        isSpectator: !!player.isSpectator,
        joinedAt: player.joinedAt || null,
        startPeekCount: player.startPeekedCardIds ? player.startPeekedCardIds.length : 0,
        startPeekDone: !!player.startPeekDone,
        cardCount: player.cards.length
      })),
      log: state.log,
      roundNumber: state.roundNumber,
      scoreHistory: state.scoreHistory,
      round: null
    };

    if (!state.round) return base;

    const round = state.round;
    const cp = deps.currentPlayer();
    const special = deps.topSpecial();
    const dutchCaller = round.dutchCallerId ? deps.findPlayer(round.dutchCallerId) : null;
    const pendingDutchIds = new Set(round.dutchQueue || []);

    base.round = {
      stage: round.stage,
      currentPlayerId: cp ? cp.id : null,
      currentPlayerName: cp ? cp.name : '',
      protectedSpecialTargetIds: round.dutchCallerId ? [round.dutchCallerId] : [],
      deckCount: round.deck.length,
      discardCount: round.discard.length,
      discardTop: publicCard(round.discard[round.discard.length - 1], true),
      pileHighlight: round.pileHighlight && round.pileHighlight.until > Date.now() ? String(round.pileHighlight.kind || 'event') : '',
      deckBack: state.deckSetting === 'one' ? (state.deckColor || 'blue') : 'mixed',
      drawn: round.drawn ? {
        source: round.drawn.source,
        card: publicCard(round.drawn.card, round.drawn.playerId === playerId || round.drawn.source === 'pile')
      } : null,
      anyDrawn: !!round.drawn,
      turnComplete: !!round.turnComplete,
      throwInOpen: !!(round.throwIn && round.throwIn.open),
      special: special ? {
        type: special.type,
        actorId: special.actorId,
        actorName: deps.nameOf(special.actorId),
        selected: special.selected || []
      } : null,
      dutchCallerId: round.dutchCallerId,
      dutchCallerName: dutchCaller ? dutchCaller.name : '',
      dutchTurnsRemaining: round.dutchQueue ? round.dutchQueue.length : 0,
      roundWinnerIds: round.roundWinnerIds || [],
      winnerId: round.winnerId,
      winnerName: round.winnerId ? deps.nameOf(round.winnerId) : '',
      players: deps.activePlayers().map((player) => ({
        id: player.id,
        name: player.name,
        total: player.total,
        roundPoints: player.roundPoints,
        connected: player.connected,
        isBot: !!player.isBot,
        botType: player.botType || '',
        isSpectator: !!player.isSpectator,
        isCurrent: !['peek', 'roundEnd', 'gameEnd'].includes(round.stage) && cp && cp.id === player.id,
        finalTurnDone: !!(!player.isSpectator && round.dutchCallerId && !['roundEnd', 'gameEnd'].includes(round.stage) && player.id !== round.dutchCallerId && !pendingDutchIds.has(player.id) && (!cp || cp.id !== player.id || round.turnComplete)),
        cards: player.cards.map((card) => {
          const view = publicCard(card, canViewerSeeCard(playerId, player.id, card));
          if (view) view.highlight = cardHighlight(card.id, playerId);
          if (view && player.id === playerId && player.startPeekedCardIds && player.startPeekedCardIds.includes(card.id)) view.startPeeked = true;
          return view;
        })
      })),
      controls: controlsFor(playerId)
    };
    return base;
  }

  return {
    buildView,
    controlsFor,
    canViewerSeeCard,
    cardHighlight
  };
}

module.exports = {
  createGameView,
  publicCard
};
