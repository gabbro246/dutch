(function initDutchTheme(root, factory) {
  const theme = factory();
  if (typeof module === 'object' && module.exports) module.exports = theme;
  if (root) {
    root.DutchTheme = theme;
    theme.applyStoredTheme(root);
  }
})(typeof window !== 'undefined' ? window : null, function createDutchTheme() {
  const STORAGE_KEY = 'dutchColorTheme';
  const DEFAULT_THEME = 'light';
  const THEMES = new Set(['light', 'dark']);

  function normalizeTheme(value) {
    return THEMES.has(value) ? value : DEFAULT_THEME;
  }

  function getStoredTheme(target) {
    try {
      return normalizeTheme(target.localStorage.getItem(STORAGE_KEY));
    } catch (error) {
      return DEFAULT_THEME;
    }
  }

  function applyTheme(value, target) {
    const selectedTheme = normalizeTheme(value);
    if (target && target.document && target.document.documentElement) {
      target.document.documentElement.dataset.theme = selectedTheme;
    }
    return selectedTheme;
  }

  function applyStoredTheme(target) {
    return applyTheme(getStoredTheme(target), target);
  }

  function setTheme(value, target) {
    const selectedTheme = applyTheme(value, target);
    try {
      target.localStorage.setItem(STORAGE_KEY, selectedTheme);
    } catch (error) {
      // The selection still applies for this page when storage is unavailable.
    }
    return selectedTheme;
  }

  return {
    STORAGE_KEY,
    normalizeTheme,
    getStoredTheme,
    applyStoredTheme,
    setTheme
  };
});
