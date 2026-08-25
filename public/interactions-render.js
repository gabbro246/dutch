(function initInteractionRender(root, factory) {
  const commonJs = typeof module === 'object' && module.exports;
  const api = factory(
    commonJs ? require('./i18n.js') : root.DutchI18n,
    commonJs ? require('./shared.js') : root.DutchShared,
    commonJs ? require('./client-settings.js') : root.DutchClientSettings
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DutchInteractionRender = api;
})(typeof window !== 'undefined' ? window : globalThis, function createInteractionRender(i18n, shared, clientSettings) {
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
      .map(([key, value]) => key + '="' + escapeHtml(value) + '"')
      .join(' ');
  }

  function cardHtml(card, small, extraAttrs = {}) {
    const smallClass = small ? ' small' : '';
    if (!card) return '<div class="card' + smallClass + ' empty-card">empty</div>';
    const faceKind = card.back ? 'back' : 'front';
    const dataAttrs = attrsToText({ 'data-card-id': card.id, 'data-face-kind': faceKind, ...extraAttrs });
    if (card.back) return '<div class="card' + smallClass + ' back-' + escapeHtml(card.deckColor) + '" ' + dataAttrs + '>##</div>';
    return '<div class="card' + smallClass + ' ' + (card.red ? 'red' : 'black') + '" ' + dataAttrs + '>' +
      '<div><div class="rank">' + escapeHtml(card.rank) + escapeHtml(card.symbol) + '</div>' +
      '<div class="points">' + escapeHtml(card.points) + '</div></div></div>';
  }

  function actionButton(action, playerId, label, attributes = {}) {
    return '<button type="button" data-action="' + action + '" data-player-id="' + escapeHtml(playerId) + '" ' +
      attrsToText(attributes) + '>' + escapeHtml(label) + '</button>';
  }

  function language(state) {
    return (state.preferences && state.preferences.language) || 'en';
  }

  function t(state, key, values) {
    return i18n.translate(language(state), key, values);
  }

  function specialAction(card, ownerId, state) {
    if (state.round.stage === 'peek') {
      return actionButton('initial-peek', ownerId, t(state, 'Peek'), { 'data-card-id': card.id });
    }
    const special = state.round.special;
    if (!special) return '<button class="special-action-placeholder" disabled>' + escapeHtml(t(state, 'Action')) + '</button>';
    if (special.type === 'A') {
      return actionButton('ace', special.actorId, 'A ' + t(state, 'add'), {
        'data-target-player-id': ownerId
      });
    }
    if (special.type === 'Q') {
      return actionButton('queen', special.actorId, 'Q ' + t(state, 'peek'), { 'data-card-id': card.id });
    }
    if (special.type === 'J') {
      const selectedCards = special.selected || [];
      const selected = selectedCards.includes(card.id);
      return actionButton('jack-target', special.actorId, selected ? 'J undo' : 'J ' + t(state, 'swap'), {
        'data-card-id': card.id,
        disabled: selectedCards.length >= 2 ? 'disabled' : ''
      });
    }
    return '<button class="special-action-placeholder" disabled>' + escapeHtml(t(state, 'Action')) + '</button>';
  }

  function renderCardCell(card, player, index, state, compact) {
    const canReplace = !!(state.round.drawn && state.round.drawn.playerId === player.id);
    const buttons = [
      actionButton('replace', player.id, 'Replace', { 'data-card-id': card.id, disabled: canReplace ? '' : 'disabled' }),
      actionButton('replace-special', player.id, 'Repl. A', { 'data-card-id': card.id, 'data-special-type': 'A', disabled: canReplace ? '' : 'disabled' }),
      actionButton('replace-special', player.id, 'Repl. Q', { 'data-card-id': card.id, 'data-special-type': 'Q', disabled: canReplace ? '' : 'disabled' }),
      actionButton('replace-special', player.id, 'Repl. J', { 'data-card-id': card.id, 'data-special-type': 'J', disabled: canReplace ? '' : 'disabled' }),
      actionButton('right-throw', player.id, 'Ri. Th. In', { 'data-card-id': card.id, disabled: state.round.discardTop ? '' : 'disabled' }),
      actionButton('wrong-throw', player.id, 'Wr. Th. In', { 'data-card-id': card.id, disabled: state.round.discardTop ? '' : 'disabled' }),
      specialAction(card, player.id, state)
    ].filter(Boolean).join('');
    const selected = state.round.special && (state.round.special.selected || []).includes(card.id);
    return '<div class="card-cell" data-owner-id="' + escapeHtml(player.id) + '" data-card-slot="' + escapeHtml(player.id) + ':' + index + '">' +
      cardHtml(card, compact, {
        'data-location-key': 'player:' + player.id + ':' + index,
        'data-selected': selected ? 'true' : '',
        'data-highlight': state.highlightChangedCards === false || card.highlight === 'peek' ? '' : (card.highlight || '')
      }) + '<div class="card-buttons">' + buttons + '</div></div>';
  }

  function playerActions(player, state) {
    const nextPlayer = systemButton('next-player', t(state, 'Next player'), {
      disabled: state.round.currentPlayerId === player.id && !['roundEnd', 'gameEnd', 'revealing', 'opening'].includes(state.round.stage) ? '' : 'disabled'
    });
    return '<div class="row player-actions">' +
      actionButton('call-dutch', player.id, 'Dutch', {
        disabled: state.round.turnComplete && state.round.currentPlayerId === player.id ? '' : 'disabled'
      }) +
      nextPlayer +
      actionButton('game-winner', player.id, 'Game winner') +
    '</div>';
  }

  function playerBadges(player, state) {
    return [
      player.id === state.user ? '<span class="user-badge">' + escapeHtml(t(state, 'your cards')) + '</span>' : '',
      state.round.dutchCallerId === player.id ? '<span class="player-badge dutch-badge">' + escapeHtml(t(state, 'said Dutch')) + '</span>' : '',
      (state.round.roundWinnerIds || []).includes(player.id) ? '<span class="player-badge round-winner-badge">' + escapeHtml(t(state, 'won this round')) + '</span>' : '',
      state.round.winnerId === player.id ? '<span class="player-badge game-winner-badge">' + escapeHtml(t(state, 'won the game')) + '</span>' : ''
    ].join('');
  }

  function playerClasses(player, state, isUser) {
    const classes = [isUser ? 'user-area' : 'player-field'];
    if (state.round.currentPlayerId === player.id) classes.push('current');
    if (state.round.dutchCallerId === player.id) classes.push('dutch-caller');
    if ((state.round.roundWinnerIds || []).includes(player.id)) classes.push('round-winner');
    if (state.round.winnerId === player.id) classes.push('game-winner');
    return classes.join(' ');
  }

  function renderPlayer(player, state, isUser) {
    const title = isUser
      ? '<h2>' + escapeHtml(player.name) + ' ' + playerBadges(player, state) + '</h2>'
      : '<strong>' + escapeHtml(player.name) + '</strong>' + playerBadges(player, state);
    return '<section class="' + playerClasses(player, state, isUser) + '" data-player-panel-id="' + escapeHtml(player.id) + '"' +
      (isUser ? ' data-game-region="user"' : '') + '>' +
      '<div class="player-title">' + title + '<div class="player-meta">' + escapeHtml(t(state, 'Total: {total}', { total: 0 })) + '</div></div>' +
      '<div class="cards-row">' + player.cards.map((card, index) => renderCardCell(card, player, index, state, !isUser)).join('') + '</div>' +
      playerActions(player, state) +
    '</section>';
  }

  function stackBacks(count, color) {
    if (count <= 0) return '<div class="card empty-card">empty</div>';
    let html = '';
    const shown = Math.min(3, count);
    for (let index = 0; index < shown; index += 1) {
      const topAttrs = index === shown - 1 ? ' data-anim-role="deck-top" data-location-key="deck-top"' : '';
      html += '<div class="card back-' + escapeHtml(color) + '" data-face-kind="stack-back"' + topAttrs + '>##</div>';
    }
    return html;
  }

  function pileHtml(round) {
    if (!round.discardTop) return '<div class="card empty-card">empty</div>';
    const under = round.discardCount > 1 ? '<div class="card back-blue" data-face-kind="stack-back">##</div>' : '';
    return under + cardHtml(round.discardTop, false, {
      'data-anim-role': 'pile-top',
      'data-location-key': 'pile-top'
    });
  }

  function systemButton(action, label, attributes = {}) {
    return '<button type="button" data-system-action="' + action + '" ' + attrsToText(attributes) + '>' + escapeHtml(label) + '</button>';
  }

  function renderDeckPile(state) {
    const round = state.round;
    const deckCountToken = '__DECK_COUNT__';
    const deckCountLabel = escapeHtml(t(state, 'Deck ({count})', { count: deckCountToken }))
      .replace(deckCountToken, '<span data-deck-count>' + escapeHtml(round.deckCount) + '</span>');
    const drawn = round.drawn
      ? cardHtml(round.drawn.card, false, { 'data-anim-role': 'drawn', 'data-location-key': 'drawn' })
      : '<div class="card empty-card drawn-placeholder">empty</div>';
    const hasDrawn = !!round.drawn;
    const canDiscard = !!(round.drawn && round.drawn.source === 'deck');
    const drawnUserId = round.drawn ? round.drawn.playerId : state.user;
    return '<section class="deck-pile-area" data-game-region="deck">' +
      '<div class="stack-area"><div class="deck-pile-label">' + deckCountLabel + '</div>' +
        '<div class="stack" data-stack="deck">' + stackBacks(round.deckCount, round.deckBack) + '</div>' +
        actionButton('draw-deck', round.currentPlayerId, t(state, 'Take'), { disabled: hasDrawn ? 'disabled' : '' }) + '</div>' +
      '<div class="drawn-area"><div class="deck-pile-label">' + escapeHtml(t(state, 'Drawn')) + '</div><div class="drawn-card-slot">' + drawn + '</div>' +
        actionButton('discard', drawnUserId, t(state, 'Discard'), { disabled: canDiscard ? '' : 'disabled' }) + '</div>' +
      '<div class="stack-area"><div class="deck-pile-label">' + escapeHtml(t(state, 'Pile ({count})', { count: round.discardCount })) + '</div>' +
        '<div class="stack" data-stack="pile">' + pileHtml(round) + '</div>' +
        actionButton('draw-discard', round.currentPlayerId, t(state, 'Take'), { disabled: hasDrawn || !round.discardTop ? 'disabled' : '' }) + '</div>' +
    '</section>';
  }

  function renderUtilityActions() {
    return '<div class="row player-actions" data-interaction-controls="setup">' +
      systemButton('reshuffle', 'Reshuffle') +
    '</div>';
  }

  function playerName(state, playerId) {
    const player = state.round.players.find((candidate) => candidate.id === playerId);
    return player ? player.name : 'Player';
  }

  function renderStatus(state) {
    const round = state.round;
    const currentName = playerName(state, round.currentPlayerId);
    let message = t(state, "{name}'s move.", { name: currentName });
    const temporaryEvent = round.wrongThrowIn
      ? t(state, '{name} made a wrong throw-in and gets a penalty card.', { name: playerName(state, round.wrongThrowIn.playerId) })
      : (round.infoEvent && round.infoEvent.text ? i18n.translateGameText(language(state), round.infoEvent.text) + '.' : '');
    if (round.stage === 'roundEnd') {
      message = t(state, 'Round ended. Cards are revealed and points were counted.');
    } else if (round.stage === 'gameEnd') {
      message = 'Game ended. ' + playerName(state, round.winnerId) + ' won the Single round game.';
    } else if (temporaryEvent) {
      message = temporaryEvent;
    } else if (round.stage === 'peek') {
      message = t(state, 'Start peek: each player must look at exactly two own cards.');
    } else if (round.stage === 'opening') {
      message = t(state, 'Opening card…');
    } else if (round.stage === 'special' && round.special) {
      message = t(state, '{name} may use {special} or click Next player.', {
        name: playerName(state, round.special.actorId),
        special: i18n.specialLabel(language(state), round.special.type)
      });
    } else if (round.turnComplete && round.currentPlayerId === state.user) {
      message = t(state, 'Your turn is complete. Say Dutch or click Next player.');
    } else if (round.turnComplete) {
      message = t(state, "{name}'s turn is complete. Waiting for Next player.", { name: currentName });
    }
    if (round.dutchCallerId && !temporaryEvent && !['roundEnd', 'gameEnd'].includes(round.stage)) message = '';
    const dutch = round.dutchCallerId && !temporaryEvent && !['roundEnd', 'gameEnd'].includes(round.stage)
      ? '<div>' + escapeHtml(t(state, '{caller} called Dutch. {current} is taking the final turn of the round.', {
        caller: playerName(state, round.dutchCallerId),
        current: currentName
      })) + '</div>'
      : '';
    const statusClass = round.stage === 'gameEnd' ? 'status game-ended-status' : 'status';
    return '<div class="side-status-card" data-game-region="status"><div class="' + statusClass + '"><div class="status-main"><div class="status-info">' +
      (message ? '<div>' + escapeHtml(message) + '</div>' : '') + dutch + '</div><div class="status-actions">' +
      systemButton('round-reveal', 'Round reveal', { disabled: ['roundEnd', 'gameEnd'].includes(round.stage) ? 'disabled' : '' }) +
      systemButton('reset', 'Reset') +
      '</div></div></div></div>';
  }

  function renderSettings(state) {
    const preferences = state.preferences || {};
    const settings = clientSettings.create({
      translate: (key, values) => t(state, key, values),
      escapeHtml,
      botSpeedOptions: shared.BOT_SPEED_OPTIONS
    });
    return '<div class="panel side-panel"><div class="side-drawers">' +
      settings.renderGameSettingsDrawer(state, {
        open: preferences.settingsOpen,
        expanded: preferences.settingsExpanded,
        selectedTheme: preferences.theme,
        selectedLanguage: language(state),
        soundsEnabled: preferences.sounds
      }) + '</div></div>';
  }

  function renderPage(state) {
    const user = state.round.players.find((player) => player.id === state.user);
    const otherPlayers = state.round.players.filter((player) => player.id !== state.user);
    return '<div class="main-layout"><main class="game-area">' +
      '<section class="other-players" data-game-region="players">' + otherPlayers.map((player) => renderPlayer(player, state, false)).join('') + '</section>' +
      renderDeckPile(state) + renderUtilityActions() + (user ? renderPlayer(user, state, true) : '') +
      '</main><aside class="side-area">' + renderStatus(state) + renderSettings(state) + '</aside></div>';
  }

  return { escapeHtml, attrsToText, cardHtml, renderPage };
});
