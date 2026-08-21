const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function storage(values = {}) {
  const entries = new Map(Object.entries(values));
  return {
    getItem: (key) => entries.get(key) || null,
    setItem: (key, value) => entries.set(key, String(value))
  };
}

function loadClient({ token, tabId, storedName = '' }) {
  const elements = {};
  const app = {
    set innerHTML(markup) {
      this.markup = markup;
      const input = markup.match(/id="rejoinNameInput"[^>]*value="([^"]*)"/);
      const button = markup.match(/<button id="rejoinBtn"[^>]*>/);
      if (input) {
        elements.rejoinNameInput = {
          value: input[1],
          addEventListener() {}
        };
      }
      if (button) {
        elements.rejoinBtn = {
          disabled: /\sdisabled(?:\s|>)/.test(button[0]),
          addEventListener() {}
        };
      }
    },
    get innerHTML() {
      return this.markup || '';
    }
  };
  const socket = {
    connected: true,
    on() {},
    emit() {},
    connect() {}
  };
  const noop = () => {};
  const context = {
    io: () => socket,
    alert: noop,
    document: {
      querySelectorAll: () => [],
      getElementById(id) {
        return id === 'app' ? app : elements[id] || null;
      },
      addEventListener: noop
    }
  };
  context.window = {
    name: '',
    crypto: { randomUUID: () => 'generated-token' },
    sessionStorage: storage({
      dutchPlayerSessionToken: token,
      dutchPlayerTabId: tabId
    }),
    localStorage: storage({ dutchPlayerName: storedName }),
    DutchTheme: {
      getStoredTheme: () => 'light',
      setTheme: noop
    },
    DutchI18n: {
      getStoredLanguage: () => 'en',
      setLanguage: noop,
      translate: (language, key) => key,
      translateGameText: (language, value) => value
    },
    DutchShared: {
      PLAYER_NAME_MAX_LENGTH: 24,
      GAME_DESCRIPTION: 'Description',
      BOT_SPEED_OPTIONS: [],
      BOT_LABELS: {},
      BOT_PERSONALITIES: {},
      normalizedShortPlayerName: (name) => String(name || '').trim().toLowerCase(),
      quickRulesHtml: () => '<p><strong>Goal:</strong> Fewest points.</p>',
      fullRulesHtml: () => '<p>Dutch is a card game.</p>'
    },
    DutchClientCardAnimations: {
      create: () => ({
        emptyAnimationSnapshot: () => ({}),
        captureAnimationSnapshot: () => ({}),
        animateStateTransition: noop,
        hideActiveCardMoveTargets: noop,
        cancelAllCardMoves: noop,
        cancelAllWrongThrows: noop,
        cancelAllFaceTurns: noop
      })
    },
    DutchClientUiAnimations: {
      create: () => ({
        wireAnimatedDrawers: noop,
        captureDrawerTransitions: () => ({}),
        animateDrawerTransitions: noop,
        animateWaitingPlayerListChanges: noop,
        animateWinnerConfetti: noop,
        captureRightPanelScroll: () => 0,
        restoreRightPanelScroll: noop
      })
    },
    DutchClientActions: { create: () => ({}) },
    DutchClientSettings: require('../public/client-settings.js'),
    DutchClientWaiting: { create: () => ({ renderWaiting: noop }) },
    DutchClientSounds: {
      create: () => ({
        isEnabled: () => true,
        setEnabled: noop,
        unlock: noop,
        handleStateTransition: noop
      })
    },
    DutchSelectInteraction: {
      create: () => ({ current: () => null, release: noop, releaseIfOutside: noop, wire: noop })
    },
    DutchClientState: {
      mergeIncrementalState: (previous, state) => state,
      cardAnimationSignature: () => ''
    },
    DutchClientRender: { patchGameLayout: () => ({ patched: false, changedRegions: [] }) }
  };
  vm.createContext(context);
  const clientSource = fs.readFileSync(require.resolve('../public/client.js'), 'utf8');
  vm.runInContext(clientSource, context, { filename: 'public/client.js' });
  return { render: context.render, elements, app };
}

function activeGameState(you) {
  return {
    joined: false,
    phase: 'playing',
    you,
    version: 'test',
    gameTarget: 100,
    singleRound: false,
    roundNumber: 1,
    players: [
      { id: 'same-token', name: 'Ada', connected: false, isBot: false, isSpectator: false },
      { id: 'other-token', name: 'Ben', connected: true, isBot: false, isSpectator: false }
    ]
  };
}

test('same-tab player identity prefills and enables active-game rejoin', () => {
  const client = loadClient({ token: 'same-token', tabId: 'tab-a', storedName: 'Other tab name' });

  client.render(activeGameState('same-token'));

  assert.equal(client.elements.rejoinNameInput.value, 'Ada');
  assert.equal(client.elements.rejoinBtn.disabled, false);
});

test('a new-tab player identity leaves active-game rejoin blank', () => {
  const client = loadClient({ token: 'new-token', tabId: 'tab-b', storedName: 'Ada' });

  client.render(activeGameState('new-token'));

  assert.equal(client.elements.rejoinNameInput.value, '');
  assert.equal(client.elements.rejoinBtn.disabled, true);
});

test('occupied game room includes rules and device-only settings', () => {
  const client = loadClient({ token: 'new-token', tabId: 'tab-b' });

  client.render(activeGameState('new-token'));

  assert.match(client.app.innerHTML, /data-occupied-drawer="guide"/);
  assert.match(client.app.innerHTML, /<strong>Goal:<\/strong>/);
  assert.match(client.app.innerHTML, /data-occupied-drawer="rules"/);
  assert.match(client.app.innerHTML, /data-occupied-drawer="settings"/);
  assert.match(client.app.innerHTML, /id="occupiedThemeSelect"/);
  assert.match(client.app.innerHTML, /id="occupiedSoundSelect"/);
  assert.match(client.app.innerHTML, /id="occupiedLanguageSelect"/);
  assert.doesNotMatch(client.app.innerHTML, /id="inGameTargetSelect"/);
});
