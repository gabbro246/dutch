const fs = require('fs');
const os = require('os');

function createServerRuntime(deps) {
  const fsModule = deps.fs || fs;
  const osModule = deps.os || os;
  const consoleObj = deps.console || console;
  const now = deps.now || (() => new Date());

  function timestamp() {
    const value = now();
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  function adminLog(event, data = {}) {
    const entry = {
      datetime: timestamp(),
      event,
      ...data
    };
    fsModule.appendFile(deps.adminLogPath, JSON.stringify(entry) + '\n', (error) => {
      if (error) consoleObj.error('Could not write admin usage log:', error.message);
    });
  }

  function terminalGameLog(message) {
    consoleObj.log('[Dutch] ' + timestamp() + ' ' + message);
  }

  function terminalSettingsText() {
    const state = deps.getState();
    const deck = state.deckSetting === 'two' ? 'two decks' : 'one deck';
    return deck + ', target ' + state.gameTarget + ' points';
  }

  function terminalPlayerNames() {
    return deps.activePlayablePlayers().map((player) => {
      return player.name + (player.isBot ? ' (bot)' : '');
    }).join(', ');
  }

  function terminalScoresText(scores) {
    return (scores || deps.scoreSnapshot()).map((score) => {
      const roundText = typeof score.roundPoints === 'number' ? ', round ' + score.roundPoints : '';
      return score.name + ': ' + score.total + ' pts' + roundText;
    }).join('; ');
  }

  function terminalGameStarted() {
    terminalGameLog('Game started. Players: ' + terminalPlayerNames() + '. Settings: ' + terminalSettingsText() + '.');
  }

  function terminalGameEnded(reason, winnerName) {
    const state = deps.getState();
    const winnerText = winnerName ? ' Winner: ' + winnerName + '.' : '';
    terminalGameLog('Game ended.' + winnerText + ' Reason: ' + reason + '. Rounds: ' + state.roundNumber + '. Final scores: ' + terminalScoresText() + '.');
  }

  function hostAddresses(port = deps.port) {
    return Object.values(osModule.networkInterfaces())
      .flat()
      .filter((address) => address && address.family === 'IPv4' && !address.internal)
      .map((address) => 'http://' + address.address + ':' + port);
  }

  function logServerStarted(port) {
    consoleObj.log('Dutch! 🂡 server running on http://localhost:' + port);
    for (const hostAddress of hostAddresses(port)) consoleObj.log('Dutch! 🂡 network address: ' + hostAddress);
  }

  return {
    adminLog,
    terminalGameLog,
    terminalSettingsText,
    terminalPlayerNames,
    terminalScoresText,
    terminalGameStarted,
    terminalGameEnded,
    hostAddresses,
    logServerStarted
  };
}

module.exports = { createServerRuntime };
