const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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
  const waitingPlayersDrawer = page.locator('details[data-waiting-drawer="players"]');
  assert.equal(await waitingPlayersDrawer.evaluate((element) => element.open), false, 'Players drawer should be closed while empty.');
  await page.locator('#nameInput').fill('Browser Ada');
  await page.locator('#joinBtn').click();
  await page.locator('[data-waiting-player-id]').waitFor();

  assert.equal(await waitingPlayersDrawer.evaluate((element) => element.open), true, 'Players drawer should open when its first player appears.');
  const firstWaitingDrawers = await page.locator('details[data-waiting-drawer]').evaluateAll((drawers) => drawers.slice(0, 2).map((drawer) => drawer.dataset.waitingDrawer));
  assert.deepEqual(firstWaitingDrawers, ['bots', 'players']);
  await waitingPlayersDrawer.locator(':scope > summary').click();
  await assertEventually(async () => !await waitingPlayersDrawer.evaluate((element) => element.open), 'Players drawer did not close.');
  await waitingPlayersDrawer.locator(':scope > summary').click();
  await assertEventually(async () => waitingPlayersDrawer.evaluate((element) => element.open), 'Players drawer did not reopen.');

  const waitingGuideDrawer = page.locator('details[data-waiting-drawer="guide"]');
  await waitingGuideDrawer.locator(':scope > summary').click();
  await assertEventually(async () => waitingGuideDrawer.evaluate((element) => element.open), 'Waiting-room guide drawer did not open.');
  assert.match(await waitingGuideDrawer.textContent(), /Goal:/);

  const waitingRulesDrawer = page.locator('details[data-waiting-drawer="rules"]');
  await waitingRulesDrawer.locator(':scope > summary').click();
  await assertEventually(async () => waitingRulesDrawer.evaluate((element) => element.open), 'Waiting-room rules drawer did not open.');
  assert.match(await waitingRulesDrawer.textContent(), /Dutch is a card game/);

  const botsDrawer = page.locator('details[data-waiting-drawer="bots"]');
  await botsDrawer.locator(':scope > summary').click();
  await assertEventually(async () => botsDrawer.evaluate((element) => element.open), 'Bots drawer did not open.');
  const botTypeSelect = page.locator('#botTypeSelect');
  const botTypes = ['dory', 'norman', 'athena', 'roswell'];
  assert.deepEqual(await botTypeSelect.locator('option').evaluateAll((options) => options.map((option) => option.value)), botTypes);
  const initiallySelectedBot = await botTypeSelect.inputValue();
  assert.ok(botTypes.includes(initiallySelectedBot), 'An available bot should be selected by default.');
  assert.equal(await page.locator('#addBotBtn').isDisabled(), false, 'The default bot should be ready to add.');
  await page.locator('#addBotBtn').click();
  await assertEventually(() => runtime.getState().players.length === 2, 'Add-bot event did not reach the server.');
  await assertEventually(
    async () => {
      const nextSelectedBot = await botTypeSelect.inputValue();
      return botTypes.includes(nextSelectedBot) && nextSelectedBot !== initiallySelectedBot;
    },
    'A remaining bot was not selected after adding the default bot.'
  );
  assert.deepEqual(
    await botTypeSelect.locator('option').evaluateAll((options) => options.map((option) => option.value)),
    botTypes,
    'Bot options should remain in their fixed order.'
  );
  assert.equal(await page.locator('#startBtn').isDisabled(), false, 'A default bot selection should not prevent starting the game.');
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
  const statusActionLayout = await page.locator('.side-status-card .status').evaluate((status) => {
    const actions = status.querySelector('.status-actions');
    const info = status.querySelector('.status-info');
    const buttons = Array.from(actions.querySelectorAll('button'));
    const statusRect = status.getBoundingClientRect();
    const infoRect = info.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    const firstButtonRect = buttons[0].getBoundingClientRect();
    const lastButtonRect = buttons.at(-1).getBoundingClientRect();
    return {
      buttonCount: buttons.length,
      bottomInset: statusRect.bottom - actionsRect.bottom,
      rightInset: statusRect.right - actionsRect.right,
      textGap: actionsRect.top - infoRect.bottom,
      actionLeftGap: firstButtonRect.left - actionsRect.left,
      actionRightGap: actionsRect.right - lastButtonRect.right
    };
  });
  assert.equal(statusActionLayout.buttonCount, 3);
  assert.ok(
    statusActionLayout.bottomInset >= 8 && statusActionLayout.bottomInset <= 10,
    'Status actions should stay at the bottom of the info panel.'
  );
  assert.ok(statusActionLayout.textGap >= 10, 'Status actions should be below the info text.');
  assert.ok(
    statusActionLayout.rightInset >= 8 && statusActionLayout.rightInset <= 10,
    'Status actions should be aligned to the panel right edge: ' + JSON.stringify(statusActionLayout)
  );
  assert.ok(
    Math.abs(statusActionLayout.actionLeftGap) < 1 && Math.abs(statusActionLayout.actionRightGap) < 1,
    'Status action row should shrink to its buttons instead of stretching across the panel.'
  );

  const occupiedPage = await browser.newPage({ reducedMotion: 'reduce' });
  occupiedPage.on('pageerror', (error) => pageErrors.push(error.stack || error.message));
  await occupiedPage.goto('http://127.0.0.1:' + port, { waitUntil: 'networkidle' });
  const occupiedGuideDrawer = occupiedPage.locator('details[data-occupied-drawer="guide"]');
  await occupiedGuideDrawer.locator(':scope > summary').click();
  await assertEventually(async () => occupiedGuideDrawer.evaluate((element) => element.open), 'Occupied-room guide drawer did not open.');
  assert.match(await occupiedGuideDrawer.textContent(), /Goal:/);
  const occupiedRulesDrawer = occupiedPage.locator('details[data-occupied-drawer="rules"]');
  assert.equal(await occupiedRulesDrawer.count(), 1);
  const occupiedSettingsDrawer = occupiedPage.locator('details[data-occupied-drawer="settings"]');
  await occupiedSettingsDrawer.locator(':scope > summary').click();
  await assertEventually(async () => occupiedSettingsDrawer.evaluate((element) => element.open), 'Occupied-room settings drawer did not open.');
  assert.equal(await occupiedPage.locator('#occupiedThemeSelect').count(), 1);
  assert.equal(await occupiedPage.locator('#occupiedLanguageSelect').count(), 1);
  assert.equal(await occupiedPage.locator('#inGameTargetSelect').count(), 0);

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
  await page.locator('.moving-card').first().waitFor({ state: 'attached', timeout: 2000 });
  assert.equal(await page.locator('.moving-card').count() > 0, true, 'Deck draw should create a moving card overlay.');

  await assertEventually(
    async () => await page.locator('.moving-card').count() === 0,
    'Card move overlays did not finish.',
    3000
  );
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

test('bot selector keeps a random available bot selected until none remain', { timeout: 10_000 }, async (t) => {
  const runtime = createDutchServer();
  await new Promise((resolve) => runtime.startServer(0, resolve));
  const address = runtime.server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));

  t.after(async () => {
    await browser.close();
    await runtime.closeServer();
  });

  await page.goto('http://127.0.0.1:' + port, { waitUntil: 'networkidle' });
  const botsDrawer = page.locator('details[data-waiting-drawer="bots"]');
  await botsDrawer.locator(':scope > summary').click();
  const botTypeSelect = page.locator('#botTypeSelect');
  const addBotButton = page.locator('#addBotBtn');
  const botTypes = ['dory', 'norman', 'athena', 'roswell'];
  const selectedBots = [];

  for (let botCount = 1; botCount <= botTypes.length; botCount += 1) {
    let selectedBot = '';
    await assertEventually(
      async () => {
        selectedBot = await botTypeSelect.inputValue();
        return botTypes.includes(selectedBot) && !selectedBots.includes(selectedBot);
      },
      'The selector did not choose a remaining bot.'
    );
    assert.deepEqual(
      await botTypeSelect.locator('option').evaluateAll((options) => options.map((option) => option.value)),
      botTypes,
      'Bot options changed order while bots were added.'
    );
    selectedBots.push(selectedBot);
    await addBotButton.click();
    await assertEventually(() => runtime.getState().players.filter((player) => player.isBot).length === botCount, 'Bot was not added.');
  }

  await assertEventually(
    async () => await botTypeSelect.isDisabled() && await botTypeSelect.inputValue() === '',
    'The exhausted bot selector did not become disabled.'
  );
  assert.equal(await botTypeSelect.locator('option').first().textContent(), 'No bots left');
  assert.deepEqual(
    await botTypeSelect.locator('option').evaluateAll((options) => options.map((option) => option.value)),
    ['', ...botTypes]
  );
  assert.equal(await addBotButton.isDisabled(), true);
  assert.deepEqual(pageErrors, []);
});

test('explicit shuffle renders five pile-to-deck ghosts and resumes the draw', { timeout: 20_000 }, async (t) => {
  const runtime = createDutchServer({
    randomBetween: () => 20,
    config: {
      openingDiscardDelayMs: 20,
      openingDiscardTravelMs: 40,
      openingDiscardFlipHalfMs: 20
    }
  });
  await new Promise((resolve) => runtime.startServer(0, resolve));
  const address = runtime.server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  const browser = await chromium.launch({ headless: true });
  const ada = await browser.newPage({ reducedMotion: 'no-preference' });
  const ben = await browser.newPage({ reducedMotion: 'no-preference' });

  t.after(async () => {
    await browser.close();
    await runtime.closeServer();
  });

  await ada.goto('http://127.0.0.1:' + port, { waitUntil: 'networkidle' });
  await ben.goto('http://127.0.0.1:' + port, { waitUntil: 'networkidle' });
  await ada.locator('#nameInput').fill('Ada');
  await ada.locator('#joinBtn').click();
  await ben.locator('#nameInput').fill('Ben');
  await ben.locator('#joinBtn').click();
  await ada.locator('#startBtn').click();
  await ada.locator('[data-action="peekStart"]:not([disabled])').first().click();
  await ada.locator('[data-action="peekStart"]:not([disabled])').first().click();
  await ben.locator('[data-action="peekStart"]:not([disabled])').first().click();
  await ben.locator('[data-action="peekStart"]:not([disabled])').first().click();

  const currentPage = await Promise.race([
    ada.locator('[data-action="takeDeck"]:not([disabled])').waitFor({ timeout: 5000 }).then(() => ada),
    ben.locator('[data-action="takeDeck"]:not([disabled])').waitFor({ timeout: 5000 }).then(() => ben)
  ]);
  const round = runtime.getState().round;
  const top = round.discard.pop();
  const buriedCount = round.deck.length;
  round.discard = round.deck.splice(0).concat(top);
  round.needsReshuffle = false;

  await currentPage.locator('[data-action="takeDeck"]:not([disabled])').click();
  const shuffleButton = currentPage.locator('[data-action="shuffle"]:not([disabled])');
  await shuffleButton.waitFor();
  await shuffleButton.click();

  await currentPage.locator('.reshuffle-ghost').first().waitFor({ state: 'attached' });
  assert.equal(await currentPage.locator('.reshuffle-ghost').count(), 5);
  assert.equal(await currentPage.locator(`[data-stack="pile"] [data-card-id="${top.id}"]`).count(), 1);
  await currentPage.locator('.reshuffle-ghost').first().waitFor({ state: 'detached', timeout: 2000 });
  assert.equal(runtime.getState().round.discard.at(-1).id, top.id);
  assert.equal(runtime.getState().round.deck.length, buriedCount - 1);
  assert.ok(runtime.getState().round.drawn);
});

test('wrong-throw penalty waits until the rejected card finishes shaking', { timeout: 20_000 }, async (t) => {
  const runtime = createDutchServer({
    randomBetween: () => 20,
    config: {
      openingDiscardDelayMs: 20,
      openingDiscardTravelMs: 40,
      openingDiscardFlipHalfMs: 20,
      wrongThrowPenaltyDelayMs: 100
    }
  });
  await new Promise((resolve) => runtime.startServer(0, resolve));
  const address = runtime.server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  const browser = await chromium.launch({ headless: true });
  const ada = await browser.newPage({ reducedMotion: 'no-preference' });
  const ben = await browser.newPage({ reducedMotion: 'no-preference' });
  const pageErrors = [];
  ada.on('pageerror', (error) => pageErrors.push(error.stack || error.message));
  ben.on('pageerror', (error) => pageErrors.push(error.stack || error.message));

  t.after(async () => {
    await browser.close();
    await runtime.closeServer();
  });

  await ada.goto('http://127.0.0.1:' + port, { waitUntil: 'networkidle' });
  await ben.goto('http://127.0.0.1:' + port, { waitUntil: 'networkidle' });
  await ada.locator('#nameInput').fill('Ada');
  await ada.locator('#joinBtn').click();
  await ben.locator('#nameInput').fill('Ben');
  await ben.locator('#joinBtn').click();
  await ada.locator('#startBtn').click();
  await ada.locator('[data-action="peekStart"]:not([disabled])').first().click();
  await ada.locator('[data-action="peekStart"]:not([disabled])').first().click();
  await ben.locator('[data-action="peekStart"]:not([disabled])').first().click();
  await ben.locator('[data-action="peekStart"]:not([disabled])').first().click();
  await ada.locator('[data-action="throwIn"]:not([disabled])').first().waitFor({ timeout: 5000 });

  const state = runtime.getState();
  const adaPlayer = state.players.find((player) => player.name.toLowerCase() === 'ada');
  const wrongCard = adaPlayer.cards[0];
  wrongCard.rank = state.round.throwIn.rank === 'K' ? '2' : 'K';

  await ada.evaluate(() => {
    const timeline = {
      shakeStartedAt: 0,
      shakeFinishedAt: 0,
      penaltyStartedAt: 0
    };
    const record = () => {
      const now = performance.now();
      const shaking = !!document.querySelector('.wrong-throw-shaking');
      if (shaking && !timeline.shakeStartedAt) timeline.shakeStartedAt = now;
      if (timeline.shakeStartedAt && !shaking && !timeline.shakeFinishedAt) timeline.shakeFinishedAt = now;
      if (document.querySelector('.wrong-throw-penalty-card') && !timeline.penaltyStartedAt) {
        timeline.penaltyStartedAt = now;
      }
    };
    const observer = new MutationObserver(record);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
      childList: true,
      subtree: true
    });
    window.__wrongThrowTimeline = timeline;
  });

  await ada.locator(`[data-action="throwIn"][data-card-id="${wrongCard.id}"]`).click();
  await assertEventually(
    () => ada.evaluate(() => window.__wrongThrowTimeline.penaltyStartedAt > 0),
    'Wrong-throw penalty animation did not start.',
    3000
  );

  const timeline = await ada.evaluate(() => window.__wrongThrowTimeline);
  assert.ok(timeline.shakeStartedAt > 0, 'Rejected card never entered its shake phase.');
  assert.ok(timeline.shakeFinishedAt >= timeline.shakeStartedAt, 'Rejected card never finished shaking.');
  assert.ok(
    timeline.penaltyStartedAt >= timeline.shakeFinishedAt,
    'Penalty card started moving before the rejected card finished shaking.'
  );
  assert.deepEqual(pageErrors, []);
});

test('saved-log graph keeps labels, lines, and markers fixed-size while spacing responds', { timeout: 20_000 }, async (t) => {
  const logDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dutch-responsive-log-'));
  const filename = 'dutch-game-log-2026-08-13_12-00-00.txt';
  await fs.promises.writeFile(path.join(logDirectory, filename), [
    'Dutch game log 2026-08-13_12-00-00',
    'Target: 100',
    'Rounds: 3',
    '',
    'Points table:',
    'Round | Ada | Ben',
    '--- | --- | ---',
    'Round 1 | 10 | 20',
    'Round 2 | 25 | 30',
    'Round 3 | 40 | 35',
    '',
    'Game log:',
    '+00:00.000 1. [system] game started'
  ].join('\n'));

  const runtime = createDutchServer({
    config: {
      gameLogDir: logDirectory,
      adminLogPath: path.join(logDirectory, 'usage.log')
    }
  });
  await new Promise((resolve) => runtime.startServer(0, resolve));
  const address = runtime.server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 320, height: 700 },
    reducedMotion: 'reduce'
  });

  t.after(async () => {
    await browser.close();
    await runtime.closeServer();
    await fs.promises.rm(logDirectory, { recursive: true, force: true });
  });

  await page.goto('http://127.0.0.1:' + port + '/logs/' + filename, { waitUntil: 'networkidle' });
  const chart = page.locator('.points-chart-svg-responsive');
  await chart.waitFor();

  async function chartMetrics() {
    return chart.evaluate((svg) => {
      const label = svg.querySelector('.points-chart-grid text');
      const line = svg.querySelector('.points-chart-line');
      const firstSeries = svg.querySelector('.points-chart-series');
      const markers = Array.from(firstSeries.querySelectorAll('.points-chart-marker'));
      const firstMarker = markers[0].getBoundingClientRect();
      const lastMarker = markers.at(-1).getBoundingClientRect();
      const panelRect = svg.closest('.logs-panel').getBoundingClientRect();
      const contentRects = Array.from(svg.querySelectorAll('text, line, circle'), (element) => element.getBoundingClientRect());
      const contentLeft = Math.min(...contentRects.map((rect) => rect.left));
      const contentRight = Math.max(...contentRects.map((rect) => rect.right));
      return {
        height: svg.getBoundingClientRect().height,
        fontSize: Number.parseFloat(getComputedStyle(label).fontSize),
        lineWidth: Number.parseFloat(getComputedStyle(line).strokeWidth),
        markerWidth: firstMarker.width,
        horizontalSpan: (lastMarker.left + lastMarker.width / 2) - (firstMarker.left + firstMarker.width / 2),
        leftOverflow: panelRect.left - contentLeft,
        rightOverflow: contentRight - panelRect.right
      };
    });
  }

  const mobile = await chartMetrics();
  await page.setViewportSize({ width: 760, height: 700 });
  const desktop = await chartMetrics();

  assert.equal(mobile.height, 240);
  assert.equal(desktop.height, mobile.height);
  assert.equal(mobile.fontSize, 9);
  assert.ok(
    mobile.leftOverflow <= -8 && mobile.rightOverflow <= -8,
    'Mobile graph content should stay inside the log panel: ' + JSON.stringify(mobile)
  );
  assert.ok(
    desktop.leftOverflow <= -8 && desktop.rightOverflow <= -8,
    'Desktop graph content should stay inside the log panel: ' + JSON.stringify(desktop)
  );
  assert.equal(mobile.lineWidth, 2);
  assert.equal(mobile.markerWidth, 4);
  assert.equal(desktop.fontSize, mobile.fontSize);
  assert.equal(desktop.lineWidth, mobile.lineWidth);
  assert.equal(desktop.markerWidth, mobile.markerWidth);
  assert.ok(
    desktop.horizontalSpan > mobile.horizontalSpan,
    'Only graph spacing should expand with the viewport: ' + JSON.stringify({ mobile, desktop })
  );
});

async function assertEventually(predicate, message, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(message);
}
