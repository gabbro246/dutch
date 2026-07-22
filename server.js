const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const packageInfo = require('./package.json');
const { createHttpApp } = require('./lib/http-app.js');
const { createGameServices } = require('./lib/game-services.js');

const PORT = process.env.PORT || 3000;
const DISCONNECT_GRACE_MS = 15 * 60 * 1000;
const WAITING_ROOM_TIMEOUT_MS = 15 * 60 * 1000;
const GAME_INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
const BOT_FINISHED_GAME_RESET_MS = 60 * 1000;
const JACK_SWAP_SELECTION_MS = 500;
const OPENING_DISCARD_DELAY_MS = 1000;
const OPENING_DISCARD_TRAVEL_MS = 500;
const OPENING_DISCARD_FLIP_HALF_MS = 130;
const PILE_REVEAL_MOVE_MS = 360;
const GAME_LOG_DIR = path.join(__dirname, 'game-logs');
const ADMIN_LOG_PATH = path.join(GAME_LOG_DIR, 'usage.log');
const APP_VERSION = packageInfo.version;
const SPECTATOR_TRIGGER_NAME = 'spectator';
const PUBLIC_DIR = path.join(__dirname, 'public');
const INDEX_PATH = path.join(PUBLIC_DIR, 'index.html');

const app = createHttpApp({ indexPath: INDEX_PATH, publicDir: PUBLIC_DIR, appVersion: APP_VERSION, gameLogDir: GAME_LOG_DIR });
const server = http.createServer(app);
const io = new Server(server);
const services = createGameServices({
  io,
  config: {
    port: PORT,
    appVersion: APP_VERSION,
    adminLogPath: ADMIN_LOG_PATH,
    gameLogDir: GAME_LOG_DIR,
    spectatorTriggerName: SPECTATOR_TRIGGER_NAME,
    disconnectGraceMs: DISCONNECT_GRACE_MS,
    waitingRoomTimeoutMs: WAITING_ROOM_TIMEOUT_MS,
    gameInactivityTimeoutMs: GAME_INACTIVITY_TIMEOUT_MS,
    botFinishedGameResetMs: BOT_FINISHED_GAME_RESET_MS,
    jackSwapSelectionMs: JACK_SWAP_SELECTION_MS,
    openingDiscardDelayMs: OPENING_DISCARD_DELAY_MS,
    openingDiscardTravelMs: OPENING_DISCARD_TRAVEL_MS,
    openingDiscardFlipHalfMs: OPENING_DISCARD_FLIP_HALF_MS,
    pileRevealMoveMs: PILE_REVEAL_MOVE_MS
  }
});

function startServer(port = PORT, onListening = null) {
  return server.listen(port, onListening || (() => {
    const address = server.address();
    const actualPort = address && typeof address === 'object' ? address.port : port;
    services.logServerStarted(actualPort);
  }));
}

function closeServer() {
  services.close();
  io.disconnectSockets(true);
  io.close();
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

if (require.main === module) startServer();

module.exports = {
  app,
  server,
  io,
  startServer,
  closeServer,
  getState: services.getState
};
