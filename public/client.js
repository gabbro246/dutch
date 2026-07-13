const socket = io({ autoConnect: false });
const app = document.getElementById('app');
const PLAYER_TOKEN_KEY = 'dutchPlayerSessionToken';
const playerToken = getPlayerToken();
let lastState = null;
let hasRenderedGame = false;
let pendingConfirm = null;
let currentDetailsMode = '';
let logExpanded = false;
const detailPreferencesByMode = {};
const PLAYER_NAME_MAX_LENGTH = 16;
const GAME_DESCRIPTION = 'Play the card game Dutch against other people or bots.';
const BOT_LABELS = {
  strategic: '🦉 Athena',
  roswell: '👽 Roswell',
  casual: '🐑 Norman',
  distracted: '🐠 Dory'
};
const BOT_NAMES = Object.values(BOT_LABELS);
const BOT_PERSONALITIES = {
  strategic: {
    summary: 'Tracks cards carefully, waits for strong swaps, and rarely moves without a reason.',
    stats: [
      ['Memory', 9],
      ['Tempo', 8],
      ['Risk', 4],
      ['Pressure', 7],
      ['Discipline', 9]
    ]
  },
  roswell: {
    summary: 'Reads the table relentlessly, exploits exact-score tricks, and almost never gives away value.',
    stats: [
      ['Memory', 10],
      ['Tempo', 10],
      ['Risk', 5],
      ['Pressure', 10],
      ['Discipline', 10]
    ]
  },
  casual: {
    summary: 'Makes balanced choices with a relaxed read of the table and a steady sense of timing.',
    stats: [
      ['Memory', 6],
      ['Tempo', 5],
      ['Risk', 5],
      ['Pressure', 5],
      ['Discipline', 5]
    ]
  },
  distracted: {
    summary: 'Plays erratically and boldly, with loose card tracking and a weakness for tempting moves.',
    stats: [
      ['Memory', 3],
      ['Tempo', 3],
      ['Risk', 8],
      ['Pressure', 3],
      ['Discipline', 2]
    ]
  }
};

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

function nameGraphemes(value) {
  const text = String(value || '').trim();
  if (!text) return [];
  if (window.Intl && Intl.Segmenter) {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (part) => part.segment);
  }
  return Array.from(text);
}

function isEmojiGrapheme(value) {
  return Array.from(String(value || '')).some((char) => {
    const code = char.codePointAt(0);
    return (code >= 0x1F000 && code <= 0x1FAFF) ||
      (code >= 0x1F1E6 && code <= 0x1F1FF) ||
      (code >= 0x2600 && code <= 0x27BF) ||
      (code >= 0x2300 && code <= 0x23FF);
  });
}

function shortPlayerName(name) {
  const graphemes = nameGraphemes(name);
  if (graphemes.length === 0) return '';
  if (isEmojiGrapheme(graphemes[0])) return graphemes[0];
  if (graphemes.length > 5) return graphemes.slice(0, 4).join('') + '.';
  return graphemes.join('');
}

function normalizedShortPlayerName(name) {
  return shortPlayerName(name).toLocaleLowerCase();
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

function playerNameTaken(state, name) {
  const normalized = normalizedShortPlayerName(name);
  if (!normalized) return false;
  if (BOT_NAMES.some((botName) => normalizedShortPlayerName(botName) === normalized)) return true;
  return state.players.some((player) => normalizedShortPlayerName(player.name) === normalized && player.id !== state.you);
}

function canJoinWithName(state, name) {
  if (state.joined) return false;
  if (!state.canJoin) return false;
  if (!String(name || '').trim()) return false;
  return !playerNameTaken(state, name);
}

function render(state) {
  if (!state.joined && state.phase === 'playing') {
    const gameStarted = gameStartedText(state.gameStartedAt);
    app.innerHTML = `
      <div class="page waiting-page">
        <h1 class="app-title">Dutch! 🂡</h1>
        <div class="waiting-panel">
          <p class="waiting-description">${escapeHtml(GAME_DESCRIPTION)}</p>
          <p>${escapeHtml(state.waitingMessage)}</p>
          ${gameStarted}
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
  const personality = BOT_PERSONALITIES[type];
  if (!personality) return "";
  const stats = personality.stats.map(([label, value]) => (
    "<div class=\"bot-stat\">" +
      "<span class=\"bot-stat-name\">" + escapeHtml(label) + "</span>" +
      "<span class=\"bot-stat-bar\" aria-hidden=\"true\"><span style=\"width: " + (value * 10) + "%\"></span></span>" +
      "<span class=\"bot-stat-value\">" + escapeHtml(value + "/10") + "</span>" +
    "</div>"
  )).join("");
  return "<div id=\"botPersonality\" class=\"bot-personality\">" +
    "<p>" + escapeHtml(personality.summary) + "</p>" +
    "<div class=\"bot-stats\">" + stats + "</div>" +
  "</div>";
}

function renderWaiting(state) {
  const botTypes = ['strategic', 'roswell', 'casual', 'distracted'];
  const usedBotTypes = new Set(state.players.filter((p) => p.isBot).map((p) => p.botType));
  const firstAvailableBot = botTypes.find((type) => !usedBotTypes.has(type));
  const botOptions = '<option value="" selected>Choose bot...</option>' + botTypes.map((type) => `
    <option value="${escapeHtml(type)}" ${usedBotTypes.has(type) ? 'disabled' : ''}>${escapeHtml(botTypeLabel(type))}</option>
  `).join('');
  const players = state.players.map((p, index) => {
    const isMe = p.id === state.you;
    return `
      <div class="player-line">
        <span>${index + 1}. ${escapeHtml(p.name)}${p.isBot ? ' <span class="bot-badge">bot</span>' : ''}${isMe ? ' <span class="you-label">(you)</span>' : ''} ${p.connected ? '' : '(missing)'}</span>
        ${isMe ? '' : `<button data-action="removeWaitingPlayer" data-player-id="${escapeHtml(p.id)}">Remove</button>`}
      </div>
    `;
  }).join('');
  const joined = state.joined;
  const me = state.players.find((p) => p.id === state.you);
  const humanCount = state.players.filter((p) => !p.isBot).length;
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
          <div class="row bot-row">
            <select id="botTypeSelect" ${joined && firstAvailableBot && state.players.length < 9 ? '' : 'disabled'}>
              ${botOptions}
            </select>
            <button id="addBotBtn" disabled>Add bot</button>
          </div>
          <div id="botPersonalitySlot"></div>
        </div>
        <div class="player-list">
          ${players || '<p class="hint">No players yet. Join to choose settings and add bots.</p>'}
          ${players ? playerHint : ''}
        </div>
        <div class="waiting-selectors">
          <select id="gameTargetSelect" ${!joined ? 'disabled' : ''}>
            <option value="50" ${state.gameTarget === 50 ? 'selected' : ''}>Short game, 50 points</option>
            <option value="100" ${state.gameTarget === 100 ? 'selected' : ''}>Full game, 100 points</option>
          </select>
          <select id="deckSettingSelect" ${!joined ? 'disabled' : ''}>
            <option value="one" ${state.deckSetting === 'one' ? 'selected' : ''} ${state.oneDeckDisabled ? 'disabled' : ''}>One deck</option>
            <option value="two" ${state.deckSetting === 'two' ? 'selected' : ''}>Two decks</option>
          </select>
        </div>
        <button id="startBtn" class="expected-action" ${state.canStart && joined ? '' : 'disabled'}>Start game</button>
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
      clearPendingConfirm();
      emit('join', { name: nameInput.value.slice(0, PLAYER_NAME_MAX_LENGTH), token: playerToken });
    });
    nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !joinBtn.disabled) {
        clearPendingConfirm();
        emit('join', { name: nameInput.value.slice(0, PLAYER_NAME_MAX_LENGTH), token: playerToken });
      }
    });
  }
  const leaveBtn = document.getElementById('leaveBtn');
  if (leaveBtn) leaveBtn.addEventListener('click', () => confirmThen(leaveBtn, 'leave-waiting', 'Confirm leave', () => emit('leave')));
  const botTypeSelect = document.getElementById('botTypeSelect');
  const addBotBtn = document.getElementById('addBotBtn');
  if (botTypeSelect && addBotBtn) {
    const botPersonalitySlot = document.getElementById('botPersonalitySlot');
    const updateBotPersonality = () => {
      const selectedOption = botTypeSelect.selectedOptions[0];
      const type = selectedOption && !selectedOption.disabled ? botTypeSelect.value : '';
      if (botPersonalitySlot) botPersonalitySlot.innerHTML = renderBotPersonality(type);
      addBotBtn.disabled = !type || !joined || state.players.length >= 9;
    };
    updateBotPersonality();
    botTypeSelect.addEventListener('change', updateBotPersonality);
    addBotBtn.addEventListener('click', () => {
      clearPendingConfirm();
      emit('addBot', botTypeSelect.value);
    });
  }
  const deckSettingSelect = document.getElementById('deckSettingSelect');
  if (deckSettingSelect) {
    deckSettingSelect.addEventListener('change', () => {
      clearPendingConfirm();
      emit('setDeckSetting', deckSettingSelect.value);
    });
  }
  const gameTargetSelect = document.getElementById('gameTargetSelect');
  if (gameTargetSelect) {
    gameTargetSelect.addEventListener('change', () => {
      clearPendingConfirm();
      emit('setGameTarget', gameTargetSelect.value);
    });
  }
  document.querySelectorAll('[data-action="removeWaitingPlayer"]').forEach((button) => {
    button.addEventListener('click', () => {
      confirmThen(button, `remove-${button.dataset.playerId}`, 'Confirm remove', () => emit('removeWaitingPlayer', button.dataset.playerId || ''));
    });
  });
  const startBtn = document.getElementById('startBtn');
  if (startBtn) startBtn.addEventListener('click', () => {
    clearPendingConfirm();
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
  wireGameButtons(state);
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

function specialLabel(type) {
  if (type === 'A') return 'Ace add card';
  if (type === 'Q') return 'Queen peek';
  if (type === 'J') return 'Jack swap';
  return type;
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
        <div class="player-meta">Total: ${player.total}${player.roundPoints === null ? '' : `, round: ${player.roundPoints}`}</div>
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
      <h2>Your cards</h2>
      <div class="player-title">
        <strong>${escapeHtml(player.name)}</strong>${playerBadges(state, player)}
        <div class="player-meta">Total: ${player.total}${player.roundPoints === null ? '' : `, round: ${player.roundPoints}`}</div>
      </div>
      <div class="cards-row">
        ${player.cards.map((card, index) => renderCardCell(card, player.id, index, state, false, true)).join('')}
      </div>
      <div class="row own-actions">
        <button data-action="sayDutch" class="expected-action" ${r.controls.canDutch ? '' : 'disabled'}>Dutch</button>
        <button data-action="endTurn" class="expected-action" ${r.controls.canEndTurn ? "" : "disabled"}>${endTurnLabel(state)}</button>
      </div>
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
  if (r.dutchCallerId === player.id) badges.push('<span class="player-badge dutch-badge">said Dutch</span>');
  if ((r.roundWinnerIds || []).includes(player.id)) badges.push('<span class="player-badge round-winner-badge">won this round</span>');
  if (r.winnerId === player.id) badges.push('<span class="player-badge game-winner-badge">won the game</span>');
  return badges.join('');
}

function renderDeckPile(state) {
  const r = state.round;
  const drawnCard = r.drawn
    ? cardHtml(r.drawn.card, false, { 'data-anim-role': 'drawn', 'data-location-key': 'drawn', 'data-drawn-card': 'true' })
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
  return `${under}${cardHtml(r.discardTop, false, { 'data-anim-role': 'pile-top', 'data-location-key': 'pile-top' })}`;
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
      ${cardHtml(card, compact, { 'data-location-key': `player:${ownerId}:${index}`, 'data-selected': selected ? 'true' : '' })}
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

function logTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return date.getFullYear() + '-' +
    pad(date.getMonth() + 1) + '-' +
    pad(date.getDate()) + '_' +
    pad(date.getHours()) + '-' +
    pad(date.getMinutes()) + '-' +
    pad(date.getSeconds());
}

function logEntryTimeMs(entry) {
  if (!entry || typeof entry === "string") return null;
  const ms = Date.parse(entry.at || "");
  return Number.isFinite(ms) ? ms : null;
}

function logRelativeBaseMs(lines) {
  const times = lines.map(logEntryTimeMs).filter(Number.isFinite);
  return times.length ? Math.min(...times) : null;
}

function formatRelativeLogTime(ms, baseMs) {
  if (!Number.isFinite(ms) || !Number.isFinite(baseMs)) return "+--:--.---";
  const elapsed = Math.max(0, ms - baseMs);
  const milliseconds = elapsed % 1000;
  const totalSeconds = Math.floor(elapsed / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const pad = (value, size = 2) => String(value).padStart(size, "0");
  const clock = hours > 0
    ? hours + ":" + pad(minutes) + ":" + pad(seconds)
    : pad(minutes) + ":" + pad(seconds);
  return "+" + clock + "." + pad(milliseconds, 3);
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
  if (history.length === 0) return ["No completed rounds yet."];
  const playerNames = [];
  for (const entry of history) {
    for (const player of entry.players || []) {
      if (!playerNames.includes(player.name)) playerNames.push(player.name);
    }
  }
  const rows = ["Round | " + playerNames.join(" | ")];
  rows.push(["---", ...playerNames.map(() => "---")].join(" | "));
  for (const entry of history) {
    rows.push([
      "Round " + entry.round,
      ...playerNames.map((name) => {
        const player = (entry.players || []).find((item) => item.name === name);
        return player ? String(player.total) : "";
      })
    ].join(" | "));
  }
  return rows;
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
  state.round.players.forEach((player) => {
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
  return `
    <p><strong>Goal:</strong> As few points as possible.</p>
    <p><strong>Start:</strong> Each player gets 4 cards face down and may look at 2 of them. The first discard card is turned up only after everyone has finished peeking.</p>
    <p><strong>Turn:</strong> Draw one card. Either swap it with one of your own cards or discard it again.</p>
    <p><strong>Throwing in:</strong> Matching cards may be thrown in immediately unless the top card was itself thrown in. Wrong throw-in: one penalty card, and the top card stays open for another throw-in.</p>
    <p><strong>Points:</strong> Number cards count their value. A=1, J=11, Q=12, ♥♦K=0, ♣♠K=13.</p>
    <p><strong>Special cards:</strong> A may add one card to someone. Q may look at any one card. J may swap any two cards. These actions are optional.</p>
    <p>Anyone who believes they have 5 points or less may say <strong>Dutch</strong>. After that, everyone else gets one more turn. Then reveal and count. The player with the most points in the last round starts the next round.</p>
  `;
}

function fullRules(state) {
  return `
    <p>Dutch is a card game in which players try to collect as few points as possible over several rounds. It is played with a normal deck of cards without jokers. With many players, two decks can be shuffled together.</p>
    <p>At the beginning, each player receives four cards face down. Then each player may look at exactly two of their own cards. These cards are then placed face down again. After every player has finished peeking, one card is turned up from the draw pile to start the face-up discard pile. The remaining cards form the face-down draw pile.</p>
    <p>Play goes in turn order. The player whose turn it is draws one card, either from the draw pile or from the discard pile. If the player takes the card from the discard pile, they must swap it with one of their own cards. If the player takes a card from the draw pile, they may either swap it with one of their own cards or place it directly face up on the discard pile. If one of their own cards is replaced, that card goes face up onto the discard pile.</p>
    <p>Number cards count their value. Ace counts 1 point. Jack counts 11 points. Queen counts 12 points. Heart King and Diamond King count 0 points. Club King and Spade King count 13 points.</p>
    <p>Ace, Queen, and Jack are special cards as soon as they are placed face up on the discard pile. With an Ace, the player may give any player one face-down card from the draw pile. With a Queen, the player may look at any one card. With a Jack, the player may swap any two face-down cards. These actions are optional.</p>
    <p>If a card is lying face up on the discard pile, a player may immediately throw in by placing exactly one own face-down card onto the discard pile, if it has the same card value. Suit does not matter. Kings may be placed on each other when throwing in. A card that was thrown in cannot be thrown on again. If someone throws in wrongly and takes a penalty card, the same top card stays open for another throw-in until the next playing action.</p>
    <p>Anyone who throws in incorrectly takes their card back and receives one unknown face-down penalty card.</p>
    <p>If a player believes they have 5 points or less, they may say <strong>Dutch</strong> at the end of their turn. After that, every other player gets exactly one more turn. Then everyone reveals their cards and counts the points.</p>
    <p>If the Dutch caller has 5 points or less and nobody has fewer points, they receive 0 points for that round. If they have more than 5 points or another player has fewer points, their points are doubled. All other players receive their normal points.</p>
    <p>After each round, points are added to the total score. If a player reaches exactly 50 or exactly 100 points, their score is halved. The player with the most points in the previous round starts the next round. As soon as a player has more than ${state.gameTarget} points after scoring and halving, the game ends. The winner is the player with the fewest total points.</p>
  `;
}

function wireGameButtons() {
  const detailsMode = currentDetailsMode;
  document.querySelectorAll('details[data-detail-key]').forEach((details) => {
    details.addEventListener('toggle', () => {
      if (!detailPreferencesByMode[detailsMode]) detailPreferencesByMode[detailsMode] = {};
      detailPreferencesByMode[detailsMode][details.dataset.detailKey] = details.open;
    });
  });
  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.action;
      if (action === "toggleLog") {
        logExpanded = !logExpanded;
        if (lastState) render(lastState);
        return;
      }
      if (action === "downloadLog") {
        downloadLogFile(lastState);
        return;
      }
      const cardId = button.dataset.cardId;
      const run = () => {
        if (action === 'aceAdd') {
          emit('aceAdd', button.dataset.playerId || '');
          return;
        }
        if (cardId) emit(action, cardId);
        else emit(action);
      };
      if (action === 'leave') {
        confirmThen(button, 'leave-game', 'Confirm leave', run);
        return;
      }
      if (action === 'endGameForAll') {
        confirmThen(button, 'end-game-for-all', 'Confirm end game', run);
        return;
      }
      clearPendingConfirm();
      run();
    });
  });
}

function confirmThen(button, key, label, callback) {
  if (!button || button.disabled) return;
  if (pendingConfirm && pendingConfirm.key === key) {
    clearPendingConfirm();
    callback();
    return;
  }
  clearPendingConfirm();
  pendingConfirm = {
    key,
    button,
    label: button.innerHTML,
    timer: window.setTimeout(clearPendingConfirm, 3500)
  };
  button.innerHTML = escapeHtml(label);
}

function clearPendingConfirm() {
  if (!pendingConfirm) return;
  window.clearTimeout(pendingConfirm.timer);
  if (pendingConfirm.button && pendingConfirm.button.isConnected) pendingConfirm.button.innerHTML = pendingConfirm.label;
  pendingConfirm = null;
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
