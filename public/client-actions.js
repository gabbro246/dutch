(function initClientActions(root) {
  function createClientActions(deps) {
    let pendingConfirm = null;
    const wiredButtons = new WeakSet();

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

    function wireGameButtons() {
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
        button.addEventListener('click', () => {
          const action = button.dataset.action;
          if (action === 'toggleLog') {
            deps.setLogExpanded(!deps.getLogExpanded());
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
