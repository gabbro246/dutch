#!/usr/bin/env node
const fs = require('fs');
const { replayArchiveFromFinishedLog, counterfactualReplay } = require('../lib/bot-replay.js');

const [logPath, tickRaw, roundRaw, botId] = process.argv.slice(2);
if (!logPath || tickRaw == null) {
  console.error('Usage: npm run replay:bots -- <finished-log.txt> <strategy-tick> [round] [bot-id]');
  process.exitCode = 1;
} else {
  const archive = replayArchiveFromFinishedLog(fs.readFileSync(logPath, 'utf8'));
  if (!archive) throw new Error('The finished log does not contain a replay archive.');
  const result = counterfactualReplay(archive, {
    strategyTick: Number(tickRaw),
    round: roundRaw == null ? undefined : Number(roundRaw),
    botId
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
