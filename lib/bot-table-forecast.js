const { cardPoints, HALVING_TOTALS } = require('../public/shared.js');
const clamp = n => Math.max(0, Math.min(1, n));
const score = hand => hand.reduce((n, slot) => n + slot.expected, 0);
const after = (total, value) => HALVING_TOTALS.includes(total + value) ? (total + value) / 2 : total + value;
const signature = hand => hand.map(s => `${s.card ? s.card.rank + ':' + s.expected : '?' + s.expected.toFixed(2)}:${s.ownerKnows ?? .5}`).join(',');
const cardKey = card => card ? card.rank + ':' + cardPoints(card) : '-';

// This is a belief forecast, not a simulated opponent with access to hidden
// faces. Each choice is selected BEFORE its unresolved outgoing card is revealed.
function createTableForecast(scoreDistribution) {
  function turn(ctx, player, top) {
    const hand = ctx.hands.get(player.id);
    const publicLow = Math.min(14, ...ctx.players.filter(p => p.id!==player.id && p.id!==ctx.round.dutchCallerId).flatMap(p => ctx.hands.get(p.id)).filter(s=>s.card && s.memory?.publicSeen).map(s=>s.expected));
    const baseKey = `table:${player.id}:${signature(hand)}:${publicLow}`;
    const cacheKey = `${baseKey}:${cardKey(top)}`;
    if (ctx.cycleMemo.has(cacheKey)) return ctx.cycleMemo.get(cacheKey);
    const distribution = h => scoreDistribution(h);
    const assessmentCache = new Map();
    function assess(h) {
      const k = signature(h);
      if (assessmentCache.has(k)) return assessmentCache.get(k);
      const outcomes = distribution(h);
      const knowledge = h.reduce((p, s) => p * (s.ownerKnows ?? .5), 1);
      const low = outcomes.reduce((p, s) => p + (s.value <= 5 ? s.probability : 0), 0);
      const zero = outcomes.reduce((p, s) => p + (s.value === 0 ? s.probability : 0), 0);
      const wrongHalf = outcomes.reduce((p, s) => p + (s.value > 5 && after(player.total, 2 * s.value) < Math.min(player.total, after(player.total, s.value)) ? s.probability : 0), 0);
      const raw = score(h);
      const result = { call: clamp(knowledge * (zero + .8 * (low - zero) + .9 * wrongHalf)), zero,
        raw, total: outcomes.reduce((n, s) => n + s.probability * after(player.total, s.value), 0),
        utility: -raw + 8 * low * knowledge - 2 * h.reduce((n, s) => n + 1 - (s.ownerKnows ?? .5), 0) };
      assessmentCache.set(k,result);
      return result;
    }
    function resolve(next, discarded) {
      let h = next.slice(), attack = 0;
      const specials = [discarded.rank];
      // Only remembered matches can be placed in a definite slot. Unseen cards
      // retain their distribution rather than receiving an oracle throw.
      const matching = h.map((s, i) => ({ s, i })).filter(({s}) => s.card?.rank === discarded.rank && (s.expected > 0 || h.length === 1)).sort((a,b) => b.s.expected - a.s.expected)[0];
      const throwChance = matching ? (matching.s.ownerKnows ?? .5) * .9 : 0;
      const branches = [{ h, probability: 1 - throwChance, specials }];
      if (matching) branches.push({ h: h.filter((_,i) => i !== matching.i), probability: throwChance, specials: specials.concat(matching.s.card.rank) });
      return branches.map(branch => {
        h = branch.h;
        attack = 0;
        for (const rank of branch.specials) {
          if (rank === 'Q') {
            const index = h.reduce((at,s,i) => at < 0 || (s.ownerKnows ?? .5) < (h[at].ownerKnows ?? .5) ? i : at, -1);
            if (index >= 0) h = h.map((s,i) => i === index ? { ...s, ownerKnows: 1 } : s);
          }
          if (rank === 'A' && !ctx.final) attack += 6.5 / Math.max(1, ctx.players.length - 1);
          if (rank === 'J' && !ctx.final) {
            // Public low placements are available to every player. A private
            // Queen observation by Roswell is never handed to an opponent.
            const publicLow = ctx.players.filter(p => p.id !== player.id && p.id !== ctx.round.dutchCallerId)
              .flatMap(p => ctx.hands.get(p.id)).filter(s => s.card && s.memory?.publicSeen)
              .sort((a,b) => a.expected - b.expected)[0];
            if (publicLow) {
              const i = h.reduce((best,s,index) => best < 0 || s.expected > h[best].expected ? index : best, -1);
              if (i >= 0 && h[i].expected > publicLow.expected) {
                if (publicLow.player?.id === ctx.bot.id) attack += h[i].expected - publicLow.expected;
                h = h.map((s,index) => index === i ? { ...publicLow, ownerKnows: 1 } : s);
              }
            }
          }
        }
        return { ...assess(h), attack, probability: branch.probability };
      });
    }
    function response(incoming, required) {
      let best;
      const seen = new Set();
      for (const index of [...(required ? [] : [-1]), ...hand.map((_,i) => i)]) {
        const identity = index < 0 ? '-' : signature([hand[index]]);
        if (seen.has(identity)) continue;
        seen.add(identity);
        const next = index < 0 ? hand : hand.map((s,i) => i === index ? { ...s, card: incoming, expected: cardPoints(incoming), ownerKnows: 1, distribution: [{value:cardPoints(incoming),probability:1}] } : s);
        const outgoing = index < 0 ? [{card:incoming, probability:1}] : hand[index].card ? [{card:hand[index].card,probability:1}] : hand[index].distribution;
        // Select an opponent response with cheap, public-information rules;
        // expand unresolved outgoing faces only for the selected response.
        // This keeps each table cycle bounded even after many Ace attacks.
        let utility = -score(next)-3*next.reduce((n,s)=>n+1-(s.ownerKnows ?? .5),0);
        for(const d of outgoing) {
          const match=next.filter(s=>s.card?.rank===d.card?.rank && (s.expected>0 || next.length===1)).sort((a,b)=>b.expected-a.expected)[0];
          if(match)utility+=d.probability*.9*(match.ownerKnows ?? .5)*(match.expected+2);
          if(d.card?.rank==='Q')utility+=d.probability*3*Math.min(1,next.reduce((n,s)=>n+1-(s.ownerKnows ?? .5),0));
          if(d.card?.rank==='A')utility+=d.probability*1.5;
        }
        if(next.every(s=>s.card && s.ownerKnows===1)) {
          const raw=score(next);
          if(raw<=5)utility+=8;
          if(raw>0)utility+=.5*Math.max(0,player.total-Math.min(after(player.total,raw),raw>5?after(player.total,2*raw):Infinity));
        }
        if (!best || utility > best.utility) best = {next,outgoing,utility};
      }
      const result = {call:0,zero:0,raw:0,total:0,utility:best.utility,attack:0,tops:[]};
      for(const d of best.outgoing) {
        if(!d.card)continue;
        result.tops.push({card:d.card,probability:d.probability});
        for(const branch of resolve(best.next,d.card))for(const field of ['call','zero','raw','total','attack'])result[field]+=d.probability*branch.probability*branch[field];
      }
      return result;
    }
    if (!hand.length || hand.length > 4) {
      const result = {...assess(hand),attack:0,tops:ctx.draw};
      ctx.cycleMemo.set(cacheKey,result); return result;
    }
    // The deck branch is identical for every possible pile face. Reuse it
    // across those comparisons instead of rebuilding the same 14 draws.
    let deck = ctx.cycleMemo.get(baseKey+':deck');
    if (!deck) {
      deck = {call:0,zero:0,raw:0,total:0,utility:0,attack:0,tops:[]};
      for (const d of ctx.draw) {
        const r = response(d.card,false);
        for (const field of ['call','zero','raw','total','utility','attack']) deck[field] += d.probability * r[field];
        deck.tops.push(...r.tops.map(t => ({...t,probability:t.probability*d.probability})));
      }
      ctx.cycleMemo.set(baseKey+':deck',deck);
    }
    const pile = top ? response(top,true) : null;
    const result = { ...(pile && pile.utility > deck.utility + .25 ? pile : deck) };
    const tops = new Map();
    for (const t of result.tops) {
      const k = cardKey(t.card), prev=tops.get(k);
      tops.set(k,{card:t.card,probability:t.probability+(prev?.probability || 0)});
    }
    result.tops = [...tops.values()].sort((a,b)=>b.probability-a.probability);
    ctx.cycleMemo.set(cacheKey,result);
    return result;
  }
  function cycle(ctx, top) {
    const openings = [];
    let none=1, attacks=0, zero=0, tops=[{card:top,probability:1}];
    for (const player of ctx.others) {
      let call=0, attack=0, z=0;
      const next=[];
      // Keep the most likely outgoing pile face. The residual uses a
      // deck-only response, bounding multi-player work without duplicating a gift.
      for (const t of tops) {
        const r=turn(ctx,player,t.card);
        call+=t.probability*r.call; attack+=t.probability*r.attack; z+=t.probability*r.zero;
        next.push(...r.tops.map(x=>({...x,probability:x.probability*t.probability})));
      }
      openings.push(...next.map(t => ({...t, playerId:player.id})));
      attacks+=none*attack; zero=1-(1-zero)*(1-z); none*=1-call;
      const merged=new Map();
      for(const t of next){const k=cardKey(t.card);const p=merged.get(k)?.probability || 0;merged.set(k,{...t,probability:p+t.probability});}
      tops=[...merged.values()].sort((a,b)=>b.probability-a.probability).slice(0,1);
      const mass=tops.reduce((p,t)=>p+t.probability,0);if(mass<1)tops.push({card:null,probability:1-mass});
    }
    return {callChance:1-none,attackCost:attacks,zeroChance:zero,openings};
  }
  return {turn,cycle};
}
module.exports={createTableForecast};
