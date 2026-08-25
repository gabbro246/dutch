const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  gameLogStartDate,
  finishedGameLogFilename,
  finishedGameLogText
} = require('../lib/game-log.js');
const {
  formatLogFileSize,
  logListPage,
  logSummaryFromContent,
  pageShell,
  readBrowserLogContent,
  readLogSummaryContent,
  renderLogList,
  renderLogViewer,
  renderSavedLogContent
} = require("../lib/http-app.js");

test('game log filename uses the game start time when present', () => {
  const savedAt = new Date(2026, 0, 2, 3, 4, 5);
  const startedAt = new Date(2026, 0, 1, 1, 2, 3);

  assert.equal(finishedGameLogFilename(startedAt, savedAt), 'dutch-game-log-2026-01-01_01-02-03.txt');
  assert.equal(finishedGameLogFilename('', savedAt), 'dutch-game-log-2026-01-02_03-04-05.txt');
  assert.equal(gameLogStartDate('not a date', savedAt), savedAt);
});

test('finished game log includes winner, score table, and relative log lines', () => {
  const baseMs = Date.parse('2026-01-01T00:00:00.000Z');
  const text = finishedGameLogText({
    savedAt: new Date(2026, 0, 2, 3, 4, 5),
    gameStartedAt: new Date(2026, 0, 1, 1, 2, 3),
    gameVersion: '1.3.66',
    gameSeed: 424242,
    winnerName: 'Ada',
    gameTarget: 100,
    roundNumber: 2,
    scoreHistory: [
      { round: 1, players: [{ name: 'Ada', total: 4 }, { name: 'Ben', total: 7 }] },
      { round: 2, players: [{ name: 'Ada', total: 9 }, { name: 'Ben', total: 8 }] }
    ],
    log: [
      { text: 'Ada swapped cards', kind: 'game', at: new Date(baseMs + 1500).toISOString() },
      { text: 'game started', kind: 'system', at: new Date(baseMs).toISOString() }
    ]
  });

  assert.match(text, /^Dutch game log 2026-01-01_01-02-03\n/);
  assert.match(text, /Exported: 2026-01-02_03-04-05\n/);
  assert.match(text, /Game version: 1\.3\.66\nGame seed: 424242\nWinner: Ada\nTarget: 100\nRounds: 2\n/);
  assert.match(text, /Round \| Ada \| Ben\n--- \| --- \| ---\nRound 1 \| 4 \| 7\nRound 2 \| 9 \| 8/);
  assert.match(text, /Game log:\n\+00:00\.000 1\. \[system\] game started\n\+00:01\.500 2\. Ada swapped cards\n$/);
});

test('finished-game logs ignore bot diagnostics and replay archives', () => {
  const diagnostic = {
    round: 2,
    botName: 'Roswell',
    decision: 'dutch',
    selected: 'continue',
    actualHands: [{ playerName: 'Ada', score: 3 }]
  };
  const text = finishedGameLogText({
    savedAt: new Date(2026, 0, 2, 3, 4, 5),
    gameStartedAt: new Date(2026, 0, 1, 1, 2, 3),
    winnerName: 'Ada',
    gameTarget: 100,
    roundNumber: 2,
    scoreHistory: [],
    log: [{ text: 'public move', kind: 'game', at: '2026-01-01T00:00:00.000Z' }],
    botDiagnostics: [diagnostic],
    replayArchive: { decisions: [{ private: 'thought' }] }
  });

  assert.match(text, /Game log:\n\+00:00\.000 1\. public move\n$/);
  assert.doesNotMatch(text, /Bot strategy diagnostics/);
  assert.doesNotMatch(text, /Deterministic replay archive/);
  assert.doesNotMatch(text, /Roswell|thought/);
});

test('finished game log labels a single-round game', () => {
  const text = finishedGameLogText({
    singleRound: true,
    gameTarget: 100,
    roundNumber: 1,
    scoreHistory: [],
    log: []
  });

  assert.match(text, /Target: Single round\nRounds: 1\n/);
});

test('log list summary ranks players by final score without winner text', () => {
  const text = finishedGameLogText({
    savedAt: new Date(2026, 0, 2, 3, 4, 5),
    gameStartedAt: new Date(2026, 0, 1, 1, 2, 3),
    winnerName: 'Ben',
    gameTarget: 100,
    roundNumber: 2,
    scoreHistory: [
      { round: 1, players: [{ name: 'Ada', total: 4 }, { name: 'Ben', total: 7 }, { name: 'Cal', total: 6 }] },
      { round: 2, players: [{ name: 'Ada', total: 9 }, { name: 'Ben', total: 8 }, { name: 'Cal', total: 12 }] }
    ],
    log: []
  });

  assert.deepEqual(logSummaryFromContent(text), {
    summaryText: 'Ranking: Ben, Ada, Cal · Rounds: 2'
  });
});

test("saved log viewer renders public sections and omits private bot data", () => {
  const content = [
    "Dutch game log 2026-01-01_01-02-03",
    "Exported: 2026-01-01_01-03-26",
    "Game version: 1.3.65",
    "Game seed: 424242",
    "Winner: Ada",
    "Target: 100",
    "Rounds: 1",
    "",
    "Points table:",
    "Round | Ada | <Bot>",
    "--- | --- | ---",
    "Round 1 | 4 | 8",
    "",
    "Game log:",
    "+00:00.000 1. [system] game started",
    "+01:23.107 2. [system] game ended. Ada won",
    "",
    "Bot strategy diagnostics:",
    "Earlier diagnostics dropped: 2",
    "1. {\"decision\":\"draw-source\",\"selected\":\"take-pile\"}"
  ].join("\n");

  const html = renderSavedLogContent(content);

  assert.doesNotMatch(html, /<h2>Dutch game log<\/h2>/);
  assert.match(html, /<dt>Game started<\/dt><dd>January 1, 2026 at 01:02:03<\/dd>/);
  assert.match(html, /<dt>Exported<\/dt><dd>January 1, 2026 at 01:03:26<\/dd>/);
  assert.match(html, /<dt>Game version<\/dt><dd>1\.3\.65<\/dd>/);
  assert.match(html, /<dt>Game seed<\/dt><dd>424242<\/dd>/);
  assert.match(html, /<dt>Game duration<\/dt><dd>1 minute 23 seconds<\/dd>/);
  assert.match(html, /<dt>Winner<\/dt><dd>Ada<\/dd>/);
  assert.match(html, /<section class=saved-log-section aria-label="Points table">/);
  assert.match(html, /<section class="saved-log-section saved-log-chart" aria-label="Points graph">/);
  assert.match(html, /<section class=saved-log-section aria-label="Game log">/);
  assert.ok(html.indexOf('aria-label="Points table"') < html.indexOf('aria-label="Points graph"'));
  assert.doesNotMatch(html, /<h2>(?:Points graph|Points table|Game log)<\/h2>/);
  assert.doesNotMatch(html, /points-chart-legend/);
  assert.match(html, /<figure class="points-chart" aria-label="Points over time">/);
  assert.doesNotMatch(html, /viewBox=/);
  assert.match(html, /class="points-chart-svg points-chart-svg-responsive" height="240"/);
  assert.match(html, /<svg class="points-chart-plot" x="8%" width="87%" height="240" overflow="visible">/);
  assert.match(html, /<line class="points-chart-line" x1="0%" y1="215" x2="100%" y2="206\.88"><\/line>/);
  assert.match(html, /<g class="points-chart-target">/);
  assert.match(html, /<text x="50%"[^>]*>Target: 100<\/text>/);
  assert.match(html, /<g class="points-chart-halving"><title>Score halves at 50 points<\/title>/);
  assert.match(html, /aria-label="Round 1: &lt;Bot&gt;, 8 points"/);
  assert.match(html, /<table class=saved-log-table>/);
  const adaColor = (html.match(/<span class="saved-log-player-name" style="--series-color: var\(--chart-color-(\d)\)">Ada<\/span>/) || [])[1];
  assert.ok(adaColor);
  assert.match(html, new RegExp('<g class="points-chart-series" style="--series-color: var\\(--chart-color-' + adaColor + '\\)'));
  assert.match(html, /<span class="saved-log-player-name"[^>]*>&lt;Bot&gt;<\/span>/);
  assert.match(html, /<td class="saved-log-player-points"[^>]*>8<\/td>/);
  assert.match(html, /<time>\+00:00\.000<\/time><span>1\. \[system\] game started<\/span>/);
  assert.doesNotMatch(html, /Bot strategy/);
  assert.doesNotMatch(html, /draw-source/);
  assert.doesNotMatch(html, /<Bot>/);
});

test('log readers stop at the section needed by each page', async (t) => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dutch-log-reader-'));
  const filePath = path.join(directory, 'game.txt');
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  await fs.promises.writeFile(filePath, [
    'Dutch game log 2026-01-01_01-02-03',
    'Winner: Ada',
    'Rounds: 1',
    '',
    'Points table:',
    'Round | Ada | Ben',
    '--- | --- | ---',
    'Round 1 | 4 | 8',
    '',
    'Game log:',
    '+00:00.000 1. game started',
    '',
    'Bot strategy diagnostics (post-game only):',
    '1. {"private":"thought"}',
    '',
    'Deterministic replay archive (post-game only):',
    '1. {"private":"replay"}'
  ].join('\n'));

  const summaryContent = await readLogSummaryContent(filePath);
  assert.match(summaryContent, /Round 1 \| 4 \| 8/);
  assert.doesNotMatch(summaryContent, /Game log:/);

  const browserContent = await readBrowserLogContent(filePath);
  assert.match(browserContent, /game started/);
  assert.doesNotMatch(browserContent, /private/);
  assert.doesNotMatch(browserContent, /Bot strategy diagnostics/);
});

test('log file sizes use megabytes for large files', () => {
  assert.equal(formatLogFileSize(0), '1 KB');
  assert.equal(formatLogFileSize(1024 * 500), '500 KB');
  assert.equal(formatLogFileSize(1024 * 1024), '1.0 MB');
  assert.equal(formatLogFileSize(1024 * 1024 * 12.4), '12 MB');
});

test('saved log page shell applies the stored theme before styles load', () => {
  const html = pageShell({
    appVersion: '1.2&3',
    title: 'Dutch logs',
    body: ''
  });

  assert.match(html, /<meta name="theme-color" content="#f6f7f9">/);
  assert.match(html, /<script src="\/theme\.js\?v=1\.2%263"><\/script>/);
  assert.ok(html.indexOf('<script src="/theme.js') < html.indexOf('<link rel="stylesheet"'));
});

test('log list and viewer display the repository and app version', () => {
  const pages = [
    renderLogList([], '1.2&3'),
    renderLogViewer('dutch-game-log.txt', 'Dutch game log', '1.2&3')
  ];

  for (const html of pages) {
    assert.match(html, /<p class="repo-link"><a href="https:\/\/github\.com\/gabbro246\/dutch" target="_blank" rel="noopener">github\.com\/gabbro246\/dutch<\/a> <span class="version-label">v1\.2&amp;3<\/span><\/p>/);
  }
});

test('log list pages contain 20 entries and render navigation below the list', () => {
  const files = Array.from({ length: 45 }, (_, index) => ({
    name: 'dutch-game-log-2026-01-01_00-00-' + String(index).padStart(2, '0') + '.txt',
    sizeText: (index + 1) + ' KB',
    summaryText: ''
  }));

  const secondPage = logListPage(files, '2');
  assert.equal(secondPage.currentPage, 2);
  assert.equal(secondPage.totalPages, 3);
  assert.equal(secondPage.files.length, 20);
  assert.equal(secondPage.files[0], files[20]);
  assert.equal(secondPage.files.at(-1), files[39]);

  const html = renderLogList(files, 'test', '2');
  assert.doesNotMatch(html, /00:00:19/);
  assert.match(html, /00:00:20/);
  assert.match(html, /00:00:39/);
  assert.doesNotMatch(html, /00:00:40/);
  assert.match(html, /<nav class="log-pagination" aria-label="Log pages"><a class="log-page-link" href="\/logs\?page=1" rel="prev">Previous<\/a><span class="log-page-status">Page 2 of 3<\/span><a class="log-page-link" href="\/logs\?page=3" rel="next">Next<\/a><\/nav>/);
  assert.ok(html.indexOf('class="log-file-list"') < html.indexOf('class="log-pagination"'));
});

test('log list page numbers are clamped and single pages omit navigation', () => {
  const files = Array.from({ length: 21 }, (_, index) => ({ name: String(index) }));
  assert.equal(logListPage(files, 'not-a-page').currentPage, 1);
  assert.equal(logListPage(files, '999').currentPage, 2);
  assert.doesNotMatch(renderLogList(files.slice(0, 20), 'test', 1), /log-pagination/);
});
