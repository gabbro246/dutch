const express = require('express');
const fs = require('fs');
const path = require('path');
const { shortPlayerName } = require('../public/shared.js');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function gameLogFileName(value) {
  const filename = path.basename(String(value || ''));
  return /^dutch-game-log-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.txt$/.test(filename) ? filename : '';
}

function displayLogName(filename) {
  return filename
    .replace(/^dutch-game-log-/, '')
    .replace(/\.txt$/, '')
    .replace('_', ' ')
    .replace(/-/g, ':')
    .replace(/^(\d{4}):(\d{2}):(\d{2}) /, '$1-$2-$3 ');
}

function logLineValue(lines, label) {
  const prefix = label + ':';
  const line = lines.find((entry) => entry.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : '';
}

function playerShortNamesFromLines(lines) {
  const pointsHeader = lines.find((line) => /^Round\s*\|/.test(line));
  if (!pointsHeader) return '';
  const names = pointsHeader
    .split('|')
    .slice(1)
    .map((name) => shortPlayerName(name.trim()))
    .filter(Boolean);
  return names.join(', ');
}

function rankedPlayersFromLines(lines) {
  const pointsHeaderIndex = lines.findIndex((line) => /^Round\s*\|/.test(line));
  if (pointsHeaderIndex < 0) return '';
  const names = lines[pointsHeaderIndex]
    .split('|')
    .slice(1)
    .map((name) => name.trim());
  const scoreLine = lines
    .slice(pointsHeaderIndex + 1)
    .filter((line) => /^Round\s+\d+\s*\|/.test(line))
    .at(-1);
  if (!scoreLine) return '';
  const scores = scoreLine
    .split('|')
    .slice(1)
    .map((score) => score.trim());
  const ranked = names
    .map((name, index) => ({
      name,
      score: Number(scores[index])
    }))
    .filter((player) => player.name && Number.isFinite(player.score))
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  return ranked.map((player) => shortPlayerName(player.name)).join(', ');
}

function logSummaryFromContent(content) {
  const lines = String(content || '').split(/\r?\n/);
  const rounds = logLineValue(lines, 'Rounds');
  const rankedPlayers = rankedPlayersFromLines(lines);
  const players = playerShortNamesFromLines(lines);
  return {
    summaryText: [
      rankedPlayers ? 'Ranking: ' + rankedPlayers : (players ? 'Players: ' + players : ''),
      rounds ? 'Rounds: ' + rounds : ''
    ].filter(Boolean).join(' · ')
  };
}

function logSection(lines, heading, nextHeadings = []) {
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) return [];
  const end = lines.findIndex((line, index) => index > start && nextHeadings.includes(line.trim()));
  return lines.slice(start + 1, end < 0 ? lines.length : end);
}

function renderPointsTable(lines) {
  const rows = lines
    .filter((line) => line.trim() && !/^\s*-+(\s*\|\s*-+)+\s*$/.test(line))
    .map((line) => line.split("|").map((cell) => cell.trim()));
  if (rows.length < 2 || rows.some((row) => row.length !== rows[0].length)) {
    return "<pre class=saved-log-code><code>" + escapeHtml(lines.join("\n").trim()) + "</code></pre>";
  }
  const header = "<thead><tr>" + rows[0]
    .map((cell) => "<th scope=col>" + escapeHtml(cell) + "</th>")
    .join("") + "</tr></thead>";
  const body = "<tbody>" + rows.slice(1).map((row) => (
    "<tr>" + row.map((cell, index) => (
      index === 0
        ? "<th scope=row>" + escapeHtml(cell) + "</th>"
        : "<td>" + escapeHtml(cell) + "</td>"
    )).join("") + "</tr>"
  )).join("") + "</tbody>";
  return "<div class=saved-log-table-wrap><table class=saved-log-table>" + header + body + "</table></div>";
}

function renderBotDiagnostics(lines) {
  return lines.filter((line) => line.trim()).map((line) => {
    const match = line.match(/^\s*(\d+)\.\s+([\s\S]+)$/);
    const label = match ? "Thought " + match[1] : "Thought";
    const source = match ? match[2] : line;
    let formatted = source;
    try {
      formatted = JSON.stringify(JSON.parse(source), null, 2);
    } catch (_) {
      // Older or partial diagnostic entries may not contain valid JSON.
    }
    return "<article class=saved-log-thought>" +
      "<h3>" + label + "</h3>" +
      "<pre class=saved-log-code><code>" + escapeHtml(formatted) + "</code></pre>" +
    "</article>";
  }).join("");
}

function renderSavedLogContent(content) {
  const lines = String(content || "").split(/\r?\n/).map((line) =>
    /^Bot strategy diagnostics(?: \(post-game only\))?:$/.test(line.trim())
      ? "Bot strategy diagnostics:"
      : line
  );
  const pointsStart = lines.findIndex((line) => line.trim() === "Points table:");
  const preamble = lines.slice(0, pointsStart < 0 ? lines.length : pointsStart).filter((line) => line.trim());
  const title = preamble.shift() || "Dutch game log";
  const details = preamble.map((line) => {
    const separator = line.indexOf(":");
    if (separator < 0) return "<p>" + escapeHtml(line) + "</p>";
    return "<div><dt>" + escapeHtml(line.slice(0, separator)) + "</dt><dd>" +
      escapeHtml(line.slice(separator + 1).trim()) + "</dd></div>";
  }).join("");
  const points = logSection(lines, "Points table:", ["Game log:", "Bot strategy diagnostics:"]);
  const game = logSection(lines, "Game log:", ["Bot strategy diagnostics:"]).filter((line) => line.trim());
  const diagnostics = logSection(lines, "Bot strategy diagnostics:");
  const dropped = diagnostics.filter((line) => /^Earlier diagnostics dropped:/.test(line));
  const thoughts = diagnostics.filter((line) => !/^Earlier diagnostics dropped:/.test(line));

  return "<div class=saved-log-view>" +
    "<header class=saved-log-summary><h2>" + escapeHtml(title) + "</h2>" +
      (details ? "<dl>" + details + "</dl>" : "") +
    "</header>" +
    (points.length ? "<section class=saved-log-section><h2>Points table</h2>" + renderPointsTable(points) + "</section>" : "") +
    (game.length ? "<section class=saved-log-section><h2>Game log</h2><ol class=saved-log-lines>" +
      game.map((line) => "<li><time>" + escapeHtml((line.match(/^(\S+)/) || ["", ""])[1]) +
        "</time><span>" + escapeHtml(line.replace(/^\S+\s+/, "")) + "</span></li>").join("") +
      "</ol></section>" : "") +
    (diagnostics.length ? "<section class=saved-log-section><h2>Bot strategy</h2>" +
      dropped.map((line) => "<p class=hint>" + escapeHtml(line) + "</p>").join("") +
      renderBotDiagnostics(thoughts) + "</section>" : "") +
  "</div>";
}

function pageShell({ appVersion, title, body }) {
  return '<!doctype html>' +
    '<html lang="en">' +
    '<head>' +
      '<meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>' + escapeHtml(title) + '</title>' +
      '<link rel="stylesheet" href="/styles.css?v=' + encodeURIComponent(appVersion) + '">' +
    '</head>' +
    '<body><div id="app">' + body + '</div></body>' +
    '</html>';
}

function renderLogList(files, appVersion) {
  const items = files.map((file) => (
    '<a class="log-file-link" href="/logs/' + encodeURIComponent(file.name) + '">' +
      '<span class="log-file-main">' +
        '<span>' + escapeHtml(displayLogName(file.name)) + '</span>' +
        (file.summaryText ? '<span class="log-file-summary">' + escapeHtml(file.summaryText) + '</span>' : '') +
      '</span>' +
      '<span class="log-file-meta">' + escapeHtml(file.sizeText) + '</span>' +
    '</a>'
  )).join('');
  const empty = '<p class="hint">No saved game logs yet.</p>';
  return pageShell({
    appVersion,
    title: 'Dutch game logs',
    body: '<div class="page waiting-page">' +
      '<h1 class="app-title">Dutch! 🂡</h1>' +
      '<div class="waiting-panel logs-panel">' +
        '<div class="log-view-header">' +
          '<p class="waiting-description">Saved game logs</p>' +
          '<a class="log-back-link" href="/">Back to main page</a>' +
        '</div>' +
        '<div class="log-file-list">' + (items || empty) + '</div>' +
      '</div>' +
    '</div>'
  });
}

function renderLogViewer(filename, content, appVersion) {
  const encodedFilename = encodeURIComponent(filename);
  return pageShell({
    appVersion,
    title: displayLogName(filename),
    body: '<div class="page waiting-page">' +
      '<h1 class="app-title">Dutch! 🂡</h1>' +
      '<div class="waiting-panel logs-panel">' +
        '<div class="log-view-header">' +
          '<p class="waiting-description">' + escapeHtml(displayLogName(filename)) + '</p>' +
          '<span class="log-nav-links">' +
            '<a class="log-back-link" href="/logs">Back to logs</a>' +
          '</span>' +
        '</div>' +
        renderSavedLogContent(content) +
        '<div class="log-download-row">' +
          '<a class="log-back-link" href="/logs/' + encodedFilename + '/download" download="' + escapeHtml(filename) + '">Download this log file</a>' +
        '</div>' +
      '</div>' +
    '</div>'
  });
}

function createHttpApp({ indexPath, publicDir, appVersion, gameLogDir }) {
  const app = express();

  app.get('/', (req, res) => {
    fs.readFile(indexPath, 'utf8', (error, html) => {
      if (error) {
        res.status(500).send('Could not load app.');
        return;
      }
      const versionedHtml = html
        .replace('href="styles.css"', 'href="styles.css?v=' + appVersion + '"')
        .replace('src="shared.js"', 'src="shared.js?v=' + appVersion + '"')
        .replace('src="client-actions.js"', 'src="client-actions.js?v=' + appVersion + '"')
        .replace('src="client.js"', 'src="client.js?v=' + appVersion + '"');
      res.set('Cache-Control', 'no-cache');
      res.type('html').send(versionedHtml);
    });
  });

  app.get('/logs', (req, res) => {
    fs.readdir(gameLogDir, { withFileTypes: true }, (error, entries) => {
      if (error && error.code !== 'ENOENT') {
        res.status(500).send('Could not load game logs.');
        return;
      }
      const names = (entries || [])
        .filter((entry) => entry.isFile() && gameLogFileName(entry.name))
        .map((entry) => entry.name);
      Promise.all(names.map((name) => {
        const filePath = path.join(gameLogDir, name);
        return Promise.all([
          fs.promises.stat(filePath),
          fs.promises.readFile(filePath, 'utf8').catch(() => '')
        ])
          .then(([stats, content]) => {
            const summary = logSummaryFromContent(content);
            return {
              name,
              mtimeMs: stats.mtimeMs,
              sizeText: Math.max(1, Math.ceil(stats.size / 1024)) + ' KB',
              summaryText: summary.summaryText
            };
          })
          .catch(() => null);
      }))
        .then((files) => {
          const sorted = files
            .filter(Boolean)
            .sort((a, b) => b.mtimeMs - a.mtimeMs);
          res.set('Cache-Control', 'no-cache');
          res.type('html').send(renderLogList(sorted, appVersion));
        })
        .catch(() => res.status(500).send('Could not load game logs.'));
    });
  });

  app.get('/logs/:filename/download', (req, res) => {
    const filename = gameLogFileName(req.params.filename);
    if (!filename) {
      res.status(404).send('Log not found.');
      return;
    }
    res.download(path.join(gameLogDir, filename), filename, (error) => {
      if (!error || res.headersSent) return;
      res.status(error.code === 'ENOENT' ? 404 : 500).send(error.code === 'ENOENT' ? 'Log not found.' : 'Could not download game log.');
    });
  });

  app.get('/logs/:filename', (req, res) => {
    const filename = gameLogFileName(req.params.filename);
    if (!filename) {
      res.status(404).send('Log not found.');
      return;
    }
    fs.readFile(path.join(gameLogDir, filename), 'utf8', (error, content) => {
      if (error) {
        res.status(error.code === 'ENOENT' ? 404 : 500).send(error.code === 'ENOENT' ? 'Log not found.' : 'Could not load game log.');
        return;
      }
      res.set('Cache-Control', 'no-cache');
      res.type('html').send(renderLogViewer(filename, content, appVersion));
    });
  });

  app.use(express.static(publicDir));

  return app;
}

module.exports = { createHttpApp, logSummaryFromContent, rankedPlayersFromLines, renderSavedLogContent };
