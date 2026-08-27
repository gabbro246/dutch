const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadClientActions(root) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'client-actions.js'), 'utf8');
  const context = vm.createContext({ window: root });
  vm.runInContext(source, context);
  return root.DutchClientActions;
}

function createButton(action, rect = { left: 10, top: 10, right: 110, bottom: 50 }) {
  const listeners = {};
  return {
    dataset: { action },
    disabled: false,
    isConnected: true,
    innerHTML: action,
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
    click() {
      listeners.click({ preventDefault() {} });
    },
    closest(selector) {
      return selector === '[data-action]' ? this : null;
    },
    getBoundingClientRect() {
      return rect;
    },
    dispatch(type, event = {}) {
      listeners[type]({ preventDefault() {}, ...event });
    }
  };
}

function createHarness(initialButtons) {
  const listeners = {};
  const document = {
    buttons: initialButtons,
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
    querySelectorAll(selector) {
      return selector === '[data-action]' ? this.buttons : [];
    },
    dispatch(type, event) {
      listeners[type](event);
    }
  };
  const emitted = [];
  const root = {
    document,
    clearTimeout() {},
    setTimeout() { return 1; }
  };
  const actions = loadClientActions(root).create({
    document,
    emit(...args) { emitted.push(args); },
    escapeHtml: String,
    wireAnimatedDrawers() {},
    detailPreferencesByMode: {},
    getDetailsMode: () => 'wide',
    getLastState: () => null,
    getLogExpanded: () => false,
    setLogExpanded() {},
    getSettingsExpanded: () => false,
    setSettingsExpanded() {},
    downloadLogFile() {},
    render() {}
  });
  return { actions, document, emitted };
}

function pointerEvent(button, pointerId, x, y) {
  return {
    target: button,
    pointerId,
    isPrimary: true,
    button: 0,
    clientX: x,
    clientY: y
  };
}

test('completes a game action when its button is replaced before pointer release', () => {
  const original = createButton('takeDeck');
  const replacement = createButton('takeDeck');
  const harness = createHarness([original]);
  harness.actions.wireGameButtons();

  harness.document.dispatch('pointerdown', pointerEvent(original, 7, 40, 30));
  original.isConnected = false;
  harness.document.buttons = [replacement];
  harness.actions.wireGameButtons();
  harness.document.dispatch('pointerup', pointerEvent(harness.document, 7, 40, 30));

  assert.deepEqual(harness.emitted, [['takeDeck']]);
  original.dispatch('click');
  assert.deepEqual(harness.emitted, [['takeDeck']], 'a synthesized click must not emit the action twice');
});

test('keeps pointer cancellation and keyboard click behavior', () => {
  const button = createButton('sayDutch');
  const harness = createHarness([button]);
  harness.actions.wireGameButtons();

  harness.document.dispatch('pointerdown', pointerEvent(button, 1, 40, 30));
  harness.document.dispatch('pointerup', pointerEvent(harness.document, 1, 140, 30));
  harness.document.dispatch('pointerdown', pointerEvent(button, 2, 40, 30));
  harness.document.dispatch('pointercancel', pointerEvent(harness.document, 2, 40, 30));
  assert.deepEqual(harness.emitted, []);

  button.dispatch('click');
  assert.deepEqual(harness.emitted, [['sayDutch']]);
});
