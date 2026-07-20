const test = require('node:test');
const assert = require('node:assert/strict');
const theme = require('../public/theme.js');

function browserWith(storedValue = null) {
  const values = new Map();
  if (storedValue !== null) values.set(theme.STORAGE_KEY, storedValue);
  return {
    document: { documentElement: { dataset: {} } },
    localStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value)
    },
    values
  };
}

test('stored dark theme is applied to the document', () => {
  const browser = browserWith('dark');
  assert.equal(theme.applyStoredTheme(browser), 'dark');
  assert.equal(browser.document.documentElement.dataset.theme, 'dark');
});

test('setting a theme applies and persists it', () => {
  const browser = browserWith();
  assert.equal(theme.setTheme('dark', browser), 'dark');
  assert.equal(browser.document.documentElement.dataset.theme, 'dark');
  assert.equal(browser.values.get(theme.STORAGE_KEY), 'dark');
});

test('unknown stored themes fall back to light mode', () => {
  const browser = browserWith('sepia');
  assert.equal(theme.applyStoredTheme(browser), 'light');
  assert.equal(browser.document.documentElement.dataset.theme, 'light');
});
