(function initClientUiAnimations(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DutchClientUiAnimations = api;
})(typeof window !== 'undefined' ? window : globalThis, function createClientUiAnimations(root) {
  const RIGHT_PANEL_SCROLL_TARGETS = [
    ['side-area', '.side-area'],
    ['status-info', '.side-status-card .status-info'],
    ['score-scroll', '.score-scroll']
  ];
  const CONFETTI_COLORS = [
    'var(--game-winner-border)',
    'var(--winner-border)',
    'var(--accent-color)',
    'var(--current-border)',
    'var(--chart-color-3)'
  ];
  const CONFETTI_PIECE_COUNT = 40;

  function create(deps) {
    const window = root;
    const document = root.document;
    const Element = root.Element;
    const wiredAnimatedDrawers = new WeakSet();
    const getLastState = deps.getLastState;
    const render = deps.render;
    const random = deps.random || Math.random;
    const schedule = deps.schedule || window.setTimeout.bind(window);

    function cssEscape(value) {
      if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
      return String(value).replace(/"/g, '\\"');
    }

    function wireAnimatedDrawers(scope, onChange) {
      scope.querySelectorAll("details.drawer").forEach((details) => {
        const summary = details.querySelector(":scope > summary");
        const content = details.querySelector(":scope > .drawer-animation-content");
        if (!summary || !content) return;
        if (wiredAnimatedDrawers.has(details)) return;
        wiredAnimatedDrawers.add(details);
    
        let animation = null;
        let targetOpen = details.open;
    
        summary.addEventListener("click", (event) => {
          event.preventDefault();
          targetOpen = animation ? !targetOpen : !details.open;
          if (typeof onChange === "function") onChange(details, targetOpen);
          if (targetOpen && details.dataset.lazyContent === 'true') {
            details.open = true;
            const state = getLastState();
            if (state) render(state);
            return;
          }
    
          const runningHeight = animation ? content.getBoundingClientRect().height : null;
          const runningOpacity = animation ? Number.parseFloat(getComputedStyle(content).opacity) : null;
          if (animation) animation.cancel();
          if (!content.animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            details.open = targetOpen;
            content.removeAttribute("style");
            animation = null;
            return;
          }
    
          if (targetOpen) details.open = true;
          const startHeight = runningHeight === null
            ? (targetOpen ? 0 : content.getBoundingClientRect().height)
            : runningHeight;
          const startOpacity = runningOpacity === null ? (targetOpen ? 0 : 1) : runningOpacity;
          const endHeight = targetOpen ? content.scrollHeight : 0;
          content.style.overflow = "hidden";
    
          const currentAnimation = content.animate([
            { height: `${startHeight}px`, opacity: startOpacity },
            { height: `${endHeight}px`, opacity: targetOpen ? 1 : 0 }
          ], {
            duration: 220,
            easing: targetOpen ? "cubic-bezier(0.2, 0.8, 0.2, 1)" : "cubic-bezier(0.4, 0, 1, 1)"
          });
          animation = currentAnimation;
    
          currentAnimation.onfinish = () => {
            if (animation !== currentAnimation) return;
            details.open = targetOpen;
            content.removeAttribute("style");
            animation = null;
          };
          currentAnimation.oncancel = () => {
            if (animation === currentAnimation) animation = null;
          };
        });
      });
    }
    
    function captureDrawerTransitions() {
      const transitions = new Map();
      document.querySelectorAll('details.drawer[data-detail-key]').forEach((details) => {
        const content = details.querySelector(':scope > .drawer-animation-content');
        if (!content) return;
        transitions.set(details.dataset.detailKey, {
          open: details.open,
          height: details.open ? content.getBoundingClientRect().height : 0
        });
      });
      return transitions;
    }
    
    function animateDrawerTransitions(transitions) {
      if (!transitions.size || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    
      document.querySelectorAll('details.drawer[data-detail-key]').forEach((details) => {
        const content = details.querySelector(':scope > .drawer-animation-content');
        const previous = transitions.get(details.dataset.detailKey);
        if (!content || !content.animate || !previous || previous.open === details.open) return;
    
        const targetOpen = details.open;
        if (!targetOpen) details.open = true;
        const startHeight = targetOpen ? 0 : previous.height;
        const endHeight = targetOpen ? content.scrollHeight : 0;
        content.style.overflow = 'hidden';
    
        const animation = content.animate([
          { height: `${startHeight}px`, opacity: targetOpen ? 0 : 1 },
          { height: `${endHeight}px`, opacity: targetOpen ? 1 : 0 }
        ], {
          duration: 220,
          easing: targetOpen ? 'cubic-bezier(0.2, 0.8, 0.2, 1)' : 'cubic-bezier(0.4, 0, 1, 1)'
        });
    
        animation.onfinish = () => {
          details.open = targetOpen;
          content.removeAttribute('style');
        };
      });
    }
    
    function animateWaitingPlayerListChanges(previousState, state, before, after) {
      if (previousState.phase !== 'waiting' || !Element.prototype.animate) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const previousIds = new Set((previousState.players || []).map((player) => player.id));
      const currentIds = new Set((state.players || []).map((player) => player.id));
      const enterEasing = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
      const exitEasing = 'cubic-bezier(0.8, 0, 0.8, 0.2)';
      const isRemoving = (previousState.players || []).some((player) => !currentIds.has(player.id));
      (state.players || []).forEach((player) => {
        const selector = '[data-waiting-player-id="' + cssEscape(player.id) + '"]';
        const row = document.querySelector(selector);
        if (!row) return;
        if (previousIds.has(player.id)) {
          if (isRemoving) return;
          const previousRect = before.waitingPlayers.get(player.id);
          const currentRect = after.waitingPlayers.get(player.id);
          if (!previousRect || !currentRect) return;
          const deltaX = previousRect.left - currentRect.left;
          const deltaY = previousRect.top - currentRect.top;
          if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;
          row.animate([
            { transform: 'translate(' + String(deltaX) + 'px, ' + String(deltaY) + 'px)' },
            { transform: 'translate(0, 0)' }
          ], {
            duration: 280,
            easing: isRemoving ? exitEasing : enterEasing
          });
          return;
        }
        const height = row.getBoundingClientRect().height;
        if (!height) return;
        row.style.overflow = 'hidden';
        const animation = row.animate([
          { height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0, transform: 'translateY(-8px)' },
          { height: String(height) + 'px', paddingTop: '4px', paddingBottom: '4px', opacity: 1, transform: 'translateY(0)' }
        ], {
          duration: 280,
          easing: enterEasing
        });
        const finish = () => row.style.removeProperty('overflow');
        animation.onfinish = finish;
        animation.oncancel = finish;
      });
      const waitingList = document.querySelector('.waiting-player-list');
      if (!waitingList) return;
      (previousState.players || []).forEach((player, index) => {
        if (currentIds.has(player.id)) return;
        const previousData = before.waitingPlayers.get(player.id);
        if (!previousData || !previousData.html) return;
        const template = document.createElement('template');
        template.innerHTML = previousData.html.trim();
        const ghost = template.content.firstElementChild;
        if (!ghost) return;
        ghost.removeAttribute('data-waiting-player-id');
        ghost.setAttribute('aria-hidden', 'true');
        ghost.style.height = String(previousData.height) + 'px';
        ghost.style.overflow = 'hidden';
        ghost.style.pointerEvents = 'none';
        const nextPlayer = (previousState.players || []).slice(index + 1).find((candidate) => currentIds.has(candidate.id));
        const nextSelector = nextPlayer ? '[data-waiting-player-id="' + cssEscape(nextPlayer.id) + '"]' : '';
        const nextRow = nextSelector ? waitingList.querySelector(nextSelector) : null;
        const hint = waitingList.querySelector('.hint');
        waitingList.insertBefore(ghost, nextRow || hint || null);
        const animation = ghost.animate([
          { height: String(previousData.height) + 'px', paddingTop: '4px', paddingBottom: '4px', opacity: 1, transform: 'translateY(0)' },
          { height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0, transform: 'translateY(-8px)' }
        ], {
          duration: 280,
          easing: exitEasing,
          fill: 'forwards'
        });
        animation.onfinish = () => ghost.remove();
        animation.oncancel = () => ghost.remove();
      });
    }
    
    function captureRightPanelScroll() {
      return RIGHT_PANEL_SCROLL_TARGETS.reduce((snapshot, [key, selector]) => {
        const element = document.querySelector(selector);
        if (element) snapshot[key] = { top: element.scrollTop, left: element.scrollLeft };
        return snapshot;
      }, {});
    }
    
    function restoreRightPanelScroll(snapshot) {
      RIGHT_PANEL_SCROLL_TARGETS.forEach(([key, selector]) => {
        const position = snapshot[key];
        const element = position ? document.querySelector(selector) : null;
        if (!element) return;
        element.scrollTop = position.top;
        element.scrollLeft = position.left;
      });
    }

    function visibleWinnerIds(state) {
      if (!state || state.phase !== 'playing' || !state.round) return [];
      if (state.round.stage !== 'gameEnd' || !state.round.winnerId) return [];
      return [String(state.round.winnerId)];
    }

    function launchWinnerConfetti(panel) {
      const rect = panel.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const layer = document.createElement('div');
      layer.className = 'winner-confetti-layer';
      layer.setAttribute('aria-hidden', 'true');
      const host = document.getElementById('app') || document.body;
      panel.classList.add('winner-confetti-origin');
      host.appendChild(layer);

      const originX = rect.left + rect.width / 2;
      const originY = rect.top + rect.height * 0.66;
      const nearViewportTop = rect.top < Math.max(80, rect.height * 0.75);
      const animations = [];
      for (let index = 0; index < CONFETTI_PIECE_COUNT; index += 1) {
        const piece = document.createElement('i');
        const square = index % 5 === 0;
        const width = square ? 7 : 6 + Math.round(random());
        const height = square ? 7 : 10 + Math.round(random() * 3);
        const direction = index % 2 === 0 ? -1 : 1;
        const minimumSpread = nearViewportTop ? 0.3 : 0.12;
        const variableSpread = nearViewportTop ? 0.65 : 0.63;
        const spreadX = direction * rect.width * (minimumSpread + random() * variableSpread);
        const rise = rect.height * (0.65 + random() * 0.75);
        const unconstrainedDriftY = rise * (0.82 + random() * 0.18);
        const visibleRiseLimit = Math.max(rect.height * 0.35, originY - 12);
        const driftY = nearViewportTop
          ? Math.min(unconstrainedDriftY, visibleRiseLimit)
          : unconstrainedDriftY;
        const startRotation = random() * 180;
        const endRotation = startRotation + (random() < 0.5 ? -1 : 1) * (360 + random() * 720);
        const flightDuration = 1180 + random() * 320;
        const duration = flightDuration * 3;

        piece.className = 'winner-confetti-piece';
        piece.style.left = String(originX - width / 2) + 'px';
        piece.style.top = String(originY - height / 2) + 'px';
        piece.style.width = String(width) + 'px';
        piece.style.height = String(height) + 'px';
        piece.style.background = CONFETTI_COLORS[index % CONFETTI_COLORS.length];
        layer.appendChild(piece);

        animations.push(piece.animate([
          { transform: 'translate(0, 0) rotate(' + String(startRotation) + 'deg)', opacity: 0 },
          { transform: 'translate(' + String(spreadX * 0.12) + 'px, ' + String(-driftY * 0.18) + 'px) rotate(' + String(startRotation + 90) + 'deg)', opacity: 1, offset: 0.053 },
          { transform: 'translate(' + String(spreadX) + 'px, ' + String(-driftY) + 'px) rotate(' + String(endRotation) + 'deg)', opacity: 1, offset: 0.24, easing: 'linear' },
          { transform: 'translate(' + String(spreadX * 1.1) + 'px, ' + String(-driftY + rise * 0.45) + 'px) rotate(' + String(endRotation + 180) + 'deg)', opacity: 0 }
        ], {
          duration,
          easing: 'cubic-bezier(0.18, 0.7, 0.3, 1)',
          fill: 'forwards'
        }));
      }

      const removeLayer = () => {
        layer.remove();
        panel.classList.remove('winner-confetti-origin');
      };
      Promise.allSettled(animations.map((animation) => animation.finished)).then(removeLayer);
      schedule(removeLayer, 4700);
    }

    function animateWinnerConfetti(previousState, state) {
      if (!Element.prototype.animate) return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const previousWinnerIds = new Set(visibleWinnerIds(previousState));
      visibleWinnerIds(state).forEach((winnerId) => {
        if (previousWinnerIds.has(winnerId)) return;
        const selector = '[data-player-panel-id="' + cssEscape(winnerId) + '"]';
        const panel = document.querySelector(selector);
        if (panel) launchWinnerConfetti(panel);
      });
    }

    return {
      wireAnimatedDrawers,
      captureDrawerTransitions,
      animateDrawerTransitions,
      animateWaitingPlayerListChanges,
      animateWinnerConfetti,
      captureRightPanelScroll,
      restoreRightPanelScroll
    };
  }

  return { create };
});
