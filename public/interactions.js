(function startInteractionLab(window) {
  const document = window.document;
  const app = document.getElementById('app');
  const model = window.DutchInteractionState;
  const view = window.DutchInteractionRender;
  const i18n = window.DutchI18n;
  const sounds = window.DutchClientSounds.create();
  let state = model.createInitialState();
  state.preferences = {
    theme: window.DutchTheme.getStoredTheme(window),
    language: i18n.setLanguage(i18n.getStoredLanguage(window), window),
    sounds: sounds.isEnabled(),
    settingsOpen: true,
    settingsExpanded: false
  };
  let runToken = 0;
  const timers = new Set();

  const cardAnimations = window.DutchClientCardAnimations.create({
    cardHtml: view.cardHtml,
    emit: handleAnimationEvent
  });
  const uiAnimations = window.DutchClientUiAnimations.create({
    getLastState: () => state,
    render: () => render(false)
  });

  function schedule(callback, delay) {
    const token = runToken;
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      if (token === runToken) callback();
    }, delay);
    timers.add(timer);
    return timer;
  }

  function nextFrame(callback) {
    const token = runToken;
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (token === runToken) callback();
    }));
  }

  function stopSequences() {
    runToken += 1;
    timers.forEach((timer) => window.clearTimeout(timer));
    timers.clear();
    cardAnimations.cancelAllCardMoves();
    cardAnimations.cancelAllWrongThrows();
    cardAnimations.cancelAllFaceTurns();
    cardAnimations.cancelAllReshuffles();
  }

  function wireHelpDisclosures() {
    app.querySelectorAll('.help-disclosure-button[popovertarget]').forEach((button) => {
      const popover = document.getElementById(button.getAttribute('popovertarget'));
      if (!popover) return;
      popover.addEventListener('toggle', (event) => {
        if (event.newState !== 'open') return;
        const triggerRect = button.getBoundingClientRect();
        const popoverRect = popover.getBoundingClientRect();
        const edge = 10;
        const gap = 6;
        const maxLeft = Math.max(edge, window.innerWidth - popoverRect.width - edge);
        popover.style.left = Math.min(Math.max(edge, triggerRect.left), maxLeft) + 'px';
        const below = triggerRect.bottom + gap;
        popover.style.top = (below + popoverRect.height <= window.innerHeight - edge
          ? below : Math.max(edge, triggerRect.top - popoverRect.height - gap)) + 'px';
      });
    });
  }

  function render(fullPage = false) {
    const settingsDrawer = app.querySelector('details[data-detail-key="settings"]');
    if (settingsDrawer) state.preferences.settingsOpen = settingsDrawer.open;
    if (fullPage || !app.querySelector(':scope > .main-layout')) {
      app.innerHTML = view.renderPage(state);
    } else {
      const currentLayout = app.querySelector(':scope > .main-layout');
      const template = document.createElement('template');
      template.innerHTML = view.renderPage(state).trim();
      currentLayout.replaceWith(template.content.firstElementChild);
    }
    uiAnimations.wireAnimatedDrawers(document, (details, open) => {
      if (details.dataset.detailKey === 'settings') state.preferences.settingsOpen = open;
    });
    wireHelpDisclosures();
  }

  function preservePreferences(next) {
    next.preferences = { ...(next.preferences || {}), ...state.preferences };
    next.highlightChangedCards = state.highlightChangedCards;
    return next;
  }

  function replaceState(next) {
    preservePreferences(next);
    state = next;
    render(false);
  }

  function transition(next) {
    const previous = state;
    preservePreferences(next);
    const before = cardAnimations.captureAnimationSnapshot('game');
    state = next;
    render(false);
    cardAnimations.hideActiveCardMoveTargets();
    const after = cardAnimations.captureAnimationSnapshot('game');
    cardAnimations.animateStateTransition(previous, next, before, after);
    uiAnimations.animateWinnerConfetti(previous, next);
    sounds.handleStateTransition(previous, next);
  }

  function mutate(mutator) {
    const next = model.clone(state);
    model.clearTransientEvents(next);
    mutator(next);
    transition(next);
    return next;
  }

  function handleAnimationEvent(name) {
    if (!['openingRevealMidpoint', 'pileRevealMidpoint'].includes(name)) return;
    const next = model.clone(state);
    next.round.pendingPileReveal = null;
    if (name === 'openingRevealMidpoint') next.round.stage = 'turn';
    state = next;
  }

  function setActor(stateToChange, playerId) {
    stateToChange.round.currentPlayerId = playerId;
    stateToChange.round.stage = 'turn';
    stateToChange.round.turnComplete = false;
  }

  function runPlayerAction(action, playerId, button) {
    const player = model.playerById(state, playerId);
    if (!player) return;
    stopSequences();
    const cardId = button.dataset.cardId || '';
    if (['right-throw', 'wrong-throw'].includes(action) && !state.round.discardTop) {
      const prepared = model.clone(state);
      prepared.round.discardTop = model.nextCard(prepared, { back: false });
      prepared.round.discardCount = 1;
      replaceState(prepared);
    }

    if (action === 'draw-deck') {
      if (state.round.drawn) return;
      mutate((next) => {
        setActor(next, playerId);
        next.round.drawn = { playerId, source: 'deck', card: model.nextCard(next, { back: playerId !== next.user }) };
        next.round.deckCount = Math.max(0, next.round.deckCount - 1);
      });
      return;
    }

    if (action === 'draw-discard') {
      if (state.round.drawn || !state.round.discardTop) return;
      mutate((next) => {
        setActor(next, playerId);
        const drawn = { ...next.round.discardTop, back: false };
        next.round.drawn = { playerId, source: 'pile', card: drawn };
        next.round.discardCount = Math.max(0, next.round.discardCount - 1);
        next.round.discardTop = next.round.discardCount ? model.nextCard(next, { back: false }) : null;
      });
      return;
    }

    if (action === 'initial-peek') {
      if (state.round.stage !== 'peek' || !cardId) return;
      const next = model.clone(state);
      next.round.players.forEach((candidate) => candidate.cards.forEach((card) => {
        card.back = true;
        card.highlight = '';
      }));
      next.round.peekEvent = null;
      const location = model.cardLocation(next, cardId);
      if (!location) return;
      location.card.highlight = 'peek';
      if (playerId === next.user) {
        location.card.back = false;
        next.round.peekEvent = { id: model.nextEventId(next, 'initial-peek'), cardId };
      }
      transition(next);
      schedule(() => {
        const hidden = model.clone(state);
        const current = model.cardLocation(hidden, cardId);
        if (current) {
          current.card.back = true;
          current.card.highlight = '';
        }
        hidden.round.peekEvent = null;
        transition(hidden);
      }, 1800);
      return;
    }

    if (action === 'replace-special') {
      const type = button.dataset.specialType;
      if (
        !['A', 'Q', 'J'].includes(type)
        || !state.round.drawn
        || state.round.drawn.playerId !== playerId
      ) return;
      const prepared = model.clone(state);
      model.clearTransientEvents(prepared);
      setActor(prepared, playerId);
      const preparedActor = model.playerById(prepared, playerId);
      const cardIndex = preparedActor.cards.findIndex((card) => card.id === cardId);
      if (cardIndex < 0) return;
      preparedActor.cards[cardIndex] = model.setCardRank(preparedActor.cards[cardIndex], type);
      const discarded = preparedActor.cards[cardIndex];
      preparedActor.cards[cardIndex] = { ...prepared.round.drawn.card, back: true, highlight: 'replace' };
      prepared.round.drawn = null;
      prepared.round.discardTop = { ...discarded, back: false };
      prepared.round.discardCount += 1;
      prepared.round.pendingPileReveal = {
        cardId: discarded.id,
        actorId: playerId,
        kind: 'discard',
        moveMs: 360,
        flipMs: 260
      };
      prepared.round.stage = 'revealing';
      transition(prepared);
      schedule(() => mutate((next) => {
        next.round.stage = 'special';
        next.round.special = { type, actorId: playerId, selected: [] };
      }), 650);
      return;
    }

    if (action === 'discard') {
      if (!state.round.drawn || state.round.drawn.playerId !== playerId || state.round.drawn.source !== 'deck') return;
      mutate((next) => {
        const discarded = next.round.drawn.card;
        next.round.drawn = null;
        next.round.discardTop = { ...discarded, back: false };
        next.round.discardCount += 1;
        next.round.pendingPileReveal = {
          cardId: discarded.id,
          actorId: playerId,
          kind: 'discard',
          moveMs: 360,
          flipMs: 260
        };
        next.round.stage = 'revealing';
      });
      schedule(() => mutate((next) => {
        next.round.stage = 'turn';
        next.round.turnComplete = true;
      }), 650);
      return;
    }

    if (action === 'replace') {
      if (!state.round.drawn || state.round.drawn.playerId !== playerId || !cardId) return;
      mutate((next) => {
        const actor = model.playerById(next, playerId);
        const index = actor.cards.findIndex((card) => card.id === cardId);
        if (index < 0) return;
        const drawn = next.round.drawn.card;
        const discarded = { ...actor.cards[index], back: false };
        actor.cards[index] = { ...drawn, back: true, highlight: 'replace' };
        next.round.drawn = null;
        next.round.discardTop = discarded;
        next.round.discardCount += 1;
        next.round.pendingPileReveal = {
          cardId: discarded.id,
          actorId: playerId,
          kind: 'discard',
          moveMs: 360,
          flipMs: 260
        };
        next.round.stage = 'revealing';
      });
      schedule(() => mutate((next) => {
        next.round.stage = 'turn';
        next.round.turnComplete = true;
      }), 650);
      return;
    }

    if (action === 'right-throw') {
      const actionType = model.actionTypeForRank(state.round.discardTop && state.round.discardTop.rank);
      mutate((next) => {
        const actor = model.playerById(next, playerId);
        const index = actor.cards.findIndex((card) => card.id === cardId);
        const discardRank = next.round.discardTop ? next.round.discardTop.rank : '7';
        actor.cards[index] = model.setCardRank(actor.cards[index], discardRank);
        const thrown = actor.cards.splice(index, 1)[0];
        next.round.discardTop = { ...thrown, back: false };
        next.round.discardCount += 1;
        next.round.infoEvent = { text: actor.name + ' threw in a ' + thrown.rank + thrown.symbol };
        next.round.pendingPileReveal = { cardId: thrown.id, actorId: playerId, kind: 'throw-in', moveMs: 360, flipMs: 260 };
        next.round.stage = 'revealing';
      });
      schedule(() => mutate((next) => {
        if (actionType) {
          next.round.stage = 'special';
          next.round.special = { type: actionType, actorId: playerId, selected: [] };
        } else {
          next.round.stage = 'turn';
        }
      }), 650);
      return;
    }

    if (action === 'wrong-throw') {
      const next = model.clone(state);
      model.clearTransientEvents(next);
      const actor = model.playerById(next, playerId);
      const index = actor.cards.findIndex((card) => card.id === cardId);
      const discardRank = next.round.discardTop ? next.round.discardTop.rank : '7';
      actor.cards[index] = model.setCardRank(actor.cards[index], model.differentRank(discardRank));
      next.round.wrongThrowIn = {
        id: model.nextEventId(next, 'wrong-throw'),
        playerId,
        playerName: actor.name,
        cardId,
        card: { ...actor.cards[index], back: false }
      };
      transition(next);
      schedule(() => {
        mutate((penaltyState) => {
          const recipient = model.playerById(penaltyState, playerId);
          const penalty = model.nextCard(penaltyState, { back: true, highlight: 'add' });
          recipient.cards.push(penalty);
          penaltyState.round.deckCount = Math.max(0, penaltyState.round.deckCount - 1);
          penaltyState.round.wrongThrowPenalty = {
            id: model.nextEventId(penaltyState, 'penalty'),
            cardId: penalty.id,
            playerId,
            wrongThrowCardId: cardId
          };
          penaltyState.round.cardAddEvent = {
            id: model.nextEventId(penaltyState, 'wrong-add'),
            playerId,
            source: 'wrong-throw'
          };
        });
      }, 1500);
      return;
    }

    if (action === 'ace') {
      const targetId = button.dataset.targetPlayerId;
      const target = model.playerById(state, targetId);
      if (!target || !state.round.special || state.round.special.type !== 'A') return;
      mutate((next) => {
        const recipient = model.playerById(next, targetId);
        const added = model.nextCard(next, { back: true, highlight: 'add' });
        recipient.cards.push(added);
        next.round.deckCount = Math.max(0, next.round.deckCount - 1);
        next.round.cardAddEvent = { id: model.nextEventId(next, 'ace-add'), playerId: targetId, source: 'ace' };
        next.round.infoEvent = { text: player.name + ' used Ace add' };
        next.round.turnComplete = true;
      });
      return;
    }

    if (action === 'queen') {
      const targetCardId = cardId;
      const target = model.cardLocation(state, targetCardId);
      if (!target || !state.round.special || state.round.special.type !== 'Q') return;
      mutate((next) => {
        const location = model.cardLocation(next, targetCardId);
        location.player.cards[location.index].highlight = 'peek';
        if (playerId === next.user) location.player.cards[location.index].back = false;
        if (playerId === next.user) next.round.peekEvent = { id: model.nextEventId(next, 'peek'), cardId: targetCardId };
        next.round.infoEvent = { text: player.name + ' used Queen peek' };
        next.round.turnComplete = true;
      });
      schedule(() => {
        mutate((next) => {
          const location = model.cardLocation(next, targetCardId);
          if (location) location.player.cards[location.index] = { ...location.card, back: true, highlight: '' };
        });
      }, 3000);
      return;
    }

    if (action === 'jack-target') {
      const special = state.round.special;
      if (!special || special.type !== 'J' || !cardId) return;
      const selected = special.selected || [];
      if (selected.includes(cardId)) {
        mutate((next) => {
          next.round.stage = 'special';
          next.round.special = { type: 'J', actorId: playerId, selected: selected.filter((id) => id !== cardId) };
        });
        return;
      }
      if (selected.length === 0) {
        mutate((next) => {
          next.round.stage = 'special';
          next.round.special = { type: 'J', actorId: playerId, selected: [cardId] };
        });
        return;
      }
      const firstId = selected[0];
      mutate((next) => {
        next.round.stage = 'special';
        next.round.special = { type: 'J', actorId: playerId, selected: [firstId, cardId] };
      });
      schedule(() => mutate((next) => {
        const first = model.cardLocation(next, firstId);
        const second = model.cardLocation(next, cardId);
        if (!first || !second) return;
        const firstCard = first.card;
        first.player.cards[first.index] = second.card;
        second.player.cards[second.index] = firstCard;
        first.player.cards[first.index].highlight = 'swap';
        second.player.cards[second.index].highlight = 'swap';
        next.round.special = null;
        next.round.infoEvent = { text: player.name + ' used Jack swap' };
        next.round.turnComplete = true;
      }), 500);
      return;
    }

    if (action === 'call-dutch') {
      mutate((next) => { next.round.dutchCallerId = playerId; });
      return;
    }

    if (action === 'game-winner') {
      stopSequences();
      const prepared = model.clone(state);
      model.clearTransientEvents(prepared);
      prepared.round.players.forEach((candidate) => candidate.cards.forEach((card) => { card.back = true; card.highlight = ''; }));
      prepared.round.stage = 'turn';
      replaceState(prepared);
      nextFrame(() => mutate((next) => {
        next.round.stage = 'gameEnd';
        next.round.winnerId = playerId;
        next.round.roundWinnerIds = [playerId];
        next.round.players.forEach((candidate) => candidate.cards.forEach((card) => { card.back = false; }));
      }));
    }
  }

  function resetBaseline() {
    stopSequences();
    const gameStartedAt = state.gameStartedAt + 1;
    const empty = model.createInitialState({ gameStartedAt, cardCount: 0 });
    empty.round.stage = 'deal';
    empty.round.discardCount = 0;
    empty.round.discardTop = null;
    replaceState(empty);
    nextFrame(() => {
      const dealt = model.createInitialState({ gameStartedAt });
      dealt.round.stage = 'deal';
      dealt.round.discardCount = 0;
      dealt.round.discardTop = null;
      replaceState(dealt);

      const dealSnapshot = cardAnimations.captureAnimationSnapshot('game');
      const dealDuration = cardAnimations.animateInitialDeal(dealt, dealSnapshot);
      schedule(() => {
        const opening = model.clone(state);
        opening.round.stage = 'opening';
        opening.round.discardTop = model.nextCard(opening, { back: true });
        opening.round.discardCount = 1;
        transition(opening);
        schedule(() => {
          const revealed = model.clone(state);
          revealed.round.discardTop.back = false;
          transition(revealed);
        }, 500);
        schedule(() => {
          const ready = model.clone(state);
          ready.round.stage = 'peek';
          ready.round.turnComplete = false;
          transition(ready);
        }, 850);
      }, dealDuration);
    });
  }

  function runSystemAction(action) {
    stopSequences();
    if (action === 'reset') {
      resetBaseline();
      return;
    }
    if (action === 'reshuffle') {
      const prepared = model.clone(state);
      model.clearTransientEvents(prepared);
      if (!prepared.round.discardTop) prepared.round.discardTop = model.nextCard(prepared, { back: false });
      prepared.round.discardCount = Math.max(6, prepared.round.discardCount);
      prepared.round.deckCount = 0;
      replaceState(prepared);
      nextFrame(() => mutate((next) => {
        next.round.deckCount = next.round.discardCount - 1;
        next.round.reshuffleToken = (next.round.reshuffleToken || 0) + 1;
        next.round.reshuffleCardCount = next.round.discardCount - 1;
        next.round.discardCount = 1;
      }));
      return;
    }
    if (action === 'round-reveal') {
      stopSequences();
      const prepared = model.clone(state);
      model.clearTransientEvents(prepared);
      prepared.round.stage = 'turn';
      prepared.round.players.forEach((player) => player.cards.forEach((card) => { card.back = true; card.highlight = ''; }));
      replaceState(prepared);
      nextFrame(() => mutate((next) => {
        next.round.stage = 'roundEnd';
        next.round.roundWinnerIds = ['user'];
        next.round.players.forEach((player) => player.cards.forEach((card) => { card.back = false; }));
      }));
      return;
    }
    if (action === 'next-player') {
      if (['roundEnd', 'gameEnd', 'revealing', 'opening'].includes(state.round.stage)) return;
      mutate((next) => {
        const players = next.round.players;
        const index = players.findIndex((player) => player.id === next.round.currentPlayerId);
        next.round.drawn = null;
        next.round.currentPlayerId = players[(index + 1) % players.length].id;
        next.round.stage = 'turn';
        next.round.turnComplete = false;
      });
      return;
    }
  }

  app.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    sounds.unlock();
    if (button.dataset.systemAction) {
      runSystemAction(button.dataset.systemAction);
      return;
    }
    if (button.dataset.action === 'toggleSettingsMore') {
      state.preferences.settingsExpanded = !state.preferences.settingsExpanded;
      render(false);
      return;
    }
    if (button.dataset.action && button.dataset.playerId) {
      runPlayerAction(button.dataset.action, button.dataset.playerId, button);
    }
  });

  app.addEventListener('change', (event) => {
    const select = event.target.closest('select');
    if (!select) return;
    if (select.id === 'gameThemeSelect') {
      state.preferences.theme = window.DutchTheme.setTheme(select.value, window);
      return;
    }
    if (select.id === 'gameLanguageSelect') {
      state.preferences.language = i18n.setLanguage(select.value, window);
      render(false);
      return;
    }
    if (select.id === 'gameSoundSelect') {
      state.preferences.sounds = sounds.setEnabled(select.value !== 'off');
      if (state.preferences.sounds) sounds.unlock();
      return;
    }
    if (select.id === 'inGameTargetSelect') {
      state.singleRound = select.value === 'single';
      if (!state.singleRound) state.gameTarget = Number(select.value);
      return;
    }
    if (select.id === 'gameInactivityTimeoutSelect') {
      const value = Number(select.value);
      if ([15, 30, 60, 90].includes(value)) state.inactivityTimeoutMinutes = value;
      return;
    }
    if (select.id === 'gameBotTimingSelect') {
      const value = Number(select.value);
      if (window.DutchShared.BOT_SPEED_OPTIONS.some((option) => option.value === value)) {
        state.botTimingPercent = value;
      }
      return;
    }
    if (select.id === 'highlightChangedCardsSelect') {
      state.highlightChangedCards = select.value !== 'false';
      render(false);
    }
  });

  document.addEventListener('keydown', () => sounds.unlock(), true);
  render(true);
})(window);
