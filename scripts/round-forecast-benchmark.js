#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { runTournament } = require('../lib/bot-simulation.js');
const { createDeterministicRandom } = require('../lib/deterministic-rng.js');
const args = process.argv.slice(2);
const option = (name, fallback) => {const i=args.indexOf('--'+name);return i<0 ? fallback : args[i+1];};
const candidate = 'roswell-beta@1.3.82';
const opponents = option('opponents','roswell-beta@1.3.81').split(',');
const lineup = [candidate,...opponents];
const games = Number(option('games',200));
const seedStart = Number(option('seed',110001));
const roundLimit = Number(option('rounds',0));
const output = path.resolve(option('output','round-forecast-results.json'));
if(!Number.isSafeInteger(games) || games<=0 || games%lineup.length)throw new Error('Games must be a positive multiple of the seat count.');
if(!Number.isSafeInteger(seedStart) || ![0,1,5].includes(roundLimit))throw new Error('Invalid seed or round count.');
if(new Set(lineup).size!==lineup.length)throw new Error('Each competitor must have a distinct version label.');
const root=path.join(__dirname,'..');
const sourceFiles=fs.readdirSync(path.join(root,'lib')).filter(n=>n.endsWith('.js') || n==='bot-hand-values.json').map(n=>'lib/'+n)
  .concat(['public/shared.js','package.json','scripts/round-forecast-benchmark.js','scripts/build-beta-hand-values.js']).sort();
const sourceHashes=Object.fromEntries(sourceFiles.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
const startedAt=new Date().toISOString();
const records=[];
const options={
  seeds:Array.from({length:games/lineup.length},(_,i)=>seedStart+i),
  lineups:lineup.map((_,i)=>lineup.slice(i).concat(lineup.slice(0,i))),
  roundLimit,maxRounds:250,maxTurnsPerRound:300,capturePostGameLog:true,
  onGameComplete(game,n){
    records.push({seed:game.seed,players:game.players,winner:game.winnerPolicy,truncated:game.truncated,
      metrics:game.metrics,scoreHistory:game.postGameLog.scoreHistory});
    if(n%20===0)process.stdout.write(`${n}/${games} games completed\n`);
  }
};
const result=runTournament(options);
const clusters=new Map();
for(const record of records){if(!clusters.has(record.seed))clusters.set(record.seed,[]);clusters.get(record.seed).push(record);}
const samples=[...clusters.values()];
const rng=createDeterministicRandom(314159);
const bootstrap=Array.from({length:3000},()=>{
  let wins=0,count=0;
  for(let i=0;i<samples.length;i++)for(const g of samples[Math.floor(rng()*samples.length)]){wins+=g.winner===candidate?1:0;count++;}
  return wins/count;
}).sort((a,b)=>a-b);
const report={version:require('../package.json').version,node:process.version,startedAt,finishedAt:new Date().toISOString(),
  candidate,opponents,games,seedStart,roundLimit,gameTarget:100,maxRounds:250,maxTurnsPerRound:300,sourceHashes,
  candidateGameWinInterval95:[bootstrap[75],bootstrap[2925]],
  forcedGames:records.filter(g=>Object.values(g.metrics).some(m=>m.forcedRoundEndings)).length,
  truncatedGames:records.filter(g=>g.truncated).length,summary:result.summary,records};
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,JSON.stringify(report)+'\n');
process.stdout.write(JSON.stringify({output,gameWins:report.summary[candidate].gameWinRate,roundWins:report.summary[candidate].roundWinRate,forced:report.forcedGames,truncated:report.truncatedGames})+'\n');
