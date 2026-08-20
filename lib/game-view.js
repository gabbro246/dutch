const { suitSymbol, isRedSuit, cardPoints } = require('../public/shared.js');
const { selectablePointGameTargets } = require('./game-targets.js');

const LIVE_LOG_WINDOW = 16;
const LIVE_SCORE_HISTORY_WINDOW = 4;

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
  const now = deps.now || Date.now;
  function canViewerSeeCard(viewerId, ownerId, card) {
    const round = deps.getState().round;
    if (!round) return false;
    if (round.stage === 'roundEnd' || round.stage === 'gameEnd') return true;
    if (round.drawn && round.drawn.card.id === card.id && round.drawn.playerId === viewerId) return true;
    return round.reveals.some((reveal) => (
      !reveal.public &&
      reveal.viewerId === viewerId &&
      reveal.cardId === card.id &&
      reveal.until > now()
    ));
  }

  function cardHighlight(cardId, viewerId = '') {
    const state = deps.getState();
    const round = state.round;
    if (!round || !cardId) return '';
    if (state.highlightChangedCards !== false && (round.handHighlights || []).some((item) => item.cardId === cardId)) {
      return 'changed';
    }
    const active = round.reveals.find((reveal) => (
      reveal.public &&
      reveal.cardId === cardId &&
      reveal.until > now() &&
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
    const waitingForReshuffle = !!round.needsReshuffle;
    const beforeDraw = !waitingForReshuffle && round.stage === 'turn' && isCurrent && !round.drawn && !round.turnComplete && !special && !mustDutch;
    return {
      canReshuffle: waitingForReshuffle && !player.isBot && round.deck.length === 0 && round.discard.length > 1,
      canPeekStart: !waitingForReshuffle && round.stage === 'peek' && !player.startPeekDone,
      canTake: beforeDraw,
      canDiscardDrawn: !waitingForReshuffle && round.stage === 'turn' && isCurrent && round.drawn && round.drawn.source === 'deck' && !mustDutch,
      canSwapDrawn: !waitingForReshuffle && round.stage === 'turn' && isCurrent && !!round.drawn && !mustDutch,
      canThrowIn: !waitingForReshuffle && !!(round.throwIn && round.throwIn.open) && round.stage !== 'roundEnd' && round.stage !== 'gameEnd' && !jackSwapInProgress,
      canQueenPeek: !waitingForReshuffle && round.stage === 'special' && actorForSpecial && special.type === 'Q' && !mustDutch,
      canJackSwap: !waitingForReshuffle && round.stage === 'special' && actorForSpecial && special.type === 'J' && !mustDutch && !special.resolving && (special.selected || []).length < 2,
      canJackUnselect: !waitingForReshuffle && round.stage === 'special' && actorForSpecial && special.type === 'J' && !mustDutch,
      canAceAdd: !waitingForReshuffle && round.stage === 'special' && actorForSpecial && special.type === 'A' && !mustDutch,
      canDutch: !waitingForReshuffle && deps.canPlayerSayDutch(playerId),
      canEndTurn: !waitingForReshuffle && !mustDutch && ((!round.roundEndPending && round.stage === 'turn' && isCurrent && round.turnComplete) || (round.stage === 'special' && actorForSpecial && !jackSwapSelectionActive)),
      canNextRound: round.stage === 'roundEnd',
      canNewGame: round.stage === 'gameEnd'
    };
  }

  function buildView(playerId, options = {}) {
    deps.removeExpiredReveals();
    const state = deps.getState();
    const joined = state.players.some((player) => player.id === playerId && !player.left);
    const selectableGameTargets = selectablePointGameTargets(state);
    const canSelectSingleRound = state.phase === 'waiting' || !!(
      state.phase === 'playing'
      && state.roundNumber <= 1
      && state.round
      && !['roundEnd', 'gameEnd'].includes(state.round.stage)
    );
    const canChangeGameTarget = canSelectSingleRound || selectableGameTargets.some((target) => state.singleRound || target !== state.gameTarget);
    const completeLog = !options.liveUpdate || state.log.length <= LIVE_LOG_WINDOW;
    const completeScoreHistory = !options.liveUpdate || state.scoreHistory.length <= LIVE_SCORE_HISTORY_WINDOW;
    const scoreHistoryStart = completeScoreHistory
      ? 0
      : state.scoreHistory.length - LIVE_SCORE_HISTORY_WINDOW;
    const base = {
      you: playerId,
      joined,
      phase: state.phase,
      version: deps.appVersion,
      deckSetting: state.deckSetting,
      gameTarget: state.gameTarget,
      singleRound: !!state.singleRound,
      botTimingPercent: state.botTimingPercent ?? 50,
      highlightChangedCards: state.highlightChangedCards !== false,
      inactivityTimeoutMinutes: state.inactivityTimeoutMinutes || 15,
      canChangeGameTarget,
      canSelectSingleRound,
      selectableGameTargets,
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
      log: completeLog ? state.log : state.log.slice(0, LIVE_LOG_WINDOW),
      logComplete: completeLog,
      logLength: state.log.length,
      roundNumber: state.roundNumber,
      scoreHistory: completeScoreHistory ? state.scoreHistory : state.scoreHistory.slice(scoreHistoryStart),
      scoreHistoryComplete: completeScoreHistory,
      scoreHistoryLength: state.scoreHistory.length,
      scoreHistoryStart,
      round: null
    };

    if (!state.round) return base;

    const round = state.round;
    const cp = deps.currentPlayer();
    const special = deps.topSpecial();
    const dutchCaller = round.dutchCallerId ? deps.findPlayer(round.dutchCallerId) : null;
    const pendingDutchIds = new Set(round.dutchQueue || []);
    const wrongThrowReveal = round.reveals.find((reveal) => (
      reveal.public &&
      reveal.kind === 'wrong-throw' &&
      reveal.until > now()
    ));
    let wrongThrowIn = null;
    if (wrongThrowReveal) {
      const wrongThrowPlayer = deps.findPlayer(wrongThrowReveal.playerId);
      const wrongThrowCard = wrongThrowPlayer && wrongThrowPlayer.cards.find((card) => card.id === wrongThrowReveal.cardId);
      if (wrongThrowCard) {
        wrongThrowIn = {
          id: wrongThrowCard.id + ':' + wrongThrowReveal.until,
          playerId: wrongThrowPlayer.id,
          playerName: wrongThrowPlayer.name,
          cardId: wrongThrowCard.id,
          card: publicCard(wrongThrowCard, true)
        };
      }
    }

    base.round = {
      stage: round.stage,
      pendingPileReveal: round.pendingPileReveal ? {
        cardId: round.pendingPileReveal.cardId,
        actorId: round.pendingPileReveal.actorId || '',
        kind: round.pendingPileReveal.removedSlotSource === 'throw-in' ? 'throw-in' : 'discard',
        moveMs: Number.isFinite(deps.pileRevealMoveMs) ? deps.pileRevealMoveMs : 360,
        flipMs: 2 * (Number.isFinite(deps.pileRevealFlipHalfMs) ? deps.pileRevealFlipHalfMs : 130)
      } : null,
      openingDiscardFlipMs: 2 * (Number.isFinite(deps.openingDiscardFlipHalfMs) ? deps.openingDiscardFlipHalfMs : 130),
      currentPlayerId: cp ? cp.id : null,
      currentPlayerName: cp ? cp.name : '',
      protectedSpecialTargetIds: round.dutchCallerId ? [round.dutchCallerId] : [],
      deckCount: round.deck.length,
      discardCount: round.discard.length,
      needsReshuffle: !!round.needsReshuffle,
      reshuffleToken: round.reshuffleToken || 0,
      reshuffleCardCount: round.reshuffleCardCount || 0,
      discardTop: publicCard(round.discard[round.discard.length - 1], !round.openingDiscardPending),
      pileHighlight: round.pileHighlight && round.pileHighlight.until > now() ? String(round.pileHighlight.kind || 'event') : '',
      infoEvent: round.infoEvent && round.infoEvent.until > now() ? { text: String(round.infoEvent.text || '') } : null,
      deckBack: state.deckSetting === 'one' ? (state.deckColor || 'blue') : 'mixed',
      drawn: round.drawn ? {
        playerId: round.drawn.playerId,
        source: round.drawn.source,
        card: publicCard(round.drawn.card, round.drawn.playerId === playerId || round.drawn.source === 'pile')
      } : null,
      anyDrawn: !!round.drawn,
      turnComplete: !!round.turnComplete,
      roundEndPending: !!round.roundEndPending,
      roundEndAt: Number.isFinite(round.roundEndAt) ? round.roundEndAt : null,
      wrongThrowPenalty: round.wrongThrowPenalty ? {
        id: String(round.wrongThrowPenalty.id || ''),
        cardId: String(round.wrongThrowPenalty.cardId || ''),
        playerId: String(round.wrongThrowPenalty.playerId || ''),
        wrongThrowCardId: String(round.wrongThrowPenalty.wrongThrowCardId || '')
      } : null,
      cardAddEvent: round.cardAddEvent && round.cardAddEvent.playerId === playerId ? {
        id: String(round.cardAddEvent.id || ''),
        playerId: String(round.cardAddEvent.playerId || ''),
        source: String(round.cardAddEvent.source || '')
      } : null,
      peekEvent: round.peekEvent && round.peekEvent.playerId === playerId ? {
        id: String(round.peekEvent.id || ''),
        cardId: String(round.peekEvent.cardId || '')
      } : null,
      throwInOpen: !!(round.throwIn && round.throwIn.open),
      wrongThrowIn,
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
        isCurrent: !['peek', 'opening', 'roundEnd', 'gameEnd'].includes(round.stage) && cp && cp.id === player.id,
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
  LIVE_LOG_WINDOW,
  LIVE_SCORE_HISTORY_WINDOW,
  createGameView,
  publicCard
};
