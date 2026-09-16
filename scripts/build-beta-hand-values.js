#!/usr/bin/env node
// Offline, finite-horizon own-hand model. It never observes a live game.
const fs = require('node:fs');
const path = require('node:path');
const U = 14, Q = 12;
// Known classes are point values 0..13, with 0/13 rank-matching as Kings.
const draw = Array.from({ length: 14 }, (_, card) => ({ card, probability: card === 0 || card === 13 ? 2 / 52 : 4 / 52 }));
const ownThrowProbability = 0.9;
const score = hand => hand.reduce((n, c) => n + (c === U ? 6.5 : c), 0);
const ready = hand => !hand.includes(U) && score(hand) <= 5;
const key = hand => hand.slice().sort((a, b) => a - b).join(',');
const hands = [];
function enumerate(hand, start) {
  hands.push(hand);
  if (hand.length === 4) return;
  for (let card = start; card <= U; card++) enumerate(hand.concat(card), card);
}
enumerate([], 0);
const ids = new Map(hands.map((hand, id) => [key(hand), id]));
const match = (a, b) => a === b || [0, 13].includes(a) && [0, 13].includes(b);
function throwIndex(hand, discarded) {
  let selected = -1;
  hand.forEach((c, i) => {
    if (c !== U && match(c, discarded) && (c !== 0 || hand.length === 1) && (selected < 0 || c > hand[selected])) selected = i;
  });
  return selected;
}
function peek(branches) {
  return branches.flatMap(branch => {
    const at = branch.hand.indexOf(U);
    return at < 0 ? [branch] : draw.map(d => ({ hand: branch.hand.map((c, i) => i === at ? d.card : c), probability: branch.probability * d.probability }));
  });
}
function resolution(hand, discarded) {
  const at = throwIndex(hand, discarded);
  let branches;
  if (at >= 0) {
    let thrown = [{ hand: hand.filter((_, i) => i !== at), probability: ownThrowProbability }];
    let missed = [{ hand, probability: 1 - ownThrowProbability }];
    if (discarded === Q) { thrown = peek(peek(thrown)); missed = peek(missed); }
    branches = thrown.concat(missed);
  } else {
    branches = [{ hand, probability: 1 }];
    if (discarded === Q) {
      branches = peek(branches).flatMap(branch => {
        const discovered = throwIndex(branch.hand, discarded);
        if (discovered < 0) return [branch];
        return [{ ...branch, probability: branch.probability * (1 - ownThrowProbability) }].concat(peek([{ hand: branch.hand.filter((_, i) => i !== discovered), probability: branch.probability * ownThrowProbability }]));
      });
    }
  }
  return branches;
}
const transitions = hands.map(hand => draw.map(incoming => {
  const indices = [-1, ...hand.map((_, i) => i).filter(i => hand.indexOf(hand[i]) === i)];
  return indices.map(at => {
    const next = at < 0 ? hand : hand.map((c, i) => i === at ? incoming.card : c);
    const outgoing = at < 0 ? [{ card: incoming.card, probability: 1 }] : hand[at] === U ? draw : [{ card: hand[at], probability: 1 }];
    const merged = new Map();
    for (const discarded of outgoing) for (const branch of resolution(next, discarded.card)) {
      const id = ids.get(key(branch.hand));
      merged.set(id, (merged.get(id) || 0) + discarded.probability * branch.probability);
    }
    const entries = Array.from(merged);
    if (Math.abs(entries.reduce((sum, x) => sum + x[1], 0) - 1) > 1e-9) throw new Error('Invalid probability mass');
    return entries;
  });
}));
function advance(values, canFinish, turnCost = 0) {
  return hands.map((hand, id) => {
    if (canFinish && ready(hand)) return 0;
    return turnCost + draw.reduce((sum, incoming, i) => sum + incoming.probability * Math.min(...transitions[id][i].map(edges => edges.reduce((value, [next, p]) => value + p * values[next], 0))), 0);
  });
}
// Between our future turns, known cards can leave on an opponent's discard.
// The reference distribution favors high discards; live next-cycle openings
// are forecast separately from the actual opponent hand and remembered pool.
const discardWeights = [.1,1,.25,.35,.6,.8,1,1.2,1.4,1.6,1.8,1.8,1.8,2];
const mass = draw.reduce((n,d) => n+d.probability*discardWeights[d.card],0);
const openings = draw.map(d => ({...d,probability:d.probability*discardWeights[d.card]/mass}));
function interveningCycle(values) {
  return hands.map((hand,id) => {
    if (ready(hand)) return 0;
    return openings.reduce((v,d) => {
      const at=throwIndex(hand,d.card);
      if(at<0)return v+d.probability*values[id];
      let branches=[{hand:hand.filter((_,i)=>i!==at),probability:1}];
      if(hand[at]===Q)branches=peek(branches);
      const thrown=branches.reduce((n,b)=>n+b.probability*values[ids.get(key(b.hand))],0);
      return v+d.probability*(.7*thrown+.3*values[id]);
    },0);
  });
}
const raw = hands.map(score);
const finish = [hands.map(hand => ready(hand) ? 0 : score(hand))];
for (let turn = 1; turn <= 3; turn++) finish.push(advance(turn > 1 ? interveningCycle(finish.at(-1)) : finish.at(-1), true, 1));
const finalTurn = advance(raw, false);
const output = {
  schema: 1,
  assumptions: { maxCards: 4, unknownClass: U, ownThrowProbability, deck: 'one uniform deck', futureTurnCost: 1, opponentActions: 'actual next cycle at runtime; one reference discard between future own turns', referenceDiscardWeights: discardWeights, referenceThrowProbability: .7, aceAndJack: 'external targets evaluated at runtime', unknowns: 'independent marginal draws' },
  values: Object.fromEntries(hands.map((hand, id) => [key(hand), [finalTurn[id], ...finish.slice(1).map(values => values[id])].map(n => Math.round(n * 1e6) / 1e6)]))
};
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1]) : path.join(__dirname, '../lib/bot-hand-values.json');
fs.writeFileSync(outputPath, JSON.stringify(output) + '\n');
console.log(`Built ${hands.length} hand compositions.`);
