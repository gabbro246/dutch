const test = require('node:test');
const assert = require('node:assert/strict');
const clientCardAnimations = require('../public/client-card-animations.js');

function animationRoot(document = {}) {
  const root = {
    document: {
      querySelector: () => null,
      querySelectorAll: () => [],
      ...document
    },
    Element: function Element() {},
    matchMedia: () => ({ matches: false }),
    scrollX: 0,
    scrollY: 0
  };
  root.Element.prototype = {};
  return root;
}

test('animation snapshots target only cards and panels changed by the transition', () => {
  const root = animationRoot();
  const animations = clientCardAnimations.create({ window: root, emit: () => {}, cardHtml: () => '' });
  const previousState = {
    roundNumber: 1,
    round: {
      players: [
        { id: 'a', cards: [{ id: 'a1', back: true }, { id: 'a2', back: true }] },
        { id: 'b', cards: [{ id: 'b1', back: true }] }
      ],
      discardTop: { id: 'pile', back: false },
      drawn: null,
      wrongThrowIn: null
    }
  };
  const state = {
    roundNumber: 1,
    round: {
      players: [
        { id: 'a', cards: [{ id: 'a1', back: false }, { id: 'a2', back: true }] },
        { id: 'b', cards: [{ id: 'b1', back: true }, { id: 'b2', back: true }] }
      ],
      discardTop: { id: 'pile', back: false },
      drawn: null,
      wrongThrowIn: { id: 'wrong:1', cardId: 'b1' }
    }
  };

  const targets = animations.animationSnapshotTargets(previousState, state);

  assert.deepEqual(Array.from(targets.cardIds).sort(), ['a1', 'b1', 'b2']);
  assert.deepEqual(Array.from(targets.panelIds), ['b']);
});

test('a new round targets every dealt card and player panel', () => {
  const root = animationRoot();
  const animations = clientCardAnimations.create({ window: root, emit: () => {}, cardHtml: () => '' });
  const previousState = {
    roundNumber: 1,
    round: { players: [{ id: 'a', cards: [{ id: 'old', back: true }] }], discardTop: null, drawn: null }
  };
  const state = {
    roundNumber: 2,
    round: {
      players: [
        { id: 'a', cards: [{ id: 'a1', back: true }] },
        { id: 'b', cards: [{ id: 'b1', back: true }] }
      ],
      discardTop: null,
      drawn: null
    }
  };

  const targets = animations.animationSnapshotTargets(previousState, state);

  assert.deepEqual(Array.from(targets.cardIds).sort(), ['a1', 'b1']);
  assert.deepEqual(Array.from(targets.panelIds).sort(), ['a', 'b']);
});

test('targeted snapshots measure only requested cards, panels, and pile anchors', () => {
  const measured = [];
  const element = (dataset) => ({
    dataset,
    outerHTML: '<div></div>',
    getBoundingClientRect() {
      measured.push(dataset.cardId || dataset.playerPanelId || dataset.animRole);
      return { left: 0, top: 0, width: 64, height: 88 };
    }
  });
  const elements = {
    '[data-player-panel-id="b"]': element({ playerPanelId: 'b' }),
    '.card[data-card-id="b2"]': element({ cardId: 'b2', locationKey: 'player:b:1', faceKind: 'back' }),
    '.card[data-anim-role="deck-top"]': element({ animRole: 'deck-top' }),
    '.card[data-anim-role="pile-top"]': element({ animRole: 'pile-top', locationKey: 'pile-top' })
  };
  const root = animationRoot({ querySelector: (selector) => elements[selector] || null });
  const animations = clientCardAnimations.create({ window: root, emit: () => {}, cardHtml: () => '' });

  const snapshot = animations.captureAnimationSnapshot('game', {
    cardIds: new Set(['b2']),
    panelIds: new Set(['b'])
  });

  assert.deepEqual(measured, ['b', 'b2', 'deck-top', 'pile-top']);
  assert.deepEqual(Array.from(snapshot.cards.keys()), ['b2']);
  assert.deepEqual(Array.from(snapshot.panels.keys()), ['b']);
});

test('first and second Jack targets each animate upward exactly once', () => {
  const calls = [];
  const cards = new Map();
  ['a1', 'b1'].forEach((id) => {
    cards.set(id, {
      classList: { contains: () => false },
      animate: (keyframes, options) => {
        calls.push({ id, keyframes, options });
        return { cancel() {} };
      }
    });
  });
  const root = {
    document: {
      querySelector: (selector) => cards.get(selector.match(/"([^"]+)"/)[1])
    },
    Element: function Element() {},
    matchMedia: () => ({ matches: false })
  };
  root.Element.prototype = {};
  const animations = clientCardAnimations.create({ window: root, emit: () => {}, cardHtml: () => '' });
  const state = (selected) => ({ roundNumber: 1, round: { special: { type: 'J', actorId: 'bot', selected } } });

  animations.animateJackSwapSelections(state([]), state(['a1']));
  animations.animateJackSwapSelections(state(['a1']), state(['a1', 'b1']));

  assert.deepEqual(calls.map((call) => call.id), ['a1', 'b1']);
  assert.deepEqual(calls.map((call) => call.keyframes), [
    [{ transform: 'translateY(0)' }, { transform: 'translateY(-24px)' }],
    [{ transform: 'translateY(0)' }, { transform: 'translateY(-24px)' }]
  ]);
});

test('initial deal stacks earlier cards above later cards at the deck', () => {
  const appended = [];
  const targets = new Map();
  const moveAnimations = [];
  const deckCount = { textContent: '49' };

  function cardElement(id) {
    return {
      dataset: { cardId: id, locationKey: `player:p:${id}` },
      classList: { add() {}, remove() {} },
      style: {},
      cloneNode() {
        return {
          classList: { add() {} },
          removeAttribute() {},
          remove() {},
          style: {},
          animate(keyframes, options) {
            this.animationKeyframes = keyframes;
            this.animationOptions = options;
            const animation = { cancel() {} };
            moveAnimations.push(animation);
            return animation;
          }
        };
      }
    };
  }

  ['c1', 'c2', 'c3'].forEach((id) => targets.set(id, cardElement(id)));
  const root = {
    document: {
      body: { appendChild: (element) => appended.push(element) },
      querySelector(selector) {
        if (selector === '[data-deck-count]') return deckCount;
        const match = selector.match(/data-card-id="([^"]+)"/);
        return match ? targets.get(match[1]) : null;
      },
      elementFromPoint: () => null
    },
    Element: function Element() {},
    matchMedia: () => ({ matches: false }),
    scrollX: 0,
    scrollY: 0
  };
  root.Element.prototype = { animate() {} };
  const animations = clientCardAnimations.create({ window: root, emit: () => {}, cardHtml: () => '' });
  const rect = (left, top) => ({ left, top, width: 64, height: 88 });
  const snapshot = animations.emptyAnimationSnapshot();
  snapshot.roles.set('deck-top', { rect: rect(100, 100) });
  ['c1', 'c2', 'c3'].forEach((id, index) => {
    snapshot.cards.set(id, { rect: rect(10 + index * 70, 300), locationKey: `player:p:${id}` });
  });

  const duration = animations.animateInitialDeal({
    round: {
      stage: 'deal',
      initialDealIntervalMs: 120,
      initialDealTravelMs: 240,
      deckCount: 49,
      players: [{ id: 'p', cards: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }] }]
    }
  }, snapshot);

  assert.deepEqual(appended.map((card) => Number(card.style.zIndex)), [10000, 9999, 9998]);
  assert.deepEqual(appended.map((card) => card.animationOptions.delay), [0, 120, 240]);
  assert.equal(appended[0].animationKeyframes[0].opacity, undefined);
  assert.deepEqual(appended.slice(1).map((card) => card.animationKeyframes[0].opacity), [0, 0]);
  assert.deepEqual(appended.slice(1).map((card) => card.animationKeyframes[1].opacity), [1, 1]);
  assert.equal(duration, 480);
  assert.equal(deckCount.textContent, '52');
  moveAnimations[0].onfinish();
  assert.equal(deckCount.textContent, '51');
  moveAnimations[1].onfinish();
  moveAnimations[2].onfinish();
  assert.equal(deckCount.textContent, '49');
});
