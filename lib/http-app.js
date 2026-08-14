const express = require('express');
const fs = require('fs');
const path = require('path');
const { StringDecoder } = require('string_decoder');
const {
  HALVING_TOTALS,
  pointsChartGeometry,
  shortPlayerName,
  shuffledPointColorIndices
} = require('../public/shared.js');

const LOG_READ_CHUNK_SIZE = 64 * 1024;
const LOGS_PER_PAGE = 20;
const LOG_SUMMARY_END = /^Game log:\r?$/m;
const LOG_BROWSER_END = /^(?:Bot strategy diagnostics|Deterministic replay archive)(?: \(post-game only\))?:\r?$/m;

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

const LOG_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function logTimestampParts(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const timestamp = Date.UTC(year, month - 1, day, hour, minute, second);
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
    || date.getUTCHours() !== hour
    || date.getUTCMinutes() !== minute
    || date.getUTCSeconds() !== second
  ) return null;
  return { year, month, day, hour, minute, second, timestamp };
}

function formatHumanLogTimestamp(value) {
  const parts = logTimestampParts(value);
  if (!parts) return String(value || '');
  const pad = (number) => String(number).padStart(2, '0');
  return LOG_MONTHS[parts.month - 1] + ' ' + parts.day + ', ' + parts.year + ' at ' +
    pad(parts.hour) + ':' + pad(parts.minute) + ':' + pad(parts.second);
}

function relativeLogDurationMs(lines) {
  let duration = null;
  for (const line of lines) {
    const token = (String(line || '').match(/^\+(\S+)/) || [])[1];
    if (!token) continue;
    const parts = token.split(':');
    if (parts.length < 2 || parts.length > 3) continue;
    const secondsMatch = parts.at(-1).match(/^(\d{2})\.(\d{3})$/);
    if (!secondsMatch) continue;
    const hours = parts.length === 3 ? Number(parts[0]) : 0;
    const minutes = Number(parts.at(-2));
    const seconds = Number(secondsMatch[1]);
    const milliseconds = Number(secondsMatch[2]);
    if (![hours, minutes, seconds, milliseconds].every(Number.isFinite) || minutes >= 60 || seconds >= 60) continue;
    const elapsed = ((hours * 60 + minutes) * 60 + seconds) * 1000 + milliseconds;
    duration = Math.max(duration === null ? 0 : duration, elapsed);
  }
  return duration;
}

function formatGameDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '';
  const totalSeconds = Math.round(milliseconds / 1000);
  if (totalSeconds === 0) return milliseconds > 0 ? 'Less than a second' : '0 seconds';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [
    hours ? hours + ' ' + (hours === 1 ? 'hour' : 'hours') : '',
    minutes ? minutes + ' ' + (minutes === 1 ? 'minute' : 'minutes') : '',
    seconds ? seconds + ' ' + (seconds === 1 ? 'second' : 'seconds') : ''
  ].filter(Boolean).join(' ');
}

function savedGameDuration(gameLines, startedTimestamp, exportedTimestamp) {
  const relativeDuration = relativeLogDurationMs(gameLines);
  if (relativeDuration !== null) return formatGameDuration(relativeDuration);
  const started = logTimestampParts(startedTimestamp);
  const exported = logTimestampParts(exportedTimestamp);
  return started && exported ? formatGameDuration(exported.timestamp - started.timestamp) : '';
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

async function readLogUntil(filePath, endPattern) {
  const file = await fs.promises.open(filePath, 'r');
  const decoder = new StringDecoder('utf8');
  const buffer = Buffer.alloc(LOG_READ_CHUNK_SIZE);
  let content = '';

  try {
    while (true) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (!bytesRead) return content + decoder.end();
      content += decoder.write(buffer.subarray(0, bytesRead));
      const end = content.search(endPattern);
      if (end >= 0) return content.slice(0, end);
    }
  } finally {
    await file.close();
  }
}

function readLogSummaryContent(filePath) {
  return readLogUntil(filePath, LOG_SUMMARY_END);
}

function readBrowserLogContent(filePath) {
  return readLogUntil(filePath, LOG_BROWSER_END);
}

function formatLogFileSize(bytes) {
  if (bytes >= 1024 * 1024) {
    const megabytes = bytes / (1024 * 1024);
    return megabytes.toFixed(megabytes < 10 ? 1 : 0) + ' MB';
  }
  return Math.max(1, Math.ceil(bytes / 1024)) + ' KB';
}

function logSection(lines, heading, nextHeadings = []) {
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) return [];
  const end = lines.findIndex((line, index) => index > start && nextHeadings.includes(line.trim()));
  return lines.slice(start + 1, end < 0 ? lines.length : end);
}

function pointsTableRows(lines) {
  return lines
    .filter((line) => line.trim() && !/^\s*-+(\s*\|\s*-+)+\s*$/.test(line))
    .map((line) => line.split("|").map((cell) => cell.trim()));
}

function renderPointsTable(lines, seed = '') {
  const rows = pointsTableRows(lines);
  if (rows.length < 2 || rows.some((row) => row.length !== rows[0].length)) {
    return "<pre class=saved-log-code><code>" + escapeHtml(lines.join("\n").trim()) + "</code></pre>";
  }
  const colors = shuffledPointColorIndices(seed, 9);
  const header = "<thead><tr>" + rows[0]
    .map((cell, index) => {
      if (index === 0) return "<th scope=col>" + escapeHtml(cell) + "</th>";
      const colorIndex = colors[(index - 1) % colors.length];
      return '<th scope=col><span class="saved-log-player-name" style="--series-color: var(--chart-color-' +
        colorIndex + ')">' + escapeHtml(cell) + '</span></th>';
    })
    .join("") + "</tr></thead>";
  const body = "<tbody>" + rows.slice(1).map((row) => (
    "<tr>" + row.map((cell, index) => {
      if (index === 0) return "<th scope=row>" + escapeHtml(cell) + "</th>";
      const colorIndex = colors[(index - 1) % colors.length];
      return '<td class="saved-log-player-points" style="--series-color: var(--chart-color-' +
        colorIndex + ')">' + escapeHtml(cell) + '</td>';
    }).join("") + "</tr>"
  )).join("") + "</tbody>";
  return "<div class=saved-log-table-wrap><table class=saved-log-table>" + header + body + "</table></div>";
}

function renderSavedPointsChart(lines, target, seed = '') {
  const rows = pointsTableRows(lines);
  if (rows.length < 2 || rows[0].length < 2 || rows.some((row) => row.length !== rows[0].length)) return '';

  const players = rows[0].slice(1).map((name) => ({
    name,
    points: [{ round: 0, total: 0 }]
  }));
  let maxRound = 0;
  for (const row of rows.slice(1)) {
    const match = row[0].match(/^Round\s+(\d+)$/i);
    if (!match) continue;
    const round = Number(match[1]);
    maxRound = Math.max(maxRound, round);
    row.slice(1).forEach((value, index) => {
      const total = Number(value);
      if (players[index] && value !== '' && Number.isFinite(total)) {
        players[index].points.push({ round, total });
      }
    });
  }
  if (maxRound === 0 || players.every((player) => player.points.length === 1)) return '';

  const width = 640;
  const height = 240;
  const maxTotal = Math.max(0, ...players.flatMap((player) => player.points.map((point) => point.total)));
  const numericTarget = Number(target) || 0;
  const { yMax, y, coordinate, xTicks, yTicks } = pointsChartGeometry({
    width,
    height,
    maxRound,
    maxTotal,
    target: numericTarget
  });
  const colors = shuffledPointColorIndices(seed, 9);
  const xPercent = (round) => coordinate((round / Math.max(1, maxRound)) * 100) + '%';

  const grid = yTicks.map((value) => {
    const yPos = coordinate(y(value));
    return `<g class="points-chart-grid"><line x1="0" y1="${yPos}" x2="100%" y2="${yPos}"></line><text x="-6" y="${yPos + 3}">${escapeHtml(Math.round(value))}</text></g>`;
  }).join('');
  const roundLabels = xTicks.map((round) => (
    `<text class="points-chart-round" x="${xPercent(round)}" y="${height - 7}">${escapeHtml(round === 0 ? '0' : 'R' + round)}</text>`
  )).join('');
  const halvingLines = HALVING_TOTALS
    .filter((value) => value <= yMax && value !== numericTarget)
    .map((value) => `<g class="points-chart-halving"><title>Score halves at ${value} points</title><line x1="0" y1="${coordinate(y(value))}" x2="100%" y2="${coordinate(y(value))}"></line></g>`)
    .join('');
  const targetLine = numericTarget > 0 && numericTarget <= yMax
    ? `<g class="points-chart-target"><line x1="0" y1="${coordinate(y(numericTarget))}" x2="100%" y2="${coordinate(y(numericTarget))}"></line><text x="50%" y="${Math.max(10, coordinate(y(numericTarget)) - 4)}">Target: ${escapeHtml(numericTarget)}</text></g>`
    : '';
  const chartSeries = players.map((player, index) => {
    const colorIndex = colors[index % colors.length];
    const points = player.points.map((point) => ({
      ...point,
      x: xPercent(point.round),
      y: coordinate(y(point.total))
    }));
    const lines = points.slice(1).map((point, pointIndex) => {
      const previous = points[pointIndex];
      return `<line class="points-chart-line" x1="${previous.x}" y1="${previous.y}" x2="${point.x}" y2="${point.y}"></line>`;
    }).join('');
    const markers = points.map((point) => {
      const label = `Round ${point.round}: ${player.name}, ${point.total} points`;
      return `<circle class="points-chart-marker" tabindex="0" role="img" aria-label="${escapeHtml(label)}" cx="${point.x}" cy="${point.y}" r="2"><title>${escapeHtml(label)}</title></circle>`;
    }).join('');
    return `<g class="points-chart-series" style="--series-color: var(--chart-color-${colorIndex})">${lines}${markers}</g>`;
  }).join('');

  return `<figure class="points-chart" aria-label="Points over time">
    <svg class="points-chart-svg points-chart-svg-responsive" height="${height}" role="img" aria-label="Points over time">
      <title>Points over time</title>
      <svg class="points-chart-plot" x="8%" width="87%" height="${height}" overflow="visible">
        ${grid}
        ${targetLine}
        ${halvingLines}
        ${chartSeries}
        ${roundLabels}
      </svg>
    </svg>
  </figure>`;
}

function renderSavedLogContent(content) {
  const allLines = String(content || "").split(/\r?\n/);
  const privateStart = allLines.findIndex((line) => (
    /^(?:Bot strategy diagnostics|Deterministic replay archive)(?: \(post-game only\))?:$/.test(line.trim())
  ));
  const lines = privateStart < 0 ? allLines : allLines.slice(0, privateStart);
  const pointsStart = lines.findIndex((line) => line.trim() === "Points table:");
  const preamble = lines.slice(0, pointsStart < 0 ? lines.length : pointsStart).filter((line) => line.trim());
  const rawTitle = preamble.shift() || "Dutch game log";
  const startedTimestamp = (rawTitle.match(/^Dutch game log\s+(\S+)$/) || [])[1] || '';
  const exportedTimestamp = logLineValue(lines, 'Exported');
  const points = logSection(lines, "Points table:", ["Game log:"]);
  const game = logSection(lines, "Game log:").filter((line) => line.trim());
  const duration = savedGameDuration(game, startedTimestamp, exportedTimestamp);
  const detailRows = [
    startedTimestamp ? ['Game started', formatHumanLogTimestamp(startedTimestamp)] : null,
    exportedTimestamp ? ['Exported', formatHumanLogTimestamp(exportedTimestamp)] : null,
    duration ? ['Game duration', duration] : null,
    ...preamble.filter((line) => !line.startsWith('Exported:')).map((line) => {
      const separator = line.indexOf(":");
      return separator < 0
        ? ['', line]
        : [line.slice(0, separator), line.slice(separator + 1).trim()];
    })
  ].filter(Boolean);
  const details = detailRows.map(([label, value]) => {
    if (!label) return "<p>" + escapeHtml(value) + "</p>";
    return "<div><dt>" + escapeHtml(label) + "</dt><dd>" + escapeHtml(value) + "</dd></div>";
  }).join("");
  const numericTarget = Number(logLineValue(lines, 'Target')) || 0;
  const pointsChart = renderSavedPointsChart(points, numericTarget, rawTitle);

  return "<div class=saved-log-view>" +
    (details ? "<header class=saved-log-summary><dl>" + details + "</dl></header>" : "") +
    (points.length ? "<section class=saved-log-section aria-label=\"Points table\">" + renderPointsTable(points, rawTitle) + "</section>" : "") +
    (pointsChart ? "<section class=\"saved-log-section saved-log-chart\" aria-label=\"Points graph\">" + pointsChart + "</section>" : "") +
    (game.length ? "<section class=saved-log-section aria-label=\"Game log\"><ol class=saved-log-lines>" +
      game.map((line) => "<li><time>" + escapeHtml((line.match(/^(\S+)/) || ["", ""])[1]) +
        "</time><span>" + escapeHtml(line.replace(/^\S+\s+/, "")) + "</span></li>").join("") +
      "</ol></section>" : "") +
  "</div>";
}

function pageShell({ appVersion, title, body }) {
  return '<!doctype html>' +
    '<html lang="en">' +
    '<head>' +
      '<meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<meta name="theme-color" content="#f6f7f9">' +
      '<title>' + escapeHtml(title) + '</title>' +
      '<script src="/theme.js?v=' + encodeURIComponent(appVersion) + '"></script>' +
      '<link rel="stylesheet" href="/styles.css?v=' + encodeURIComponent(appVersion) + '">' +
    '</head>' +
    '<body><div id="app">' + body + '</div></body>' +
    '</html>';
}

function renderRepoLink(appVersion) {
  const version = appVersion
    ? ' <span class="version-label">v' + escapeHtml(appVersion) + '</span>'
    : '';
  return '<p class="repo-link"><a href="https://github.com/gabbro246/dutch" target="_blank" rel="noopener">github.com/gabbro246/dutch</a>' + version + '</p>';
}

function logListPage(files, requestedPage) {
  const totalPages = Math.max(1, Math.ceil(files.length / LOGS_PER_PAGE));
  const pageText = String(requestedPage ?? '');
  const parsedPage = /^\d+$/.test(pageText) ? Number(pageText) : 1;
  const currentPage = Math.min(Math.max(parsedPage || 1, 1), totalPages);
  const start = (currentPage - 1) * LOGS_PER_PAGE;
  return {
    currentPage,
    files: files.slice(start, start + LOGS_PER_PAGE),
    totalPages
  };
}

function renderLogPagination(currentPage, totalPages) {
  if (totalPages <= 1) return '';
  const previous = currentPage > 1
    ? '<a class="log-page-link" href="/logs?page=' + (currentPage - 1) + '" rel="prev">Previous</a>'
    : '<span class="log-page-link is-disabled" aria-disabled="true">Previous</span>';
  const next = currentPage < totalPages
    ? '<a class="log-page-link" href="/logs?page=' + (currentPage + 1) + '" rel="next">Next</a>'
    : '<span class="log-page-link is-disabled" aria-disabled="true">Next</span>';
  return '<nav class="log-pagination" aria-label="Log pages">' +
    previous +
    '<span class="log-page-status">Page ' + currentPage + ' of ' + totalPages + '</span>' +
    next +
  '</nav>';
}

function renderLogList(files, appVersion, requestedPage = 1) {
  const page = logListPage(files, requestedPage);
  const items = page.files.map((file) => (
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
        renderLogPagination(page.currentPage, page.totalPages) +
      '</div>' +
      renderRepoLink(appVersion) +
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
      renderRepoLink(appVersion) +
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
        .replace('src="client-state.js"', 'src="client-state.js?v=' + appVersion + '"')
        .replace('src="client-render.js"', 'src="client-render.js?v=' + appVersion + '"')
        .replace('src="client-sounds.js"', 'src="client-sounds.js?v=' + appVersion + '"')
        .replace('src="client-ui-animations.js"', 'src="client-ui-animations.js?v=' + appVersion + '"')
        .replace('src="client-card-animations.js"', 'src="client-card-animations.js?v=' + appVersion + '"')
        .replace('src="client-waiting.js"', 'src="client-waiting.js?v=' + appVersion + '"')
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
          readLogSummaryContent(filePath).catch(() => '')
        ])
          .then(([stats, content]) => {
            const summary = logSummaryFromContent(content);
            return {
              name,
              mtimeMs: stats.mtimeMs,
              sizeText: formatLogFileSize(stats.size),
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
          res.type('html').send(renderLogList(sorted, appVersion, req.query.page));
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
    readBrowserLogContent(path.join(gameLogDir, filename))
      .then((content) => {
        res.set('Cache-Control', 'no-cache');
        res.type('html').send(renderLogViewer(filename, content, appVersion));
      })
      .catch((error) => {
        res.status(error.code === 'ENOENT' ? 404 : 500).send(error.code === 'ENOENT' ? 'Log not found.' : 'Could not load game log.');
      });
  });

  app.use(express.static(publicDir));

  return app;
}

module.exports = {
  createHttpApp,
  formatLogFileSize,
  logListPage,
  logSummaryFromContent,
  rankedPlayersFromLines,
  pageShell,
  readBrowserLogContent,
  readLogSummaryContent,
  renderLogList,
  renderLogViewer,
  renderSavedLogContent
};
