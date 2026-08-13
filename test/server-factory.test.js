const test = require('node:test');
const assert = require('node:assert/strict');

test('importing the server factory creates no cleanup interval', () => {
  const originalSetInterval = global.setInterval;
  let intervalCalls = 0;
  global.setInterval = (...args) => {
    intervalCalls += 1;
    return originalSetInterval(...args);
  };

  let serverModule;
  try {
    delete require.cache[require.resolve('../server.js')];
    serverModule = require('../server.js');
  } finally {
    global.setInterval = originalSetInterval;
  }

  assert.equal(intervalCalls, 0);
  assert.equal(typeof serverModule.createDutchServer, 'function');
  assert.equal(typeof serverModule.startServer, 'function');
});

test('legacy server wrappers create and close the default runtime lazily', async () => {
  const serverModule = require('../server.js');
  await new Promise((resolve) => serverModule.startServer(0, resolve));

  assert.equal(serverModule.server.listening, true);
  await serverModule.closeServer();
  assert.equal(serverModule.server.listening, false);
});
