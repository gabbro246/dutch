const test = require('node:test');
const assert = require('node:assert/strict');
const theme = require('../public/theme.js');

function browserWith(storedValue = null) {
  const values = new Map();
  if (storedValue !== null) values.set(theme.STORAGE_KEY, storedValue);
  const themeColorMeta = {
    content: '',
    setAttribute(name, value) {
      if (name === 'content') this.content = value;
    }
  };
  return {
    document: {
      documentElement: { dataset: {} },
      querySelector: (selector) => selector === 'meta[name="theme-color"]' ? themeColorMeta : null
    },
    localStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value)
    },
    values,
    themeColorMeta
  };
}

test('stored dark theme is applied to the document', () => {
  const browser = browserWith('dark');
  assert.equal(theme.applyStoredTheme(browser), 'dark');
  assert.equal(browser.document.documentElement.dataset.theme, 'dark');
  assert.equal(browser.themeColorMeta.content, '#000000');
});

test('setting a theme applies and persists it', () => {
  const browser = browserWith();
  assert.equal(theme.setTheme('dark', browser), 'dark');
  assert.equal(browser.document.documentElement.dataset.theme, 'dark');
  assert.equal(browser.values.get(theme.STORAGE_KEY), 'dark');
  assert.equal(browser.themeColorMeta.content, '#000000');
});

test('unknown stored themes fall back to light mode', () => {
  const browser = browserWith('sepia');
  assert.equal(theme.applyStoredTheme(browser), 'light');
  assert.equal(browser.document.documentElement.dataset.theme, 'light');
  assert.equal(browser.themeColorMeta.content, '#f6f7f9');
});
