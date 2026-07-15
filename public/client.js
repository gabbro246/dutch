const socket = io({ autoConnect: false });
const app = document.getElementById('app');
const PLAYER_TOKEN_KEY = 'dutchPlayerSessionToken';
const playerToken = getPlayerToken();
let lastState = null;
let hasRenderedGame = false;
let currentDetailsMode = '';
let logExpanded = false;
const detailPreferencesByMode = {};
const waitingDrawerPreferences = { bots: false, settings: false };
const SPECTATOR_TRIGGER_NAME = 'spectator';
const {
  PLAYER_NAME_MAX_LENGTH,
  GAME_DESCRIPTION,
  BOT_LABELS,
  BOT_PERSONALITIES,
  normalizedShortPlayerName,
  shortPlayerName,
  specialLabel,
  logTimestamp,
  logEntryTimeMs,
  logRelativeBaseMs,
  formatRelativeLogTime,
  scoreHistoryRows,
  quickRulesHtml,
  fullRulesHtml
} = window.DutchShared;
const BOT_NAMES = Object.values(BOT_LABELS);
const clientActions = window.DutchClientActions.create({
  emit,
  render,
  escapeHtml,
  downloadLogFile,
  detailPreferencesByMode,
  getDetailsMode: () => currentDetailsMode,
  getLastState: () => lastState,
  getLogExpanded: () => logExpanded,
  setLogExpanded: (value) => { logExpanded = value; }
});

function getPlayerToken() {
  try {
    const existing = window.sessionStorage.getItem(PLAYER_TOKEN_KEY);
    if (existing) return existing;
    const token = window.crypto && window.crypto.randomUUID
      ? window.crypto.randomUUID()
      : 'player-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    window.sessionStorage.setItem(PLAYER_TOKEN_KEY, token);
    return token;
  } catch (error) {
    return 'player-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  }
}

socket.on('connect', () => {
  socket.emit('identify', playerToken);
});

socket.on('state', (state) => {
  const previousState = lastState;
  const beforeSnapshot = captureAnimationSnapshot();
  render(state);
  const afterSnapshot = captureAnimationSnapshot();
  if (previousState && hasRenderedGame && state.phase === 'playing') {
    animateStateTransition(previousState, state, beforeSnapshot, afterSnapshot);
  }
  hasRenderedGame = state.phase === 'playing' && !!state.round;
  lastState = state;
});

socket.on('notice', (message) => {
  alert(message);
});

socket.connect();

function emit(event, payload) {
  socket.emit(event, payload);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function attrsToText(attrs = {}) {
  return Object.entries(attrs)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}="${escapeHtml(value)}"`)
    .join(' ');
}

function repoLink(version = '') {
  const versionText = version ? ` <span class="version-label">v${escapeHtml(version)}</span>` : '';
  return `<p class="repo-link"><a href="https://github.com/gabbro246/dutch" target="_blank" rel="noopener">github.com/gabbro246/dutch</a>${versionText}</p>`;
}

function gameStartedText(startedAt) {
  if (!startedAt) return '';
  const started = new Date(startedAt);
  if (Number.isNaN(started.getTime())) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - started.getTime()) / 60000));
  const elapsed = minutes === 0 ? 'just now' : minutes === 1 ? '1 min ago' : minutes + ' min ago';
  const time = started.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return '<p class="hint">Started ' + escapeHtml(time) + ' (' + escapeHtml(elapsed) + ')</p>';
}

function activeGameSummary(state) {
  const tag = String.fromCharCode(60);
  const end = String.fromCharCode(62);
  const players = (state.players || [])
    .filter(function(player) { return player.isSpectator === false; })
    .map(function(player) { return player.name; })
    .join(", ");
  const round = state.roundNumber ? "Round " + state.roundNumber : "Round not started";
  const text = "Players: " + (players || "none") + ". " + round + ".";
  return tag + "p class=\"hint active-game-summary\"" + end + escapeHtml(text) + tag + "/p" + end;
}

function playerNameTaken(state, name) {
  const normalized = normalizedShortPlayerName(name);
  if (!normalized) return false;
  if (BOT_NAMES.some((botName) => normalizedShortPlayerName(botName) === normalized)) return true;
  return state.players.some((player) => normalizedShortPlayerName(player.name) === normalized && player.id !== state.you);
}

function isSpectatorName(name) {
  return String(name || '').trim().toLowerCase() === SPECTATOR_TRIGGER_NAME;
}

function canJoinWithName(state, name) {
  if (state.joined) return false;
  if (!state.canJoin) return false;
  if (!String(name || '').trim()) return false;
  if (isSpectatorName(name)) return true;
  return !playerNameTaken(state, name);
}

function render(state) {
  if (!state.joined && state.phase === 'playing') {
    const gameStarted = gameStartedText(state.gameStartedAt);
    const gameSummary = activeGameSummary(state);
    app.innerHTML = `
      <div class="page waiting-page">
        <h1 class="app-title">Dutch! 🂡</h1>
        <div class="waiting-panel">
          <p class="waiting-description">${escapeHtml(GAME_DESCRIPTION)}</p>
          <p>${escapeHtml(state.waitingMessage)}</p>
          ${gameStarted}
          ${gameSummary}
        </div>
        ${repoLink(state.version)}
      </div>
    `;
    return;
  }
  if (state.phase === 'waiting') renderWaiting(state);
  else renderGame(state);
}

function botTypeLabel(type) {
  return BOT_LABELS[type] || 'Bot';
}

function renderBotPersonality(type) {
  const personality = BOT_PERSONALITIES[type] || null;
  const fallbackStats = Object.values(BOT_PERSONALITIES)[0].stats;
  const stats = (personality ? personality.stats : fallbackStats).map(([label, value]) => {
    const barWidth = personality ? value * 10 : 0;
    const valueText = personality ? escapeHtml(value + "/10") : "";
    return (
      '<div class="bot-stat">' +
        '<span class="bot-stat-name">' + escapeHtml(label) + '</span>' +
        '<span class="bot-stat-bar" aria-hidden="true"><span style="width: ' + barWidth + '%"></span></span>' +
        '<span class="bot-stat-value">' + valueText + '</span>' +
      '</div>'
    );
  }).join("");
  return '<div id="botPersonality" class="bot-personality' + (personality ? '' : ' empty') + '">' +
    '<p>' + (personality ? escapeHtml(personality.summary) : '&nbsp;') + '</p>' +
    '<div class="bot-stats">' + stats + '</div>' +
  '</div>';
}

function renderWaiting(state) {
  const botTypes = ['strategic', 'roswell', 'casual', 'distracted'];
  const usedBotTypes = new Set(state.players.filter((p) => p.isBot).map((p) => p.botType));
  const firstAvailableBot = botTypes.find((type) => !usedBotTypes.has(type));
  let startDisabled = state.canStart === false || state.joined === false;
  const botsOpen = waitingDrawerPreferences.bots ? 'open' : '';
  const settingsOpen = waitingDrawerPreferences.settings ? 'open' : '';
  const botOptions = '<option value="" selected>Choose bot...</option>' + botTypes.map((type) => `
    <option value="${escapeHtml(type)}" ${usedBotTypes.has(type) ? 'disabled' : ''}>${escapeHtml(botTypeLabel(type))}</option>
  `).join('');
  const players = state.players.map((p, index) => {
    const isMe = p.id === state.you;
    const moveControls = `
      <div class="player-line-actions">
        ${isMe ? '' : `<button data-action="removeWaitingPlayer" data-player-id="${escapeHtml(p.id)}">Remove</button>`}
        <button class="icon-button" title="Move up" aria-label="Move ${escapeHtml(p.name)} up" data-action="moveWaitingPlayer" data-player-id="${escapeHtml(p.id)}" data-direction="up" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button class="icon-button" title="Move down" aria-label="Move ${escapeHtml(p.name)} down" data-action="moveWaitingPlayer" data-player-id="${escapeHtml(p.id)}" data-direction="down" ${index === state.players.length - 1 ? 'disabled' : ''}>↓</button>
      </div>
    `;
    return `
      <div class="player-line">
        <span>${index + 1}. ${escapeHtml(p.name)}${p.isBot ? ' <span class="bot-badge">bot</span>' : ''}${p.isSpectator ? ' <span class="spectator-badge">spectator</span>' : ''}${isMe ? ' <span class="you-label">(you)</span>' : ''} ${p.connected ? '' : '(missing)'}</span>
        ${moveControls}
      </div>
    `;
  }).join('');
  const joined = state.joined;
  const me = state.players.find((p) => p.id === state.you);
  const humanCount = state.players.filter((p) => !p.isBot && !p.isSpectator).length;
  const playerHintText = humanCount === 0 ? 'Waiting for a human player.' : 'Waiting for another human or a bot.';
  const playerHint = state.players.length > 0 && !state.canStart ? `<p class="hint">${playerHintText}</p>` : '';
  app.innerHTML = `
    <div class="page waiting-page">
      <h1 class="app-title">Dutch! 🂡</h1>
      <div class="waiting-panel">
        <p class="waiting-description">${escapeHtml(GAME_DESCRIPTION)}</p>
        <div class="waiting-controls">
          <div class="row join-row">
            <input id="nameInput" placeholder="Name" maxlength="${PLAYER_NAME_MAX_LENGTH}" value="${joined && me ? escapeHtml(me.name) : ''}" ${joined ? 'disabled' : ''}>
            <button id="joinBtn" disabled>Join</button>
            <button id="leaveBtn" ${joined ? '' : 'disabled'}>Leave</button>
          </div>
          <details class="waiting-drawer" data-waiting-drawer="bots" ${botsOpen}>
            <summary>Bots</summary>
            <div class="drawer-content">
              <div class="row bot-row">
                <select id="botTypeSelect" ${firstAvailableBot && state.players.length < 9 ? '' : 'disabled'}>
                  ${botOptions}
                </select>
                <button id="addBotBtn" class="expected-action" disabled>Add bot</button>
              </div>
              <div id="botPersonalitySlot">${renderBotPersonality('')}</div>
            </div>
          </details>
          <details class="waiting-drawer" data-waiting-drawer="settings" ${settingsOpen}>
            <summary>Settings</summary>
            <div class="drawer-content waiting-selectors">
              <label class="setting-row" for="gameTargetSelect">
                <span>Game length</span>
                <select id="gameTargetSelect">
                  <option value="50" ${state.gameTarget === 50 ? 'selected' : ''}>Short game, 50 points</option>
                  <option value="100" ${state.gameTarget === 100 ? 'selected' : ''}>Full game, 100 points</option>
                </select>
              </label>
              <label class="setting-row" for="deckSettingSelect">
                <span>Deck amount</span>
                <select id="deckSettingSelect">
                  <option value="one" ${state.deckSetting === 'one' ? 'selected' : ''} ${state.oneDeckDisabled ? 'disabled' : ''}>One deck</option>
                  <option value="two" ${state.deckSetting === 'two' ? 'selected' : ''}>Two decks</option>
                </select>
              </label>
            </div>
          </details>
          <section class="waiting-player-list player-list" aria-labelledby="waitingPlayersHeading">
            <h2 id="waitingPlayersHeading">Players</h2>
            ${players || "<p class=\"hint\">No players yet.</p>"}
            ${players ? playerHint : ""}
          </section>
        </div>
        <button id="startBtn" class="expected-action" ${startDisabled ? 'disabled' : ''}>Start game</button>
      </div>
      ${repoLink(state.version)}
    </div>
  `;

  const nameInput = document.getElementById('nameInput');
  const joinBtn = document.getElementById('joinBtn');
  if (nameInput && joinBtn) {
    nameInput.addEventListener('input', () => {
      if (nameInput.value.length > PLAYER_NAME_MAX_LENGTH) nameInput.value = nameInput.value.slice(0, PLAYER_NAME_MAX_LENGTH);
      joinBtn.disabled = !canJoinWithName(state, nameInput.value);
    });
    joinBtn.disabled = !canJoinWithName(state, nameInput.value);
    joinBtn.addEventListener('click', () => {
      clientActions.clearPendingConfirm();
      emit('join', { name: nameInput.value.slice(0, PLAYER_NAME_MAX_LENGTH), token: playerToken });
    });
    nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !joinBtn.disabled) {
        clientActions.clearPendingConfirm();
        emit('join', { name: nameInput.value.slice(0, PLAYER_NAME_MAX_LENGTH), token: playerToken });
      }
    });
  }
  const leaveBtn = document.getElementById('leaveBtn');
  if (leaveBtn) leaveBtn.addEventListener('click', () => clientActions.confirmThen(leaveBtn, 'leave-waiting', 'Confirm leave', () => emit('leave')));
  document.querySelectorAll('[data-waiting-drawer]').forEach((details) => {
    details.addEventListener('toggle', () => {
      waitingDrawerPreferences[details.dataset.waitingDrawer] = details.open;
    });
  });
  const botTypeSelect = document.getElementById('botTypeSelect');
  const addBotBtn = document.getElementById('addBotBtn');
  if (botTypeSelect && addBotBtn) {
    const botPersonalitySlot = document.getElementById('botPersonalitySlot');
    const updateBotPersonality = () => {
      const selectedOption = botTypeSelect.selectedOptions[0];
      const type = selectedOption && !selectedOption.disabled ? botTypeSelect.value : '';
      if (botPersonalitySlot) botPersonalitySlot.innerHTML = renderBotPersonality(type);
      addBotBtn.disabled = !type || state.players.length >= 9;
      const startButton = document.getElementById('startBtn');
      if (startButton) startButton.disabled = !state.canStart || !joined || !!type;
    };
    updateBotPersonality();
    botTypeSelect.addEventListener('change', updateBotPersonality);
    addBotBtn.addEventListener('click', () => {
      clientActions.clearPendingConfirm();
      emit('addBot', botTypeSelect.value);
    });
  }
  const deckSettingSelect = document.getElementById('deckSettingSelect');
  if (deckSettingSelect) {
    deckSettingSelect.addEventListener('change', () => {
      clientActions.clearPendingConfirm();
      emit('setDeckSetting', deckSettingSelect.value);
    });
  }
  const gameTargetSelect = document.getElementById('gameTargetSelect');
  if (gameTargetSelect) {
    gameTargetSelect.addEventListener('change', () => {
      clientActions.clearPendingConfirm();
      emit('setGameTarget', gameTargetSelect.value);
    });
  }
  document.querySelectorAll('[data-action="moveWaitingPlayer"]').forEach((button) => {
    button.addEventListener('click', () => {
      clientActions.clearPendingConfirm();
      emit('moveWaitingPlayer', { playerId: button.dataset.playerId || '', direction: button.dataset.direction || '' });
    });
  });
  document.querySelectorAll('[data-action="removeWaitingPlayer"]').forEach((button) => {
    button.addEventListener('click', () => {
      clientActions.confirmThen(button, `remove-${button.dataset.playerId}`, 'Confirm remove', () => emit('removeWaitingPlayer', button.dataset.playerId || ''));
    });
  });
  const startBtn = document.getElementById('startBtn');
  if (startBtn) startBtn.addEventListener('click', () => {
    clientActions.clearPendingConfirm();
    emit('startGame');
  });
}

function renderGame(state) {
  const round = state.round;
  const me = round.players.find((p) => p.id === state.you);
  const others = round.players.filter((p) => p.id !== state.you);
  app.innerHTML = `
    <div class="main-layout">
      <main class="game-area">
        <section class="other-players">
          ${others.map((player) => renderPlayerField(player, state, true)).join('')}
        </section>
        ${renderDeckPile(state)}
        ${me ? renderOwnArea(me, state) : ''}
      </main>
      ${renderSideArea(state)}
    </div>
  `;
  clientActions.wireGameButtons();
}

function renderStatus(state) {
  const r = state.round;
  let text = '';
  if (r.stage === 'peek') {
    text = 'Start peek: each player must look at exactly two own cards.';
  } else if (r.stage === 'special' && r.special) {
    text = `${r.special.actorName} may use ${specialLabel(r.special.type)} or click Next player.`;
  } else if (r.stage === 'roundEnd') {
    text = 'Round ended. Cards are revealed and points were counted.';
  } else if (r.stage === 'gameEnd') {
    text = `Game ended. Winner: ${r.winnerName || 'unknown'}.`;
  } else if (r.turnComplete && r.currentPlayerId === state.you) {
    text = 'Your turn is complete. Say Dutch or click Next player.';
  } else if (r.turnComplete) {
    text = `${r.currentPlayerName}'s turn is complete. Waiting for Next player.`;
  } else {
    text = `${r.currentPlayerName}'s move.`;
  }
  const dutch = r.dutchCallerName ? `<div>${escapeHtml(r.dutchCallerName)} called Dutch. ${r.dutchTurnsRemaining} player turn(s) remaining.</div>` : '';
  const buttons = [
    '<button data-action="endGameForAll">End game for all</button>',
    '<button data-action="leave">Leave game</button>',
    `<button data-action="nextRound" class="expected-action" ${r.stage === 'roundEnd' ? '' : 'disabled'}>Next round</button>`,
    `<button data-action="newGame" class="expected-action" ${r.stage === 'gameEnd' ? '' : 'disabled'}>New game</button>`
  ].filter(Boolean).join('');
  return `
    <div class="status">
      <div class="status-main">
        <div class="status-info">
          <div>${escapeHtml(text)}</div>
          ${dutch}
        </div>
        ${buttons ? `<div class="status-actions">${buttons}</div>` : ''}
      </div>
    </div>
  `;
}

function renderPlayerMeta(player) {
  if (player.isSpectator) return '<div class="player-meta">Watching</div>';
  return `<div class="player-meta">Total: ${player.total}${player.roundPoints === null ? '' : `, round: ${player.roundPoints}`}</div>`;
}

function renderPlayerField(player, state, compact) {
  const current = player.isCurrent ? ' current' : '';
  const dutchCaller = state.round.dutchCallerId === player.id ? ' dutch-caller' : '';
  const finalTurnDone = player.finalTurnDone ? ' final-turn-done' : '';
  const roundWinner = (state.round.roundWinnerIds || []).includes(player.id);
  const gameWinner = state.round.winnerId === player.id;
  const winner = roundWinner || gameWinner ? ' winner' : '';
  const missing = player.connected ? '' : ' (missing)';
  return `
    <div class="player-field${current}${dutchCaller}${finalTurnDone}${winner}">
      <div class="player-title">
        <strong>${escapeHtml(player.name)}</strong>${missing}${playerBadges(state, player)}
        ${renderPlayerMeta(player)}
      </div>
      <div class="cards-row">
        ${player.cards.map((card, index) => renderCardCell(card, player.id, index, state, compact, false)).join('')}
      </div>
    </div>
  `;
}

function renderOwnArea(player, state) {
  const r = state.round;
  const dutchCaller = r.dutchCallerId === player.id ? ' dutch-caller' : '';
  const finalTurnDone = player.finalTurnDone ? ' final-turn-done' : '';
  const roundWinner = (r.roundWinnerIds || []).includes(player.id);
  const gameWinner = r.winnerId === player.id;
  const winner = roundWinner || gameWinner ? ' winner' : '';
  return `
    <section class="own-area${player.isCurrent ? ' current' : ''}${dutchCaller}${finalTurnDone}${winner}">
      <h2>${player.isSpectator ? 'Spectating' : 'Your cards'}</h2>
      <div class="player-title">
        <strong>${escapeHtml(player.name)}</strong>${playerBadges(state, player)}
        ${renderPlayerMeta(player)}
      </div>
      <div class="cards-row">
        ${player.cards.map((card, index) => renderCardCell(card, player.id, index, state, false, true)).join('')}
      </div>
      ${player.isSpectator ? '' : `<div class="row own-actions">
        <button data-action="sayDutch" class="expected-action" ${r.controls.canDutch ? '' : 'disabled'}>Dutch</button>
        <button data-action="endTurn" class="expected-action" ${r.controls.canEndTurn ? "" : "disabled"}>${endTurnLabel(state)}</button>
      </div>`}
    </section>
  `;
}

function endTurnLabel(state) {
  const r = state.round;
  if (['turn', 'special'].includes(r.stage) && r.dutchCallerId && r.dutchTurnsRemaining === 0 && r.currentPlayerId === state.you) return 'Finish round';
  return 'Next player';
}

function playerBadges(state, player) {
  const r = state.round;
  const badges = [];
  if (player.isBot) badges.push('<span class="bot-badge">bot</span>');
  if (player.isSpectator) badges.push('<span class="spectator-badge">spectator</span>');
  if (r.dutchCallerId === player.id) badges.push('<span class="player-badge dutch-badge">said Dutch</span>');
  if ((r.roundWinnerIds || []).includes(player.id)) badges.push('<span class="player-badge round-winner-badge">won this round</span>');
  if (r.winnerId === player.id) badges.push('<span class="player-badge game-winner-badge">won the game</span>');
  return badges.join('');
}

function renderDeckPile(state) {
  const r = state.round;
  const drawnCard = r.drawn
    ? cardHtml(r.drawn.card, false, { 'data-anim-role': 'drawn', 'data-location-key': 'drawn' })
    : '<div class="card empty-card drawn-placeholder">empty</div>';
  const drawnLabel = r.drawn ? '<div>Drawn</div>' : '<div class="drawn-label-spacer" aria-hidden="true">Drawn</div>';
  const discardButton = r.drawn
    ? `<button data-action="discardDrawn" ${r.controls.canDiscardDrawn ? '' : 'disabled'}>Discard</button>`
    : '<button class="drawn-button-spacer" disabled aria-hidden="true" tabindex="-1">Discard</button>';

  return `
    <section class="deck-pile-area">
      <div class="stack-area">
        <div>Deck (${r.deckCount})</div>
        <div class="stack" data-stack="deck">
          ${stackBacks(r.deckCount, r.deckBack)}
        </div>
        <button data-action="takeDeck" class="expected-action" ${r.controls.canTake ? '' : 'disabled'}>Take</button>
      </div>
      <div class="drawn-area">
        ${drawnLabel}
        <div class="drawn-card-slot">
          ${drawnCard}
        </div>
        ${discardButton}
      </div>
      <div class="stack-area">
        <div>Pile (${r.discardCount})</div>
        <div class="stack" data-stack="pile">
          ${stackPile(r)}
        </div>
        <button data-action="takePile" class="expected-action" ${r.controls.canTake && r.discardCount > 0 ? '' : 'disabled'}>Take</button>
      </div>
    </section>
  `;
}
function stackBacks(count, color) {
  if (count <= 0) return '<div class="card empty-card">empty</div>';
  const shown = Math.min(3, count);
  let html = '';
  for (let i = 0; i < shown; i += 1) {
    const backColor = color === 'mixed' ? (i % 2 === 0 ? 'red' : 'blue') : color;
    const topAttrs = i === shown - 1 ? ' data-anim-role="deck-top" data-location-key="deck-top"' : '';
    html += `<div class="card back-${backColor}" data-face-kind="stack-back"${topAttrs}>##</div>`;
  }
  return html;
}

function stackPile(r) {
  if (!r.discardTop) return '<div class="card empty-card">empty</div>';
  let under = '';
  if (r.discardCount > 1) under = '<div class="card back-blue" data-face-kind="stack-back">##</div>';
  return `${under}${cardHtml(r.discardTop, false, { 'data-anim-role': 'pile-top', 'data-location-key': 'pile-top', 'data-highlight': r.pileHighlight || '' })}`;
}

function renderCardCell(card, ownerId, index, state, compact, own) {
  const r = state.round;
  const buttons = [];
  const showingStartPeek = own && r.stage === "peek" && r.controls.canPeekStart;
  const startPeekDisabled = !r.controls.canPeekStart || !!card.startPeeked;
  if (showingStartPeek) {
    buttons.push(`<button data-action="peekStart" class="expected-action" data-card-id="${card.id}" ${startPeekDisabled ? "disabled" : ""}>Peek</button>`);
  }
  if (own) {
    buttons.push(`<button data-action="swapDrawn" data-card-id="${card.id}" ${r.controls.canSwapDrawn ? "" : "disabled"}>Swap</button>`);
    buttons.push(`<button data-action="throwIn" data-card-id="${card.id}" ${r.controls.canThrowIn ? "" : "disabled"}>Throw in</button>`);
  }
  const specialAction = showingStartPeek ? "" : renderCardSpecialAction(card, ownerId, r);
  if (specialAction) buttons.push(specialAction);

  const selected = r.special && r.special.actorId !== state.you && r.special.selected && r.special.selected.includes(card.id);
  return `
    <div class="card-cell" data-owner-id="${escapeHtml(ownerId)}" data-card-slot="${escapeHtml(ownerId)}:${index}">
      ${cardHtml(card, compact, { 'data-location-key': `player:${ownerId}:${index}`, 'data-selected': selected ? 'true' : '', 'data-highlight': card.highlight || '' })}
      <div class="card-buttons">${buttons.join('')}</div>
    </div>
  `;
}

function renderCardSpecialAction(card, ownerId, r) {
  const protectedTarget = (r.protectedSpecialTargetIds || []).includes(ownerId);
  if (r.controls.canAceAdd && !protectedTarget) {
    return '<button data-action="aceAdd" data-player-id="' + escapeHtml(ownerId) + '">' + cardActionLabel('A', 'add') + '</button>';
  }
  if (r.controls.canQueenPeek) {
    return '<button data-action="queenPeek" data-card-id="' + escapeHtml(card.id) + '">' + cardActionLabel('Q', 'peek') + '</button>';
  }
  if (r.controls.canJackSwap && !protectedTarget) {
    const selected = r.special && r.special.selected && r.special.selected.includes(card.id);
    return '<button data-action="jackSelect" data-card-id="' + escapeHtml(card.id) + '" ' + (selected ? 'disabled' : '') + '>' + cardActionLabel('J', 'swap') + '</button>';
  }
  return '<button class="special-action-placeholder" disabled>Action</button>';
}

function cardActionLabel(symbol, text) {
  return `<span class="card-action-label"><span class="card-symbol">${symbol}</span> <span>${escapeHtml(text)}</span></span>`;
}

function cardHtml(card, small, extraAttrs = {}) {
  const smallClass = small ? ' small' : '';
  if (!card) return `<div class="card${smallClass} empty-card">empty</div>`;
  const faceKind = card.back ? 'back' : 'front';
  const dataAttrs = attrsToText({
    'data-card-id': card.id,
    'data-face-kind': faceKind,
    ...extraAttrs
  });
  if (card.back) {
    return `<div class="card${smallClass} back-${card.deckColor}" ${dataAttrs}>##</div>`;
  }
  const color = card.red ? 'red' : 'black';
  return `
    <div class="card${smallClass} ${color}" ${dataAttrs}>
      <div>
        <div class="rank">${escapeHtml(card.rank)}${escapeHtml(card.symbol)}</div>
        <div class="points">${card.points}</div>
      </div>
    </div>
  `;
}

function renderSideArea(state) {
  const r = state.round;
  const gameFinished = r.stage === 'gameEnd';
  const firstRoundActive = state.roundNumber <= 1 && !['roundEnd', 'gameEnd'].includes(r.stage);
  const detailsMode = gameFinished ? 'finished' : firstRoundActive ? 'first-round' : 'scoring';
  currentDetailsMode = detailsMode;
  if (!detailPreferencesByMode[detailsMode]) detailPreferencesByMode[detailsMode] = {};
  const pointsDefaultOpen = gameFinished || !firstRoundActive;
  const guideDefaultOpen = firstRoundActive;
  const logDefaultOpen = !gameFinished;
  return `
    <aside class="side-area">
      ${renderStatus(state)}
      ${renderDetails('guide', 'Quick guide', shortInstructions(), guideDefaultOpen)}
      ${renderDetails('rules', 'Complete rules', fullRules(state), false, 'rules-body')}
      ${renderDetails('points', 'Points', pointsTable(state), pointsDefaultOpen)}
      ${renderDetails('log', 'Game log', renderLog(state), logDefaultOpen)}
      ${repoLink(state.version)}
    </aside>
  `;
}

function renderDetails(key, title, content, defaultOpen, extraClass = '') {
  const preferences = detailPreferencesByMode[currentDetailsMode] || {};
  const open = preferences[key] === undefined ? defaultOpen : preferences[key];
  return `
    <details data-detail-key="${escapeHtml(key)}" class="${escapeHtml(extraClass)}" ${open ? 'open' : ''}>
      <summary>${escapeHtml(title)}</summary>
      ${content}
    </details>
  `;
}

function renderLog(state) {
  const lines = state.log || [];
  const visibleLines = logExpanded ? lines : lines.slice(0, 8);
  const items = visibleLines.map((entry, index) => {
    const line = typeof entry === "string" ? { text: entry, kind: "game" } : entry;
    const isSystem = line.kind === "system";
    const moveNumber = lines.length - index;
    return '<li value="' + moveNumber + '" class="' + (isSystem ? 'system-log' : '') + '">' + escapeHtml(line.text) + '</li>';
  }).join("");
  const controls = lines.length > 8
    ? '<div class="log-controls">' +
        (logExpanded ? '<button type="button" class="log-toggle" data-action="downloadLog">Download game logs</button>' : '') +
        '<button type="button" class="log-toggle" data-action="toggleLog">' + (logExpanded ? 'Show less' : 'Show more') + '</button>' +
      '</div>'
    : "";
  return '<ol class="log">' + items + '</ol>' + controls;
}

function logLinesForDownload(state) {
  const lines = state && Array.isArray(state.log) ? state.log : [];
  const relativeBaseMs = logRelativeBaseMs(lines);
  const orderedLines = lines.slice().reverse();
  return orderedLines.map((entry, index) => {
    const line = typeof entry === "string" ? { text: entry, kind: "game" } : entry;
    const moveNumber = index + 1;
    const kind = line.kind && line.kind !== "game" ? " [" + line.kind + "]" : "";
    return formatRelativeLogTime(logEntryTimeMs(line), relativeBaseMs) + " " + moveNumber + "." + kind + " " + String(line.text || "");
  });
}

function scoreHistoryForDownload(state) {
  const history = state && Array.isArray(state.scoreHistory) ? state.scoreHistory : [];
  return scoreHistoryRows(history);
}

function gameStartedLogTimestamp(state, fallbackDate = new Date()) {
  if (!state || !state.gameStartedAt) return logTimestamp(fallbackDate);
  const startedAt = new Date(state.gameStartedAt);
  return Number.isNaN(startedAt.getTime()) ? logTimestamp(fallbackDate) : logTimestamp(startedAt);
}

function downloadLogFile(state) {
  const exportedTimestamp = logTimestamp();
  const startedTimestamp = gameStartedLogTimestamp(state);
  const title = "Dutch game log " + startedTimestamp;
  const body = [
    title,
    "Exported: " + exportedTimestamp,
    "",
    "Points table:",
    ...scoreHistoryForDownload(state),
    "",
    "Game log:",
    ...logLinesForDownload(state)
  ].join("\n") + "\n";
  const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "dutch-game-log-" + startedTimestamp + ".txt";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function pointsTable(state) {
  const history = state.scoreHistory || [];
  const playerMap = new Map();
  history.forEach((entry) => {
    entry.players.forEach((player) => {
      if (!playerMap.has(player.id)) playerMap.set(player.id, { id: player.id, name: player.name });
    });
  });
  state.round.players.filter((player) => !player.isSpectator).forEach((player) => {
    if (!playerMap.has(player.id)) playerMap.set(player.id, { id: player.id, name: player.name });
  });
  const players = Array.from(playerMap.values());
  const historyRows = history.map((entry) => {
    const cells = players.map((p) => {
      const item = entry.players.find((h) => h.id === p.id);
      return `<td>${item ? item.total : ""}</td>`;
    }).join("");
    return `<tr><th>Round ${entry.round}</th>${cells}</tr>`;
  }).join("");

  return `
    <div class="score-scroll">
      <table class="score-table">
        <thead><tr><th>Round</th>${players.map((p) => `<th title="${escapeHtml(p.name)}">${escapeHtml(shortPlayerName(p.name))}</th>`).join('')}</tr></thead>
        <tbody>
          ${historyRows || '<tr><th>Round</th><td colspan="99">No completed rounds yet.</td></tr>'}
        </tbody>
      </table>
    </div>
    <p class="points-note">Values show total points after each round. Number cards count their value. A=1, J=11, Q=12, red K=0, black K=13.</p>
  `;
}
function shortInstructions() {
  return quickRulesHtml();
}

function fullRules(state) {
  return fullRulesHtml(state.gameTarget);
}

function captureAnimationSnapshot() {
  const snapshot = { cards: new Map(), roles: new Map(), locations: new Map() };
  document.querySelectorAll('.card').forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const data = {
      rect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      },
      html: el.outerHTML,
      faceKind: el.dataset.faceKind || '',
      locationKey: el.dataset.locationKey || ''
    };
    if (el.dataset.cardId) snapshot.cards.set(el.dataset.cardId, data);
    if (el.dataset.animRole) snapshot.roles.set(el.dataset.animRole, data);
    if (el.dataset.locationKey) snapshot.locations.set(el.dataset.locationKey, data);
  });
  return snapshot;
}

function stateCardLocations(state) {
  const result = new Map();
  const round = state && state.round;
  if (!round) return result;
  round.players.forEach((player) => {
    player.cards.forEach((card, index) => {
      if (!card || !card.id) return;
      result.set(card.id, {
        id: card.id,
        locationKey: `player:${player.id}:${index}`,
        faceKind: card.back ? 'back' : 'front',
        ownerId: player.id,
        index
      });
    });
  });
  if (round.discardTop && round.discardTop.id) {
    result.set(round.discardTop.id, {
      id: round.discardTop.id,
      locationKey: 'pile-top',
      faceKind: round.discardTop.back ? 'back' : 'front'
    });
  }
  if (round.drawn && round.drawn.card && round.drawn.card.id) {
    result.set(round.drawn.card.id, {
      id: round.drawn.card.id,
      locationKey: 'drawn',
      faceKind: round.drawn.card.back ? 'back' : 'front',
      source: round.drawn.source
    });
  }
  return result;
}

function animateStateTransition(previousState, state, before, after) {
  if (!previousState.round || !state.round) return;
  if (previousState.roundNumber !== state.roundNumber) return;
  const previousCards = stateCardLocations(previousState);
  const currentCards = stateCardLocations(state);
  const movedIds = new Set();

  currentCards.forEach((current, cardId) => {
    const previous = previousCards.get(cardId);
    const targetData = after.cards.get(cardId);
    if (!targetData) return;

    if (previous && previous.locationKey !== current.locationKey) {
      const sourceData = before.cards.get(cardId) || before.locations.get(previous.locationKey);
      if (sourceData) {
        animateCardMove(sourceData, targetData);
        movedIds.add(cardId);
      }
      return;
    }

    if (!previous && current.locationKey === 'drawn' && state.round.drawn && state.round.drawn.source === 'deck') {
      const sourceData = before.roles.get('deck-top');
      if (sourceData) {
        animateCardMove(sourceData, targetData);
        movedIds.add(cardId);
      }
      return;
    }

    if (!previous && current.locationKey.startsWith('player:')) {
      const sourceData = before.roles.get('deck-top');
      if (sourceData) {
        animateCardMove(sourceData, targetData);
        movedIds.add(cardId);
      }
    }
  });

  currentCards.forEach((current, cardId) => {
    if (movedIds.has(cardId)) return;
    const previous = previousCards.get(cardId);
    if (!previous) return;
    if (previous.locationKey !== current.locationKey) return;
    if (previous.faceKind === current.faceKind) return;
    if (!['front', 'back'].includes(previous.faceKind) || !['front', 'back'].includes(current.faceKind)) return;
    const target = document.querySelector(`.card[data-card-id="${cssEscape(cardId)}"]`);
    if (target) animateFaceTurn(target);
  });
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
  return String(value).replace(/"/g, '\\"');
}

function animateCardMove(sourceData, targetData) {
  const target = elementAtRect(targetData.rect, targetData.locationKey);
  const source = sourceData.rect;
  const dest = targetData.rect;
  if (!target) return;
  if (Math.abs(source.left - dest.left) < 2 && Math.abs(source.top - dest.top) < 2) return;

  const clone = target.cloneNode(true);
  clone.classList.add('moving-card');
  clone.removeAttribute('data-card-id');
  clone.removeAttribute('data-action');
  clone.style.left = `${source.left}px`;
  clone.style.top = `${source.top}px`;
  clone.style.width = `${source.width}px`;
  clone.style.height = `${source.height}px`;
  clone.style.margin = '0';
  clone.style.transformOrigin = 'top left';
  document.body.appendChild(clone);

  target.classList.add('anim-target-hidden');
  const scaleX = dest.width / source.width;
  const scaleY = dest.height / source.height;
  const animation = clone.animate([
    { transform: 'translate(0, 0) scale(1, 1)' },
    { transform: `translate(${dest.left - source.left}px, ${dest.top - source.top}px) scale(${scaleX}, ${scaleY})` }
  ], {
    duration: 360,
    easing: 'linear',
    fill: 'forwards'
  });
  animation.onfinish = () => {
    clone.remove();
    target.classList.remove('anim-target-hidden');
  };
  animation.oncancel = () => {
    clone.remove();
    target.classList.remove('anim-target-hidden');
  };
}

function elementAtRect(rect, locationKey) {
  if (locationKey) {
    const byLocation = document.querySelector(`.card[data-location-key="${cssEscape(locationKey)}"]`);
    if (byLocation) return byLocation;
  }
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const el = document.elementFromPoint(centerX, centerY);
  return el ? el.closest('.card') : null;
}

function animateFaceTurn(el) {
  el.animate([
    { transform: 'scaleX(1)' },
    { transform: 'scaleX(0.12)' },
    { transform: 'scaleX(1)' }
  ], {
    duration: 260,
    easing: 'linear'
  });
}
