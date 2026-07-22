const test = require('node:test');
const assert = require('node:assert/strict');
const { createTableSettings } = require('../lib/table-settings.js');
const { createCombinedDeck } = require('../lib/deck.js');

function settingsFor(state, overrides = {}) {
  const deps = {
    getState: () => state,
    activePlayablePlayerCount: () => state.players.filter((player) => !player.left && !player.isSpectator).length,
    createCombinedDeck,
    random: () => 0.75,
    ...overrides
  };
  return createTableSettings(deps);
}

function player(id, extra = {}) {
  return {
    id,
    left: false,
    isSpectator: false,
    ...extra
  };
}

test('clampDeckSetting forces two decks for more than four playable players', () => {
  const state = {
    phase: 'waiting',
    deckSetting: 'one',
    players: [player('a'), player('b'), player('c'), player('d'), player('e')]
  };
  const settings = settingsFor(state);

  settings.clampDeckSetting();
  assert.equal(state.deckSetting, 'two');

  state.deckSetting = 'one';
  state.players = [player('a'), player('b'), player('c'), player('d'), player('spec', { isSpectator: true })];
  settings.clampDeckSetting();
  assert.equal(state.deckSetting, 'one');
});

test('setDeckSetting only accepts valid waiting-room settings and reclamps', () => {
  const state = {
    phase: 'waiting',
    deckSetting: 'one',
    players: [player('a'), player('b')]
  };
  const settings = settingsFor(state);

  settings.setDeckSetting('two');
  assert.equal(state.deckSetting, 'two');

  settings.setDeckSetting('invalid');
  assert.equal(state.deckSetting, 'two');

  state.phase = 'playing';
  settings.setDeckSetting('one');
  assert.equal(state.deckSetting, 'two');

  state.phase = 'waiting';
  state.players = [player('a'), player('b'), player('c'), player('d'), player('e')];
  settings.setDeckSetting('one');
  assert.equal(state.deckSetting, 'two');
});

test('setGameTarget accepts supported targets until a player reaches 50', () => {
  const state = {
    phase: 'waiting',
    gameTarget: 100,
    players: []
  };
  const settings = settingsFor(state);

  settings.setGameTarget('50');
  assert.equal(state.gameTarget, 50);

  settings.setGameTarget(75);
  assert.equal(state.gameTarget, 50);

  state.phase = 'playing';
  settings.setGameTarget(100);
  assert.equal(state.gameTarget, 100);

  state.players = [player('a', { total: 50 })];
  settings.setGameTarget(50);
  assert.equal(state.gameTarget, 100);

  state.players[0].left = true;
  settings.setGameTarget(50);
  assert.equal(state.gameTarget, 50);

  state.players[0].left = false;
  state.round = { stage: 'gameEnd' };
  settings.setGameTarget(100);
  assert.equal(state.gameTarget, 50);

  state.phase = 'invalid';
  state.round = null;
  settings.setGameTarget(100);
  assert.equal(state.gameTarget, 50);
});

test('setInactivityTimeout accepts only supported minute values', () => {
  const state = { phase: 'waiting', inactivityTimeoutMinutes: 15, players: [] };
  const settings = settingsFor(state);

  settings.setInactivityTimeout('60');
  assert.equal(state.inactivityTimeoutMinutes, 60);
  settings.setInactivityTimeout(45);
  assert.equal(state.inactivityTimeoutMinutes, 60);
});

test('createCombinedDeck sets deck color and advances card ids across calls', () => {
  const state = {
    phase: 'waiting',
    deckSetting: 'one',
    players: []
  };
  const settings = settingsFor(state, { random: () => 0.75 });

  const firstDeck = settings.createCombinedDeck();
  const firstIds = new Set(firstDeck.map((card) => card.id));
  assert.equal(state.deckColor, 'blue');
  assert.equal(firstDeck.length, 52);
  assert.equal(firstIds.has('c1'), true);
  assert.equal(firstIds.has('c52'), true);

  state.deckSetting = 'two';
  const secondDeck = settings.createCombinedDeck();
  const secondIds = new Set(secondDeck.map((card) => card.id));
  assert.equal(state.deckColor, 'red+blue');
  assert.equal(secondDeck.length, 104);
  assert.equal(secondIds.has('c53'), true);
  assert.equal(secondIds.has('c156'), true);
  assert.equal(secondIds.has('c1'), false);
});
