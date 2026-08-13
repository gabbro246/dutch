const test = require('node:test');
const assert = require('node:assert/strict');
const i18n = require('../public/i18n.js');

function fakeWindow() {
  const values = new Map();
  return {
    localStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value)
    },
    document: { documentElement: { lang: '' } }
  };
}

test('language preference defaults to English and persists German', () => {
  const target = fakeWindow();
  assert.equal(i18n.getStoredLanguage(target), 'en');
  assert.equal(i18n.setLanguage('de', target), 'de');
  assert.equal(i18n.getStoredLanguage(target), 'de');
  assert.equal(target.document.documentElement.lang, 'de');
});

test('German translations interpolate dynamic UI text', () => {
  assert.equal(i18n.translate('en', 'Join'), 'Join');
  assert.equal(i18n.translate('de', 'Join'), 'Beitreten');
  assert.equal(i18n.translate('de', 'Show help'), 'Hilfe anzeigen');
  assert.equal(i18n.translate('de', 'Double game, 200 points'), 'Doppeltes Spiel, 200 Punkte');
  assert.equal(
    i18n.translate('de', 'Round {number}', { number: 3 }),
    'Runde 3'
  );
  assert.equal(i18n.specialLabel('de', 'Q'), 'Dame: Karte ansehen');
  assert.equal(i18n.translate('de', 'Last chance to throw in…'), 'Letzte Chance zum Einwerfen …');
});

test('German card labels remain compact for fixed-width controls', () => {
  for (const label of ['Peek', 'Swap', 'Throw in', 'add', 'peek', 'swap']) {
    assert.ok(i18n.translate('de', label).length <= 7);
  }
});

test('German rules and server-originated game text are localized', () => {
  assert.match(i18n.quickRulesHtml('de'), /Ziel:/);
  assert.match(i18n.quickRulesHtml('de'), /<span class="red-card-value">♥♦K=0<\/span>/);
  assert.match(i18n.fullRulesHtml('de', 100, false), /mehr als 100 Punkte/);
  assert.equal(i18n.translateGameText('de', 'Ada said Dutch'), 'Ada hat Dutch gesagt');
  assert.equal(
    i18n.translateGameText('de', 'Ada changed game length from 100 points to single round'),
    'Ada hat die Spieldauer von 100 Punkten auf eine Runde geändert'
  );
  assert.equal(
    i18n.translateGameText('de', 'Ada changed game length from single round to 50 points'),
    'Ada hat die Spieldauer von einer Runde auf 50 Punkte geändert'
  );
  assert.equal(
    i18n.translateGameText('de', 'Ben changed inactivity timeout from 15 to 90 minutes'),
    'Ben hat die Inaktivitätsgrenze von 15 auf 90 Minuten geändert'
  );
  assert.equal(
    i18n.translateGameText('de', 'Ben turned changed-card highlighting off'),
    'Ben hat das Hervorheben geänderter Karten ausgeschaltet'
  );
});
