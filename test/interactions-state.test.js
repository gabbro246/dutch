const test = require('node:test');
const assert = require('node:assert/strict');
const stateModel = require('../public/interactions-state.js');
const render = require('../public/interactions-render.js');

function actionButtons(html, action) {
  return html.match(new RegExp('<button[^>]*data-action="' + action + '"[^>]*>', 'g')) || [];
}

test('interaction lab starts with You plus two other players and four hidden cards each', () => {
  const state = stateModel.createInitialState({ random: () => 0 });

  assert.deepEqual(state.round.players.map((player) => player.name), ['You', 'Player 2', 'Player 3']);
  assert.deepEqual(state.round.players.map((player) => player.cards.length), [4, 4, 4]);
  assert.ok(state.round.players.every((player) => player.cards.every((card) => card.back)));
  assert.equal(state.you, 'you');
});

test('differentRank always produces a rank that cannot match the discard', () => {
  for (const rank of require('../public/shared.js').RANKS) {
    assert.notEqual(stateModel.differentRank(rank, () => 0), rank);
  }
});

test('action ranks remain available after a matching right throw-in', () => {
  assert.equal(stateModel.actionTypeForRank('A'), 'A');
  assert.equal(stateModel.actionTypeForRank('Q'), 'Q');
  assert.equal(stateModel.actionTypeForRank('J'), 'J');
  assert.equal(stateModel.actionTypeForRank('7'), '');
});

test('interaction layout matches the live top-opponents, piles, bottom-player order', () => {
  const state = stateModel.createInitialState({ random: () => 0 });
  const html = render.renderPage(state);

  const opponents = html.indexOf('class="other-players"');
  const piles = html.indexOf('class="deck-pile-area"');
  const ownArea = html.indexOf('class="own-area');
  assert.ok(opponents >= 0 && opponents < piles && piles < ownArea);
  assert.doesNotMatch(html, /<h1|Interaction lab/);
  assert.match(html, /data-detail-key="settings"/);
});

test('player actions stay below players while card-targeted actions stay below every card', () => {
  const state = stateModel.createInitialState({ random: () => 0 });
  state.round.stage = 'turn';
  const html = render.renderPage(state);

  for (const label of ['Dutch', 'Game winner']) {
    assert.equal(html.split('>' + label + '<').length - 1, 3, label + ' should appear once per player');
  }
  assert.doesNotMatch(html, />Draw deck<|>Draw discard<|>Call Dutch<|>End turn</);
  for (const label of ['Replace', 'Repl. A', 'Repl. Q', 'Repl. J', 'Ri. Th. In', 'Wr. Th. In']) {
    assert.equal(html.split('>' + label + '<').length - 1, 12, label + ' should appear below every card');
  }
  const firstCardButtons = html.slice(html.indexOf('class="card-buttons"'), html.indexOf('</div></div>', html.indexOf('class="card-buttons"')));
  let previousIndex = -1;
  for (const label of ['Replace', 'Repl. A', 'Repl. Q', 'Repl. J', 'Ri. Th. In', 'Wr. Th. In', 'Action']) {
    const index = firstCardButtons.indexOf('>' + label + '<');
    assert.ok(index > previousIndex, label + ' should follow the requested card-button order');
    previousIndex = index;
  }
  assert.equal((html.match(/class="row own-actions"/g) || []).length, 4, 'players and setup controls should use short rows');
  assert.match(html, /data-action="replace-special"[^>]+data-card-id="lab-card-1"[^>]+data-special-type="Q"/);
  const ownArea = html.slice(html.indexOf('data-game-region="own"'), html.indexOf('</main>'));
  const opponentsArea = html.slice(html.indexOf('class="other-players"'), html.indexOf('class="deck-pile-area"'));
  const statusArea = html.slice(html.indexOf('data-game-region="status"'), html.indexOf('data-detail-key="settings"'));
  assert.equal((html.match(/data-system-action="next-player"/g) || []).length, 3);
  assert.equal((ownArea.match(/data-system-action="next-player"/g) || []).length, 1);
  assert.equal((opponentsArea.match(/data-system-action="next-player"/g) || []).length, 2);
  assert.equal((statusArea.match(/data-system-action="next-player"/g) || []).length, 0);
  assert.match(ownArea, /data-system-action="next-player" >Next player<\/button>/);
});

test('special action slots stay visible and become active only after that rank is discarded', () => {
  const state = stateModel.createInitialState({ random: () => 0 });
  state.round.stage = 'turn';
  assert.doesNotMatch(render.renderPage(state), /data-action="(?:ace|queen|jack-target)"/);
  assert.equal((render.renderPage(state).match(/special-action-placeholder" disabled/g) || []).length, 12);

  state.round.special = { type: 'A', actorId: 'player-2', selected: [] };
  const ace = render.renderPage(state);
  assert.equal((ace.match(/data-action="ace"/g) || []).length, 12);
  assert.equal((ace.match(/data-target-player-id=/g) || []).length, 12);

  state.round.special = { type: 'Q', actorId: 'player-2', selected: [] };
  const queen = render.renderPage(state);
  assert.equal((queen.match(/data-action="queen"/g) || []).length, 12);
  assert.equal((queen.match(/data-player-id="player-2"/g) || []).length >= 12, true);

  state.round.special = { type: 'J', actorId: 'player-3', selected: [] };
  assert.equal((render.renderPage(state).match(/data-action="jack-target"/g) || []).length, 12);
});

test('setup interactions use a normal utility row instead of card-attached controls', () => {
  const html = render.renderPage(stateModel.createInitialState({ random: () => 0 }));
  const deckStart = html.indexOf('class="deck-pile-area"');
  const deckArea = html.slice(deckStart, html.indexOf('</section>', deckStart));
  const utilityArea = html.slice(html.indexOf('data-interaction-controls="setup"'), html.indexOf('data-game-region="own"'));
  const statusArea = html.slice(html.indexOf('data-game-region="status"'));
  for (const label of ['Reshuffle']) {
    assert.equal(utilityArea.split('>' + label + '<').length - 1, 1);
    assert.equal(deckArea.split('>' + label + '<').length - 1, 0);
  }
  assert.doesNotMatch(html, /Initial deal|Opening discard|Randomize cards/);
  assert.equal(deckArea.split('>Take<').length - 1, 2);
  assert.equal(deckArea.split('>Discard<').length - 1, 1);
  for (const label of ['Round reveal', 'Next round', 'Reset']) {
    assert.equal(statusArea.split('>' + label + '<').length - 1, 1);
    assert.equal(deckArea.split('>' + label + '<').length - 1, 0);
  }
});

test('take controls target the active player and replacement controls enable only after their draw', () => {
  const state = stateModel.createInitialState({ random: () => 0 });
  state.round.currentPlayerId = 'player-2';
  let html = render.renderPage(state);
  assert.match(html, /data-action="draw-deck" data-player-id="player-2"/);
  assert.match(html, /data-action="draw-discard" data-player-id="player-2"/);
  assert.equal(actionButtons(html, 'replace').length, 12);
  assert.equal(actionButtons(html, 'replace').filter((button) => /disabled/.test(button)).length, 12);
  assert.equal(actionButtons(html, 'replace-special').length, 36);
  assert.equal(actionButtons(html, 'replace-special').filter((button) => /disabled/.test(button)).length, 36);
  assert.equal(actionButtons(html, 'discard').length, 1);
  assert.equal(actionButtons(html, 'discard').filter((button) => /disabled/.test(button)).length, 1);

  state.round.drawn = {
    playerId: 'player-2',
    source: 'deck',
    card: stateModel.nextCard(state, { rank: '7', suit: 'clubs', back: true })
  };
  html = render.renderPage(state);
  assert.equal(actionButtons(html, 'replace').filter((button) => /disabled/.test(button)).length, 8);
  assert.equal(actionButtons(html, 'replace-special').filter((button) => /disabled/.test(button)).length, 24);
  assert.equal(actionButtons(html, 'discard').filter((button) => /disabled/.test(button)).length, 0);

  state.round.drawn.source = 'pile';
  html = render.renderPage(state);
  assert.equal(actionButtons(html, 'discard').filter((button) => /disabled/.test(button)).length, 1);
});

test('optional initial peek controls stay visible and enable during the peek stage', () => {
  const state = stateModel.createInitialState({ random: () => 0 });
  let html = render.renderPage(state);
  assert.equal(actionButtons(html, 'initial-peek').length, 12);
  assert.equal(actionButtons(html, 'initial-peek').filter((button) => /disabled/.test(button)).length, 0);
  assert.equal((html.match(/special-action-placeholder/g) || []).length, 0);

  state.round.stage = 'turn';
  html = render.renderPage(state);
  assert.equal(actionButtons(html, 'initial-peek').length, 0);
  assert.equal((html.match(/special-action-placeholder" disabled/g) || []).length, 12);
});

test('settings drawer reuses all real-game controls', () => {
  const state = stateModel.createInitialState({ random: () => 0 });
  let html = render.renderPage(state);
  assert.match(html, /data-detail-key="settings"[^>]+class="drawer side-drawer" open/);
  for (const id of ['inGameTargetSelect', 'gameInactivityTimeoutSelect', 'gameBotTimingSelect', 'highlightChangedCardsSelect', 'gameThemeSelect', 'gameSoundSelect', 'gameLanguageSelect']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.equal((html.match(/class="setting-row advanced-setting" hidden/g) || []).length, 3);
  assert.match(html, /data-action="toggleSettingsMore"[^>]+aria-expanded="false"[^>]*>Show more<\/button>/);

  state.preferences.settingsExpanded = true;
  html = render.renderPage(state);
  assert.doesNotMatch(html, /class="setting-row advanced-setting" hidden/);
  assert.match(html, /data-action="toggleSettingsMore"[^>]+aria-expanded="true"[^>]*>Show less<\/button>/);

  assert.match(html, /popovertarget="gameBotTimingSelectHelp"[^>]*>Bot speed<\/button>/);
  assert.match(html, /<option value="0"[^>]*>Instant<\/option>/);
  assert.match(html, /<option value="50"[^>]*selected[^>]*>Medium<\/option>/);
  assert.match(html, /<option value="100"[^>]*>Human-like<\/option>/);

  state.preferences.language = 'de';
  assert.match(render.renderPage(state), /<summary>Einstellungen<\/summary>/);

  state.round.players[0].cards[0].highlight = 'swap';
  state.highlightChangedCards = true;
  assert.match(render.renderPage(state), /data-highlight="swap"/);
  state.highlightChangedCards = false;
  assert.doesNotMatch(render.renderPage(state), /data-highlight="swap"/);
});

test('status panel contains only messages used by the real game', () => {
  const state = stateModel.createInitialState({ random: () => 0 });
  state.round.stage = 'turn';
  let html = render.renderPage(state);
  let statusInfo = html.slice(html.indexOf('class="status-info"'), html.indexOf('class="status-actions"'));
  const statusActions = html.slice(html.indexOf('class="status-actions"'), html.indexOf('</div></div></div></div>', html.indexOf('class="status-actions"')));
  assert.match(statusInfo, /You&#039;s move\./);
  assert.doesNotMatch(statusInfo, /interaction|Ready|randomized/i);
  assert.doesNotMatch(statusActions, /data-system-action="next-player"/);
  assert.match(html, /data-system-action="next-player" >Next player<\/button>/);

  state.round.turnComplete = true;
  html = render.renderPage(state);
  statusInfo = html.slice(html.indexOf('class="status-info"'), html.indexOf('class="status-actions"'));
  assert.match(statusInfo, /Your turn is complete\. Say Dutch or click Next player\./);
  assert.match(html, /data-system-action="next-player" >Next player<\/button>/);

  state.round.turnComplete = false;
  state.round.stage = 'special';
  state.round.special = { type: 'J', actorId: 'player-2', selected: [] };
  assert.match(render.renderPage(state), /Player 2 may use Jack swap or click Next player\./);
});
