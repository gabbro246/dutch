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
  assert.equal(i18n.translate('de', 'No bots left'), 'Keine Bots übrig');
  assert.equal(i18n.translate('de', 'Double game, 200 points'), 'Doppeltes Spiel, 200 Punkte');
  assert.equal(i18n.translate('de', 'Five rounds'), 'Fünf Runden');
  assert.equal(i18n.translate('de', 'Sound effects'), 'Soundeffekte');
  assert.equal(i18n.translate('de', 'Bot speed'), 'Bot-Geschwindigkeit');
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
  assert.match(i18n.fullRulesHtml('de', 100, false, 5), /fünften Runde/);
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
    i18n.translateGameText('de', 'Ada changed game length from single round to five rounds'),
    'Ada hat die Spieldauer von einer Runde auf fünf Runden geändert'
  );
  assert.equal(
    i18n.translateGameText('de', 'Ben changed inactivity timeout from 15 to 90 minutes'),
    'Ben hat die Inaktivitätsgrenze von 15 auf 90 Minuten geändert'
  );
  assert.equal(
    i18n.translateGameText('de', 'Ada changed bot timing from 50% to 25%'),
    'Ada hat die Bot-Wartezeit von 50% auf 25% geändert'
  );
  assert.equal(
    i18n.translateGameText('de', 'Ada changed bot speed from Medium to Fast'),
    'Ada hat die Bot-Geschwindigkeit von Mittel auf Schnell geändert'
  );
  assert.equal(
    i18n.translateGameText('de', 'Ben turned changed-card highlighting off'),
    'Ben hat das Hervorheben geänderter Karten ausgeschaltet'
  );
});

test('language preference persists Russian and normalizes regional locale tags', () => {
  const target = fakeWindow();
  assert.equal(i18n.normalizeLanguage('ru-RU'), 'ru');
  assert.equal(i18n.setLanguage('ru', target), 'ru');
  assert.equal(i18n.getStoredLanguage(target), 'ru');
  assert.equal(target.document.documentElement.lang, 'ru');
});

test('Russian translations cover dynamic UI text and compact card controls', () => {
  assert.equal(i18n.translate('ru', 'Bot speed'), 'Скорость ботов');
  assert.equal(i18n.translate('ru', 'Join'), 'Войти');
  assert.equal(i18n.translate('ru', 'Russian'), 'Русский');
  assert.equal(i18n.translate('de', 'Russian'), 'Russisch');
  assert.equal(i18n.translate('ru', 'No bots left'), 'Ботов не осталось');
  assert.equal(i18n.translate('ru', 'Sound effects'), 'Звуковые эффекты');
  assert.equal(i18n.translate('ru', 'Five rounds'), 'Пять раундов');
  assert.equal(
    i18n.translate('ru', 'Round {number}', { number: 3 }),
    'Раунд 3'
  );
  assert.equal(i18n.specialLabel('ru', 'Q'), 'Дама: смотреть');
  for (const label of ['Peek', 'Swap', 'Throw in', 'add', 'peek', 'swap']) {
    assert.ok(i18n.translate('ru', label).length <= 7);
  }
});

test('Russian rules, bot descriptions, and game text are localized', () => {
  assert.match(i18n.quickRulesHtml('ru'), /Цель:/);
  assert.match(i18n.quickRulesHtml('ru'), /<span class="red-card-value">♥♦K=0<\/span>/);
  assert.match(i18n.fullRulesHtml('ru', 100, false), /больше 100 очков/);
  assert.match(i18n.fullRulesHtml('ru', 100, false, 5), /пятого раунда/);
  const fallback = {
    summary: 'English summary',
    stats: [['Memory', 5], ['Pace', 4], ['Risk', 3], ['Pressure', 2], ['Discipline', 1]]
  };
  const personality = i18n.localizedBotPersonality('ru', 'athena', fallback);
  assert.match(personality.summary, /запоминает карты/);
  assert.deepEqual(personality.stats.map((stat) => stat[0]), ['Память', 'Темп', 'Риск', 'Напор', 'Дисциплина']);
  assert.equal(i18n.translateGameText('ru', 'Ada said Dutch'), 'Ada объявляет Dutch');
  assert.equal(
    i18n.translateGameText('ru', 'Ada changed game length from 100 points to single round'),
    'Ada меняет длину игры: 100 очков → один раунд'
  );
  assert.equal(
    i18n.translateGameText('ru', 'Ada changed bot timing from 50% to 25%'),
    'Ada меняет время ожидания ботов: 50% → 25%'
  );
  assert.equal(
    i18n.translateGameText('ru', 'Ada changed bot speed from Medium to Fast'),
    'Ada меняет скорость ботов: Средне → Быстро'
  );
  assert.equal(
    i18n.translateGameText('ru', 'Ben changed inactivity timeout from 15 to 90 minutes'),
    'Ben меняет время до завершения при бездействии: 15 → 90 мин.'
  );
  assert.equal(
    i18n.translateGameText('ru', 'Ben turned changed-card highlighting off'),
    'Ben выключает подсветку изменённых карт'
  );
  assert.equal(
    i18n.translateGameText('ru', 'round ended. Ada gained 5 points'),
    'Раунд завершён. Ada получает 5 очк.'
  );
});
