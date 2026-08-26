const test = require('node:test');
const assert = require('node:assert/strict');

function fakeElement(tagName = '') {
  return {
    tagName,
    className: '',
    children: [],
    style: {},
    attributes: {},
    removed: false,
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    appendChild(child) {
      this.children.push(child);
    },
    animate(keyframes, options) {
      this.animation = { keyframes, options };
      return { finished: new Promise(() => {}) };
    },
    remove() {
      this.removed = true;
    }
  };
}

function harness({ reducedMotion = false, panelTop = 80, getLastState = () => undefined, render = () => {} } = {}) {
  const layers = [];
  const scheduled = [];
  const selectors = [];
  const panelClasses = new Set();
  const app = fakeElement('div');
  const panel = {
    getBoundingClientRect: () => ({ left: 100, top: panelTop, width: 200, height: 120 }),
    classList: {
      add: (name) => panelClasses.add(name),
      remove: (name) => panelClasses.delete(name)
    }
  };
  app.appendChild = (layer) => layers.push(layer);

  global.document = {
    body: {
      appendChild(layer) {
        layers.push(layer);
      }
    },
    createElement: fakeElement,
    getElementById: (id) => id === 'app' ? app : null,
    querySelector(selector) {
      selectors.push(selector);
      return panel;
    }
  };
  global.CSS = { escape: (value) => String(value) };
  global.matchMedia = () => ({ matches: reducedMotion });
  global.Element = function Element() {};
  global.Element.prototype.animate = () => {};

  delete require.cache[require.resolve('../public/client-ui-animations.js')];
  const uiAnimations = require('../public/client-ui-animations.js');
  const api = uiAnimations.create({
    getLastState,
    render,
    random: () => 0.5,
    schedule: (callback, delay) => scheduled.push({ callback, delay })
  });
  return { api, layers, scheduled, selectors, panelClasses };
}

test('animates the first opening of a lazy drawer after its content renders', () => {
  let api;
  let currentDrawer;
  let click;
  let requestedOpen = false;
  const state = {};
  const oldContent = {
    getBoundingClientRect: () => ({ height: 0 })
  };
  const oldDrawer = {
    open: false,
    dataset: { detailKey: 'rules', lazyContent: 'true' },
    querySelector(selector) {
      if (selector === ':scope > summary') {
        return {
          addEventListener(type, listener) {
            if (type === 'click') click = listener;
          }
        };
      }
      return oldContent;
    }
  };
  const newContent = {
    scrollHeight: 480,
    style: {},
    animate(keyframes, options) {
      this.animation = { keyframes, options };
      return {};
    },
    removeAttribute() {}
  };
  const newDrawer = {
    open: true,
    dataset: { detailKey: 'rules', lazyContent: 'false' },
    querySelector: () => newContent
  };
  currentDrawer = oldDrawer;
  const configured = harness({
    getLastState: () => state,
    render() {
      const transitions = api.captureDrawerTransitions();
      currentDrawer = newDrawer;
      global.document.querySelectorAll = () => [currentDrawer];
      api.animateDrawerTransitions(transitions);
    }
  });
  api = configured.api;
  global.document.querySelectorAll = () => [currentDrawer];
  api.wireAnimatedDrawers(global.document, (details, open) => {
    requestedOpen = open;
  });

  click({ preventDefault() {} });

  assert.equal(requestedOpen, true);
  assert.equal(oldDrawer.open, false, 'the transition snapshot must see the drawer closed');
  assert.deepEqual(newContent.animation.keyframes, [
    { height: '0px', opacity: 0 },
    { height: '480px', opacity: 1 }
  ]);
  assert.equal(newContent.animation.options.easing, 'ease-in-out');
});

function playingRound(stage, winnerId = null, roundWinnerIds = []) {
  return { phase: 'playing', round: { stage, winnerId, roundWinnerIds } };
}

test('launches one local 40-piece burst when the game winner first appears', () => {
  const { api, layers, scheduled, selectors, panelClasses } = harness();
  const before = playingRound('roundEnd', null, ['ada']);
  const winner = playingRound('gameEnd', 'ada', ['ada']);

  api.animateWinnerConfetti(before, winner);

  assert.deepEqual(selectors, ['[data-player-panel-id="ada"]']);
  assert.equal(layers.length, 1);
  assert.equal(layers[0].children.length, 40);
  assert.equal(layers[0].attributes['aria-hidden'], 'true');
  assert.equal(panelClasses.has('winner-confetti-origin'), true);
  assert.equal(scheduled[0].delay, 4700);
  for (const piece of layers[0].children) {
    assert.match(piece.style.background, /^var\(--/);
    assert.ok(Number.parseFloat(piece.style.width) >= 6 && Number.parseFloat(piece.style.width) <= 7);
    assert.ok(Number.parseFloat(piece.style.height) >= 7 && Number.parseFloat(piece.style.height) <= 13);
    assert.ok(piece.animation.options.duration >= 3540 && piece.animation.options.duration <= 4500);
    assert.equal(piece.animation.keyframes.at(-1).opacity, 0);
    assert.equal(piece.animation.keyframes.length, 4, 'the fall should be one uninterrupted segment');
    assert.equal(piece.animation.keyframes[2].easing, 'ease-in-out');
    assert.equal(piece.animation.options.easing, 'ease-in-out');
  }

  api.animateWinnerConfetti(winner, winner);
  assert.equal(layers.length, 1, 'the same visible winner should not burst twice');

  scheduled[0].callback();
  assert.equal(layers[0].removed, true);
  assert.equal(panelClasses.has('winner-confetti-origin'), false);
});

test('skips winner confetti when reduced motion is requested', () => {
  const { api, layers } = harness({ reducedMotion: true });

  api.animateWinnerConfetti(null, playingRound('gameEnd', 'ada'));

  assert.equal(layers.length, 0);
});

test('keeps a top-field burst on-screen and biases pieces toward the sides', () => {
  const { api, layers } = harness({ panelTop: 10 });

  api.animateWinnerConfetti(playingRound('roundEnd', null, ['ada']), playingRound('gameEnd', 'ada', ['ada']));

  for (const piece of layers[0].children) {
    const apex = piece.animation.keyframes[2].transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
    assert.ok(Math.abs(Number(apex[1])) >= 60, 'top-field pieces should travel at least 30% of the panel width sideways');
    assert.ok(Math.abs(Number(apex[2])) <= 78, 'top-field pieces should not fly above the viewport');
  }
});

test('does not launch confetti for a round winner', () => {
  const { api, layers } = harness();

  api.animateWinnerConfetti(playingRound('turn'), playingRound('roundEnd', null, ['ada']));

  assert.equal(layers.length, 0);
});

function transitionButton(disabled) {
  return {
    id: '',
    dataset: { action: 'endTurn' },
    disabled,
    closest: () => null,
    animate(keyframes, options) {
      this.animation = { keyframes, options };
    }
  };
}

function transitionStyle(disabled) {
  return disabled
    ? { opacity: '0.45', backgroundColor: 'rgb(255, 255, 255)', borderTopColor: 'rgb(154, 160, 166)', color: 'rgb(32, 33, 36)' }
    : { opacity: '1', backgroundColor: 'rgb(66, 57, 200)', borderTopColor: 'rgb(66, 57, 200)', color: 'rgb(255, 255, 255)' };
}

test('animates button visuals in both disabled-state directions', () => {
  for (const [beforeDisabled, afterDisabled] of [[true, false], [false, true]]) {
    const { api } = harness();
    const before = transitionButton(beforeDisabled);
    before.visual = transitionStyle(beforeDisabled);
    global.getComputedStyle = (button) => button.visual;
    global.document.querySelectorAll = () => [before];
    const transitions = api.captureButtonTransitions();

    const after = transitionButton(afterDisabled);
    after.visual = transitionStyle(afterDisabled);
    global.document.querySelectorAll = () => [after];
    api.animateButtonTransitions(transitions);

    assert.deepEqual(after.animation.keyframes[0], {
      opacity: before.visual.opacity,
      backgroundColor: before.visual.backgroundColor,
      borderColor: before.visual.borderTopColor,
      color: before.visual.color
    });
    assert.deepEqual(after.animation.keyframes[1], {
      opacity: after.visual.opacity,
      backgroundColor: after.visual.backgroundColor,
      borderColor: after.visual.borderTopColor,
      color: after.visual.color
    });
    assert.equal(after.animation.options.duration, 180);
    assert.equal(after.animation.options.easing, 'ease-in-out');
  }
});

test('skips button state animations when reduced motion is requested', () => {
  const { api } = harness({ reducedMotion: true });
  const before = transitionButton(true);
  before.visual = transitionStyle(true);
  global.getComputedStyle = (button) => button.visual;
  global.document.querySelectorAll = () => [before];
  const transitions = api.captureButtonTransitions();

  const after = transitionButton(false);
  after.visual = transitionStyle(false);
  global.document.querySelectorAll = () => [after];
  api.animateButtonTransitions(transitions);

  assert.equal(after.animation, undefined);
});
