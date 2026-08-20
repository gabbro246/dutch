const socket = io({ autoConnect: false });
const app = document.getElementById('app');
const PLAYER_TOKEN_KEY = 'dutchPlayerSessionToken';
const PLAYER_TAB_KEY = 'dutchPlayerTabId';
const PLAYER_TOKEN_BACKUP_PREFIX = 'dutchPlayerSessionToken:';
const PLAYER_TAB_WINDOW_PREFIX = 'dutch-tab:';
const PLAYER_NAME_KEY = 'dutchPlayerName';
const i18n = window.DutchI18n;
let language = i18n.getStoredLanguage(window);
i18n.setLanguage(language, window);
const soundEffects = window.DutchClientSounds.create();
const playerToken = getPlayerToken();
let lastState = null;
let pendingManualRejoin = null;
let hasRenderedGame = false;
let currentDetailsMode = '';
let logExpanded = false;
let detailPreferencesGameKey = '';
const detailPreferencesByMode = {};
const occupiedDrawerPreferences = { guide: false, rules: false, settings: false };
const pointColorAssignments = { order: [], byPlayerId: new Map() };
const wiredHelpDisclosureButtons = new WeakSet();
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
  HALVING_TOTALS,
  shuffledPointColorIndices,
  pointsChartGeometry,
  scoreHistorySeries,
  quickRulesHtml,
  fullRulesHtml
} = window.DutchShared;
const BOT_NAMES = Object.values(BOT_LABELS);

const cardAnimations = window.DutchClientCardAnimations.create({ emit, cardHtml });
const {
  emptyAnimationSnapshot,
  captureAnimationSnapshot,
  animateStateTransition,
  hideActiveCardMoveTargets,
  cancelAllCardMoves,
  cancelAllWrongThrows,
  cancelAllFaceTurns,
  cancelAllReshuffles
} = cardAnimations;
const uiAnimations = window.DutchClientUiAnimations.create({
  getLastState: () => lastState,
  render
});
const {
  wireAnimatedDrawers,
  captureDrawerTransitions,
  animateDrawerTransitions,
  animateWaitingPlayerListChanges,
  animateWinnerConfetti,
  captureRightPanelScroll,
  restoreRightPanelScroll
} = uiAnimations;

function t(key, values) {
  return i18n.translate(language, key, values);
}

function translatedGameText(value) {
  return i18n.translateGameText(language, value);
}
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
  setLogExpanded: (value) => { logExpanded = value; },
  translate: t
});
const { renderWaiting } = window.DutchClientWaiting.create({
  app,
  translate: t,
  getLanguage: () => language,
  escapeHtml,
  i18n,
  botLabels: BOT_LABELS,
  botPersonalities: BOT_PERSONALITIES,
  playerNameMaxLength: PLAYER_NAME_MAX_LENGTH,
  gameDescription: GAME_DESCRIPTION,
  playerNameHtml,
  helpDisclosureHtml,
  inactivityTimeoutSettingHtml,
  botTimingSettingHtml,
  languageSettingHtml,
  soundSettingHtml,
  shortInstructions,
  fullRules,
  repoLink,
  canJoinWithName,
  clientActions,
  rememberPlayerName,
  rememberPlayerTokenBackup,
  playerToken,
  emit,
  wireHelpDisclosures,
  wireAnimatedDrawers,
  wireInactivityTimeoutSelect,
  wireBotTimingSelect,
  wireLanguageSelect,
  wireSoundSelect
});
const selectInteraction = window.DutchSelectInteraction.create();
const { mergeIncrementalState, cardAnimationSignature } = window.DutchClientState;
const { patchGameLayout } = window.DutchClientRender;

document.addEventListener('pointerdown', (event) => {
  soundEffects.unlock();
  selectInteraction.releaseIfOutside(event.target);
}, true);

document.addEventListener('keydown', () => {
  soundEffects.unlock();
}, true);


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
  selectInteraction.release();
  render({
    ...lastState,
    joined: false,
    players: (lastState.players || []).map((player) => (
      player.id === lastState.you ? { ...player, connected: false } : player
    ))
  });
});

function applyIncomingState(state) {
  const previousState = lastState;
  const mergedState = mergeIncrementalState(previousState, state);
  const gameTransition = !!(previousState && hasRenderedGame && mergedState.phase === 'playing');
  const waitingTransition = !!(previousState && mergedState.phase === 'waiting');
  const captureGameLayout = gameTransition && cardAnimationSignature(previousState) !== cardAnimationSignature(mergedState);
  const beforeSnapshot = captureGameLayout
    ? captureAnimationSnapshot('game')
    : (waitingTransition ? captureAnimationSnapshot('waiting') : emptyAnimationSnapshot());
  render(mergedState);
  if (mergedState.phase === 'playing' && mergedState.round) {
    hideActiveCardMoveTargets();
  } else {
    cancelAllCardMoves();
    cancelAllWrongThrows();
    cancelAllFaceTurns();
    cancelAllReshuffles();
  }
  const afterSnapshot = captureGameLayout
    ? captureAnimationSnapshot('game')
    : (waitingTransition ? captureAnimationSnapshot('waiting') : emptyAnimationSnapshot());
  if (gameTransition) {
    animateStateTransition(previousState, mergedState, beforeSnapshot, afterSnapshot);
  } else if (waitingTransition) {
    animateWaitingPlayerListChanges(previousState, mergedState, beforeSnapshot, afterSnapshot);
  }
  animateWinnerConfetti(previousState, mergedState);
  soundEffects.handleStateTransition(previousState, mergedState);
  hasRenderedGame = mergedState.phase === 'playing' && !!mergedState.round;
  lastState = mergedState;
}

socket.on('state', applyIncomingState);

socket.on('notice', (message) => {
  alert(translatedGameText(message));
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

function repoLink(version = '', attributes = '') {
  const versionText = version ? ` <span class="version-label">v${escapeHtml(version)}</span>` : '';
  return `<p class="repo-link" ${attributes}><a href="https://github.com/gabbro246/dutch" target="_blank" rel="noopener">github.com/gabbro246/dutch</a>${versionText}</p>`;
}

function gameStartedText(startedAt) {
  if (!startedAt) return '';
  const started = new Date(startedAt);
  if (Number.isNaN(started.getTime())) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - started.getTime()) / 60000));
  const elapsed = minutes === 0 ? t('just now') : minutes === 1 ? t('1 min ago') : t('{count} min ago', { count: minutes });
  const time = started.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' });
  return '<p class="hint">' + escapeHtml(t('Started {time} ({elapsed})', { time, elapsed })) + '</p>';
}

function activeGameSummary(state) {
  const tag = String.fromCharCode(60);
  const end = String.fromCharCode(62);
  const players = (state.players || [])
    .filter(function(player) { return player.isSpectator === false; })
    .map(function(player) { return player.name; })
    .join(", ");
  const round = state.roundNumber ? t('Round {number}', { number: state.roundNumber }) : t('Round not started');
  const text = t('Players: {players}. {round}.', { players: players || t('none'), round });
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
    const selectedTheme = window.DutchTheme.getStoredTheme(window);
    const gameStarted = gameStartedText(state.gameStartedAt);
    const gameSummary = activeGameSummary(state);
    const rejoinPlayers = (state.players || []).filter((player) => !player.isBot && !player.connected);
    const rejoinAvailable = rejoinPlayers.length > 0;
    const knownRejoinPlayer = rejoinPlayers.find((player) => player.id === state.you);
    const rejoinName = knownRejoinPlayer ? knownRejoinPlayer.name : '';
    const activeGameMessage = rejoinAvailable
      ? t('A game is already active. If you were disconnected, enter your name to rejoin.')
      : t('A game is already active. Join after the game ends.');
    const rejoinControls = rejoinAvailable ? `
          <div class="row join-row active-rejoin-row">
            <input id="rejoinNameInput" placeholder="${escapeHtml(t('Name'))}" maxlength="${PLAYER_NAME_MAX_LENGTH}" value="${escapeHtml(rejoinName)}">
            <button id="rejoinBtn" class="expected-action" disabled>${escapeHtml(t('Rejoin'))}</button>
          </div>` : '';
    app.innerHTML = `
      <div class="page waiting-page">
        <h1 class="app-title">Dutch! 🂡</h1>
        <div class="waiting-panel">
          <p class="waiting-description">${escapeHtml(t(GAME_DESCRIPTION))}</p>
          <p>${activeGameMessage}</p>
          ${rejoinControls}
          ${gameStarted}
          ${gameSummary}
          <div class="occupied-room-drawers">
            <details class="drawer waiting-drawer" data-occupied-drawer="guide" ${occupiedDrawerPreferences.guide ? 'open' : ''}>
              <summary>${escapeHtml(t('Quick guide'))}</summary>
              <div class="drawer-animation-content">${shortInstructions()}</div>
            </details>
            <details class="drawer waiting-drawer rules-body" data-occupied-drawer="rules" ${occupiedDrawerPreferences.rules ? 'open' : ''}>
              <summary>${escapeHtml(t('Complete rules'))}</summary>
              <div class="drawer-animation-content">${fullRules(state)}</div>
            </details>
            <details class="drawer waiting-drawer" data-occupied-drawer="settings" ${occupiedDrawerPreferences.settings ? 'open' : ''}>
              <summary>${escapeHtml(t('Settings'))}</summary>
              <div class="drawer-content drawer-animation-content waiting-selectors">
                <div class="setting-row">
                  ${helpDisclosureHtml('occupiedAppearanceHelp', 'Appearance', 'Choose the light or dark color theme.')}
                  <select id="occupiedThemeSelect" aria-label="${escapeHtml(t('Appearance'))}">
                    <option value="light" ${selectedTheme === 'light' ? 'selected' : ''}>${escapeHtml(t('Light mode'))}</option>
                    <option value="dark" ${selectedTheme === 'dark' ? 'selected' : ''}>${escapeHtml(t('Dark mode'))}</option>
                  </select>
                </div>
                ${soundSettingHtml('occupiedSoundSelect')}
                ${languageSettingHtml('occupiedLanguageSelect')}
              </div>
            </details>
          </div>
        </div>
        ${repoLink(state.version)}
      </div>
    `;
    bindActiveGameRejoin(rejoinPlayers);
    wireHelpDisclosures(document);
    wireAnimatedDrawers(document, (details, open) => {
      if (details.dataset.occupiedDrawer) occupiedDrawerPreferences[details.dataset.occupiedDrawer] = open;
    });
    const occupiedThemeSelect = document.getElementById('occupiedThemeSelect');
    if (occupiedThemeSelect) {
      occupiedThemeSelect.addEventListener('change', () => {
        window.DutchTheme.setTheme(occupiedThemeSelect.value, window);
      });
    }
    wireSoundSelect('occupiedSoundSelect');
    wireLanguageSelect('occupiedLanguageSelect');
    return;
  }
  if (state.phase === 'waiting') renderWaiting(state);
  else renderGame(state);
}

function renderGame(state) {
  const round = state.round;
  const me = round.players.find((p) => p.id === state.you);
  const others = round.players.filter((p) => p.id !== state.you && !p.isSpectator);
  const rightPanelScroll = captureRightPanelScroll();
  const drawerTransitions = captureDrawerTransitions();
  const gameMarkup = `
    <div class="main-layout">
      <main class="game-area">
        <section class="other-players" data-game-region="players">
          ${others.map((player) => renderPlayerField(player, state, true)).join('')}
        </section>
        ${renderDeckPile(state)}
        ${me && !me.isSpectator ? renderOwnArea(me, state) : ''}
      </main>
      ${renderSideArea(state)}
    </div>
  `;
  const activeSettingsSelect = selectInteraction.current();
  const patch = patchGameLayout(app, gameMarkup, activeSettingsSelect);
  if (!patch.patched) app.innerHTML = gameMarkup;
  clientActions.wireGameButtons();
  animateDrawerTransitions(drawerTransitions);
  wireHelpDisclosures(document);
  if (!patch.patched || patch.changedRegions.includes('drawer:settings')) {
    const gameThemeSelect = document.getElementById('gameThemeSelect');
    const inGameTargetSelect = document.getElementById('inGameTargetSelect');
    const gameBotTimingSelect = document.getElementById('gameBotTimingSelect');
    const highlightChangedCardsSelect = document.getElementById('highlightChangedCardsSelect');
    const gameSoundSelect = document.getElementById('gameSoundSelect');
    [gameThemeSelect, inGameTargetSelect, gameBotTimingSelect, highlightChangedCardsSelect, gameSoundSelect].forEach((select) => {
      selectInteraction.wire(select);
    });
    if (inGameTargetSelect) {
      inGameTargetSelect.addEventListener('change', () => {
        clientActions.clearPendingConfirm();
        emit('setGameTarget', inGameTargetSelect.value);
      });
    }
    wireInactivityTimeoutSelect('gameInactivityTimeoutSelect');
    selectInteraction.wire(document.getElementById('gameInactivityTimeoutSelect'));
    wireBotTimingSelect('gameBotTimingSelect');
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
    wireSoundSelect('gameSoundSelect');
    wireLanguageSelect('gameLanguageSelect');
    selectInteraction.wire(document.getElementById('gameLanguageSelect'));
  }
  restoreRightPanelScroll(rightPanelScroll);
}

function renderStatus(state) {
  const r = state.round;
  let text = '';
  let textHtml = '';
  const temporaryEvent = r.wrongThrowIn
    ? t('{name} made a wrong throw-in and gets a penalty card.', { name: r.wrongThrowIn.playerName || t('A player') })
    : (r.infoEvent && r.infoEvent.text ? translatedGameText(r.infoEvent.text) + '.' : '');
  if (r.stage === 'roundEnd') {
    text = t('Round ended. Cards are revealed and points were counted.');
  } else if (r.stage === 'gameEnd') {
    const gameLength = state.singleRound ? t('Single round') : t('{count} point', { count: state.gameTarget });
    textHtml = t('Game ended. <strong>{winner} won the {length} game.</strong>', {
      winner: escapeHtml(r.winnerName || t('Unknown player')),
      length: escapeHtml(gameLength)
    });
  } else if (temporaryEvent) {
    text = temporaryEvent;
  } else if (r.stage === 'peek') {
    text = t('Start peek: each player must look at exactly two own cards.');
  } else if (r.stage === 'opening') {
    text = t('Opening card…');
  } else if (r.stage === 'special' && r.special) {
    text = t('{name} may use {special} or click Next player.', { name: r.special.actorName, special: i18n.specialLabel(language, r.special.type) });
  } else if (r.roundEndPending) {
    text = t('Last chance to throw in…');
  } else if (r.turnComplete && r.currentPlayerId === state.you) {
    text = t('Your turn is complete. Say Dutch or click Next player.');
  } else if (r.turnComplete) {
    text = t("{name}'s turn is complete. Waiting for Next player.", { name: r.currentPlayerName });
  } else {
    text = r.dutchCallerName ? '' : t("{name}'s move.", { name: r.currentPlayerName });
  }
  if (!textHtml) textHtml = escapeHtml(text);
  const statusClass = r.stage === 'gameEnd' ? 'status game-ended-status' : 'status';
  const finishActive = r.stage === 'gameEnd';
  let dutch = '';
  if (r.dutchCallerName && !temporaryEvent && !['roundEnd', 'gameEnd'].includes(r.stage)) {
    const callerName = escapeHtml(r.dutchCallerName);
    const currentPlayerName = escapeHtml(r.currentPlayerName || t('The current player'));
    const playersAfterCurrent = Number(r.dutchTurnsRemaining) || 0;
    dutch = playersAfterCurrent > 0
      ? `<div>${t('{caller} called Dutch. {current} is taking their final turn, with {count} more {players} still to go afterward.', { caller: callerName, current: currentPlayerName, count: playersAfterCurrent, players: t(playersAfterCurrent === 1 ? 'player' : 'players') })}</div>`
      : `<div>${t('{caller} called Dutch. {current} is taking the final turn of the round.', { caller: callerName, current: currentPlayerName })}</div>`;
  }
  const buttons = [
    `<button data-action="endGameForAll" ${finishActive ? 'disabled' : ''}>${escapeHtml(t('End game for all'))}</button>`,
    `<button data-action="leave" ${finishActive ? 'disabled' : ''}>${escapeHtml(t('Leave game'))}</button>`,
    `<button data-action="newGame" class="expected-action" ${finishActive ? '' : 'disabled'}>${escapeHtml(t('Finish'))}</button>`
  ].filter(Boolean).join('');
  return `
    <div class="${statusClass}">
      <div class="status-main">
        <div class="status-info">
          ${textHtml ? `<div>${textHtml}</div>` : ''}
          ${dutch}
        </div>
        ${buttons ? `<div class="status-actions">${buttons}</div>` : ''}
      </div>
    </div>
  `;
}

function renderPlayerMeta(player) {
  if (player.isSpectator) return '<div class="player-meta">' + escapeHtml(t('Watching')) + '</div>';
  const meta = player.roundPoints === null
    ? t('Total: {total}', { total: player.total })
    : t('Total: {total}, round: {round}', { total: player.total, round: player.roundPoints });
  return `<div class="player-meta">${escapeHtml(meta)}</div>`;
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
  const missing = player.connected ? '' : ' (' + t('missing') + ')';
  return `
    <div class="player-field${current}${dutchCaller}${finalTurnDone}${winner}" data-player-panel-id="${escapeHtml(player.id)}">
      <div class="player-title">
        <strong>${playerNameHtml(state, player)}</strong>${missing}${playerBadges(state, player)}
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
  const areaLabel = player.isSpectator ? t('spectating') : t('your cards');
  return `
    <section class="own-area${player.isCurrent ? ' current' : ''}${dutchCaller}${finalTurnDone}${winner}" data-game-region="own" data-player-panel-id="${escapeHtml(player.id)}">
      <div class="player-title">
        <h2>${playerNameHtml(state, player)} <span class="you-badge">${areaLabel}</span>${playerBadges(state, player)}</h2>
        ${renderPlayerMeta(player)}
      </div>
      <div class="cards-row">
        ${player.cards.map((card, index) => renderCardCell(card, player.id, index, state, false, true)).join('')}
      </div>
      ${player.isSpectator ? '' : `<div class="row own-actions">
        <button data-action="sayDutch" class="expected-action" ${r.controls.canDutch ? '' : 'disabled'}>Dutch</button>
        <button data-action="endTurn" class="expected-action" ${r.controls.canEndTurn ? "" : "disabled"}>${endTurnLabel(state)}</button>
        <button data-action="nextRound" class="expected-action" ${r.stage === 'roundEnd' ? '' : 'disabled'}>${escapeHtml(t('Next round'))}</button>
      </div>`}
    </section>
  `;
}

function endTurnLabel(state) {
  const r = state.round;
  if (['turn', 'special'].includes(r.stage) && r.dutchCallerId && r.dutchTurnsRemaining === 0 && r.currentPlayerId === state.you) return t('Finish round');
  return t('Next player');
}

function playerBadges(state, player) {
  const r = state.round;
  const badges = [];
  if (player.isBot) badges.push('<span class="bot-badge">' + escapeHtml(t('bot')) + '</span>');
  if (player.isSpectator) badges.push('<span class="spectator-badge">' + escapeHtml(t('spectator')) + '</span>');
  if (r.dutchCallerId === player.id) {
    badges.push(isWrongDutchCall(r, player)
      ? `<span class="player-badge wrong-dutch-badge">${escapeHtml(t('wrong Dutch call'))}</span>`
      : `<span class="player-badge dutch-badge">${escapeHtml(t('said Dutch'))}</span>`);
  }
  if ((r.roundWinnerIds || []).includes(player.id)) badges.push('<span class="player-badge round-winner-badge">' + escapeHtml(t('won this round')) + '</span>');
  if (r.winnerId === player.id) badges.push('<span class="player-badge game-winner-badge">' + escapeHtml(t('won the game')) + '</span>');
  return badges.join('');
}

function renderDeckPile(state) {
  const r = state.round;
  const drawnCard = r.drawn
    ? cardHtml(r.drawn.card, false, { 'data-anim-role': 'drawn', 'data-location-key': 'drawn' })
    : '<div class="card empty-card drawn-placeholder">' + escapeHtml(t('empty')) + '</div>';
  const drawnLabel = r.drawn ? '<div class="deck-pile-label">' + escapeHtml(t('Drawn')) + '</div>' : '<div class="deck-pile-label drawn-label-spacer" aria-hidden="true">' + escapeHtml(t('Drawn')) + '</div>';
  const discardButton = r.drawn
    ? `<button data-action="discardDrawn" ${r.controls.canDiscardDrawn ? '' : 'disabled'}>${escapeHtml(t('Discard'))}</button>`
    : '<button class="drawn-button-spacer" disabled aria-hidden="true" tabindex="-1">' + escapeHtml(t('Discard')) + '</button>';
  const pileButton = r.needsReshuffle
    ? `<button data-action="shuffle" class="expected-action" ${r.controls.canReshuffle ? '' : 'disabled'}>${escapeHtml(t('Shuffle'))}</button>`
    : `<button data-action="takePile" class="expected-action" ${r.controls.canTake && r.discardCount > 0 ? '' : 'disabled'}>${escapeHtml(t('Take'))}</button>`;

  return `
    <section class="deck-pile-area" data-game-region="deck">
      <div class="stack-area">
        <div class="deck-pile-label">${escapeHtml(t('Deck ({count})', { count: r.deckCount }))}</div>
        <div class="stack" data-stack="deck">
          ${stackBacks(r.deckCount, r.deckBack)}
        </div>
        <button data-action="takeDeck" class="expected-action" ${r.controls.canTake ? '' : 'disabled'}>${escapeHtml(t('Take'))}</button>
      </div>
      <div class="drawn-area">
        ${drawnLabel}
        <div class="drawn-card-slot">
          ${drawnCard}
        </div>
        ${discardButton}
      </div>
      <div class="stack-area">
        <div class="deck-pile-label">${escapeHtml(t('Pile ({count})', { count: r.discardCount }))}</div>
        <div class="stack" data-stack="pile">
          ${stackPile(r)}
        </div>
        ${pileButton}
      </div>
    </section>
  `;
}
function stackBacks(count, color) {
  if (count <= 0) return '<div class="card empty-card">' + escapeHtml(t('empty')) + '</div>';
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
  if (!r.discardTop) return '<div class="card empty-card">' + escapeHtml(t('empty')) + '</div>';
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
    buttons.push(`<button data-action="peekStart" class="expected-action" data-card-id="${card.id}" title="${escapeHtml(t('Peek'))}" ${startPeekDisabled ? "disabled" : ""}>${escapeHtml(t('Peek'))}</button>`);
  }
  if (own) {
    buttons.push(`<button data-action="swapDrawn" data-card-id="${card.id}" title="${escapeHtml(t('Swap'))}" ${r.controls.canSwapDrawn ? "" : "disabled"}>${escapeHtml(t('Swap'))}</button>`);
    buttons.push(`<button data-action="throwIn" data-card-id="${card.id}" title="${escapeHtml(t('Throw in'))}" ${r.controls.canThrowIn ? "" : "disabled"}>${escapeHtml(t('Throw in'))}</button>`);
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
  return '<button class="special-action-placeholder" disabled>' + escapeHtml(t('Action')) + '</button>';
}

function cardActionLabel(symbol, text) {
  return `<span class="card-action-label"><span class="card-symbol">${symbol}</span> <span>${escapeHtml(t(text))}</span></span>`;
}

function cardHtml(card, small, extraAttrs = {}) {
  const smallClass = small ? ' small' : '';
  if (!card) return `<div class="card${smallClass} empty-card">${escapeHtml(t('empty'))}</div>`;
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

function helpDisclosureHtml(id, label, text) {
  const helpLabel = t('Show help');
  return `
    <button class="help-disclosure-button" type="button" popovertarget="${escapeHtml(id)}" title="${escapeHtml(helpLabel)}" aria-label="${escapeHtml(t(label))}: ${escapeHtml(helpLabel)}">${escapeHtml(t(label))}</button>
    <div class="help-disclosure-text" id="${escapeHtml(id)}" popover="hint" role="note">
      ${escapeHtml(t(text))}
    </div>
  `;
}

function wireHelpDisclosures(scope) {
  scope.querySelectorAll('.help-disclosure-button[popovertarget]').forEach((button) => {
    if (wiredHelpDisclosureButtons.has(button)) return;
    const popover = document.getElementById(button.getAttribute('popovertarget'));
    if (!popover || typeof popover.showPopover !== 'function' || typeof popover.hidePopover !== 'function') return;
    wiredHelpDisclosureButtons.add(button);
    let openedByHover = false;
    const positionPopover = () => {
      const triggerRect = button.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();
      const edge = 10;
      const gap = 6;
      const maxLeft = Math.max(edge, window.innerWidth - popoverRect.width - edge);
      const left = Math.min(Math.max(edge, triggerRect.left), maxLeft);
      const below = triggerRect.bottom + gap;
      const top = below + popoverRect.height <= window.innerHeight - edge
        ? below : Math.max(edge, triggerRect.top - popoverRect.height - gap);
      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
    };
    button.addEventListener('pointerenter', (event) => {
      if (popover.matches(':popover-open')) return;
      if (event.pointerType !== 'mouse') return;
      popover.showPopover();
      positionPopover();
      openedByHover = true;
    });
    button.addEventListener('pointerleave', (event) => {
      if (event.pointerType !== 'mouse') return;
      if (!openedByHover || !popover.matches(':popover-open')) return;
      popover.hidePopover();
      openedByHover = false;
    });
    popover.addEventListener('toggle', (event) => {
      if (event.newState === 'open') positionPopover();
      if (event.newState === 'closed') openedByHover = false;
    });
  });
}

function languageSettingHtml(id) {
  return `
    <div class="setting-row">
      ${helpDisclosureHtml(id + 'Help', 'Language', 'Choose the language used by this device.')}
      <select id="${id}" aria-label="${escapeHtml(t('Language'))}">
        <option value="en" ${language === 'en' ? 'selected' : ''}>${escapeHtml(t('English'))}</option>
        <option value="de" ${language === 'de' ? 'selected' : ''}>${escapeHtml(t('German'))}</option>
        <option value="ru" ${language === 'ru' ? 'selected' : ''}>${escapeHtml(t('Russian'))}</option>
      </select>
    </div>
  `;
}

function wireLanguageSelect(id) {
  const select = document.getElementById(id);
  if (!select) return;
  select.addEventListener('change', () => {
    clientActions.clearPendingConfirm();
    language = i18n.setLanguage(select.value, window);
    selectInteraction.release(select);
    if (lastState) render(lastState);
  });
}

function soundSettingHtml(id) {
  const enabled = soundEffects.isEnabled();
  return `
    <div class="setting-row">
      ${helpDisclosureHtml(id + 'Help', 'Sound effects', 'Play game sound effects on this device.')}
      <select id="${id}" aria-label="${escapeHtml(t('Sound effects'))}">
        <option value="on" ${enabled ? 'selected' : ''}>${escapeHtml(t('On'))}</option>
        <option value="off" ${enabled ? '' : 'selected'}>${escapeHtml(t('Off'))}</option>
      </select>
    </div>
  `;
}

function wireSoundSelect(id) {
  const select = document.getElementById(id);
  if (!select) return;
  select.addEventListener('change', () => {
    soundEffects.setEnabled(select.value !== 'off');
    if (select.value !== 'off') soundEffects.unlock();
  });
}

function inactivityTimeoutSettingHtml(state, id) {
  const minutes = state.inactivityTimeoutMinutes || 15;
  return `
    <div class="setting-row">
      ${helpDisclosureHtml(id + 'Help', 'Inactive after', 'If nobody plays for this long, the game ends and the room is freed for new players. Choose a longer time if everyone plans to return.')}
      <select id="${id}" aria-label="${escapeHtml(t('Inactive after'))}">
        ${[15, 30, 60, 90].map((value) => `<option value="${value}" ${minutes === value ? 'selected' : ''}>${escapeHtml(t('{count} minutes', { count: value }))}</option>`).join('')}
      </select>
    </div>
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

function botTimingSettingHtml(state, id) {
  const percent = [0, 25, 50, 75, 100].includes(Number(state.botTimingPercent))
    ? Number(state.botTimingPercent)
    : 50;
  return `
    <div class="setting-row">
      ${helpDisclosureHtml(id + 'Help', 'Bot timing', 'Choose how much of the original bot waiting time is used. 0% is immediate and 100% is the original pace. This setting is shared by everyone.')}
      <select id="${id}" aria-label="${escapeHtml(t('Bot timing'))}">
        ${[0, 25, 50, 75, 100].map((value) => `<option value="${value}" ${percent === value ? 'selected' : ''}>${value}%</option>`).join('')}
      </select>
    </div>
  `;
}

function wireBotTimingSelect(id) {
  const select = document.getElementById(id);
  if (!select) return;
  select.addEventListener('change', () => {
    clientActions.clearPendingConfirm();
    emit('setBotTimingPercent', select.value);
  });
}

function renderSideArea(state) {
  const r = state.round;
  const selectedTheme = window.DutchTheme.getStoredTheme(window);
  const selectableGameTargets = new Set(
    Array.isArray(state.selectableGameTargets) ? state.selectableGameTargets.map(Number) : [50, 100, 200]
  );
  const completedRounds = (state.scoreHistory || []).length;
  const detailsMode = 'game';
  const gameKey = String(state.gameStartedAt || 'current-game');
  if (detailPreferencesGameKey !== gameKey) {
    detailPreferencesGameKey = gameKey;
    detailPreferencesByMode[detailsMode] = {};
  }
  currentDetailsMode = detailsMode;
  if (!detailPreferencesByMode[detailsMode]) detailPreferencesByMode[detailsMode] = {};
  const pointsTableDefaultOpen = completedRounds >= 1 && completedRounds < 3;
  const pointsGraphDefaultOpen = completedRounds >= 3;
  return `
    <aside class="side-area">
      <div class="side-status-card" data-game-region="status">
        ${renderStatus(state)}
      </div>
      <div class="panel side-panel">
        <div class="side-drawers">
          ${renderDetails('pointsGraph', t('Points graph'), () => renderPointsChart(state, r.players), pointsGraphDefaultOpen)}
          ${renderDetails('pointsTable', t('Points table'), () => pointsTable(state), pointsTableDefaultOpen)}
          ${renderDetails('log', t('Game log'), () => renderLog(state), false)}
          ${renderDetails('guide', t('Quick guide'), () => shortInstructions(), false)}
          ${renderDetails('rules', t('Complete rules'), () => fullRules(state), false, 'rules-body')}
          ${renderDetails('settings', t('Settings'), () => `
            <div class="drawer-content waiting-selectors">
              <div class="setting-row">
                ${helpDisclosureHtml('inGameLengthHelp', 'Game length', 'Choose how long the game lasts: a double game ends when a player passes 200 points, a full game uses 100 points, a short game uses 50 points, and a single round ends after one round with the lowest score winning.')}
                <select id="inGameTargetSelect" aria-label="${escapeHtml(t('Game length'))}" ${state.canChangeGameTarget ? '' : 'disabled'}>
                  <option value="single" ${state.singleRound ? 'selected' : ''} ${state.canSelectSingleRound ? '' : 'disabled'}>${escapeHtml(t('Single round'))}</option>
                  <option value="50" ${!state.singleRound && state.gameTarget === 50 ? 'selected' : ''} ${selectableGameTargets.has(50) ? '' : 'disabled'}>${escapeHtml(t('Short game, 50 points'))}</option>
                  <option value="100" ${!state.singleRound && state.gameTarget === 100 ? 'selected' : ''} ${selectableGameTargets.has(100) ? '' : 'disabled'}>${escapeHtml(t('Full game, 100 points'))}</option>
                  <option value="200" ${!state.singleRound && state.gameTarget === 200 ? 'selected' : ''} ${selectableGameTargets.has(200) ? '' : 'disabled'}>${escapeHtml(t('Double game, 200 points'))}</option>
                </select>
              </div>
              ${inactivityTimeoutSettingHtml(state, 'gameInactivityTimeoutSelect')}
              ${botTimingSettingHtml(state, 'gameBotTimingSelect')}
              <div class="setting-row">
                ${helpDisclosureHtml('changedCardsHelp', 'Changed cards', 'Highlight cards that were changed recently for all players, making swaps and other changes easier to follow.')}
                <select id="highlightChangedCardsSelect" aria-label="${escapeHtml(t('Changed cards'))}">
                  <option value="true" ${state.highlightChangedCards !== false ? 'selected' : ''}>${escapeHtml(t('Highlight'))}</option>
                  <option value="false" ${state.highlightChangedCards === false ? 'selected' : ''}>${escapeHtml(t("Don't highlight"))}</option>
                </select>
              </div>
              <div class="setting-row">
                ${helpDisclosureHtml('gameAppearanceHelp', 'Appearance', 'Choose the light or dark color theme.')}
                <select id="gameThemeSelect" aria-label="${escapeHtml(t('Appearance'))}">
                  <option value="light" ${selectedTheme === 'light' ? 'selected' : ''}>${escapeHtml(t('Light mode'))}</option>
                  <option value="dark" ${selectedTheme === 'dark' ? 'selected' : ''}>${escapeHtml(t('Dark mode'))}</option>
                </select>
              </div>
              ${soundSettingHtml('gameSoundSelect')}
              ${languageSettingHtml('gameLanguageSelect')}
            </div>
          `, false)}
        </div>
      </div>
      ${repoLink(state.version, 'data-game-region="repository"')}
    </aside>
  `;
}

function renderDetails(key, title, content, defaultOpen, extraClass = '') {
  const preferences = detailPreferencesByMode[currentDetailsMode] || {};
  const open = preferences[key] === undefined ? defaultOpen : preferences[key];
  const classes = ['drawer', 'side-drawer', extraClass].filter(Boolean).join(' ');
  const lazy = typeof content === 'function';
  const renderedContent = lazy ? (open ? content() : '') : content;
  return `
    <details data-detail-key="${escapeHtml(key)}" data-lazy-content="${lazy && !open ? 'true' : 'false'}" class="${escapeHtml(classes)}" ${open ? 'open' : ''}>
      <summary>${escapeHtml(title)}</summary>
      <div class="drawer-animation-content">${renderedContent}</div>
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
    return '<li value="' + moveNumber + '" class="' + (isSystem ? 'system-log' : '') + '">' + escapeHtml(translatedGameText(line.text)) + '</li>';
  }).join("");
  const controls = lines.length > 8
    ? '<div class="log-controls">' +
        (logExpanded ? '<button type="button" class="log-toggle" data-action="downloadLog">' + escapeHtml(t('Download game logs')) + '</button>' : '') +
        '<button type="button" class="log-toggle" data-action="toggleLog">' + escapeHtml(t(logExpanded ? 'Show less' : 'Show more')) + '</button>' +
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
    return formatRelativeLogTime(logEntryTimeMs(line), relativeBaseMs) + " " + moveNumber + "." + kind + " " + translatedGameText(line.text);
  });
}

function scoreHistoryForDownload(state) {
  const history = state && Array.isArray(state.scoreHistory) ? state.scoreHistory : [];
  const rows = scoreHistoryRows(history);
  if (language === 'en') return rows;
  return rows.map((row) => row === 'No completed rounds yet.'
    ? t(row)
    : row.replace(/^Round(?= | \|)/, t('Round')));
}

function gameStartedLogTimestamp(state, fallbackDate = new Date()) {
  if (!state || !state.gameStartedAt) return logTimestamp(fallbackDate);
  const startedAt = new Date(state.gameStartedAt);
  return Number.isNaN(startedAt.getTime()) ? logTimestamp(fallbackDate) : logTimestamp(startedAt);
}

function downloadLogFile(state) {
  const exportedTimestamp = logTimestamp();
  const startedTimestamp = gameStartedLogTimestamp(state);
  const title = t('Dutch game log {timestamp}', { timestamp: startedTimestamp });
  const body = [
    title,
    t('Exported: {timestamp}', { timestamp: exportedTimestamp }),
    "",
    t('Points table:'),
    ...scoreHistoryForDownload(state),
    "",
    t('Game log:'),
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

function pointColorIndex(state, playerId) {
  if (pointColorAssignments.order.length === 0) {
    pointColorAssignments.order = shuffledPointColorIndices('table-player-colors', 9);
  }
  if (pointColorAssignments.byPlayerId.has(playerId)) return pointColorAssignments.byPlayerId.get(playerId);
  const visibleIds = [];
  for (const player of state.players || []) {
    if (player.id && !visibleIds.includes(player.id)) visibleIds.push(player.id);
  }
  for (const entry of state.scoreHistory || []) {
    for (const player of entry.players || []) {
      if (player.id && !visibleIds.includes(player.id)) visibleIds.push(player.id);
    }
  }
  for (const player of (state.round && state.round.players) || []) {
    if (player.id && !player.isSpectator && !visibleIds.includes(player.id)) visibleIds.push(player.id);
  }
  const usedColors = new Set(visibleIds.map((id) => pointColorAssignments.byPlayerId.get(id)).filter(Number.isInteger));
  const colorIndex = pointColorAssignments.order.find((index) => !usedColors.has(index))
    ?? pointColorAssignments.order[pointColorAssignments.byPlayerId.size % pointColorAssignments.order.length];
  pointColorAssignments.byPlayerId.set(playerId, colorIndex);
  return colorIndex;
}

function playerNameHtml(state, player, displayName = player.name) {
  const colorIndex = pointColorIndex(state, player.id);
  return `<span class="player-name-with-color" style="--series-color: var(--chart-color-${colorIndex})">${escapeHtml(displayName)}</span>`;
}

function pointsChartMarker(x, y, label) {
  const common = `class="points-chart-marker" tabindex="0" role="img" aria-label="${escapeHtml(label)}"`;
  return `<circle ${common} cx="${x}" cy="${y}" r="2"><title>${escapeHtml(label)}</title></circle>`;
}

function renderPointsChart(state, currentPlayers) {
  const history = state.scoreHistory || [];
  if (history.length === 0) return '<p class="hint">' + escapeHtml(t('No completed rounds yet.')) + '</p>';
  const series = scoreHistorySeries(history, currentPlayers);
  if (series.length === 0) return '';

  const width = 300;
  const height = 180;
  const maxRound = Math.max(1, ...history.map((entry) => Number(entry.round) || 0));
  const maxTotal = Math.max(0, ...series.flatMap((item) => item.points.map((point) => point.total)));
  const target = state.singleRound ? 0 : Number(state.gameTarget) || 0;
  const { margin, plotWidth, yMax, x, y, coordinate, xTicks, yTicks } = pointsChartGeometry({
    width,
    height,
    maxRound,
    maxTotal,
    target
  });

  const grid = yTicks.map((value) => {
    const yPos = coordinate(y(value));
    return `<g class="points-chart-grid"><line x1="${margin.left}" y1="${yPos}" x2="${width - margin.right}" y2="${yPos}"></line><text x="${margin.left - 6}" y="${yPos + 3}">${escapeHtml(String(Math.round(value)))}</text></g>`;
  }).join('');
  const roundLabels = xTicks.map((round) => {
    const xPos = coordinate(x(round));
    return `<text class="points-chart-round" x="${xPos}" y="${height - 7}">${escapeHtml(round === 0 ? '0' : 'R' + round)}</text>`;
  }).join('');
  const halvingLines = HALVING_TOTALS
    .filter((value) => value <= yMax && value !== target)
    .map((value) => `<g class="points-chart-halving"><line x1="${margin.left}" y1="${coordinate(y(value))}" x2="${width - margin.right}" y2="${coordinate(y(value))}"></line></g>`)
    .join('');
  const targetLine = target > 0 && target <= yMax
    ? `<g class="points-chart-target"><line x1="${margin.left}" y1="${coordinate(y(target))}" x2="${width - margin.right}" y2="${coordinate(y(target))}"></line><text x="${coordinate(margin.left + plotWidth / 2)}" y="${Math.max(10, coordinate(y(target)) - 4)}">${escapeHtml(t('Target: {points}', { points: target }))}</text></g>`
    : '';

  const chartSeries = series.map((item) => {
    const colorIndex = pointColorIndex(state, item.id);
    const points = item.points.map((point) => ({
      ...point,
      x: coordinate(x(point.round)),
      y: coordinate(y(point.total))
    }));
    const path = points.map((point, pointIndex) => (pointIndex === 0 ? 'M' : 'L') + point.x + ' ' + point.y).join(' ');
    const markers = points.map((point) => {
      const label = t('Round {round}: {name}, {points} points', {
        round: point.round,
        name: item.name,
        points: point.total
      });
      return pointsChartMarker(point.x, point.y, label);
    }).join('');
    return `<g class="points-chart-series" style="--series-color: var(--chart-color-${colorIndex})"><path class="points-chart-line" d="${path}"></path>${markers}</g>`;
  }).join('');

  const legend = series.map((item) => {
    const colorIndex = pointColorIndex(state, item.id);
    return `<span class="points-chart-legend-item" role="listitem" style="--series-color: var(--chart-color-${colorIndex})">${escapeHtml(item.name)}</span>`;
  }).join('');

  return `
    <figure class="points-chart" aria-label="${escapeHtml(t('Points over time'))}">
      <svg class="points-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(t('Points over time'))}">
        <title>${escapeHtml(t('Points over time'))}</title>
        ${grid}
        ${halvingLines}
        ${targetLine}
        ${chartSeries}
        ${roundLabels}
      </svg>
      <div class="points-chart-legend" role="list" aria-label="${escapeHtml(t('Players'))}">${legend}</div>
    </figure>
  `;
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
      const winnerClass = winnerId && p.id === winnerId ? ' winner-points' : '';
      const colorIndex = pointColorIndex(state, p.id);
      return `<td class="player-points${winnerClass}" style="--series-color: var(--chart-color-${colorIndex})">${item ? item.total : ""}</td>`;
    }).join("");
    return `<tr><th>${escapeHtml(t('Round {number}', { number: entry.round }))}</th>${cells}</tr>`;
  }).join("");

  return `
    <div class="score-scroll">
      <table class="score-table">
        <thead><tr><th>${helpDisclosureHtml('pointsTableHelp', 'Points', 'Values show total points after each round. Number cards count their value. A=1, J=11, Q=12, red K=0, black K=13.')}</th>${players.map((p) => `<th title="${escapeHtml(p.name)}">${playerNameHtml(state, p, shortPlayerName(p.name))}</th>`).join('')}</tr></thead>
        <tbody>
          ${historyRows || '<tr><th>' + escapeHtml(t('Round')) + '</th><td colspan="99">' + escapeHtml(t('No completed rounds yet.')) + '</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}
function shortInstructions() {
  return language === 'en' ? quickRulesHtml() : i18n.quickRulesHtml(language);
}

function fullRules(state) {
  return language === 'en'
    ? fullRulesHtml(state.gameTarget, state.singleRound)
    : i18n.fullRulesHtml(language, state.gameTarget, state.singleRound);
}
