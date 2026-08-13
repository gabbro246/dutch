const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createDutchServer } = require('../server.js');

test('browser smoke covers drawers, reconnect, persistent regions, and card animation', { timeout: 20_000 }, async (t) => {
  const runtime = createDutchServer({
    randomBetween: () => 20,
    config: {
      openingDiscardDelayMs: 20,
      openingDiscardTravelMs: 80,
      openingDiscardFlipHalfMs: 50
    }
  });
  await new Promise((resolve) => runtime.startServer(0, resolve));
  const address = runtime.server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ reducedMotion: 'no-preference' });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));

  t.after(async () => {
    await browser.close();
    await runtime.closeServer();
  });

  await page.goto('http://127.0.0.1:' + port, { waitUntil: 'networkidle' });
  await page.locator('#nameInput').fill('Browser Ada');
  await page.locator('#joinBtn').click();
  await page.locator('[data-waiting-player-id]').waitFor();

  const botsDrawer = page.locator('details[data-waiting-drawer="bots"]');
  await botsDrawer.locator(':scope > summary').click();
  await assertEventually(async () => botsDrawer.evaluate((element) => element.open), 'Bots drawer did not open.');
  await page.locator('#botTypeSelect').selectOption('dory');
  await page.locator('#addBotBtn').click();
  await assertEventually(() => runtime.getState().players.length === 2, 'Add-bot event did not reach the server.');
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(pageErrors, [], 'Browser error while rendering added bot.');
  const clientPlayerIds = await page.evaluate(() => eval('lastState.players.map((player) => player.id)'));
  assert.equal(clientPlayerIds.length, 2, 'Added bot state did not reach the browser.');
  const renderedPlayerIds = await page.locator('[data-waiting-player-id]').evaluateAll((rows) => rows.map((row) => row.dataset.waitingPlayerId));
  assert.deepEqual(renderedPlayerIds, clientPlayerIds, 'Added bot was not rendered.');

  await page.locator('#startBtn').click();
  await page.locator('[data-game-region="own"]').waitFor();
  for (let count = 0; count < 2; count += 1) {
    await page.locator('[data-action="peekStart"]:not([disabled])').first().click();
  }
  await page.locator('[data-action="takeDeck"]:not([disabled])').waitFor({ timeout: 5000 });

  const repositoryRegion = page.locator('[data-game-region="repository"]');
  await repositoryRegion.evaluate((element) => { window.__dutchRepositoryRegion = element; });

  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('[data-game-region="own"]').waitFor({ timeout: 5000 });
  assert.equal(await page.locator('.active-rejoin-row').count(), 0, 'Stored identity should reconnect automatically.');

  const guideDrawer = page.locator('details[data-detail-key="guide"]');
  await guideDrawer.locator(':scope > summary').click();
  await assertEventually(async () => guideDrawer.evaluate((element) => element.open), 'Guide drawer did not open.');
  assert.match(await guideDrawer.textContent(), /Goal:/);

  const takeDeck = page.locator('[data-action="takeDeck"]:not([disabled])');
  await takeDeck.click();
  await page.locator('.moving-card').waitFor({ state: 'attached', timeout: 2000 });
  assert.equal(await page.locator('.moving-card').count() > 0, true, 'Deck draw should create a moving card overlay.');

  await page.locator('.moving-card').waitFor({ state: 'detached', timeout: 3000 });
  const sameRepositoryNode = await repositoryRegion.evaluate((element) => element === window.__dutchRepositoryRegion);
  assert.equal(sameRepositoryNode, false, 'Reload should create a new document before region persistence is tested.');
  await repositoryRegion.evaluate((element) => { window.__dutchRepositoryRegion = element; });
  await page.locator('[data-action="discardDrawn"]:not([disabled])').click();
  await assertEventually(
    () => repositoryRegion.evaluate((element) => element === window.__dutchRepositoryRegion),
    'Unchanged repository region was replaced during a game update.'
  );

  assert.deepEqual(pageErrors, []);
});

async function assertEventually(predicate, message, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(message);
}
