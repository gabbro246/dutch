(function initClientWaiting(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DutchClientWaiting = api;
})(typeof window !== 'undefined' ? window : globalThis, function createClientWaiting(root) {
  function create(deps) {
    const window = root;
    const document = root.document;
    const app = deps.app;
    const t = deps.translate;
    const getLanguage = deps.getLanguage;
    const escapeHtml = deps.escapeHtml;
    const i18n = deps.i18n;
    const BOT_LABELS = deps.botLabels;
    const BOT_TYPES = deps.botTypes || Object.keys(BOT_LABELS);
    const BOT_PERSONALITIES = deps.botPersonalities;
    const PLAYER_NAME_MAX_LENGTH = deps.playerNameMaxLength;
    const GAME_DESCRIPTION = deps.gameDescription;
    const playerNameHtml = deps.playerNameHtml;
    const helpDisclosureHtml = deps.helpDisclosureHtml;
    const inactivityTimeoutSettingHtml = deps.inactivityTimeoutSettingHtml;
    const botTimingSettingHtml = deps.botTimingSettingHtml;
    const languageSettingHtml = deps.languageSettingHtml;
    const soundSettingHtml = deps.soundSettingHtml;
    const shortInstructions = deps.shortInstructions;
    const fullRules = deps.fullRules;
    const repoLink = deps.repoLink;
    const canJoinWithName = deps.canJoinWithName;
    const clientActions = deps.clientActions;
    const rememberUserName = deps.rememberUserName;
    const rememberUserTokenBackup = deps.rememberUserTokenBackup;
    const userToken = deps.userToken;
    const emit = deps.emit;
    const wireHelpDisclosures = deps.wireHelpDisclosures;
    const wireAnimatedDrawers = deps.wireAnimatedDrawers;
    const wireInactivityTimeoutSelect = deps.wireInactivityTimeoutSelect;
    const wireBotTimingSelect = deps.wireBotTimingSelect;
    const wireLanguageSelect = deps.wireLanguageSelect;
    const wireSoundSelect = deps.wireSoundSelect;
    const waitingDrawerPreferences = { bots: false, players: false, guide: false, rules: false, settings: false, settingsExpanded: false };
    let previousWaitingPlayerCount = 0;
    let selectedBotType = '';

    function botTypeLabel(type) {
      return BOT_LABELS[type] || 'Bot';
    }
    
    function renderBotPersonality(type) {
      const basePersonality = BOT_PERSONALITIES[type] || null;
      const personality = i18n.localizedBotPersonality(getLanguage(), type, basePersonality);
      const fallbackStats = i18n.localizedBotPersonality(getLanguage(), 'dory', Object.values(BOT_PERSONALITIES)[0]).stats;
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
      const botTypes = BOT_TYPES;
      const usedBotTypes = new Set(state.players.filter((p) => p.isBot).map((p) => p.botType));
      const availableBotTypes = botTypes.filter((type) => !usedBotTypes.has(type));
      if (!availableBotTypes.includes(selectedBotType)) {
        selectedBotType = availableBotTypes.length
          ? availableBotTypes[Math.floor(window.Math.random() * availableBotTypes.length)]
          : '';
      }
      let startDisabled = state.canStart === false || state.joined === false;
      if (previousWaitingPlayerCount === 0 && state.players.length > 0) waitingDrawerPreferences.players = true;
      previousWaitingPlayerCount = state.players.length;
      const botsOpen = waitingDrawerPreferences.bots ? 'open' : '';
      const playersOpen = waitingDrawerPreferences.players ? 'open' : '';
      const guideOpen = waitingDrawerPreferences.guide ? 'open' : '';
      const rulesOpen = waitingDrawerPreferences.rules ? 'open' : '';
      const settingsOpen = waitingDrawerPreferences.settings ? 'open' : '';
      const settingsExpanded = waitingDrawerPreferences.settingsExpanded;
      const noBotsLeftOption = availableBotTypes.length
        ? ''
        : '<option value="" selected disabled>' + escapeHtml(t('No bots left')) + '</option>';
      const botOptions = noBotsLeftOption + botTypes.map((type) => `
        <option value="${escapeHtml(type)}" ${usedBotTypes.has(type) ? 'disabled' : ''} ${type === selectedBotType ? 'selected' : ''}>${escapeHtml(botTypeLabel(type))}</option>
      `).join('');
      const players = state.players.map((p, index) => {
        const isUser = p.id === state.user;
        const moveControls = `
          <div class="player-line-actions">
            ${isUser ? '<button data-action="leaveWaitingPlayer">' + escapeHtml(t('Leave')) + '</button>' : `<button data-action="removeWaitingPlayer" data-player-id="${escapeHtml(p.id)}">${escapeHtml(t('Remove'))}</button>`}
            <button class="icon-button" title="${escapeHtml(t('Move up'))}" aria-label="${escapeHtml(t('Move {name} up', { name: p.name }))}" data-action="moveWaitingPlayer" data-player-id="${escapeHtml(p.id)}" data-direction="up" ${index === 0 ? 'disabled' : ''}>↑</button>
            <button class="icon-button" title="${escapeHtml(t('Move down'))}" aria-label="${escapeHtml(t('Move {name} down', { name: p.name }))}" data-action="moveWaitingPlayer" data-player-id="${escapeHtml(p.id)}" data-direction="down" ${index === state.players.length - 1 ? 'disabled' : ''}>↓</button>
          </div>
        `;
        return `
          <div class="player-line" data-waiting-player-id="${escapeHtml(p.id)}">
            <span>${index + 1}. ${playerNameHtml(state, p)}${p.isBot ? ' <span class="bot-badge">' + escapeHtml(t('bot')) + '</span>' : ''}${p.isSpectator ? ' <span class="spectator-badge">' + escapeHtml(t('spectator')) + '</span>' : ''}${isUser ? ' <span class="user-badge">' + escapeHtml(t('user')) + '</span>' : ''} ${p.connected ? '' : '(' + escapeHtml(t('missing')) + ')'}</span>
            ${moveControls}
          </div>
        `;
      }).join('');
      const joined = state.joined;
      const user = state.players.find((p) => p.id === state.user);
      const humanCount = state.players.filter((p) => !p.isBot && !p.isSpectator).length;
      const playerHintText = humanCount === 0 ? t('Waiting for a human player.') : t('Waiting for another human or a bot.');
      const playerHint = state.players.length > 0 && !state.canStart ? `<p class="hint">${playerHintText}</p>` : '';
      app.innerHTML = `
        <div class="page waiting-page">
          <h1 class="app-title">Dutch! 🂡</h1>
          <div class="waiting-panel">
            <p class="waiting-description">${escapeHtml(t(GAME_DESCRIPTION))}</p>
            <div class="waiting-controls">
              <div class="row join-row">
                <input id="nameInput" placeholder="${escapeHtml(t('Name'))}" maxlength="${PLAYER_NAME_MAX_LENGTH}" value="${joined && user ? escapeHtml(user.name) : ''}" ${joined ? 'disabled' : ''}>
                <button id="joinBtn" class="expected-action" disabled>${escapeHtml(t('Join'))}</button>
                <button id="leaveBtn" ${joined ? '' : 'disabled'}>${escapeHtml(t('Leave'))}</button>
              </div>
              <details class="drawer waiting-drawer" data-waiting-drawer="bots" ${botsOpen}>
                <summary>${escapeHtml(t('Bots'))}</summary>
                <div class="drawer-content drawer-animation-content">
                  <div class="row bot-row">
                    <select id="botTypeSelect" ${availableBotTypes.length && state.players.length < 9 ? '' : 'disabled'}>
                      ${botOptions}
                    </select>
                    <button id="addBotBtn" class="expected-action" disabled>${escapeHtml(t('Add bot'))}</button>
                  </div>
                  <div id="botPersonalitySlot">${renderBotPersonality('')}</div>
                </div>
              </details>
              <details class="drawer waiting-drawer" data-waiting-drawer="players" ${playersOpen}>
                <summary>${escapeHtml(t('Players'))}</summary>
                <div class="drawer-content drawer-animation-content waiting-player-list player-list">
                  ${players || '<p class="hint">' + escapeHtml(t('No players yet.')) + '</p>'}
                  ${players ? playerHint : ""}
                </div>
              </details>
              <details class="drawer waiting-drawer" data-waiting-drawer="guide" ${guideOpen}>
                <summary>${escapeHtml(t('Quick guide'))}</summary>
                <div class="drawer-animation-content">${shortInstructions()}</div>
              </details>
              <details class="drawer waiting-drawer rules-body" data-waiting-drawer="rules" ${rulesOpen}>
                <summary>${escapeHtml(t('Complete rules'))}</summary>
                <div class="drawer-animation-content">${fullRules(state)}</div>
              </details>
              <details class="drawer waiting-drawer" data-waiting-drawer="settings" ${settingsOpen}>
                <summary>${escapeHtml(t('Settings'))}</summary>
                <div class="drawer-content drawer-animation-content waiting-selectors">
                  <div class="setting-row">
                    ${helpDisclosureHtml('waitingGameLengthHelp', 'Game length', 'Choose how long the game lasts: play one or five rounds, or use a 50, 100, or 200-point target. The lowest total score wins.')}
                    <select id="gameTargetSelect" aria-label="${escapeHtml(t('Game length'))}">
                      <option value="single" ${Number(state.roundLimit) === 1 || state.singleRound ? 'selected' : ''}>${escapeHtml(t('Single round'))}</option>
                      <option value="five" ${Number(state.roundLimit) === 5 ? 'selected' : ''}>${escapeHtml(t('Five rounds'))}</option>
                      <option value="50" ${!state.roundLimit && !state.singleRound && state.gameTarget === 50 ? 'selected' : ''}>${escapeHtml(t('Short game, 50 points'))}</option>
                      <option value="100" ${!state.roundLimit && !state.singleRound && state.gameTarget === 100 ? 'selected' : ''}>${escapeHtml(t('Full game, 100 points'))}</option>
                      <option value="200" ${!state.roundLimit && !state.singleRound && state.gameTarget === 200 ? 'selected' : ''}>${escapeHtml(t('Double game, 200 points'))}</option>
                    </select>
                  </div>
                  ${inactivityTimeoutSettingHtml(state, 'inactivityTimeoutSelect', true, settingsExpanded)}
                  ${botTimingSettingHtml(state, 'botTimingSelect', true, settingsExpanded)}
                  <div class="setting-row advanced-setting" ${settingsExpanded ? '' : 'hidden'}>
                    ${helpDisclosureHtml('deckAmountHelp', 'Deck amount', 'More decks make the game less predictable and add more special cards, though some may remain undealt. Two decks are required for more than four players.')}
                    <select id="deckSettingSelect" aria-label="${escapeHtml(t('Deck amount'))}">
                      <option value="one" ${state.deckSetting === 'one' ? 'selected' : ''} ${state.oneDeckDisabled ? 'disabled' : ''}>${escapeHtml(t('One deck'))}</option>
                      <option value="two" ${state.deckSetting === 'two' ? 'selected' : ''}>${escapeHtml(t('Two decks'))}</option>
                    </select>
                  </div>
                  <div class="setting-row">
                    ${helpDisclosureHtml('waitingAppearanceHelp', 'Appearance', 'Choose the light or dark color theme.')}
                    <select id="themeSelect" aria-label="${escapeHtml(t('Appearance'))}">
                      <option value="light" ${selectedTheme === 'light' ? 'selected' : ''}>${escapeHtml(t('Light mode'))}</option>
                      <option value="dark" ${selectedTheme === 'dark' ? 'selected' : ''}>${escapeHtml(t('Dark mode'))}</option>
                    </select>
                  </div>
                  ${soundSettingHtml('soundSelect')}
                  ${languageSettingHtml('languageSelect')}
                  <button type="button" class="log-toggle settings-toggle" id="waitingSettingsToggle" aria-expanded="${settingsExpanded}">
                    ${escapeHtml(t(settingsExpanded ? 'Show less' : 'Show more'))}
                  </button>
                </div>
              </details>
            </div>
            <button id="startBtn" class="expected-action" ${startDisabled ? 'disabled' : ''}>${escapeHtml(t('Start game'))}</button>
          </div>
          ${repoLink(state.version)}
        </div>
      `;
    
      const nameInput = document.getElementById('nameInput');
      wireHelpDisclosures(document);
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
          rememberUserName(name);
          rememberUserTokenBackup(userToken);
          emit('join', { name, token: userToken });
        });
        nameInput.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' && !joinBtn.disabled) {
            const name = nameInput.value.slice(0, PLAYER_NAME_MAX_LENGTH);
            clientActions.clearPendingConfirm();
            rememberUserName(name);
            rememberUserTokenBackup(userToken);
            emit('join', { name, token: userToken });
          }
        });
      }
      const leaveBtn = document.getElementById('leaveBtn');
      if (leaveBtn) leaveBtn.addEventListener('click', () => clientActions.confirmThen(leaveBtn, 'leave-waiting', t('Confirm leave'), () => emit('leave')));
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
          selectedBotType = type;
          if (botPersonalitySlot) botPersonalitySlot.innerHTML = renderBotPersonality(type);
          addBotBtn.disabled = !type || state.players.length >= 9;
          const startButton = document.getElementById('startBtn');
          if (startButton) startButton.disabled = !state.canStart || !joined;
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
      wireBotTimingSelect('botTimingSelect');
      const waitingSettingsToggle = document.getElementById('waitingSettingsToggle');
      if (waitingSettingsToggle) {
        waitingSettingsToggle.addEventListener('click', () => {
          waitingDrawerPreferences.settingsExpanded = !waitingDrawerPreferences.settingsExpanded;
          renderWaiting(state);
        });
      }
      const themeSelect = document.getElementById('themeSelect');
      if (themeSelect) {
        themeSelect.addEventListener('change', () => {
          window.DutchTheme.setTheme(themeSelect.value, window);
        });
      }
      wireSoundSelect('soundSelect');
      wireLanguageSelect('languageSelect');
      document.querySelectorAll('[data-action="moveWaitingPlayer"]').forEach((button) => {
        button.addEventListener('click', () => {
          clientActions.clearPendingConfirm();
          emit('moveWaitingPlayer', { playerId: button.dataset.playerId || '', direction: button.dataset.direction || '' });
        });
      });
      document.querySelectorAll('[data-action="removeWaitingPlayer"]').forEach((button) => {
        button.addEventListener('click', () => {
          clientActions.confirmThen(button, `remove-${button.dataset.playerId}`, t('Confirm remove'), () => emit('removeWaitingPlayer', button.dataset.playerId || ''));
        });
      });
      document.querySelectorAll('[data-action="leaveWaitingPlayer"]').forEach((button) => {
        button.addEventListener('click', () => {
          clientActions.confirmThen(button, 'leave-waiting', t('Confirm leave'), () => emit('leave'));
        });
      });
      const startBtn = document.getElementById('startBtn');
      if (startBtn) startBtn.addEventListener('click', () => {
        clientActions.clearPendingConfirm();
        emit('startGame');
      });
    }
    

    return { renderWaiting };
  }

  return { create };
});
