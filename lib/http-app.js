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

function logSummaryFromContent(content) {
  const lines = String(content || '').split(/\r?\n/);
  const winner = logLineValue(lines, 'Winner');
  const rounds = logLineValue(lines, 'Rounds');
  const players = playerShortNamesFromLines(lines);
  return {
    summaryText: [
      players ? 'Players: ' + players : '',
      winner ? 'Winner: ' + shortPlayerName(winner) : '',
      rounds ? 'Rounds: ' + rounds : ''
    ].filter(Boolean).join(' · ')
  };
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
        '<p class="waiting-description">Saved game logs</p>' +
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
          '<a class="log-back-link" href="/logs">Back to logs</a>' +
        '</div>' +
        '<pre class="saved-log-view">' + escapeHtml(content) + '</pre>' +
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

module.exports = { createHttpApp };
