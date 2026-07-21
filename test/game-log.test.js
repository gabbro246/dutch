const test = require('node:test');
const assert = require('node:assert/strict');
const {
  gameLogStartDate,
  finishedGameLogFilename,
  finishedGameLogText
} = require('../lib/game-log.js');
const { logSummaryFromContent, renderSavedLogContent } = require("../lib/http-app.js");

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
  assert.match(text, /Winner: Ada\nTarget: 100\nRounds: 2\n/);
  assert.match(text, /Round \| Ada \| Ben\n--- \| --- \| ---\nRound 1 \| 4 \| 7\nRound 2 \| 9 \| 8/);
  assert.match(text, /Game log:\n\+00:00\.000 1\. \[system\] game started\n\+00:01\.500 2\. Ada swapped cards\n$/);
});

test('hidden bot diagnostics appear only in the finished-game log section', () => {
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
    botDiagnostics: [diagnostic]
  });

  assert.match(text, /Game log:\n\+00:00\.000 1\. public move\n\nBot strategy diagnostics:/);
  assert.match(text, new RegExp(JSON.stringify(diagnostic).replace(/[.*+?^$()|[\]\\]/g, '\\$&')));
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

test("saved log viewer renders the points table and pretty-printed bot thoughts", () => {
  const content = [
    "Dutch game log 2026-01-01_01-02-03",
    "Winner: Ada",
    "Target: 50",
    "Rounds: 1",
    "",
    "Points table:",
    "Round | Ada | <Bot>",
    "--- | --- | ---",
    "Round 1 | 4 | 8",
    "",
    "Game log:",
    "+00:00.000 1. [system] game started",
    "",
    "Bot strategy diagnostics:",
    "Earlier diagnostics dropped: 2",
    "1. {\"decision\":\"draw-source\",\"selected\":\"take-pile\"}"
  ].join("\n");

  const html = renderSavedLogContent(content);

  assert.match(html, /<table class=saved-log-table>/);
  assert.match(html, /<th scope=col>&lt;Bot&gt;<\/th>/);
  assert.match(html, /<td>8<\/td>/);
  assert.match(html, /<time>\+00:00\.000<\/time><span>1\. \[system\] game started<\/span>/);
  assert.match(html, /<h2>Bot strategy<\/h2>/);
  assert.match(html, /<code>{\n  &quot;decision&quot;: &quot;draw-source&quot;,\n  &quot;selected&quot;: &quot;take-pile&quot;\n}<\/code>/);
  assert.doesNotMatch(html, /<Bot>/);
});
