const socket = io({ autoConnect: false });
const app = document.getElementById('app');
const PLAYER_TOKEN_KEY = 'dutchPlayerSessionToken';
const PLAYER_TAB_KEY = 'dutchPlayerTabId';
const PLAYER_TOKEN_BACKUP_PREFIX = 'dutchPlayerSessionToken:';
const PLAYER_TAB_WINDOW_PREFIX = 'dutch-tab:';
const PLAYER_NAME_KEY = 'dutchPlayerName';
const playerToken = getPlayerToken();
let lastState = null;
let pendingManualRejoin = null;
let hasRenderedGame = false;
let currentDetailsMode = '';
let logExpanded = false;
const activeCardMoves = new Map();
const activeWrongThrows = new Map();
const detailPreferencesByMode = {};
const waitingDrawerPreferences = { bots: false, settings: false };
const SPECTATOR_TRIGGER_NAME = 'spectator';
const RIGHT_PANEL_SCROLL_TARGETS = [
  ['side-area', '.side-area'],
  ['status-info', '.side-status-card .status-info'],
  ['score-scroll', '.score-scroll']
];
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
  wireAnimatedDrawers,
  detailPreferencesByMode,
  getDetailsMode: () => currentDetailsMode,
  getLastState: () => lastState,
  getLogExpanded: () => logExpanded,
  setLogExpanded: (value) => { logExpanded = value; }
});

function wireAnimatedDrawers(scope, onChange) {
  scope.querySelectorAll("details.drawer").forEach((details) => {
    const summary = details.querySelector(":scope > summary");
    const content = details.querySelector(":scope > .drawer-animation-content");
    if (!summary || !content) return;

    let animation = null;
    let targetOpen = details.open;

    summary.addEventListener("click", (event) => {
      event.preventDefault();
      targetOpen = animation ? !targetOpen : !details.open;
      if (typeof onChange === "function") onChange(details, targetOpen);

      const runningHeight = animation ? content.getBoundingClientRect().height : null;
      const runningOpacity = animation ? Number.parseFloat(getComputedStyle(content).opacity) : null;
      if (animation) animation.cancel();
      if (!content.animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        details.open = targetOpen;
        content.removeAttribute("style");
        animation = null;
        return;
      }

      if (targetOpen) details.open = true;
      const startHeight = runningHeight === null
        ? (targetOpen ? 0 : content.getBoundingClientRect().height)
        : runningHeight;
      const startOpacity = runningOpacity === null ? (targetOpen ? 0 : 1) : runningOpacity;
      const endHeight = targetOpen ? content.scrollHeight : 0;
      content.style.overflow = "hidden";

      const currentAnimation = content.animate([
        { height: `${startHeight}px`, opacity: startOpacity },
        { height: `${endHeight}px`, opacity: targetOpen ? 1 : 0 }
      ], {
        duration: 220,
        easing: targetOpen ? "cubic-bezier(0.2, 0.8, 0.2, 1)" : "cubic-bezier(0.4, 0, 1, 1)"
      });
      animation = currentAnimation;

      currentAnimation.onfinish = () => {
        if (animation !== currentAnimation) return;
        details.open = targetOpen;
        content.removeAttribute("style");
        animation = null;
      };
      currentAnimation.oncancel = () => {
        if (animation === currentAnimation) animation = null;
      };
    });
  });
}

function generatePlayerToken() {
  return window.crypto && window.crypto.randomUUID
    ? window.crypto.randomUUID()
    : 'player-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

function readSessionValue(key) {
  try {
    return window.sessionStorage.getItem(key) || '';
  } catch (error) {
    return '';
  }
}

function rememberSessionValue(key, value) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch (error) {
    // Storage can fail in private browsing; in-memory identity still works for this page load.
  }
}

function readLocalValue(key) {
  try {
    return window.localStorage.getItem(key) || '';
  } catch (error) {
    return '';
  }
}

function rememberLocalValue(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    // A blocked backup only affects reload recovery; current-tab play still works.
  }
}

function getPlayerTabId() {
  const existing = readSessionValue(PLAYER_TAB_KEY);
  if (existing) return existing;
  const fromWindowName = String(window.name || '').startsWith(PLAYER_TAB_WINDOW_PREFIX)
    ? String(window.name).slice(PLAYER_TAB_WINDOW_PREFIX.length)
    : '';
  const tabId = fromWindowName || generatePlayerToken();
  rememberSessionValue(PLAYER_TAB_KEY, tabId);
  try {
    window.name = PLAYER_TAB_WINDOW_PREFIX + tabId;
  } catch (error) {
    // The session value is enough for ordinary reloads.
  }
  return tabId;
}

function rememberPlayerTokenBackup(token) {
  rememberLocalValue(PLAYER_TOKEN_BACKUP_PREFIX + getPlayerTabId(), token);
}

function getPlayerToken() {
  const tabId = getPlayerTabId();
  const existing = readSessionValue(PLAYER_TOKEN_KEY);
  if (existing) {
    rememberLocalValue(PLAYER_TOKEN_BACKUP_PREFIX + tabId, existing);
    return existing;
  }
  const backedUp = readLocalValue(PLAYER_TOKEN_BACKUP_PREFIX + tabId);
  if (backedUp) {
    rememberSessionValue(PLAYER_TOKEN_KEY, backedUp);
    return backedUp;
  }
  const token = generatePlayerToken();
  rememberSessionValue(PLAYER_TOKEN_KEY, token);
  rememberLocalValue(PLAYER_TOKEN_BACKUP_PREFIX + tabId, token);
  return token;
}

function readStoredValue(key) {
  try {
    return window.localStorage.getItem(key) || window.sessionStorage.getItem(key) || '';
  } catch (error) {
    try {
      return window.sessionStorage.getItem(key) || '';
    } catch (sessionError) {
      return '';
    }
  }
}

function rememberStoredValue(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    try {
      window.sessionStorage.setItem(key, value);
    } catch (sessionError) {
      // Storage can fail in private browsing; the in-memory token still works for this tab.
    }
  }
}

function getStoredPlayerName() {
  return readStoredValue(PLAYER_NAME_KEY);
}

function rememberPlayerName(name) {
  const trimmedName = String(name || '').trim().slice(0, PLAYER_NAME_MAX_LENGTH);
  if (trimmedName) rememberStoredValue(PLAYER_NAME_KEY, trimmedName);
}

socket.on('connect', () => {
  socket.emit('identify', playerToken);
  if (pendingManualRejoin) {
    socket.emit('join', pendingManualRejoin);
    pendingManualRejoin = null;
  }
});

socket.on('disconnect', () => {
  if (!lastState || !lastState.joined || lastState.phase !== 'playing') return;
  render({
    ...lastState,
    joined: false,
    players: (lastState.players || []).map((player) => (
      player.id === lastState.you ? { ...player, connected: false } : player
    ))
  });
});

socket.on('state', (state) => {
  const previousState = lastState;
  const beforeSnapshot = captureAnimationSnapshot();
  render(state);
  if (state.phase === 'playing' && state.round) {
    hideActiveCardMoveTargets();
  } else {
    cancelAllCardMoves();
    cancelAllWrongThrows();
  }
  const afterSnapshot = captureAnimationSnapshot();
  if (previousState && hasRenderedGame && state.phase === 'playing') {
    animateStateTransition(previousState, state, beforeSnapshot, afterSnapshot);
  } else if (previousState && state.phase === 'waiting') {
    animateWaitingPlayerListChanges(previousState, state, beforeSnapshot, afterSnapshot);
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

function normalizedReconnectName(name) {
  return String(name || '').trim().toLocaleLowerCase();
}

function canRejoinMissingPlayer(missingPlayers, name) {
  const normalized = normalizedReconnectName(name);
  if (!normalized) return false;
  return missingPlayers.some((player) => normalizedReconnectName(player.name) === normalized);
}

function bindActiveGameRejoin(missingPlayers = []) {
  const nameInput = document.getElementById('rejoinNameInput');
  const rejoinBtn = document.getElementById('rejoinBtn');
  if (!nameInput || !rejoinBtn) return;
  const update = () => {
    rejoinBtn.disabled = !canRejoinMissingPlayer(missingPlayers, nameInput.value);
  };
  const rejoin = () => {
    const name = nameInput.value.slice(0, PLAYER_NAME_MAX_LENGTH);
    if (!canRejoinMissingPlayer(missingPlayers, name)) return;
    rememberPlayerName(name);
    rememberPlayerTokenBackup(playerToken);
    const payload = { name, token: playerToken };
    if (socket.connected) emit('join', payload);
    else {
      pendingManualRejoin = payload;
      socket.connect();
    }
  };
  update();
  nameInput.addEventListener('input', update);
  nameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !rejoinBtn.disabled) rejoin();
  });
  rejoinBtn.addEventListener('click', rejoin);
}

function render(state) {
  if (!state.joined && state.phase === 'playing') {
    const gameStarted = gameStartedText(state.gameStartedAt);
    const gameSummary = activeGameSummary(state);
    const rejoinPlayers = (state.players || []).filter((player) => !player.isBot && !player.connected);
    const rejoinAvailable = rejoinPlayers.length > 0;
    const activeGameMessage = rejoinAvailable
      ? 'A game is already active. If you were disconnected, enter your name to rejoin.'
      : 'A game is already active. Join after the game ends.';
    const rejoinControls = rejoinAvailable ? `
          <div class="row join-row active-rejoin-row">
            <input id="rejoinNameInput" placeholder="Name" maxlength="${PLAYER_NAME_MAX_LENGTH}" value="">
            <button id="rejoinBtn" class="expected-action" disabled>Rejoin</button>
          </div>` : '';
    app.innerHTML = `
      <div class="page waiting-page">
        <h1 class="app-title">Dutch! 🂡</h1>
        <div class="waiting-panel">
          <p class="waiting-description">${escapeHtml(GAME_DESCRIPTION)}</p>
          <p>${activeGameMessage}</p>
          ${rejoinControls}
          ${gameStarted}
          ${gameSummary}
        </div>
        ${repoLink(state.version)}
      </div>
    `;
    bindActiveGameRejoin(rejoinPlayers);
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
    const valueText = personality ? escapeHtml(value + "/10") : "-/--";
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
  const selectedTheme = window.DutchTheme.getStoredTheme(window);
  const botTypes = ['dory', 'norman', 'athena', 'roswell'];
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
        ${isMe ? '<button data-action="leaveWaitingPlayer">Leave</button>' : `<button data-action="removeWaitingPlayer" data-player-id="${escapeHtml(p.id)}">Remove</button>`}
        <button class="icon-button" title="Move up" aria-label="Move ${escapeHtml(p.name)} up" data-action="moveWaitingPlayer" data-player-id="${escapeHtml(p.id)}" data-direction="up" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button class="icon-button" title="Move down" aria-label="Move ${escapeHtml(p.name)} down" data-action="moveWaitingPlayer" data-player-id="${escapeHtml(p.id)}" data-direction="down" ${index === state.players.length - 1 ? 'disabled' : ''}>↓</button>
      </div>
    `;
    return `
      <div class="player-line" data-waiting-player-id="${escapeHtml(p.id)}">
        <span>${index + 1}. ${escapeHtml(p.name)}${p.isBot ? ' <span class="bot-badge">bot</span>' : ''}${p.isSpectator ? ' <span class="spectator-badge">spectator</span>' : ''}${isMe ? ' <span class="you-badge">you</span>' : ''} ${p.connected ? '' : '(missing)'}</span>
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
          <details class="drawer waiting-drawer" data-waiting-drawer="bots" ${botsOpen}>
            <summary>Bots</summary>
            <div class="drawer-content drawer-animation-content">
              <div class="row bot-row">
                <select id="botTypeSelect" ${firstAvailableBot && state.players.length < 9 ? '' : 'disabled'}>
                  ${botOptions}
                </select>
                <button id="addBotBtn" class="expected-action" disabled>Add bot</button>
              </div>
              <div id="botPersonalitySlot">${renderBotPersonality('')}</div>
            </div>
          </details>
          <details class="drawer waiting-drawer" data-waiting-drawer="settings" ${settingsOpen}>
            <summary>Settings</summary>
            <div class="drawer-content drawer-animation-content waiting-selectors">
              <label class="setting-row" for="gameTargetSelect">
                <span>Game length</span>
                <select id="gameTargetSelect">
                  <option value="50" ${state.gameTarget === 50 ? 'selected' : ''}>Short game, 50 points</option>
                  <option value="100" ${state.gameTarget === 100 ? 'selected' : ''}>Full game, 100 points</option>
                </select>
              </label>
              ${inactivityTimeoutSettingHtml(state, 'inactivityTimeoutSelect')}
              <label class="setting-row" for="deckSettingSelect">
                <span>Deck amount</span>
                <select id="deckSettingSelect">
                  <option value="one" ${state.deckSetting === 'one' ? 'selected' : ''} ${state.oneDeckDisabled ? 'disabled' : ''}>One deck</option>
                  <option value="two" ${state.deckSetting === 'two' ? 'selected' : ''}>Two decks</option>
                </select>
              </label>
              <label class="setting-row" for="themeSelect">
                <span>Appearance</span>
                <select id="themeSelect">
                  <option value="light" ${selectedTheme === 'light' ? 'selected' : ''}>Light mode</option>
                  <option value="dark" ${selectedTheme === 'dark' ? 'selected' : ''}>Dark mode</option>
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
      const name = nameInput.value.slice(0, PLAYER_NAME_MAX_LENGTH);
      clientActions.clearPendingConfirm();
      rememberPlayerName(name);
      rememberPlayerTokenBackup(playerToken);
      emit('join', { name, token: playerToken });
    });
    nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !joinBtn.disabled) {
        const name = nameInput.value.slice(0, PLAYER_NAME_MAX_LENGTH);
        clientActions.clearPendingConfirm();
        rememberPlayerName(name);
        rememberPlayerTokenBackup(playerToken);
        emit('join', { name, token: playerToken });
      }
    });
  }
  const leaveBtn = document.getElementById('leaveBtn');
  if (leaveBtn) leaveBtn.addEventListener('click', () => clientActions.confirmThen(leaveBtn, 'leave-waiting', 'Confirm leave', () => emit('leave')));
  wireAnimatedDrawers(document, (details, open) => {
    if (details.dataset.waitingDrawer) waitingDrawerPreferences[details.dataset.waitingDrawer] = open;
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
  wireInactivityTimeoutSelect('inactivityTimeoutSelect');
  const themeSelect = document.getElementById('themeSelect');
  if (themeSelect) {
    themeSelect.addEventListener('change', () => {
      window.DutchTheme.setTheme(themeSelect.value, window);
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
  document.querySelectorAll('[data-action="leaveWaitingPlayer"]').forEach((button) => {
    button.addEventListener('click', () => {
      clientActions.confirmThen(button, 'leave-waiting', 'Confirm leave', () => emit('leave'));
    });
  });
  const startBtn = document.getElementById('startBtn');
  if (startBtn) startBtn.addEventListener('click', () => {
    clientActions.clearPendingConfirm();
    emit('startGame');
  });
}

function animateWaitingPlayerListChanges(previousState, state, before, after) {
  if (previousState.phase !== 'waiting' || !Element.prototype.animate) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const previousIds = new Set((previousState.players || []).map((player) => player.id));
  const currentIds = new Set((state.players || []).map((player) => player.id));
  const enterEasing = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
  const exitEasing = 'cubic-bezier(0.8, 0, 0.8, 0.2)';
  const isRemoving = (previousState.players || []).some((player) => !currentIds.has(player.id));
  (state.players || []).forEach((player) => {
    const selector = '[data-waiting-player-id="' + cssEscape(player.id) + '"]';
    const row = document.querySelector(selector);
    if (!row) return;
    if (previousIds.has(player.id)) {
      if (isRemoving) return;
      const previousRect = before.waitingPlayers.get(player.id);
      const currentRect = after.waitingPlayers.get(player.id);
      if (!previousRect || !currentRect) return;
      const deltaX = previousRect.left - currentRect.left;
      const deltaY = previousRect.top - currentRect.top;
      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;
      row.animate([
        { transform: 'translate(' + String(deltaX) + 'px, ' + String(deltaY) + 'px)' },
        { transform: 'translate(0, 0)' }
      ], {
        duration: 280,
        easing: isRemoving ? exitEasing : enterEasing
      });
      return;
    }
    const height = row.getBoundingClientRect().height;
    if (!height) return;
    row.style.overflow = 'hidden';
    const animation = row.animate([
      { height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0, transform: 'translateY(-8px)' },
      { height: String(height) + 'px', paddingTop: '4px', paddingBottom: '4px', opacity: 1, transform: 'translateY(0)' }
    ], {
      duration: 280,
      easing: enterEasing
    });
    const finish = () => row.style.removeProperty('overflow');
    animation.onfinish = finish;
    animation.oncancel = finish;
  });
  const waitingList = document.querySelector('.waiting-player-list');
  if (!waitingList) return;
  (previousState.players || []).forEach((player, index) => {
    if (currentIds.has(player.id)) return;
    const previousData = before.waitingPlayers.get(player.id);
    if (!previousData || !previousData.html) return;
    const template = document.createElement('template');
    template.innerHTML = previousData.html.trim();
    const ghost = template.content.firstElementChild;
    if (!ghost) return;
    ghost.removeAttribute('data-waiting-player-id');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.height = String(previousData.height) + 'px';
    ghost.style.overflow = 'hidden';
    ghost.style.pointerEvents = 'none';
    const nextPlayer = (previousState.players || []).slice(index + 1).find((candidate) => currentIds.has(candidate.id));
    const nextSelector = nextPlayer ? '[data-waiting-player-id="' + cssEscape(nextPlayer.id) + '"]' : '';
    const nextRow = nextSelector ? waitingList.querySelector(nextSelector) : null;
    const hint = waitingList.querySelector('.hint');
    waitingList.insertBefore(ghost, nextRow || hint || null);
    const animation = ghost.animate([
      { height: String(previousData.height) + 'px', paddingTop: '4px', paddingBottom: '4px', opacity: 1, transform: 'translateY(0)' },
      { height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0, transform: 'translateY(-8px)' }
    ], {
      duration: 280,
      easing: exitEasing,
      fill: 'forwards'
    });
    animation.onfinish = () => ghost.remove();
    animation.oncancel = () => ghost.remove();
  });
}

function captureRightPanelScroll() {
  return RIGHT_PANEL_SCROLL_TARGETS.reduce((snapshot, [key, selector]) => {
    const element = document.querySelector(selector);
    if (element) snapshot[key] = { top: element.scrollTop, left: element.scrollLeft };
    return snapshot;
  }, {});
}

function restoreRightPanelScroll(snapshot) {
  RIGHT_PANEL_SCROLL_TARGETS.forEach(([key, selector]) => {
    const position = snapshot[key];
    const element = position ? document.querySelector(selector) : null;
    if (!element) return;
    element.scrollTop = position.top;
    element.scrollLeft = position.left;
  });
}

function renderGame(state) {
  const round = state.round;
  const me = round.players.find((p) => p.id === state.you);
  const others = round.players.filter((p) => p.id !== state.you && !p.isSpectator);
  const rightPanelScroll = captureRightPanelScroll();
  app.innerHTML = `
    <div class="main-layout">
      <main class="game-area">
        <section class="other-players">
          ${others.map((player) => renderPlayerField(player, state, true)).join('')}
        </section>
        ${renderDeckPile(state)}
        ${me && !me.isSpectator ? renderOwnArea(me, state) : ''}
      </main>
      ${renderSideArea(state)}
    </div>
  `;
  clientActions.wireGameButtons();
  const gameThemeSelect = document.getElementById('gameThemeSelect');
  const inGameTargetSelect = document.getElementById('inGameTargetSelect');
  const highlightChangedCardsSelect = document.getElementById('highlightChangedCardsSelect');
  if (inGameTargetSelect) {
    inGameTargetSelect.addEventListener('change', () => {
      clientActions.clearPendingConfirm();
      emit('setGameTarget', inGameTargetSelect.value);
    });
  }
  wireInactivityTimeoutSelect('gameInactivityTimeoutSelect');
  if (highlightChangedCardsSelect) {
    highlightChangedCardsSelect.addEventListener('change', () => {
      emit('setHighlightChangedCards', highlightChangedCardsSelect.value);
    });
  }
  if (gameThemeSelect) {
    gameThemeSelect.addEventListener('change', () => {
      window.DutchTheme.setTheme(gameThemeSelect.value, window);
    });
  }
  restoreRightPanelScroll(rightPanelScroll);
}

function renderStatus(state) {
  const r = state.round;
  let text = '';
  let textHtml = '';
  if (r.stage === 'peek') {
    text = 'Start peek: each player must look at exactly two own cards.';
  } else if (r.stage === 'opening') {
    text = 'Opening card…';
  } else if (r.stage === 'special' && r.special) {
    text = `${r.special.actorName} may use ${specialLabel(r.special.type)} or click Next player.`;
  } else if (r.stage === 'roundEnd') {
    text = 'Round ended. Cards are revealed and points were counted.';
  } else if (r.stage === 'gameEnd') {
    textHtml = 'Game ended. <strong>Winner: ' + escapeHtml(r.winnerName || 'unknown') + '.</strong>';
  } else if (r.turnComplete && r.currentPlayerId === state.you) {
    text = 'Your turn is complete. Say Dutch or click Next player.';
  } else if (r.turnComplete) {
    text = `${r.currentPlayerName}'s turn is complete. Waiting for Next player.`;
  } else {
    text = `${r.currentPlayerName}'s move.`;
  }
  if (!textHtml) textHtml = escapeHtml(text);
  const statusClass = r.stage === 'gameEnd' ? 'status game-ended-status' : 'status';
  const finishActive = r.stage === 'gameEnd';
  const dutch = r.dutchCallerName ? `<div>${escapeHtml(r.dutchCallerName)} called Dutch. ${r.dutchTurnsRemaining} player turn(s) remaining.</div>` : '';
  const buttons = [
    `<button data-action="endGameForAll" ${finishActive ? 'disabled' : ''}>End game for all</button>`,
    `<button data-action="leave" ${finishActive ? 'disabled' : ''}>Leave game</button>`,
    `<button data-action="nextRound" class="expected-action" ${r.stage === 'roundEnd' ? '' : 'disabled'}>Next round</button>`,
    `<button data-action="newGame" class="expected-action" ${finishActive ? '' : 'disabled'}>Finish</button>`
  ].filter(Boolean).join('');
  return `
    <div class="${statusClass}">
      <div class="status-main">
        <div class="status-info">
          <div>${textHtml}</div>
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

function isWrongDutchCall(round, player) {
  return round.dutchCallerId === player.id
    && ['roundEnd', 'gameEnd'].includes(round.stage)
    && typeof player.roundPoints === 'number'
    && player.roundPoints !== 0;
}

function renderPlayerField(player, state, compact) {
  const current = player.isCurrent ? ' current' : '';
  const dutchCaller = state.round.dutchCallerId === player.id
    ? (isWrongDutchCall(state.round, player) ? ' wrong-dutch-call' : ' dutch-caller')
    : '';
  const finalTurnDone = player.finalTurnDone ? ' final-turn-done' : '';
  const roundWinner = (state.round.roundWinnerIds || []).includes(player.id);
  const gameWinner = state.round.winnerId === player.id;
  const winner = gameWinner ? ' game-winner' : (roundWinner ? ' round-winner' : '');
  const missing = player.connected ? '' : ' (missing)';
  return `
    <div class="player-field${current}${dutchCaller}${finalTurnDone}${winner}" data-player-panel-id="${escapeHtml(player.id)}">
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
  const dutchCaller = r.dutchCallerId === player.id
    ? (isWrongDutchCall(r, player) ? ' wrong-dutch-call' : ' dutch-caller')
    : '';
  const finalTurnDone = player.finalTurnDone ? ' final-turn-done' : '';
  const roundWinner = (r.roundWinnerIds || []).includes(player.id);
  const gameWinner = r.winnerId === player.id;
  const winner = gameWinner ? ' game-winner' : (roundWinner ? ' round-winner' : '');
  const areaLabel = player.isSpectator ? 'spectating' : 'your cards';
  return `
    <section class="own-area${player.isCurrent ? ' current' : ''}${dutchCaller}${finalTurnDone}${winner}" data-player-panel-id="${escapeHtml(player.id)}">
      <div class="player-title">
        <h2>${escapeHtml(player.name)} <span class="you-badge">${areaLabel}</span>${playerBadges(state, player)}</h2>
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
  if (r.dutchCallerId === player.id) {
    badges.push(isWrongDutchCall(r, player)
      ? `<span class="player-badge wrong-dutch-badge">wrong Dutch call</span>`
      : `<span class="player-badge dutch-badge">said Dutch</span>`);
  }
  if ((r.roundWinnerIds || []).includes(player.id)) badges.push('<span class="player-badge round-winner-badge">won this round</span>');
  if (r.winnerId === player.id) badges.push('<span class="player-badge game-winner-badge">won the game</span>');
  return badges.join('');
}

function renderDeckPile(state) {
  const r = state.round;
  const drawnCard = r.drawn
    ? cardHtml(r.drawn.card, false, { 'data-anim-role': 'drawn', 'data-location-key': 'drawn' })
    : '<div class="card empty-card drawn-placeholder">empty</div>';
  const drawnLabel = r.drawn ? '<div class="deck-pile-label">Drawn</div>' : '<div class="deck-pile-label drawn-label-spacer" aria-hidden="true">Drawn</div>';
  const discardButton = r.drawn
    ? `<button data-action="discardDrawn" ${r.controls.canDiscardDrawn ? '' : 'disabled'}>Discard</button>`
    : '<button class="drawn-button-spacer" disabled aria-hidden="true" tabindex="-1">Discard</button>';

  return `
    <section class="deck-pile-area">
      <div class="stack-area">
        <div class="deck-pile-label">Deck (${r.deckCount})</div>
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
        <div class="deck-pile-label">Pile (${r.discardCount})</div>
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

  const selected = r.special && r.special.selected && r.special.selected.includes(card.id);
  return `
    <div class="card-cell" data-owner-id="${escapeHtml(ownerId)}" data-card-slot="${escapeHtml(ownerId)}:${index}">
      ${cardHtml(card, compact, { 'data-location-key': `player:${ownerId}:${index}`, 'data-selected': selected ? 'true' : '', 'data-highlight': ['peek', 'wrong-throw'].includes(card.highlight) ? '' : (card.highlight || '') })}
      <div class="card-buttons">${buttons.join('')}</div>
    </div>
  `;
}

function renderCardSpecialAction(card, ownerId, r) {
  const protectedTarget = (r.protectedSpecialTargetIds || []).includes(ownerId);
  const selected = r.special && r.special.selected && r.special.selected.includes(card.id);
  if (r.controls.canAceAdd && !protectedTarget) {
    return '<button data-action="aceAdd" data-player-id="' + escapeHtml(ownerId) + '">' + cardActionLabel('A', 'add') + '</button>';
  }
  if (r.controls.canQueenPeek) {
    return '<button data-action="queenPeek" data-card-id="' + escapeHtml(card.id) + '">' + cardActionLabel('Q', 'peek') + '</button>';
  }
  if ((r.controls.canJackSwap || (r.controls.canJackUnselect && selected)) && !protectedTarget) {
    return '<button data-action="jackSelect" data-card-id="' + escapeHtml(card.id) + '">' + cardActionLabel('J', 'swap') + '</button>';
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

function inactivityTimeoutSettingHtml(state, id) {
  const minutes = state.inactivityTimeoutMinutes || 15;
  return `
    <label class="setting-row" for="${id}">
      <span>Inactive after</span>
      <select id="${id}">
        ${[15, 30, 60, 90].map((value) => `<option value="${value}" ${minutes === value ? 'selected' : ''}>${value} minutes</option>`).join('')}
      </select>
    </label>
  `;
}

function wireInactivityTimeoutSelect(id) {
  const select = document.getElementById(id);
  if (!select) return;
  select.addEventListener('change', () => {
    clientActions.clearPendingConfirm();
    emit('setInactivityTimeout', select.value);
  });
}

function renderSideArea(state) {
  const r = state.round;
  const selectedTheme = window.DutchTheme.getStoredTheme(window);
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
      <div class="side-status-card">
        ${renderStatus(state)}
      </div>
      <div class="panel side-panel">
        <div class="side-drawers">
          ${renderDetails('points', 'Points', pointsTable(state), pointsDefaultOpen)}
          ${renderDetails('log', 'Game log', renderLog(state), logDefaultOpen)}
          ${renderDetails('guide', 'Quick guide', shortInstructions(), guideDefaultOpen)}
          ${renderDetails('rules', 'Complete rules', fullRules(state), false, 'rules-body')}
          ${renderDetails('settings', 'Settings', `
            <div class="drawer-content waiting-selectors">
              <label class="setting-row" for="inGameTargetSelect">
                <span>Game length</span>
                <select id="inGameTargetSelect" ${state.canChangeGameTarget ? '' : 'disabled'}>
                  <option value="50" ${state.gameTarget === 50 ? 'selected' : ''}>Short game, 50 points</option>
                  <option value="100" ${state.gameTarget === 100 ? 'selected' : ''}>Full game, 100 points</option>
                </select>
              </label>
              ${inactivityTimeoutSettingHtml(state, 'gameInactivityTimeoutSelect')}
              <label class="setting-row" for="highlightChangedCardsSelect">
                <span>Changed cards</span>
                <select id="highlightChangedCardsSelect">
                  <option value="true" ${state.highlightChangedCards !== false ? 'selected' : ''}>Highlight</option>
                  <option value="false" ${state.highlightChangedCards === false ? 'selected' : ''}>Don't highlight</option>
                </select>
              </label>
              <label class="setting-row" for="gameThemeSelect">
                <span>Appearance</span>
                <select id="gameThemeSelect">
                  <option value="light" ${selectedTheme === 'light' ? 'selected' : ''}>Light mode</option>
                  <option value="dark" ${selectedTheme === 'dark' ? 'selected' : ''}>Dark mode</option>
                </select>
              </label>
            </div>
          `, false)}
        </div>
      </div>
      ${repoLink(state.version)}
    </aside>
  `;
}

function renderDetails(key, title, content, defaultOpen, extraClass = '') {
  const preferences = detailPreferencesByMode[currentDetailsMode] || {};
  const open = preferences[key] === undefined ? defaultOpen : preferences[key];
  const classes = ['drawer', 'side-drawer', extraClass].filter(Boolean).join(' ');
  return `
    <details data-detail-key="${escapeHtml(key)}" class="${escapeHtml(classes)}" ${open ? 'open' : ''}>
      <summary>${escapeHtml(title)}</summary>
      <div class="drawer-animation-content">${content}</div>
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
    : '';
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
  const winnerId = state.round.stage === 'gameEnd' ? state.round.winnerId : '';
  const historyRows = history.map((entry) => {
    const cells = players.map((p) => {
      const item = entry.players.find((h) => h.id === p.id);
      const winnerClass = winnerId && p.id === winnerId ? ' class="winner-points"' : "";
      return `<td${winnerClass}>${item ? item.total : ""}</td>`;
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
  const snapshot = { cards: new Map(), roles: new Map(), locations: new Map(), panels: new Map(), waitingPlayers: new Map() };
  document.querySelectorAll('[data-waiting-player-id]').forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.height) snapshot.waitingPlayers.set(el.dataset.waitingPlayerId, { left: rect.left, top: rect.top, width: rect.width, height: rect.height, html: el.outerHTML });
  });
  document.querySelectorAll("[data-player-panel-id]").forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.height) snapshot.panels.set(el.dataset.playerPanelId, { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
  });
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
        highlight: card.highlight || '',
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
  animatePlayerPanelResizes(previousState, state, before, after);
  animateJackSwapSelections(previousState, state);
  const previousCards = stateCardLocations(previousState);
  const currentCards = stateCardLocations(state);
  const previousWrongThrow = previousState.round.wrongThrowIn;
  const currentWrongThrow = state.round.wrongThrowIn;
  if (currentWrongThrow && (!previousWrongThrow || previousWrongThrow.id !== currentWrongThrow.id)) {
    animateWrongThrowIn(currentWrongThrow, before, after);
  }
  const movedIds = new Set();

  currentCards.forEach((current, cardId) => {
    const previous = previousCards.get(cardId);
    const targetData = after.cards.get(cardId);
    if (!targetData) return;

    if (previous && previous.locationKey !== current.locationKey) {
      const sourceData = before.cards.get(cardId) || before.locations.get(previous.locationKey);
      if (sourceData) {
        animateCardMove(cardId, sourceData, targetData);
        movedIds.add(cardId);
      }
      return;
    }

    if (!previous && current.locationKey === 'drawn' && state.round.drawn && state.round.drawn.source === 'deck') {
      const sourceData = before.roles.get('deck-top');
      if (sourceData) {
        animateCardMove(cardId, sourceData, targetData);
        movedIds.add(cardId);
      }
      return;
    }

    const openingDiscardAdded = !previous
      && current.locationKey === 'pile-top'
      && previousState.round.discardCount === 0
      && state.round.discardCount === 1
      && state.round.stage === 'opening';
    if (openingDiscardAdded) {
      const sourceData = before.roles.get('deck-top');
      if (sourceData) {
        animateCardMove(cardId, sourceData, targetData, 480);
        movedIds.add(cardId);
      }
      return;
    }

    if (!previous && current.locationKey.startsWith('player:')) {
      const sourceData = before.roles.get('deck-top');
      if (sourceData) {
        animateCardMove(cardId, sourceData, targetData);
        movedIds.add(cardId);
      }
    }
  });

  const finishedStage = ['roundEnd', 'gameEnd'].includes(state.round.stage);
  const enteringFinishedStage = finishedStage && !['roundEnd', 'gameEnd'].includes(previousState.round.stage);
  const revealCards = enteringFinishedStage ? Array.from(currentCards.entries()).filter(([cardId, current]) => {
    const previous = previousCards.get(cardId);
    return previous && previous.locationKey === current.locationKey && previous.faceKind !== current.faceKind;
  }) : [];
  const dutchCallerId = state.round.dutchCallerId || '';
  revealCards.sort((left, right) => {
    const leftIsCaller = left[1].ownerId === dutchCallerId ? 1 : 0;
    const rightIsCaller = right[1].ownerId === dutchCallerId ? 1 : 0;
    return leftIsCaller - rightIsCaller;
  });
  const revealInterval = revealCards.length > 1 ? Math.min(90, 1200 / (revealCards.length - 1)) : 0;
  const revealDelays = new Map(revealCards.map(([cardId], index) => [cardId, index * revealInterval]));

  currentCards.forEach((current, cardId) => {
    if (movedIds.has(cardId)) return;
    const previous = previousCards.get(cardId);
    if (!previous) return;
    if (previous.locationKey !== current.locationKey) return;
    const faceChanged = previous.faceKind !== current.faceKind;
    const publicPeekStarted = previous.highlight !== 'peek' && current.highlight === 'peek';
    if (!faceChanged && !publicPeekStarted) return;
    if (!['front', 'back'].includes(previous.faceKind) || !['front', 'back'].includes(current.faceKind)) return;
    const target = document.querySelector(`.card[data-card-id="${cssEscape(cardId)}"]`);
    const delay = enteringFinishedStage && faceChanged ? (revealDelays.get(cardId) || 0) : 0;
    if (target) animateFaceTurn(target, before.cards.get(cardId), publicPeekStarted ? 420 : 260, delay);
  });
}

function animateJackSwapSelections(previousState, state) {
  const previousSpecial = previousState.round && previousState.round.special;
  const currentSpecial = state.round && state.round.special;
  if (!currentSpecial || currentSpecial.type !== 'J') return;

  const previousSelected = new Set(
    previousSpecial && previousSpecial.type === 'J' && previousSpecial.actorId === currentSpecial.actorId
      ? (previousSpecial.selected || [])
      : []
  );
  (currentSpecial.selected || []).forEach((cardId) => {
    if (previousSelected.has(cardId)) return;
    const card = document.querySelector(`.card[data-card-id="${cssEscape(cardId)}"]`);
    if (!card || !card.animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const selectedTransform = card.classList.contains('small') ? 'translateY(-20px)' : 'translateY(-24px)';
    card.animate([
      { transform: 'translateY(0)' },
      { transform: selectedTransform }
    ], {
      duration: 180,
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)'
    });
  });
  previousSelected.forEach((cardId) => {
    if ((currentSpecial.selected || []).includes(cardId)) return;
    const card = document.querySelector(`.card[data-card-id="${cssEscape(cardId)}"]`);
    if (!card || !card.animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const selectedTransform = card.classList.contains('small') ? 'translateY(-20px)' : 'translateY(-24px)';
    card.animate([
      { transform: selectedTransform },
      { transform: 'translateY(0)' }
    ], {
      duration: 180,
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)'
    });
  });
}

function animatePlayerPanelResizes(previousState, state, before, after) {
  if (!Element.prototype.animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const previousCounts = new Map(previousState.round.players.map((player) => [player.id, player.cards.length]));

  state.round.players.forEach((player) => {
    const previousCount = previousCounts.get(player.id);
    if (previousCount === player.cards.length) return;
    const previousPanel = before.panels.get(player.id);
    const currentPanel = after.panels.get(player.id);
    const element = document.querySelector(`[data-player-panel-id="${cssEscape(player.id)}"]`);
    if (!previousPanel || !currentPanel || !element) return;
    const widthChanged = Math.abs(previousPanel.width - currentPanel.width) >= 1;
    const heightChanged = Math.abs(previousPanel.height - currentPanel.height) >= 1;
    if (!widthChanged && !heightChanged) return;

    element.style.overflow = "hidden";
    const growing = player.cards.length > previousCount;
    const offsetX = previousPanel.left - currentPanel.left;
    const offsetY = previousPanel.top - currentPanel.top;
    const scaleX = previousPanel.width / currentPanel.width;
    const animation = element.animate([
      {
        height: `${previousPanel.height}px`,
        transform: `translate(${offsetX}px, ${offsetY}px) scaleX(${scaleX})`,
        transformOrigin: "top left"
      },
      {
        height: `${currentPanel.height}px`,
        transform: "translate(0, 0) scaleX(1)",
        transformOrigin: "top left"
      }
    ], {
      duration: 220,
      easing: growing ? "cubic-bezier(0.2, 0.8, 0.2, 1)" : "cubic-bezier(0.4, 0, 1, 1)"
    });
    const cleanUp = () => element.style.removeProperty("overflow");
    animation.onfinish = cleanUp;
    animation.oncancel = cleanUp;
  });
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
  return String(value).replace(/"/g, '\\"');
}

function animateCardMove(cardId, sourceData, targetData, duration = 360) {
  const target = cardElement(cardId, targetData.locationKey) || elementAtRect(targetData.rect, targetData.locationKey);
  let source = sourceData.rect;
  const dest = targetData.rect;
  if (!target) return;
  if (Math.abs(source.left - dest.left) < 2 && Math.abs(source.top - dest.top) < 2) return;

  const existingMove = activeCardMoves.get(cardId);
  if (existingMove) {
    const movingRect = existingMove.clone.getBoundingClientRect();
    if (movingRect.width && movingRect.height) {
      source = {
        left: movingRect.left,
        top: movingRect.top,
        width: movingRect.width,
        height: movingRect.height
      };
    }
    cancelCardMove(existingMove);
  }

  const clone = target.cloneNode(true);
  clone.classList.add('moving-card');
  clone.removeAttribute('data-card-id');
  clone.removeAttribute('data-action');
  clone.style.left = `${dest.left}px`;
  clone.style.top = `${dest.top}px`;
  clone.style.width = `${dest.width}px`;
  clone.style.height = `${dest.height}px`;
  clone.style.margin = '0';
  clone.style.transformOrigin = 'top left';
  document.body.appendChild(clone);

  target.classList.add('anim-target-hidden');
  const scaleX = source.width / dest.width;
  const scaleY = source.height / dest.height;
  const animation = clone.animate([
    { transform: `translate(${source.left - dest.left}px, ${source.top - dest.top}px) scale(${scaleX}, ${scaleY})` },
    { transform: 'translate(0, 0) scale(1, 1)' }
  ], {
    duration,
    easing: 'linear',
    fill: 'forwards'
  });
  const move = { cardId, locationKey: targetData.locationKey, clone, animation };
  activeCardMoves.set(cardId, move);
  animation.onfinish = () => finishCardMove(move);
  animation.oncancel = () => finishCardMove(move);
}

function setMovingFaceRect(face, rect) {
  face.style.left = String(rect.left) + "px";
  face.style.top = String(rect.top) + "px";
  face.style.width = String(rect.width) + "px";
  face.style.height = String(rect.height) + "px";
  face.style.margin = "0";
  face.style.transformOrigin = "center";
}

function movingFaceFromHtml(html, rect) {
  const template = document.createElement("template");
  template.innerHTML = String(html || "").trim();
  const face = template.content.firstElementChild;
  if (!face) return null;
  face.classList.add("moving-card");
  face.removeAttribute("data-card-id");
  face.removeAttribute("data-action");
  setMovingFaceRect(face, rect);
  document.body.appendChild(face);
  return face;
}

function playWrongThrowPhase(move, face, keyframes, options) {
  if (move.cancelled) return Promise.resolve(false);
  const animation = face.animate(keyframes, options);
  move.animation = animation;
  return animation.finished.then(() => !move.cancelled).catch(() => false);
}

async function playWrongThrowRectPhase(move, face, fromRect, toRect, duration) {
  if (move.cancelled) return false;
  const rectFrame = (rect) => ({
    left: String(rect.left) + "px",
    top: String(rect.top) + "px",
    width: String(rect.width) + "px",
    height: String(rect.height) + "px"
  });
  const animation = face.animate([
    rectFrame(fromRect),
    rectFrame(toRect)
  ], { duration, easing: "linear", fill: "forwards" });
  move.animation = animation;
  try {
    await animation.finished;
    if (move.cancelled) return false;
    setMovingFaceRect(face, toRect);
    animation.cancel();
    if (move.animation === animation) move.animation = null;
    return true;
  } catch (error) {
    return false;
  }
}

function finishWrongThrow(move) {
  move.clones.forEach((clone) => clone.remove());
  move.clones.clear();
  if (activeWrongThrows.get(move.cardId) === move) activeWrongThrows.delete(move.cardId);
  const target = cardElement(move.cardId, move.locationKey);
  if (target) target.classList.remove("anim-target-hidden");
}

function cancelWrongThrow(move) {
  move.cancelled = true;
  if (move.animation) move.animation.cancel();
  finishWrongThrow(move);
}

function cancelAllWrongThrows() {
  Array.from(activeWrongThrows.values()).forEach(cancelWrongThrow);
}

async function animateWrongThrowIn(event, before, after) {
  if (!event || !event.card || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const sourceData = before.cards.get(event.cardId);
  const targetData = after.cards.get(event.cardId);
  const pileData = after.roles.get("pile-top") || after.locations.get("pile-top");
  const target = targetData ? cardElement(event.cardId, targetData.locationKey) : null;
  if (!sourceData || !targetData || !pileData || !target || !target.animate) return;

  const existing = activeWrongThrows.get(event.cardId);
  if (existing) cancelWrongThrow(existing);
  const move = {
    cardId: event.cardId,
    locationKey: targetData.locationKey,
    clones: new Set(),
    animation: null,
    cancelled: false
  };
  activeWrongThrows.set(event.cardId, move);
  target.classList.add("anim-target-hidden");

  const backFace = movingFaceFromHtml(sourceData.html, sourceData.rect);
  const frontHtml = cardHtml(event.card, target.classList.contains("small"));
  if (!backFace) {
    finishWrongThrow(move);
    return;
  }
  move.clones.add(backFace);

  try {
    if (!await playWrongThrowPhase(move, backFace, [
      { transform: "scaleX(1)" },
      { transform: "scaleX(0)" }
    ], { duration: 130, easing: "linear" })) return;
    backFace.remove();
    move.clones.delete(backFace);

    const frontFace = movingFaceFromHtml(frontHtml, sourceData.rect);
    if (!frontFace) {
      finishWrongThrow(move);
      return;
    }
    move.clones.add(frontFace);
    if (!await playWrongThrowPhase(move, frontFace, [
      { transform: "scaleX(0)" },
      { transform: "scaleX(1)" }
    ], { duration: 130, easing: "linear" })) return;

    if (!await playWrongThrowRectPhase(move, frontFace, sourceData.rect, pileData.rect, 320)) return;

    if (!await playWrongThrowPhase(move, frontFace, [
      { transform: "translateX(0)" },
      { transform: "translateX(-9px)" },
      { transform: "translateX(9px)" },
      { transform: "translateX(-7px)" },
      { transform: "translateX(7px)" },
      { transform: "translateX(0)" }
    ], { duration: 280, easing: "ease-in-out" })) return;

    const latestTarget = cardElement(event.cardId, targetData.locationKey);
    const returnRect = latestTarget ? latestTarget.getBoundingClientRect() : targetData.rect;
    if (!await playWrongThrowRectPhase(move, frontFace, pileData.rect, returnRect, 320)) return;

    if (!await playWrongThrowPhase(move, frontFace, [
      { transform: "scaleX(1)" },
      { transform: "scaleX(0)" }
    ], { duration: 130, easing: "linear" })) return;
    frontFace.remove();
    move.clones.delete(frontFace);

    const returnedCard = cardElement(event.cardId, targetData.locationKey);
    if (returnedCard) {
      returnedCard.classList.remove("anim-target-hidden");
      returnedCard.animate([
        { transform: "scaleX(0)" },
        { transform: "scaleX(1)" }
      ], { duration: 130, easing: "linear" });
    }
    finishWrongThrow(move);
  } catch (error) {
    cancelWrongThrow(move);
  }
}

function cardElement(cardId, locationKey) {
  const card = document.querySelector(`.card[data-card-id="${cssEscape(cardId)}"]`);
  if (!card) return null;
  return !locationKey || card.dataset.locationKey === locationKey ? card : null;
}

function hideActiveCardMoveTargets() {
  activeCardMoves.forEach((move) => {
    const target = cardElement(move.cardId, move.locationKey);
    if (target) target.classList.add('anim-target-hidden');
  });
  activeWrongThrows.forEach((move) => {
    const target = cardElement(move.cardId, move.locationKey);
    if (target) target.classList.add('anim-target-hidden');
  });
}

function finishCardMove(move) {
  move.clone.remove();
  if (activeCardMoves.get(move.cardId) !== move) return;
  activeCardMoves.delete(move.cardId);
  const target = cardElement(move.cardId, move.locationKey);
  if (target) target.classList.remove('anim-target-hidden');
}

function cancelCardMove(move) {
  move.animation.onfinish = null;
  move.animation.oncancel = null;
  move.animation.cancel();
  move.clone.remove();
  if (activeCardMoves.get(move.cardId) === move) activeCardMoves.delete(move.cardId);
}

function cancelAllCardMoves() {
  Array.from(activeCardMoves.values()).forEach(cancelCardMove);
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

function animateFaceTurn(el, previousData, duration = 260, delay = 0) {
  const halfDuration = duration / 2;
  if (!el.animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const rect = el.getBoundingClientRect();
  const template = document.createElement("template");
  template.innerHTML = previousData && previousData.html ? previousData.html.trim() : "";
  const previousFace = template.content.firstElementChild;
  if (!previousFace || !rect.width || !rect.height) {
    el.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: halfDuration, delay, easing: "linear", fill: "backwards" });
    return;
  }

  const cardCell = el.closest(".card-cell");
  previousFace.classList.add(cardCell ? "turning-card" : "moving-card");
  previousFace.removeAttribute("data-card-id");
  previousFace.removeAttribute("data-action");
  previousFace.style.left = `${cardCell ? el.offsetLeft : rect.left}px`;
  previousFace.style.top = `${cardCell ? el.offsetTop : rect.top}px`;
  previousFace.style.width = `${rect.width}px`;
  previousFace.style.height = `${rect.height}px`;
  previousFace.style.margin = "0";
  previousFace.style.transformOrigin = "center";
  el.style.visibility = "hidden";
  (cardCell || document.body).appendChild(previousFace);

  const revealNextFace = () => {
    previousFace.remove();
    if (!el.isConnected) return;
    el.style.removeProperty("visibility");
    el.animate([
      { transform: "scaleX(0)" },
      { transform: "scaleX(1)" }
    ], {
      duration: halfDuration,
      easing: "linear"
    });
  };
  const previousAnimation = previousFace.animate([
    { transform: "scaleX(1)" },
    { transform: "scaleX(0)" }
  ], {
    duration: halfDuration,
    delay,
    easing: "linear"
  });
  previousAnimation.onfinish = revealNextFace;
  previousAnimation.oncancel = revealNextFace;
}
