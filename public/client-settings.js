(function initClientSettings(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DutchClientSettings = api;
})(typeof window !== 'undefined' ? window : globalThis, function createClientSettings(root) {
  function create(deps) {
    const t = deps.translate;
    const escapeHtml = deps.escapeHtml;
    const botSpeedOptions = deps.botSpeedOptions;

    function helpDisclosureHtml(id, label, text) {
      const helpLabel = t('Show help');
      return '<button class="help-disclosure-button" type="button" popovertarget="' + escapeHtml(id) + '" title="' + escapeHtml(helpLabel) + '" aria-label="' +
        escapeHtml(t(label)) + ': ' + escapeHtml(helpLabel) + '">' + escapeHtml(t(label)) + '</button>' +
        '<div class="help-disclosure-text" id="' + escapeHtml(id) + '" popover="hint" role="note">' + escapeHtml(t(text)) + '</div>';
    }

    function option(value, selected, label, disabled = false) {
      return '<option value="' + escapeHtml(value) + '" ' + (selected ? 'selected' : '') + ' ' + (disabled ? 'disabled' : '') + '>' +
        escapeHtml(t(label)) + '</option>';
    }

    function renderGameSettingsDrawer(state, options = {}) {
      const open = options.open === true;
      const selectedTheme = options.selectedTheme || 'light';
      const selectedLanguage = options.selectedLanguage || 'en';
      const expanded = options.expanded === true;
      const soundsEnabled = options.soundsEnabled !== false;
      const selectableTargets = new Set(Array.isArray(state.selectableGameTargets) ? state.selectableGameTargets.map(Number) : [50, 100, 200]);
      const canChangeTarget = state.canChangeGameTarget !== false;
      const canSelectSingleRound = state.canSelectSingleRound !== false;
      const canSelectFiveRounds = state.canSelectFiveRounds !== false;
      const roundLimit = Number(state.roundLimit) || (state.singleRound ? 1 : 0);
      const inactivityMinutes = [15, 30, 60, 90].includes(Number(state.inactivityTimeoutMinutes)) ? Number(state.inactivityTimeoutMinutes) : 15;
      const botTimingPercent = botSpeedOptions.some((item) => item.value === Number(state.botTimingPercent)) ? Number(state.botTimingPercent) : 50;
      const content = open
        ? '<div class="drawer-content waiting-selectors">' +
          '<div class="setting-row">' +
            helpDisclosureHtml('inGameLengthHelp', 'Game length', 'Choose how long the game lasts: play one or five rounds, or use a 50, 100, or 200-point target. The lowest total score wins.') +
            '<select id="inGameTargetSelect" aria-label="' + escapeHtml(t('Game length')) + '" ' + (canChangeTarget ? '' : 'disabled') + '>' +
              option('single', roundLimit === 1, 'Single round', !canSelectSingleRound) +
              option('five', roundLimit === 5, 'Five rounds', !canSelectFiveRounds) +
              option(50, !roundLimit && state.gameTarget === 50, 'Short game, 50 points', !selectableTargets.has(50)) +
              option(100, !roundLimit && state.gameTarget === 100, 'Full game, 100 points', !selectableTargets.has(100)) +
              option(200, !roundLimit && state.gameTarget === 200, 'Double game, 200 points', !selectableTargets.has(200)) +
            '</select></div>' +
          '<div class="setting-row advanced-setting" ' + (expanded ? '' : 'hidden') + '>' +
            helpDisclosureHtml('gameInactivityTimeoutSelectHelp', 'Inactive after', 'If nobody plays for this long, the game ends and the room is freed for new players. Choose a longer time if everyone plans to return.') +
            '<select id="gameInactivityTimeoutSelect" aria-label="' + escapeHtml(t('Inactive after')) + '">' +
              [15, 30, 60, 90].map((value) => option(value, inactivityMinutes === value, t('{count} minutes', { count: value }))).join('') +
            '</select></div>' +
          '<div class="setting-row advanced-setting" ' + (expanded ? '' : 'hidden') + '>' +
            helpDisclosureHtml('gameBotTimingSelectHelp', 'Bot speed', 'Choose how quickly bots take their turns. The throw-in window always lasts 1.6 seconds and is not affected by bot speed. This setting is shared by everyone.') +
            '<select id="gameBotTimingSelect" aria-label="' + escapeHtml(t('Bot speed')) + '">' +
              botSpeedOptions.map((item) => option(item.value, botTimingPercent === item.value, item.label)).join('') +
            '</select></div>' +
          '<div class="setting-row advanced-setting" ' + (expanded ? '' : 'hidden') + '>' +
            helpDisclosureHtml('changedCardsHelp', 'Changed cards', 'Highlight cards that were changed recently for all players, making swaps and other changes easier to follow.') +
            '<select id="highlightChangedCardsSelect" aria-label="' + escapeHtml(t('Changed cards')) + '">' +
              option('true', state.highlightChangedCards !== false, 'Highlight') +
              option('false', state.highlightChangedCards === false, "Don't highlight") +
            '</select></div>' +
          '<div class="setting-row">' +
            helpDisclosureHtml('gameAppearanceHelp', 'Appearance', 'Choose the light or dark color theme.') +
            '<select id="gameThemeSelect" aria-label="' + escapeHtml(t('Appearance')) + '">' +
              option('light', selectedTheme === 'light', 'Light mode') +
              option('dark', selectedTheme === 'dark', 'Dark mode') +
            '</select></div>' +
          '<div class="setting-row">' +
            helpDisclosureHtml('gameSoundSelectHelp', 'Sound effects', 'Play game sound effects on this device.') +
            '<select id="gameSoundSelect" aria-label="' + escapeHtml(t('Sound effects')) + '">' +
              option('on', soundsEnabled, 'On') + option('off', !soundsEnabled, 'Off') +
            '</select></div>' +
          '<div class="setting-row">' +
            helpDisclosureHtml('gameLanguageSelectHelp', 'Language', 'Choose the language used by this device.') +
            '<select id="gameLanguageSelect" aria-label="' + escapeHtml(t('Language')) + '">' +
              option('en', selectedLanguage === 'en', 'English') +
              option('de', selectedLanguage === 'de', 'German') +
              option('ru', selectedLanguage === 'ru', 'Russian') +
            '</select></div>' +
          '<button type="button" class="log-toggle settings-toggle" data-action="toggleSettingsMore" aria-expanded="' + expanded + '">' +
            escapeHtml(t(expanded ? 'Show less' : 'Show more')) +
          '</button></div>'
        : '';
      return '<details data-detail-key="settings" data-lazy-content="' + (open ? 'false' : 'true') + '" class="drawer side-drawer" ' + (open ? 'open' : '') + '>' +
        '<summary>' + escapeHtml(t('Settings')) + '</summary><div class="drawer-animation-content">' + content + '</div></details>';
    }

    return { renderGameSettingsDrawer };
  }

  return { create };
});
