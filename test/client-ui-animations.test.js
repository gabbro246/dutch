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

function harness({ reducedMotion = false, panelTop = 80 } = {}) {
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
    getLastState() {},
    render() {},
    random: () => 0.5,
    schedule: (callback, delay) => scheduled.push({ callback, delay })
  });
  return { api, layers, scheduled, selectors, panelClasses };
}

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
    assert.equal(piece.animation.keyframes[2].easing, 'linear');
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
