(function initClientRender(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DutchClientRender = api;
})(typeof window !== 'undefined' ? window : globalThis, function createClientRender() {
  function elementFromMarkup(document, markup) {
    const template = document.createElement('template');
    template.innerHTML = String(markup || '').trim();
    return template.content.firstElementChild;
  }

  function replaceIfChanged(current, fresh) {
    if (!current || !fresh || current.isEqualNode(fresh)) return false;
    current.replaceWith(fresh);
    return true;
  }

  function syncSelectControls(currentSettings, freshSettings) {
    const view = currentSettings.ownerDocument.defaultView;
    const escapeId = view.CSS && typeof view.CSS.escape === 'function'
      ? view.CSS.escape
      : (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    freshSettings.querySelectorAll('select[id]').forEach((freshSelect) => {
      const currentSelect = currentSettings.querySelector('#' + escapeId(freshSelect.id));
      if (!currentSelect) return;
      Array.from(freshSelect.options).forEach((freshOption, index) => {
        const currentOption = currentSelect.options[index];
        if (currentOption && currentOption.disabled !== freshOption.disabled) {
          currentOption.disabled = freshOption.disabled;
        }
      });
      if (currentSelect.disabled !== freshSelect.disabled) currentSelect.disabled = freshSelect.disabled;
      if (currentSelect.value !== freshSelect.value) currentSelect.value = freshSelect.value;
    });
  }

  function region(layout, key) {
    return layout.querySelector('[data-game-region="' + key + '"]');
  }

  function drawerMap(layout) {
    return new Map(Array.from(layout.querySelectorAll('.side-drawers > details[data-detail-key]')).map((drawer) => [
      drawer.dataset.detailKey,
      drawer
    ]));
  }

  function patchGameLayout(app, markup, activeSelect = null) {
    const currentLayout = app.querySelector(':scope > .main-layout');
    const freshLayout = elementFromMarkup(app.ownerDocument, markup);
    if (!currentLayout || !freshLayout || !freshLayout.classList.contains('main-layout')) {
      return { patched: false, changedRegions: [] };
    }

    const currentDrawers = drawerMap(currentLayout);
    const freshDrawers = drawerMap(freshLayout);
    if (
      currentDrawers.size !== freshDrawers.size ||
      Array.from(freshDrawers.keys()).some((key) => !currentDrawers.has(key))
    ) return { patched: false, changedRegions: [] };

    const changedRegions = [];
    for (const key of ['players', 'deck', 'user', 'status', 'repository']) {
      const current = region(currentLayout, key);
      const fresh = region(freshLayout, key);
      if (!!current !== !!fresh) return { patched: false, changedRegions: [] };
      if (replaceIfChanged(current, fresh)) changedRegions.push(key);
    }

    const activeSettings = activeSelect && activeSelect.isConnected
      ? activeSelect.closest('details[data-detail-key="settings"]')
      : null;
    freshDrawers.forEach((freshDrawer, key) => {
      const currentDrawer = currentDrawers.get(key);
      if (key === 'settings' && activeSettings === currentDrawer) {
        syncSelectControls(currentDrawer, freshDrawer);
        return;
      }
      if (replaceIfChanged(currentDrawer, freshDrawer)) changedRegions.push('drawer:' + key);
    });

    return { patched: true, changedRegions };
  }

  return { patchGameLayout };
});
