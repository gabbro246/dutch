(function initClientCardAnimations(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DutchClientCardAnimations = api;
})(typeof window !== 'undefined' ? window : globalThis, function createClientCardAnimations(root) {
  function create(deps) {
    const window = deps.window || root;
    const document = window.document;
    const Element = window.Element;
    const emit = deps.emit;
    const cardHtml = deps.cardHtml;
    const activeCardMoves = new Map();
    const activeWrongThrows = new Map();
    const activeFaceTurns = new Map();
    let activeReshuffle = null;

    function emptyAnimationSnapshot() {
      return { cards: new Map(), roles: new Map(), locations: new Map(), panels: new Map(), waitingPlayers: new Map() };
    }

    function documentRect(el) {
      const rect = el.getBoundingClientRect();
      return {
        left: rect.left + window.scrollX,
        top: rect.top + window.scrollY,
        width: rect.width,
        height: rect.height
      };
    }
    
    function captureAnimationSnapshot(mode = 'all') {
      const snapshot = emptyAnimationSnapshot();
      if (mode !== 'game') document.querySelectorAll('[data-waiting-player-id]').forEach((el) => {
        const rect = documentRect(el);
        if (rect.height) snapshot.waitingPlayers.set(el.dataset.waitingPlayerId, { left: rect.left, top: rect.top, width: rect.width, height: rect.height, html: el.outerHTML });
      });
      if (mode !== 'waiting') document.querySelectorAll("[data-player-panel-id]").forEach((el) => {
        const rect = documentRect(el);
        if (rect.height) snapshot.panels.set(el.dataset.playerPanelId, { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
      });
      if (mode !== 'waiting') document.querySelectorAll('.card').forEach((el) => {
        const rect = documentRect(el);
        if (!rect.width || !rect.height) return;
        const data = {
          rect: {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height
          },
          html: el.outerHTML,
          faceKind: el.dataset.faceKind || '',
          locationKey: el.dataset.locationKey || ''
        };
        if (el.dataset.cardId) snapshot.cards.set(el.dataset.cardId, data);
        if (el.dataset.animRole) snapshot.roles.set(el.dataset.animRole, data);
        if (el.dataset.locationKey) snapshot.locations.set(el.dataset.locationKey, data);
      });
      return snapshot;
    }
    
    function stateCardLocations(state) {
      const result = new Map();
      const round = state && state.round;
      if (!round) return result;
      round.players.forEach((player) => {
        player.cards.forEach((card, index) => {
          if (!card || !card.id) return;
          result.set(card.id, {
            id: card.id,
            locationKey: `player:${player.id}:${index}`,
            faceKind: card.back ? 'back' : 'front',
            highlight: card.highlight || '',
            ownerId: player.id,
            index
          });
        });
      });
      if (round.discardTop && round.discardTop.id) {
        result.set(round.discardTop.id, {
          id: round.discardTop.id,
          locationKey: 'pile-top',
          faceKind: round.discardTop.back ? 'back' : 'front'
        });
      }
      if (round.drawn && round.drawn.card && round.drawn.card.id) {
        result.set(round.drawn.card.id, {
          id: round.drawn.card.id,
          locationKey: 'drawn',
          faceKind: round.drawn.card.back ? 'back' : 'front',
          source: round.drawn.source
        });
      }
      return result;
    }
    
    function animateStateTransition(previousState, state, before, after) {
      if (!previousState.round || !state.round) return;
      if (previousState.roundNumber !== state.roundNumber) {
        if (state.round.stage === 'deal') animateInitialDeal(state, after);
        return;
      }
      animatePlayerPanelResizes(previousState, state, before, after);
      animateJackSwapSelections(previousState, state);
      animateReshuffle(previousState, state, before, after);
      const previousCards = stateCardLocations(previousState);
      const currentCards = stateCardLocations(state);
      const previousWrongThrow = previousState.round.wrongThrowIn;
      const currentWrongThrow = state.round.wrongThrowIn;
      const currentWrongThrowPenalty = state.round.wrongThrowPenalty;
      if (currentWrongThrow && (!previousWrongThrow || previousWrongThrow.id !== currentWrongThrow.id)) {
        animateWrongThrowIn(currentWrongThrow, before, after);
      }
      const movedIds = new Set();
    
      currentCards.forEach((current, cardId) => {
        const previous = previousCards.get(cardId);
        const targetData = after.cards.get(cardId);
        if (!targetData) return;
    
        if (previous && previous.locationKey !== current.locationKey) {
          const sourceData = before.cards.get(cardId) || before.locations.get(previous.locationKey);
          if (sourceData) {
            const pendingReveal = state.round.pendingPileReveal;
            const isPendingPileReveal = current.locationKey === 'pile-top'
              && pendingReveal
              && pendingReveal.cardId === cardId;
            if (isPendingPileReveal) {
              const moveDuration = Number(pendingReveal.moveMs) || 360;
              const flipDuration = Number(pendingReveal.flipMs) || 260;
              const viewerAlreadySawCard = previous.locationKey === 'drawn' && previous.faceKind === 'front';
              if (viewerAlreadySawCard) {
                const notifyRevealMidpoint = (delay = flipDuration / 2) => {
                  window.setTimeout(() => {
                    emit('pileRevealMidpoint', { cardId, reducedMotion: false });
                  }, delay);
                };
                const move = animateCardMove(cardId, sourceData, targetData, moveDuration);
                if (move) move.afterFinish = notifyRevealMidpoint;
                else notifyRevealMidpoint(moveDuration + flipDuration / 2);
              } else {
                const backHtml = cardHtml({
                  id: cardId,
                  back: true,
                  deckColor: (state.round.discardTop && state.round.discardTop.deckColor) || 'blue'
                }, false);
                const move = animateCardMove(cardId, sourceData, targetData, moveDuration, backHtml);
                const turnAtDestination = () => {
                  const latestTarget = cardElement(cardId, current.locationKey);
                  if (latestTarget) {
                    animateFaceTurn(latestTarget, { html: backHtml }, flipDuration, 0, (details = {}) => {
                      emit('pileRevealMidpoint', { cardId, reducedMotion: !!details.reducedMotion });
                    });
                  }
                };
                if (move) move.afterFinish = turnAtDestination;
                else turnAtDestination();
              }
            } else {
              animateCardMove(cardId, sourceData, targetData);
            }
            movedIds.add(cardId);
          }
          return;
        }
    
        if (!previous && current.locationKey === 'drawn' && state.round.drawn && state.round.drawn.source === 'deck') {
          const sourceData = before.roles.get('deck-top');
          if (sourceData) {
            animateCardMove(cardId, sourceData, targetData);
            movedIds.add(cardId);
          }
          return;
        }
    
        const openingDiscardAdded = !previous
          && current.locationKey === 'pile-top'
          && previousState.round.discardCount === 0
          && state.round.discardCount === 1
          && state.round.stage === 'opening';
        if (openingDiscardAdded) {
          const sourceData = before.roles.get('deck-top');
          if (sourceData) {
            animateCardMove(cardId, sourceData, targetData, 480);
            movedIds.add(cardId);
          }
          return;
        }
    
        if (!previous && current.locationKey.startsWith('player:')) {
          const sourceData = before.roles.get('deck-top');
          if (sourceData) {
            const isWrongThrowPenalty = currentWrongThrowPenalty
              && currentWrongThrowPenalty.cardId === cardId
              && currentWrongThrowPenalty.playerId === current.ownerId;
            if (isWrongThrowPenalty) {
              animateWrongThrowPenaltyMove(currentWrongThrowPenalty, cardId, sourceData, targetData);
            } else {
              animateCardMove(cardId, sourceData, targetData);
            }
            movedIds.add(cardId);
          }
        }
      });
    
      const finishedStage = ['roundEnd', 'gameEnd'].includes(state.round.stage);
      const enteringFinishedStage = finishedStage && !['roundEnd', 'gameEnd'].includes(previousState.round.stage);
      const revealCards = enteringFinishedStage ? Array.from(currentCards.entries()).filter(([cardId, current]) => {
        const previous = previousCards.get(cardId);
        return previous && previous.locationKey === current.locationKey && previous.faceKind !== current.faceKind;
      }) : [];
      const dutchCallerId = state.round.dutchCallerId || '';
      revealCards.sort((left, right) => {
        const leftIsCaller = left[1].ownerId === dutchCallerId ? 1 : 0;
        const rightIsCaller = right[1].ownerId === dutchCallerId ? 1 : 0;
        return leftIsCaller - rightIsCaller;
      });
      const revealInterval = revealCards.length > 1 ? Math.min(90, 1200 / (revealCards.length - 1)) : 0;
      const revealDelays = new Map(revealCards.map(([cardId], index) => [cardId, index * revealInterval]));
    
      currentCards.forEach((current, cardId) => {
        if (movedIds.has(cardId)) return;
        const previous = previousCards.get(cardId);
        if (!previous) return;
        if (previous.locationKey !== current.locationKey) return;
        const faceChanged = previous.faceKind !== current.faceKind;
        const publicPeekStarted = previous.highlight !== 'peek' && current.highlight === 'peek';
        if (!faceChanged && !publicPeekStarted) return;
        if (!['front', 'back'].includes(previous.faceKind) || !['front', 'back'].includes(current.faceKind)) return;
        const target = document.querySelector(`.card[data-card-id="${cssEscape(cardId)}"]`);
        const delay = enteringFinishedStage && faceChanged ? (revealDelays.get(cardId) || 0) : 0;
        if (!target) return;
        const previousData = before.cards.get(cardId);
        const isOpeningReveal = faceChanged
          && current.locationKey === 'pile-top'
          && previousState.round.stage === 'opening'
          && state.round.stage === 'opening'
          && previousState.round.discardCount === 1
          && state.round.discardCount === 1;
        const duration = isOpeningReveal
          ? (Number(state.round.openingDiscardFlipMs) || 260)
          : (publicPeekStarted ? 420 : 260);
        const openingRevealMidpoint = isOpeningReveal ? (details = {}) => {
          emit('openingRevealMidpoint', { cardId, reducedMotion: !!details.reducedMotion });
        } : null;
        const activeMove = activeCardMoves.get(cardId);
        if (activeMove) {
          activeMove.afterFinish = () => {
            const latestTarget = cardElement(cardId, current.locationKey);
            if (latestTarget) animateFaceTurn(latestTarget, previousData, duration, delay, openingRevealMidpoint);
          };
          return;
        }
        animateFaceTurn(target, previousData, duration, delay, openingRevealMidpoint);
      });
    }
    

    function animateJackSwapSelections(previousState, state) {
      const previousSpecial = previousState.round && previousState.round.special;
      const currentSpecial = state.round && state.round.special;
      if (!currentSpecial || currentSpecial.type !== 'J') return;

      const previousSelected = new Set(
        previousSpecial && previousSpecial.type === 'J' && previousSpecial.actorId === currentSpecial.actorId
          ? (previousSpecial.selected || [])
          : []
      );
      (currentSpecial.selected || []).forEach((cardId) => {
        if (previousSelected.has(cardId)) return;
        const card = document.querySelector(`.card[data-card-id="${cssEscape(cardId)}"]`);
        if (!card || !card.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const selectedTransform = card.classList.contains('small') ? 'translateY(-20px)' : 'translateY(-24px)';
        const animation = card.animate([
          { transform: 'translateY(0)' },
          { transform: selectedTransform }
        ], {
          duration: 180,
          easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
          fill: 'both'
        });
        animation.onfinish = () => animation.cancel();
      });
    }

    function animateInitialDeal(state, snapshot) {
      const round = state && state.round;
      if (!round || round.stage !== 'deal') return 0;
      if (!Element.prototype.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 0;
      const sourceData = snapshot.roles.get('deck-top');
      if (!sourceData) return 0;
      const interval = Number(round.initialDealIntervalMs) || 120;
      const travel = Number(round.initialDealTravelMs) || 240;
      const players = (round.players || []).filter((player) => !player.isSpectator);
      const cardCount = players.reduce((max, player) => Math.max(max, (player.cards || []).length), 0);
      let dealIndex = 0;
      for (let cardIndex = 0; cardIndex < cardCount; cardIndex += 1) {
        for (const player of players) {
          const card = player.cards && player.cards[cardIndex];
          const targetData = card && snapshot.cards.get(card.id);
          if (!targetData) continue;
          const move = animateCardMove(card.id, sourceData, targetData, travel, '', dealIndex * interval);
          if (move) {
            move.clone.classList.add('initial-deal-card');
            // All delayed clones wait at the same deck position. Keep the next
            // card to be dealt above the later cards so it leaves from the top.
            move.clone.style.zIndex = String(10000 - dealIndex);
          }
          dealIndex += 1;
        }
      }
      return dealIndex ? ((dealIndex - 1) * interval) + travel : 0;
    }

    function finishReshuffle(reshuffle) {
      reshuffle.ghosts.forEach((ghost) => ghost.remove());
      reshuffle.ghosts.clear();
      if (reshuffle.deckStack) reshuffle.deckStack.classList.remove('reshuffle-target-hidden');
      if (reshuffle.timer) window.clearTimeout(reshuffle.timer);
      if (activeReshuffle === reshuffle) activeReshuffle = null;
    }

    function cancelAllReshuffles() {
      if (!activeReshuffle) return;
      activeReshuffle.animations.forEach((animation) => animation.cancel());
      finishReshuffle(activeReshuffle);
    }

    function animateReshuffle(previousState, state, before, after) {
      const previousToken = Number(previousState.round && previousState.round.reshuffleToken) || 0;
      const currentToken = Number(state.round && state.round.reshuffleToken) || 0;
      if (!currentToken || currentToken === previousToken) return;
      cancelAllReshuffles();
      if (!Element.prototype.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const sourceData = before.locations.get('pile-top');
      const targetData = after.roles.get('deck-top');
      const deckStack = document.querySelector('[data-stack="deck"]');
      if (!sourceData || !targetData || !deckStack) return;

      const reshuffle = {
        animations: new Set(),
        ghosts: new Set(),
        deckStack,
        timer: null
      };
      activeReshuffle = reshuffle;
      deckStack.classList.add('reshuffle-target-hidden');
      const dx = targetData.rect.left - sourceData.rect.left;
      const dy = targetData.rect.top - sourceData.rect.top;
      for (let index = 0; index < 5; index += 1) {
        const color = state.round.deckBack === 'mixed' && index % 2 ? 'red' : (state.round.deckBack === 'red' ? 'red' : 'blue');
        const ghostHtml = cardHtml({ id: '', back: true, deckColor: color }, false);
        const ghost = movingFaceFromHtml(ghostHtml, sourceData.rect);
        if (!ghost) continue;
        ghost.classList.add('reshuffle-ghost');
        reshuffle.ghosts.add(ghost);
        const arc = 10 + index * 2;
        const animation = ghost.animate([
          { transform: 'translate(0, 0) rotate(0deg)' },
          { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - arc}px) rotate(${index % 2 ? -3 : 3}deg)` },
          { transform: `translate(${dx}px, ${dy}px) rotate(0deg)` }
        ], {
          duration: 340,
          delay: index * 55,
          easing: 'cubic-bezier(0.35, 0, 0.25, 1)',
          fill: 'forwards'
        });
        reshuffle.animations.add(animation);
      }
      reshuffle.timer = window.setTimeout(() => finishReshuffle(reshuffle), 600);
    }
    
    function animatePlayerPanelResizes(previousState, state, before, after) {
      if (!Element.prototype.animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const previousCounts = new Map(previousState.round.players.map((player) => [player.id, player.cards.length]));
    
      state.round.players.forEach((player) => {
        const previousCount = previousCounts.get(player.id);
        if (previousCount === player.cards.length) return;
        const previousPanel = before.panels.get(player.id);
        const currentPanel = after.panels.get(player.id);
        const element = document.querySelector(`[data-player-panel-id="${cssEscape(player.id)}"]`);
        if (!previousPanel || !currentPanel || !element) return;
        const widthChanged = Math.abs(previousPanel.width - currentPanel.width) >= 1;
        const heightChanged = Math.abs(previousPanel.height - currentPanel.height) >= 1;
        if (!widthChanged && !heightChanged) return;
    
        element.style.overflow = "hidden";
        const growing = player.cards.length > previousCount;
        const offsetX = previousPanel.left - currentPanel.left;
        const offsetY = previousPanel.top - currentPanel.top;
        const scaleX = previousPanel.width / currentPanel.width;
        const animation = element.animate([
          {
            height: `${previousPanel.height}px`,
            transform: `translate(${offsetX}px, ${offsetY}px) scaleX(${scaleX})`,
            transformOrigin: "top left"
          },
          {
            height: `${currentPanel.height}px`,
            transform: "translate(0, 0) scaleX(1)",
            transformOrigin: "top left"
          }
        ], {
          duration: 220,
          easing: growing ? "cubic-bezier(0.2, 0.8, 0.2, 1)" : "cubic-bezier(0.4, 0, 1, 1)"
        });
        const cleanUp = () => element.style.removeProperty("overflow");
        animation.onfinish = cleanUp;
        animation.oncancel = cleanUp;
      });
    }
    
    function cssEscape(value) {
      if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
      return String(value).replace(/"/g, '\\"');
    }
    
    function animateCardMove(cardId, sourceData, targetData, duration = 360, cloneHtml = '', delay = 0) {
      const target = cardElement(cardId, targetData.locationKey) || elementAtRect(targetData.rect, targetData.locationKey);
      let source = sourceData.rect;
      const dest = targetData.rect;
      if (!target) return null;
      if (Math.abs(source.left - dest.left) < 2 && Math.abs(source.top - dest.top) < 2) return null;
    
      const existingMove = activeCardMoves.get(cardId);
      if (existingMove) {
        const movingRect = documentRect(existingMove.clone);
        if (movingRect.width && movingRect.height) {
          source = {
            left: movingRect.left,
            top: movingRect.top,
            width: movingRect.width,
            height: movingRect.height
          };
        }
        cancelCardMove(existingMove);
      }
    
      const clone = cloneHtml ? movingFaceFromHtml(cloneHtml, dest) : target.cloneNode(true);
      if (!clone) return null;
      if (!cloneHtml) {
        clone.classList.add('moving-card');
        clone.removeAttribute('data-card-id');
        clone.removeAttribute('data-action');
        document.body.appendChild(clone);
      }
      clone.style.left = `${dest.left}px`;
      clone.style.top = `${dest.top}px`;
      clone.style.width = `${dest.width}px`;
      clone.style.height = `${dest.height}px`;
      clone.style.margin = '0';
      clone.style.transformOrigin = 'top left';
    
      target.classList.add('anim-target-hidden');
      const scaleX = source.width / dest.width;
      const scaleY = source.height / dest.height;
      const animation = clone.animate([
        { transform: `translate(${source.left - dest.left}px, ${source.top - dest.top}px) scale(${scaleX}, ${scaleY})` },
        { transform: 'translate(0, 0) scale(1, 1)' }
      ], {
        duration,
        delay,
        easing: 'linear',
        fill: 'both'
      });
      const move = { cardId, locationKey: targetData.locationKey, clone, animation };
      activeCardMoves.set(cardId, move);
      animation.onfinish = () => finishCardMove(move);
      animation.oncancel = () => finishCardMove(move);
      return move;
    }
    
    function setMovingFaceRect(face, rect) {
      face.style.left = String(rect.left) + "px";
      face.style.top = String(rect.top) + "px";
      face.style.width = String(rect.width) + "px";
      face.style.height = String(rect.height) + "px";
      face.style.margin = "0";
      face.style.transformOrigin = "center";
    }
    
    function movingFaceFromHtml(html, rect) {
      const template = document.createElement("template");
      template.innerHTML = String(html || "").trim();
      const face = template.content.firstElementChild;
      if (!face) return null;
      face.classList.add("moving-card");
      face.classList.remove("anim-target-hidden", "turning-card");
      face.style.removeProperty("visibility");
      face.removeAttribute("data-card-id");
      face.removeAttribute("data-action");
      setMovingFaceRect(face, rect);
      document.body.appendChild(face);
      return face;
    }
    
    function startWrongThrowPenaltyMove(cardId, sourceData, targetData) {
      const target = cardElement(cardId, targetData.locationKey);
      if (!target) return null;
      const rect = documentRect(target);
      const latestTargetData = {
        ...targetData,
        rect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height
        }
      };
      const cardMove = animateCardMove(cardId, sourceData, latestTargetData);
      if (cardMove) cardMove.clone.classList.add('wrong-throw-penalty-card');
      else target.classList.remove('anim-target-hidden');
      return cardMove;
    }

    function animateWrongThrowPenaltyMove(event, cardId, sourceData, targetData) {
      const wrongThrowMove = activeWrongThrows.get(event.wrongThrowCardId);
      if (!wrongThrowMove || wrongThrowMove.shakeFinished) {
        return startWrongThrowPenaltyMove(cardId, sourceData, targetData);
      }

      const target = cardElement(cardId, targetData.locationKey);
      if (target) target.classList.add('anim-target-hidden');
      const deferredMove = {
        start: () => startWrongThrowPenaltyMove(cardId, sourceData, targetData),
        cancel: () => {
          const latestTarget = cardElement(cardId, targetData.locationKey);
          if (latestTarget) latestTarget.classList.remove('anim-target-hidden');
        }
      };
      wrongThrowMove.afterShake.add(deferredMove);
      return null;
    }

    function releaseWrongThrowPenaltyMoves(move) {
      if (move.shakeFinished) return;
      move.shakeFinished = true;
      const deferredMoves = Array.from(move.afterShake);
      move.afterShake.clear();
      deferredMoves.forEach((deferredMove) => deferredMove.start());
    }

    function cancelWrongThrowPenaltyMoves(move) {
      move.afterShake.forEach((deferredMove) => deferredMove.cancel());
      move.afterShake.clear();
    }

    function playWrongThrowPhase(move, face, keyframes, options) {
      if (move.cancelled) return Promise.resolve(false);
      const animation = face.animate(keyframes, options);
      move.animation = animation;
      return animation.finished.then(() => !move.cancelled).catch(() => false);
    }
    
    async function playWrongThrowRectPhase(move, face, fromRect, toRect, duration) {
      if (move.cancelled) return false;
      const rectFrame = (rect) => ({
        left: String(rect.left) + "px",
        top: String(rect.top) + "px",
        width: String(rect.width) + "px",
        height: String(rect.height) + "px"
      });
      const animation = face.animate([
        rectFrame(fromRect),
        rectFrame(toRect)
      ], { duration, easing: "linear", fill: "forwards" });
      move.animation = animation;
      try {
        await animation.finished;
        if (move.cancelled) return false;
        setMovingFaceRect(face, toRect);
        animation.cancel();
        if (move.animation === animation) move.animation = null;
        return true;
      } catch (error) {
        return false;
      }
    }
    
    function finishWrongThrow(move) {
      move.clones.forEach((clone) => clone.remove());
      move.clones.clear();
      if (activeWrongThrows.get(move.cardId) === move) activeWrongThrows.delete(move.cardId);
      const target = cardElement(move.cardId, move.locationKey);
      if (target) target.classList.remove("anim-target-hidden");
    }
    
    function cancelWrongThrow(move) {
      move.cancelled = true;
      cancelWrongThrowPenaltyMoves(move);
      if (move.animation) move.animation.cancel();
      finishWrongThrow(move);
    }
    
    function cancelAllWrongThrows() {
      Array.from(activeWrongThrows.values()).forEach(cancelWrongThrow);
    }
    
    async function animateWrongThrowIn(event, before, after) {
      if (!event || !event.card || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const sourceData = before.cards.get(event.cardId);
      const targetData = after.cards.get(event.cardId);
      const pileData = after.roles.get("pile-top") || after.locations.get("pile-top");
      const target = targetData ? cardElement(event.cardId, targetData.locationKey) : null;
      if (!sourceData || !targetData || !pileData || !target || !target.animate) return;
    
      const existing = activeWrongThrows.get(event.cardId);
      if (existing) cancelWrongThrow(existing);
      const move = {
        cardId: event.cardId,
        locationKey: targetData.locationKey,
        clones: new Set(),
        animation: null,
        afterShake: new Set(),
        shakeFinished: false,
        cancelled: false
      };
      activeWrongThrows.set(event.cardId, move);
      target.classList.add("anim-target-hidden");
    
      const backFace = movingFaceFromHtml(sourceData.html, sourceData.rect);
      const frontHtml = cardHtml(event.card, target.classList.contains("small"));
      if (!backFace) {
        finishWrongThrow(move);
        return;
      }
      move.clones.add(backFace);
      backFace.classList.add("wrong-throw-card");
    
      try {
        if (!await playWrongThrowPhase(move, backFace, [
          { transform: "scaleX(1)" },
          { transform: "scaleX(0)" }
        ], { duration: 130, easing: "linear" })) return;
        backFace.remove();
        move.clones.delete(backFace);
    
        const frontFace = movingFaceFromHtml(frontHtml, sourceData.rect);
        if (!frontFace) {
          finishWrongThrow(move);
          return;
        }
        move.clones.add(frontFace);
        frontFace.classList.add("wrong-throw-card");
        if (!await playWrongThrowPhase(move, frontFace, [
          { transform: "scaleX(0)" },
          { transform: "scaleX(1)" }
        ], { duration: 130, easing: "linear" })) return;
    
        if (!await playWrongThrowRectPhase(move, frontFace, sourceData.rect, pileData.rect, 320)) return;
    
        frontFace.classList.add("wrong-throw-shaking");
        const shakeFinished = await playWrongThrowPhase(move, frontFace, [
          { transform: "translateX(0)" },
          { transform: "translateX(-9px)" },
          { transform: "translateX(9px)" },
          { transform: "translateX(-7px)" },
          { transform: "translateX(7px)" },
          { transform: "translateX(0)" }
        ], { duration: 280, easing: "ease-in-out" });
        frontFace.classList.remove("wrong-throw-shaking");
        if (!shakeFinished) return;
        releaseWrongThrowPenaltyMoves(move);
    
        const latestTarget = cardElement(event.cardId, targetData.locationKey);
        const returnRect = latestTarget ? documentRect(latestTarget) : targetData.rect;
        if (!await playWrongThrowRectPhase(move, frontFace, pileData.rect, returnRect, 320)) return;
    
        if (!await playWrongThrowPhase(move, frontFace, [
          { transform: "scaleX(1)" },
          { transform: "scaleX(0)" }
        ], { duration: 130, easing: "linear" })) return;
        frontFace.remove();
        move.clones.delete(frontFace);
    
        const returnedCard = cardElement(event.cardId, targetData.locationKey);
        if (returnedCard) {
          returnedCard.classList.remove("anim-target-hidden");
          returnedCard.animate([
            { transform: "scaleX(0)" },
            { transform: "scaleX(1)" }
          ], { duration: 130, easing: "linear" });
        }
        finishWrongThrow(move);
      } catch (error) {
        cancelWrongThrow(move);
      }
    }
    
    function cardElement(cardId, locationKey) {
      const card = document.querySelector(`.card[data-card-id="${cssEscape(cardId)}"]`);
      if (!card) return null;
      return !locationKey || card.dataset.locationKey === locationKey ? card : null;
    }
    
    function hideActiveCardMoveTargets() {
      activeCardMoves.forEach((move) => {
        const target = cardElement(move.cardId, move.locationKey);
        if (target) target.classList.add('anim-target-hidden');
      });
      activeFaceTurns.forEach((turn) => {
        const target = cardElement(turn.cardId, turn.locationKey);
        if (target) target.classList.add('anim-target-hidden');
      });
      activeWrongThrows.forEach((move) => {
        const target = cardElement(move.cardId, move.locationKey);
        if (target) target.classList.add('anim-target-hidden');
      });
    }
    
    function finishCardMove(move) {
      move.clone.remove();
      if (activeCardMoves.get(move.cardId) !== move) return;
      activeCardMoves.delete(move.cardId);
      const target = cardElement(move.cardId, move.locationKey);
      if (target) target.classList.remove('anim-target-hidden');
      if (move.afterFinish) move.afterFinish();
    }
    
    function cancelCardMove(move) {
      move.animation.onfinish = null;
      move.animation.oncancel = null;
      move.animation.cancel();
      move.clone.remove();
      if (activeCardMoves.get(move.cardId) === move) activeCardMoves.delete(move.cardId);
    }
    
    function cancelAllCardMoves() {
      Array.from(activeCardMoves.values()).forEach(cancelCardMove);
    }
    
    function finishFaceTurn(turn) {
      turn.clones.forEach((clone) => clone.remove());
      turn.clones.clear();
      if (activeFaceTurns.get(turn.cardId) !== turn) return;
      activeFaceTurns.delete(turn.cardId);
      const target = cardElement(turn.cardId, turn.locationKey);
      if (target && !activeCardMoves.has(turn.cardId) && !activeWrongThrows.has(turn.cardId)) {
        target.classList.remove('anim-target-hidden');
      }
    }
    
    function cancelFaceTurn(turn) {
      turn.cancelled = true;
      if (turn.animation) {
        turn.animation.onfinish = null;
        turn.animation.oncancel = null;
        turn.animation.cancel();
      }
      finishFaceTurn(turn);
    }
    
    function cancelAllFaceTurns() {
      Array.from(activeFaceTurns.values()).forEach(cancelFaceTurn);
    }
    
    function elementAtRect(rect, locationKey) {
      if (locationKey) {
        const byLocation = document.querySelector(`.card[data-location-key="${cssEscape(locationKey)}"]`);
        if (byLocation) return byLocation;
      }
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const el = document.elementFromPoint(centerX - window.scrollX, centerY - window.scrollY);
      return el ? el.closest('.card') : null;
    }
    
    function animateFaceTurn(el, previousData, duration = 260, delay = 0, onMidpoint = null) {
      const halfDuration = duration / 2;
      if (!el.animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        if (onMidpoint) onMidpoint({ reducedMotion: true });
        return;
      }
    
      const rect = documentRect(el);
      const previousFace = movingFaceFromHtml(previousData && previousData.html, rect);
      if (!previousFace || !rect.width || !rect.height) {
        if (previousFace) previousFace.remove();
        if (onMidpoint) onMidpoint({ reducedMotion: true });
        el.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: halfDuration, delay, easing: "linear", fill: "backwards" });
        return;
      }
    
      const cardId = el.dataset.cardId || '';
      const locationKey = el.dataset.locationKey || '';
      const existingTurn = activeFaceTurns.get(cardId);
      if (existingTurn) cancelFaceTurn(existingTurn);
      const turn = {
        cardId,
        locationKey,
        clones: new Set([previousFace]),
        animation: null,
        cancelled: false,
        midpointSent: false
      };
      activeFaceTurns.set(cardId, turn);
      el.classList.add('anim-target-hidden');
    
      const revealNextFace = () => {
        if (turn.cancelled || activeFaceTurns.get(cardId) !== turn) return;
        previousFace.remove();
        turn.clones.delete(previousFace);
        if (!turn.midpointSent) {
          turn.midpointSent = true;
          if (onMidpoint) onMidpoint({ reducedMotion: false });
        }
        const target = cardElement(cardId, locationKey);
        if (!target) {
          finishFaceTurn(turn);
          return;
        }
        target.classList.add('anim-target-hidden');
        const latestRect = documentRect(target);
        const nextFace = movingFaceFromHtml(target.outerHTML, latestRect);
        if (!nextFace) {
          finishFaceTurn(turn);
          return;
        }
        turn.clones.add(nextFace);
        const nextAnimation = nextFace.animate([
          { transform: "scaleX(0)" },
          { transform: "scaleX(1)" }
        ], {
          duration: halfDuration,
          easing: "linear"
        });
        turn.animation = nextAnimation;
        nextAnimation.onfinish = () => finishFaceTurn(turn);
        nextAnimation.oncancel = () => {
          if (!turn.cancelled) finishFaceTurn(turn);
        };
      };
      const previousAnimation = previousFace.animate([
        { transform: "scaleX(1)" },
        { transform: "scaleX(0)" }
      ], {
        duration: halfDuration,
        delay,
        easing: "linear"
      });
      turn.animation = previousAnimation;
      previousAnimation.onfinish = revealNextFace;
      previousAnimation.oncancel = () => {
        if (!turn.cancelled) finishFaceTurn(turn);
      };
    }

    return {
      emptyAnimationSnapshot,
      captureAnimationSnapshot,
      animateStateTransition,
      animateJackSwapSelections,
      animateInitialDeal,
      hideActiveCardMoveTargets,
      cancelAllCardMoves,
      cancelAllWrongThrows,
      cancelAllFaceTurns,
      cancelAllReshuffles
    };
  }

  return { create };
});
