#!/usr/bin/env node
const fs = require('fs');
const zlib = require('zlib');
const { replayArchiveFromFinishedLog, counterfactualReplay } = require('../lib/bot-replay.js');

const [logPath, tickRaw, roundRaw, botId] = process.argv.slice(2);
if (!logPath || tickRaw == null) {
  console.error('Usage: npm run replay:bots -- <finished-log.txt> <strategy-tick> [round] [bot-id]');
  process.exitCode = 1;
} else {
  const raw = fs.readFileSync(logPath);
  const content = logPath.endsWith('.gz') || (raw[0] === 0x1f && raw[1] === 0x8b)
    ? zlib.gunzipSync(raw).toString('utf8')
    : raw.toString('utf8');
  const archive = replayArchiveFromFinishedLog(content);
  if (!archive) throw new Error('The finished log does not contain a replay archive.');
  const result = counterfactualReplay(archive, {
    strategyTick: Number(tickRaw),
    round: roundRaw == null ? undefined : Number(roundRaw),
    botId
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
