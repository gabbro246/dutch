const test = require('node:test');
const assert = require('node:assert/strict');

test('waiting-room settings hide advanced controls behind Show more', () => {
  const listeners = {};
  let toggle = null;
  const app = {};
  Object.defineProperty(app, 'innerHTML', {
    get() { return this.html || ''; },
    set(value) {
      this.html = value;
      toggle = value.includes('id="waitingSettingsToggle"')
        ? { addEventListener(type, listener) { listeners[type] = listener; } }
        : null;
    }
  });

  global.document = {
    getElementById(id) {
      return id === 'waitingSettingsToggle' ? toggle : null;
    },
    querySelectorAll() {
      return [];
    }
  };
  global.DutchTheme = { getStoredTheme: () => 'light' };

  const waiting = require('../public/client-waiting.js').create({
    app,
    translate: (key) => key,
    getLanguage: () => 'en',
    escapeHtml: (value) => String(value),
    i18n: {
      localizedBotPersonality(language, type) {
        return type === 'dory' ? { stats: [], summary: '' } : null;
      }
    },
    botLabels: { dory: 'Dory', norman: 'Norman', athena: 'Athena', roswell: 'Roswell' },
    botPersonalities: { dory: { stats: [], summary: '' } },
    playerNameMaxLength: 20,
    gameDescription: 'Description',
    playerNameHtml: () => '',
    helpDisclosureHtml: (id, label) => '<span>' + label + '</span>',
    inactivityTimeoutSettingHtml: (state, id, advanced, expanded) =>
      '<div data-setting="inactivity" class="' + (advanced ? 'advanced-setting' : '') + '" ' + (advanced && !expanded ? 'hidden' : '') + '></div>',
    botTimingSettingHtml: (state, id, advanced, expanded) =>
      '<div data-setting="bot-speed" class="' + (advanced ? 'advanced-setting' : '') + '" ' + (advanced && !expanded ? 'hidden' : '') + '></div>',
    languageSettingHtml: () => '<div>Language</div>',
    soundSettingHtml: () => '<div>Sound</div>',
    shortInstructions: () => '',
    fullRules: () => '',
    repoLink: () => '',
    canJoinWithName: () => false,
    clientActions: { clearPendingConfirm() {}, confirmThen() {} },
    rememberUserName() {},
    rememberUserTokenBackup() {},
    userToken: 'token',
    emit() {},
    wireHelpDisclosures() {},
    wireAnimatedDrawers() {},
    wireInactivityTimeoutSelect() {},
    wireBotTimingSelect() {},
    wireLanguageSelect() {},
    wireSoundSelect() {}
  });

  waiting.renderWaiting({
    players: [],
    joined: false,
    canStart: false,
    user: '',
    deckSetting: 'one',
    gameTarget: 100,
    version: 'test'
  });

  assert.match(app.innerHTML, /data-setting="inactivity"[^>]+hidden/);
  assert.match(app.innerHTML, /data-setting="bot-speed"[^>]+hidden/);
  assert.match(app.innerHTML, /class="setting-row advanced-setting" hidden/);
  assert.match(app.innerHTML, /id="waitingSettingsToggle" aria-expanded="false">\s*Show more/);

  listeners.click();

  assert.doesNotMatch(app.innerHTML, /data-setting="inactivity"[^>]+hidden/);
  assert.doesNotMatch(app.innerHTML, /data-setting="bot-speed"[^>]+hidden/);
  assert.match(app.innerHTML, /id="waitingSettingsToggle" aria-expanded="true">\s*Show less/);

  delete global.document;
  delete global.DutchTheme;
});
