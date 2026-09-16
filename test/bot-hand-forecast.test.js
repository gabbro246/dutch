const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {handForecast}=require('../lib/bot-hand-forecast.js');
const {createTableForecast}=require('../lib/bot-table-forecast.js');
const {scoreDistribution}=require('../lib/bot-simple-tactics.js');
const card=n=>({rank:n===0?'K':n===1?'A':n===11?'J':n===12?'Q':n===13?'K':String(n),suit:n===0?'hearts':'clubs'});
const slot=n=>({card:n===14?null:card(n),expected:n===14?6.5:n,ownerKnows:1,memory:{},distribution:n===14?Array.from({length:14},(_,i)=>({card:card(i),value:i,probability:i===0||i===13?2/52:4/52})):[{card:card(n),value:n,probability:1}]});

test('the small-hand forecast distinguishes a final turn from a successful Dutch call',()=>{
  assert.equal(handForecast([slot(0)]).finalTurn,0);
  assert.equal(handForecast([slot(2)]).threeTurns,0);
  assert.ok(handForecast([slot(2)]).finalTurn>0);
  assert.ok(handForecast([slot(14)]).threeTurns>0);
  assert.equal(handForecast(Array.from({length:5},()=>slot(14))),null);
  assert.deepEqual(handForecast([slot(4),slot(2)]),handForecast([slot(2),slot(4)]));
  assert.ok(handForecast([slot(10),slot(10)]).threeTurns < handForecast([slot(10),slot(14)]).threeTurns);
});

test('the shipped hand table rebuilds deterministically with valid transition probabilities',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dutch-hand-values-'));
  try {
    const output=path.join(dir,'values.json');
    execFileSync(process.execPath,[path.join(__dirname,'../scripts/build-beta-hand-values.js'),'--output',output]);
    assert.equal(fs.readFileSync(output,'utf8'),fs.readFileSync(path.join(__dirname,'../lib/bot-hand-values.json'),'utf8'));
    assert.equal(Object.keys(JSON.parse(fs.readFileSync(output)).values).length,3876);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('the table forecast uses owner knowledge and never reads physical hidden faces',()=>{
  const bot={id:'bot',total:0},rival={id:'rival',total:0,get cards(){throw new Error('Hidden hand read');}};
  const make=known=>({bot,players:[bot,rival],others:[rival],hands:new Map([['bot',[slot(9)]],['rival',[{...slot(2),ownerKnows:known}]]]),draw:[{card:card(10),probability:1}],round:{},cycleMemo:new Map(),final:false});
  const table=createTableForecast(scoreDistribution);
  const informed=table.cycle(make(1),null),uninformed=table.cycle(make(0),null);
  assert.ok(informed.callChance>uninformed.callChance);
  assert.ok(informed.openings.length>0);
  assert.ok(informed.openings.every(o=>o.probability>=0));
  assert.equal(table.cycle({...make(1),hands:new Map([['bot',[slot(9)]],['rival',[slot(0)]]])},null).callChance,1);
});
