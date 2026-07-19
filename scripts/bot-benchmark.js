#!/usr/bin/env node
const { runTournament } = require('../lib/bot-simulation.js');

const gamesPerLineup = Math.max(1, Number(process.argv[2]) || 2);
const seeds = Array.from({ length: gamesPerLineup }, (_, index) => 1001 + index);
const result = runTournament({ seeds });
process.stdout.write(JSON.stringify({
  gamesPerLineup,
  totalGames: result.games.length,
  truncatedGames: result.games.filter((game) => game.truncated).length,
  summary: result.summary
}, null, 2) + '\n');
