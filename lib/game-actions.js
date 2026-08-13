function createGameActions(deps) {
  const wrongThrowPenaltyDelayMs = deps.wrongThrowPenaltyDelayMs ?? 1500;
  const setTimeoutFn = deps.setTimeoutFn || setTimeout;

  function closeThrowInBecauseOfPlayingAction() {
    const round = deps.getState().round;
    if (round && round.throwIn) round.throwIn.open = false;
  }

  function pendingDeckDraws(round) {
    if (!Array.isArray(round.pendingDeckDraws)) round.pendingDeckDraws = [];
    return round.pendingDeckDraws;
  }

  function queuePendingDeckDraw(action) {
    const round = deps.getState().round;
    if (!round || !round.needsReshuffle) return false;
    const key = [action.type, action.playerId || '', action.targetId || '', action.cardId || ''].join(':');
    const queue = pendingDeckDraws(round);
    if (!queue.some((item) => item.key === key)) queue.push({ ...action, key });
    return true;
  }

  function rememberBotDeckDraw(player, card) {
    if (player && player.isBot && deps.rememberDeckDrawForBot) deps.rememberDeckDrawForBot(player, card);
  }

  function completeTakeDeck(player, card) {
    const round = deps.getState().round;
    if (!player || !card || !round || !canTakeCardForPlayer(player, { ignoreReshuffle: true })) return false;
    round.drawn = { playerId: player.id, source: 'deck', card };
    rememberBotDeckDraw(player, card);
    return true;
  }

  function completeAceAdd(player, target, card) {
    if (!player || !target || !card) return false;
    deps.addUnknownSlotForAllBots(target.id, 'Ace');
    target.cards.push(card);
    deps.markHandCardChanged(target.id, card.id);
    deps.observeAceForAllBots(player.id, target.id);
    deps.addLog(player.name + ' gave a card to ' + target.name);
    deps.showInfoEvent(player.name + ' used Ace add');
    deps.finishSpecial();
    return true;
  }

  function scheduleWrongThrowPenalty(player, penalty, wrongThrowCardId) {
    const round = deps.getState().round;
    if (!player || !penalty || !round) return false;
    const roundAtThrow = round;
    roundAtThrow.pendingWrongThrowPenalties = (roundAtThrow.pendingWrongThrowPenalties || 0) + 1;
    const timer = setTimeoutFn(() => {
      const state = deps.getState();
      if (state.round !== roundAtThrow) return;
      roundAtThrow.pendingWrongThrowPenalties = Math.max(0, (roundAtThrow.pendingWrongThrowPenalties || 1) - 1);
      if (!state.players.includes(player)) return;
      deps.addUnknownSlotForAllBots(player.id, 'wrong throw-in penalty');
      player.cards.push(penalty);
      deps.markHandCardChanged(player.id, penalty.id);
      roundAtThrow.wrongThrowPenalty = {
        id: penalty.id + ':' + String(wrongThrowCardId || ''),
        cardId: penalty.id,
        playerId: player.id,
        wrongThrowCardId: String(wrongThrowCardId || '')
      };
      deps.addLog(player.name + ' made a wrong throw-in and took a penalty card');
      deps.broadcastState();
    }, wrongThrowPenaltyDelayMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
    return true;
  }

  function resumePendingDeckDraws() {
    const state = deps.getState();
    const round = state.round;
    if (!round || round.needsReshuffle) return false;
    const queue = pendingDeckDraws(round).splice(0);
    let resumed = false;
    for (let index = 0; index < queue.length; index += 1) {
      const pending = queue[index];
      const player = deps.findPlayer(pending.playerId);
      const special = pending.type === 'aceAdd' ? deps.topSpecial() : null;
      const target = pending.type === 'aceAdd' ? deps.findPlayer(pending.targetId) : null;
      const valid = pending.type === 'takeDeck'
        ? canTakeCardForPlayer(player, { ignoreReshuffle: true })
        : pending.type === 'aceAdd'
          ? !!(player && target && special && special.type === 'A' && special.actorId === player.id)
          : pending.type === 'wrongThrowPenalty' && !!player;
      if (!valid) continue;
      const card = deps.drawFromDeck();
      if (!card) {
        round.pendingDeckDraws.unshift(...queue.slice(index));
        break;
      }
      if (pending.type === 'takeDeck') {
        resumed = completeTakeDeck(player, card) || resumed;
        continue;
      }
      if (pending.type === 'aceAdd') {
        resumed = completeAceAdd(player, target, card) || resumed;
        continue;
      }
      if (pending.type === 'wrongThrowPenalty') {
        resumed = scheduleWrongThrowPenalty(player, card, pending.cardId) || resumed;
      }
    }
    return resumed;
  }

  function canReshuffleForPlayer(player, options = {}) {
    const round = deps.getState().round;
    if (!round || !round.needsReshuffle || round.deck.length > 0 || round.discard.length <= 1) return false;
    if (options.automatic) {
      const players = deps.activePlayablePlayers ? deps.activePlayablePlayers() : [];
      return players.length > 0 && players.every((item) => item.isBot);
    }
    return !!(player && !player.left && !player.isBot && !player.isSpectator);
  }

  function shuffleForPlayer(player, options = {}) {
    if (!canReshuffleForPlayer(player, options)) return false;
    if (!deps.reshuffleDrawPile()) return false;
    resumePendingDeckDraws();
    return true;
  }

  function canTakeCardForPlayer(player, options = {}) {
    const round = deps.getState().round;
    return !!(
      player &&
      round &&
      round.stage === 'turn' &&
      deps.currentPlayer()?.id === player.id &&
      !round.drawn &&
      !round.turnComplete &&
      (options.ignoreReshuffle || !round.needsReshuffle) &&
      !deps.topSpecial() &&
      !deps.mustPlayerSayDutch(player.id)
    );
  }

  function takeDeckForPlayer(player) {
    const state = deps.getState();
    const round = state.round;
    if (!canTakeCardForPlayer(player)) return null;
    const top = round.discard[round.discard.length - 1];
    if (top && deps.observeDecisionForAllBots) {
      deps.observeDecisionForAllBots(player.id, 'reject-pile', { card: deps.publicMemoryCard ? deps.publicMemoryCard(top) : top });
    }
    const card = deps.drawFromDeck();
    if (!card) {
      queuePendingDeckDraw({ type: 'takeDeck', playerId: player.id });
      return null;
    }
    completeTakeDeck(player, card);
    return card;
  }

  function takePileForPlayer(player) {
    const round = deps.getState().round;
    if (!canTakeCardForPlayer(player) || round.needsReshuffle || round.discard.length === 0) return null;
    closeThrowInBecauseOfPlayingAction();
    const card = round.discard.pop();
    round.drawn = { playerId: player.id, source: 'pile', card };
    deps.observePileTakeForAllBots(player.id, card);
    return card;
  }

  function discardDrawnForPlayer(player) {
    const round = deps.getState().round;
    if (!player || !round || round.needsReshuffle || round.stage !== 'turn') return null;
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
    if (!player || !round || round.needsReshuffle || round.stage !== 'turn') return null;
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
    if (!player || !round || round.needsReshuffle) return null;
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
        scheduleWrongThrowPenalty(player, penalty, card.id);
      } else if (queuePendingDeckDraw({ type: 'wrongThrowPenalty', playerId: player.id, cardId })) {
        return { valid: false, penalty: null, pending: true };
      } else {
        deps.addLog(player.name + ' made a wrong throw-in but no penalty card was available');
      }
      return { valid: false, penalty };
    }
    round.throwIn.open = false;
    player.cards.splice(index, 1);
    const article = ['8', 'A'].includes(card.rank) ? 'an' : 'a';
    deps.pushDiscard(card, player.id, 'threw in', {
      allowThrowIn: false,
      observationSource: 'throw-in',
      observationActorId: player.id,
      removedSlotOwnerId: player.id,
      removedSlotIndex: index,
      removedSlotSource: 'throw-in',
      infoEventText: player.name + ' threw in ' + article + ' ' + deps.label(card)
    });
    deps.highlightPileForAll('event', 3000);
    return { valid: true, card, index };
  }

  function aceAddForPlayer(player, targetId) {
    const round = deps.getState().round;
    const special = deps.topSpecial();
    if (!player || !round || round.needsReshuffle || round.stage !== 'special' || !special) return false;
    if (special.actorId !== player.id || special.type !== 'A') return false;
    const target = deps.findPlayer(targetId);
    if (!target || target.isSpectator || deps.isProtectedSpecialTarget(target.id)) return false;
    const card = deps.drawFromDeck();
    if (!card) {
      if (queuePendingDeckDraw({ type: 'aceAdd', playerId: player.id, targetId: target.id })) return true;
      deps.finishSpecial();
      return true;
    }
    return completeAceAdd(player, target, card);
  }

  function queenPeekForPlayer(player, cardId) {
    const round = deps.getState().round;
    const special = deps.topSpecial();
    if (!player || !round || round.needsReshuffle || round.stage !== 'special' || !special) return false;
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
    deps.showInfoEvent(player.name + ' used Queen peek');
    deps.finishSpecial();
    return true;
  }

  return {
    canTakeCardForPlayer,
    canReshuffleForPlayer,
    shuffleForPlayer,
    resumePendingDeckDraws,
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
