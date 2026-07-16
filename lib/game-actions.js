function createGameActions(deps) {
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
    if (!canTakeCardForPlayer(player)) return null;
    closeThrowInBecauseOfPlayingAction();
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
    deps.observeDiscardForAllBots(card, 'discarded', player.id);
    deps.pushDiscard(card, player.id, 'drew {card} from deck but discarded it');
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
    deps.highlightCardForAll(newCard.id, 'event', 3000);
    round.drawn = null;
    round.turnComplete = true;
    if (source === 'pile') {
      deps.rememberSlotForAllBots(player.id, index, newCard, 'pile observation', 0.9);
      if (options.rememberOwnCard && player.isBot) deps.rememberSlotForBot(player, player.id, index, newCard, 'pile observation', 0.98);
    } else {
      deps.forgetSlotForAllBots(player.id, index, 'deck swap');
      if (options.rememberOwnCard && player.isBot) deps.rememberSlotForBot(player, player.id, index, newCard, 'deck draw', 1);
    }
    deps.observeDiscardForAllBots(oldCard, 'swap discard', player.id);
    deps.pushDiscard(oldCard, player.id, source === 'pile' ? 'drew ' + deps.label(newCard) + ' from pile and discarded {card}' : 'drew from deck and discarded {card}');
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
    if (!valid) {
      const penalty = deps.drawFromDeck();
      if (penalty) {
        player.cards.push(penalty);
        deps.addUnknownSlotForAllBots(player.id, 'wrong throw-in penalty');
      }
      deps.addLog(player.name + ' made a wrong throw-in and took a penalty card');
      return { valid: false, penalty };
    }
    round.throwIn.open = false;
    deps.rememberSlotForAllBots(player.id, index, card, 'throw-in', 0.98);
    player.cards.splice(index, 1);
    deps.removeSlotForAllBots(player.id, index, 'throw-in');
    deps.observeDiscardForAllBots(card, 'throw-in', player.id);
    deps.pushDiscard(card, player.id, 'threw in', { allowThrowIn: false });
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
      target.cards.push(card);
      deps.highlightCardForAll(card.id, 'event', 3000);
      deps.addUnknownSlotForAllBots(target.id, 'Ace');
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
