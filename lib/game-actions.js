function createGameActions(deps) {
  const wrongThrowPenaltyDelayMs = deps.wrongThrowPenaltyDelayMs ?? 1500;
  const setTimeoutFn = deps.setTimeoutFn || setTimeout;

  function closeThrowInBecauseOfPlayingAction() {
    const round = deps.getState().round;
    if (round && round.throwIn) round.throwIn.open = false;
  }

  function canTakeCardForPlayer(player) {
    const round = deps.getState().round;
    return !!(
      player &&
      round &&
      round.stage === 'turn' &&
      deps.currentPlayer()?.id === player.id &&
      !round.drawn &&
      !round.turnComplete &&
      !deps.topSpecial() &&
      !deps.mustPlayerSayDutch(player.id)
    );
  }

  function takeDeckForPlayer(player) {
    const state = deps.getState();
    const round = state.round;
    if (!canTakeCardForPlayer(player)) return null;
    closeThrowInBecauseOfPlayingAction();
    const top = round.discard[round.discard.length - 1];
    if (top && deps.observeDecisionForAllBots) {
      deps.observeDecisionForAllBots(player.id, 'reject-pile', { card: deps.publicMemoryCard ? deps.publicMemoryCard(top) : top });
    }
    const card = deps.drawFromDeck();
    if (!card) return null;
    state.round.drawn = { playerId: player.id, source: 'deck', card };
    return card;
  }

  function takePileForPlayer(player) {
    const round = deps.getState().round;
    if (!canTakeCardForPlayer(player) || round.discard.length === 0) return null;
    closeThrowInBecauseOfPlayingAction();
    const card = round.discard.pop();
    round.drawn = { playerId: player.id, source: 'pile', card };
    deps.observePileTakeForAllBots(player.id, card);
    return card;
  }

  function discardDrawnForPlayer(player) {
    const round = deps.getState().round;
    if (!player || !round || round.stage !== 'turn') return null;
    if (deps.currentPlayer()?.id !== player.id || !round.drawn || round.drawn.source !== 'deck') return null;
    const card = round.drawn.card;
    round.drawn = null;
    round.turnComplete = true;
    deps.pushDiscard(card, player.id, 'drew {card} from deck but discarded it', {
      observationSource: 'discarded',
      observationActorId: player.id
    });
    return card;
  }

  function swapDrawnForPlayer(player, cardId, options = {}) {
    const round = deps.getState().round;
    if (!player || !round || round.stage !== 'turn') return null;
    if (deps.currentPlayer()?.id !== player.id || !round.drawn) return null;
    const index = player.cards.findIndex((card) => card.id === cardId);
    if (index < 0) return null;
    const oldCard = player.cards[index];
    const newCard = round.drawn.card;
    const source = round.drawn.source;
    player.cards[index] = newCard;
    deps.markHandCardChanged(player.id, newCard.id);
    round.drawn = null;
    round.turnComplete = true;
    if (source === 'pile') {
      deps.rememberSlotForAllBots(player.id, index, newCard, 'pile observation', 1);
      if (options.rememberOwnCard && player.isBot) deps.rememberSlotForBot(player, player.id, index, newCard, 'pile observation', 1);
    } else {
      deps.forgetSlotForAllBots(player.id, index, 'deck swap');
      if (options.rememberOwnCard && player.isBot) deps.rememberSlotForBot(player, player.id, index, newCard, 'deck draw', 1);
    }
    if (!player.isBot && deps.rememberHumanSlotForAllBots) {
      deps.rememberHumanSlotForAllBots(
        player.id,
        player.id,
        index,
        newCard,
        source === 'pile' ? 'pile acquisition' : 'deck draw',
        1
      );
    }
    deps.pushDiscard(oldCard, player.id, source === 'pile' ? 'drew ' + deps.label(newCard) + ' from pile and discarded {card}' : 'drew from deck and discarded {card}', {
      observationSource: 'swap discard',
      observationActorId: player.id
    });
    return { oldCard, newCard, source, index };
  }

  function throwInForPlayer(player, cardId) {
    const round = deps.getState().round;
    if (!player || !round) return null;
    if (!round.throwIn || !round.throwIn.open) return null;
    if (round.stage === 'roundEnd' || round.stage === 'gameEnd' || deps.isJackSwapInProgress()) return null;
    const index = player.cards.findIndex((card) => card.id === cardId);
    if (index < 0) return null;
    const card = player.cards[index];
    const valid = deps.rankValue(card) === round.throwIn.rank;
    if (deps.observeDecisionForAllBots) {
      deps.observeDecisionForAllBots(player.id, 'throw-in', { rank: round.throwIn.rank, valid });
    }
    if (!valid) {
      const penalty = deps.drawFromDeck();
      deps.highlightCardForAll(card.id, 'wrong-throw', 2200, { playerId: player.id });
      if (penalty) {
        const roundAtThrow = round;
        const timer = setTimeoutFn(() => {
          const state = deps.getState();
          if (state.round !== roundAtThrow || !state.players.includes(player)) return;
          deps.addUnknownSlotForAllBots(player.id, 'wrong throw-in penalty');
          player.cards.push(penalty);
          deps.markHandCardChanged(player.id, penalty.id);
          deps.addLog(player.name + ' made a wrong throw-in and took a penalty card');
          deps.broadcastState();
        }, wrongThrowPenaltyDelayMs);
        if (timer && typeof timer.unref === 'function') timer.unref();
      } else {
        deps.addLog(player.name + ' made a wrong throw-in but no penalty card was available');
      }
      return { valid: false, penalty };
    }
    round.throwIn.open = false;
    player.cards.splice(index, 1);
    deps.pushDiscard(card, player.id, 'threw in', {
      allowThrowIn: false,
      observationSource: 'throw-in',
      observationActorId: player.id,
      removedSlotOwnerId: player.id,
      removedSlotIndex: index,
      removedSlotSource: 'throw-in'
    });
    deps.highlightPileForAll('event', 3000);
    return { valid: true, card, index };
  }

  function aceAddForPlayer(player, targetId) {
    const round = deps.getState().round;
    const special = deps.topSpecial();
    if (!player || !round || round.stage !== 'special' || !special) return false;
    if (special.actorId !== player.id || special.type !== 'A') return false;
    const target = deps.findPlayer(targetId);
    if (!target || target.isSpectator || deps.isProtectedSpecialTarget(target.id)) return false;
    const card = deps.drawFromDeck();
    if (card) {
      deps.addUnknownSlotForAllBots(target.id, 'Ace');
      target.cards.push(card);
      deps.markHandCardChanged(target.id, card.id);
      deps.observeAceForAllBots(player.id, target.id);
      deps.addLog(player.name + ' gave a card to ' + target.name);
    }
    deps.finishSpecial();
    return true;
  }

  function queenPeekForPlayer(player, cardId) {
    const round = deps.getState().round;
    const special = deps.topSpecial();
    if (!player || !round || round.stage !== 'special' || !special) return false;
    if (special.actorId !== player.id || special.type !== 'Q') return false;
    const target = deps.playerByCardId(cardId);
    if (!target) return false;
    deps.revealCardTo(player.id, cardId, 3000);
    deps.highlightCardForAll(cardId, 'peek', 3000, { exceptViewerId: player.id });
    if (!player.isBot && deps.rememberHumanSlotForAllBots) {
      deps.rememberHumanSlotForAllBots(player.id, target.player.id, target.index, target.card, 'Queen peek', 1);
    }
    if (deps.observeDecisionForAllBots) deps.observeDecisionForAllBots(player.id, 'queen-target', { targetId: target.player.id });
    deps.addLog(player.name + ' used Queen peek');
    deps.finishSpecial();
    return true;
  }

  return {
    canTakeCardForPlayer,
    takeDeckForPlayer,
    takePileForPlayer,
    discardDrawnForPlayer,
    swapDrawnForPlayer,
    throwInForPlayer,
    aceAddForPlayer,
    queenPeekForPlayer
  };
}

module.exports = { createGameActions };
