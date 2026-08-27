(function initClientActions(root) {
  function createClientActions(deps) {
    let pendingConfirm = null;
    let pointerTrackingWired = false;
    const document = deps.document || root.document;
    const wiredButtons = new WeakSet();
    const handledPointerButtons = new WeakSet();
    const pendingPointerActions = new Map();

    function clearPendingConfirm() {
      if (!pendingConfirm) return;
      root.clearTimeout(pendingConfirm.timer);
      if (pendingConfirm.button && pendingConfirm.button.isConnected) pendingConfirm.button.innerHTML = pendingConfirm.label;
      pendingConfirm = null;
    }

    function confirmThen(button, key, label, callback) {
      if (!button || button.disabled) return;
      if (pendingConfirm && pendingConfirm.key === key) {
        clearPendingConfirm();
        callback();
        return;
      }
      clearPendingConfirm();
      pendingConfirm = {
        key,
        button,
        label: button.innerHTML,
        timer: root.setTimeout(clearPendingConfirm, 3500)
      };
      button.innerHTML = deps.escapeHtml(label);
    }

    function pointerIsInside(rect, event) {
      if (!rect || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return true;
      return event.clientX >= rect.left && event.clientX <= rect.right
        && event.clientY >= rect.top && event.clientY <= rect.bottom;
    }

    function wirePointerTracking() {
      if (pointerTrackingWired || !document || typeof document.addEventListener !== 'function') return;
      pointerTrackingWired = true;
      document.addEventListener('pointerdown', (event) => {
        if (event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;
        const button = event.target && typeof event.target.closest === 'function'
          ? event.target.closest('[data-action]')
          : null;
        if (!button || button.disabled || !wiredButtons.has(button)) return;
        pendingPointerActions.set(event.pointerId, {
          button,
          rect: typeof button.getBoundingClientRect === 'function' ? button.getBoundingClientRect() : null
        });
      }, true);
      document.addEventListener('pointerup', (event) => {
        const pending = pendingPointerActions.get(event.pointerId);
        if (!pending) return;
        pendingPointerActions.delete(event.pointerId);
        if (!pointerIsInside(pending.rect, event)) return;

        pending.button.click();
        handledPointerButtons.add(pending.button);
      }, true);
      document.addEventListener('pointercancel', (event) => {
        pendingPointerActions.delete(event.pointerId);
      }, true);
    }

    function wireGameButtons() {
      wirePointerTracking();
      const detailsMode = deps.getDetailsMode();
      deps.wireAnimatedDrawers(document, (details, open) => {
        if (!details.dataset.detailKey) return;
        const preferences = deps.detailPreferencesByMode;
        if (!preferences[detailsMode]) preferences[detailsMode] = {};
        preferences[detailsMode][details.dataset.detailKey] = open;
      });
      document.querySelectorAll('[data-action]').forEach((button) => {
        if (wiredButtons.has(button)) return;
        wiredButtons.add(button);
        button.addEventListener('click', (event) => {
          if (handledPointerButtons.delete(button)) {
            event.preventDefault();
            return;
          }
          const action = button.dataset.action;
          if (action === 'toggleLog') {
            deps.setLogExpanded(!deps.getLogExpanded());
            const state = deps.getLastState();
            if (state) deps.render(state);
            return;
          }
          if (action === 'toggleSettingsMore') {
            deps.setSettingsExpanded(!deps.getSettingsExpanded());
            const state = deps.getLastState();
            if (state) deps.render(state);
            return;
          }
          if (action === 'downloadLog') {
            deps.downloadLogFile(deps.getLastState());
            return;
          }
          const cardId = button.dataset.cardId;
          const run = () => {
            if (action === 'aceAdd') {
              deps.emit('aceAdd', button.dataset.playerId || '');
              return;
            }
            if (cardId) deps.emit(action, cardId);
            else deps.emit(action);
          };
          if (action === 'leave') {
            confirmThen(button, 'leave-game', deps.translate ? deps.translate('Confirm leave') : 'Confirm leave', run);
            return;
          }
          if (action === 'endGameForAll') {
            confirmThen(button, 'end-game-for-all', deps.translate ? deps.translate('Confirm end game') : 'Confirm end game', run);
            return;
          }
          clearPendingConfirm();
          run();
        });
      });
    }

    return {
      clearPendingConfirm,
      confirmThen,
      wireGameButtons
    };
  }

  root.DutchClientActions = { create: createClientActions };
})(window);
