const { cardPoints, HALVING_TOTALS, isRedSuit } = require('../public/shared.js');
const { botProfile } = require('./bot-strategy.js');

const clamp = (n, low = 0, high = 1) => Math.max(low, Math.min(high, n));
const points = card => cardPoints(card);
const key = card => card.rank === 'K' ? `K:${isRedSuit(card.suit) ? 'red' : 'black'}` : card.rank;
const redKing = card => card && card.rank === 'K' && isRedSuit(card.suit);
const special = card => card && ['A', 'Q', 'J'].includes(card.rank);
const scoreAfter = (total, score) => {
  const next = total + score;
  return HALVING_TOTALS.includes(next) ? next / 2 : next;
};
const mean = distribution => distribution.reduce((sum, item) => sum + item.probability * item.value, 0);
const expected = hand => hand.reduce((sum, slot) => sum + slot.expected, 0);
const knownScore = hand => hand.every(slot => slot.card) ? expected(hand) : null;
const handKey = hand => hand.map(slot => slot.card ? key(slot.card) : `?:${slot.expected.toFixed(3)}:${slot.informed ? 1 : 0}`).join(',');

function normalize(entries) {
  const total = entries.reduce((sum, entry) => sum + entry.probability, 0);
  return total ? entries.filter(entry => entry.probability > 0).map(entry => ({ ...entry, probability: entry.probability / total })) : [];
}

const distributionCache = new WeakMap();
function scoreDistribution(hand, limit = Infinity) {
  let cached = distributionCache.get(hand);
  if (cached?.has(limit)) return cached.get(limit);
  let result = [{ value: 0, probability: 1 }];
  for (const slot of hand) {
    const next = new Map();
    const outcomes = slot.card ? [{ value: points(slot.card), probability: 1 }] : slot.distribution;
    for (const a of result) for (const b of outcomes) {
      const value = a.value + b.value;
      if (value <= limit) next.set(value, (next.get(value) || 0) + a.probability * b.probability);
    }
    result = Array.from(next, ([value, probability]) => ({ value, probability }));
  }
  if (!cached) distributionCache.set(hand, cached = new Map());
  cached.set(limit, result);
  return result;
}

function createSimpleTactics(deps) {
  const diagnostics = new WeakMap();
  const state = deps.getState;
  const protectedTarget = id => !!(state().round && state().round.dutchCallerId === id);
  const best = actions => actions.reduce((chosen, action) => !chosen || action.utility > chosen.utility + 1e-9 ? action : chosen, null);

  function context(bot) {
    const current = state();
    const profile = botProfile(bot);
    const raw = deps.remainingCards(bot);
    const groups = new Map();
    for (const card of raw) {
      const entry = groups.get(key(card)) || { card: { rank: card.rank, suit: card.suit }, count: 0 };
      entry.count += 1;
      groups.set(key(card), entry);
    }
    const draw = Array.from(groups.values(), entry => ({ ...entry, probability: entry.count / Math.max(1, raw.length) }));
    // An exhausted/contradictory remembered pool is uncertainty, not a known six.
    if (!draw.length) {
      for (const rank of ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q']) draw.push({ card: { rank, suit: 'clubs' }, count: 4, probability: 4 / 52 });
      draw.push({ card: { rank: 'K', suit: 'hearts' }, count: 2, probability: 2 / 52 }, { card: { rank: 'K', suit: 'clubs' }, count: 2, probability: 2 / 52 });
    }
    const players = deps.activePlayablePlayers();
    const ownMean = deps.unknownExpectedPoints(bot);
    function slotsFor(player) {
      return deps.playerSlots(bot, player).map(slot => {
        if (slot.card) return { ...slot, expected: points(slot.card), distribution: [{ value: points(slot.card), probability: 1 }] };
        const source = String(slot.memory.source || '').toLowerCase();
        const selected = player.id !== bot.id && source.includes('deck swap');
        // Retention is evidence, not certainty. No opponent-private card values
        // or their actual hidden cards are read by the planner.
        const tilt = selected ? -0.10 : player.id === bot.id && profile.expectedUnknownValue !== 'counted' ? (ownMean - 6.5) * 0.10 : 0;
        const distribution = normalize(draw.map(item => ({ value: points(item.card), card: item.card, probability: item.probability * Math.exp(tilt * points(item.card)) })));
        return { ...slot, expected: player.id === bot.id ? ownMean : mean(distribution), distribution, ownerKnows: selected ? 1 : 0.5 };
      });
    }
    const hands = new Map(players.map(player => [player.id, slotsFor(player)]));
    const own = hands.get(bot.id) || [];
    const seat = players.findIndex(player => player.id === bot.id);
    const others = players.slice(seat + 1).concat(players.slice(0, seat));
    const ctx = {
      bot, profile, players, own, others, hands, draw, round: current.round || {},
      totalCards: draw.reduce((sum, item) => sum + item.count, 0),
      nodes: 0, budget: Math.max(100, profile.lookaheadNodeBudget || 1800),
      memo: new Map(), final: !!(current.round && current.round.dutchCallerId),
      target: current.gameTarget || 100, knowledge: profile.tacticalKnowledgeValue ?? 5,
      opponentWeight: profile.tacticalOpponentWeight ?? 0.55,
      threat: 0
    };
    const risks = others.map(player => {
      const hand = hands.get(player.id);
      const low = scoreDistribution(hand, 5).reduce((sum, item) => sum + item.probability, 0);
      return clamp(low * 0.8 + (hand.length <= 2 ? 0.2 : 0) + (hand.length <= 1 ? 0.2 : 0));
    });
    ctx.threat = 1 - risks.reduce((none, risk) => none * (1 - risk), 1);
    return ctx;
  }

  function finishDiagnostics(ctx) {
    diagnostics.set(ctx.bot, { nodes: ctx.nodes, budget: ctx.budget, turns: ctx.profile.lookaheadTurns || 2, plans: 0 });
  }

  function knownSlot(card, previous = {}) {
    return { ...previous, card, known: true, informed: true, expected: points(card), distribution: [{ value: points(card), probability: 1 }] };
  }

  function withoutDraw(ctx, incoming) {
    if (ctx.round.drawn?.playerId === ctx.bot.id && ctx.round.drawn.source === 'deck' && key(ctx.round.drawn.card) === key(incoming)) return ctx.draw;
    const available = ctx.draw.map(item => ({ ...item, count: Math.max(0, item.count - (key(item.card) === key(incoming) ? 1 : 0)) }));
    const total = available.reduce((sum, item) => sum + item.count, 0);
    return total ? available.filter(item => item.count).map(item => ({ ...item, probability: item.count / total })) : ctx.draw;
  }

  function afterReplacement(hand, incoming, index) {
    return hand.map((slot, i) => i === index ? knownSlot(incoming, slot) : slot);
  }

  function relevantWeight(ctx, player) {
    if (ctx.others.length === 1) return 1;
    const lowTotal = Math.min(...ctx.others.map(other => other.total));
    const hand = ctx.hands.get(player.id);
    return 0.25 + 0.45 / (1 + (player.total - lowTotal) / 15) + 0.3 / (1 + expected(hand) / 8);
  }

  function finalTurnPending(ctx, player) {
    if (!ctx.final || player.id === ctx.round.dutchCallerId) return !ctx.final;
    const current = ctx.players[ctx.round.currentPlayerIndex];
    return current?.id === player.id && !ctx.round.turnComplete || (ctx.round.dutchQueue || []).includes(player.id);
  }

  function matchingIndex(hand, rank) {
    let index = -1;
    hand.forEach((slot, i) => {
      if (slot.card?.rank === rank && (index < 0 || slot.expected > hand[index].expected)) index = i;
    });
    return index;
  }

  function throwRace(ctx, hand, discard, ownerId = ctx.bot.id) {
    const ownIndex = matchingIndex(hand, discard.rank);
    const canOwn = ownIndex >= 0 && (!redKing(hand[ownIndex].card) || hand.length === 1);
    let none = 1;
    let rivalBenefit = 0;
    let rivalSpecial = 0;
    for (const player of ctx.players) {
      if (player.id === ownerId) continue;
      const slots = ctx.hands.get(player.id);
      let noMatch = 1;
      let benefit = 0;
      for (const slot of slots) {
        const probability = slot.card ? (slot.card.rank === discard.rank && !redKing(slot.card) ? 1 : 0)
          : slot.distribution.filter(item => item.card?.rank === discard.rank && !redKing(item.card)).reduce((sum, item) => sum + item.probability, 0) * (slot.ownerKnows || 0.5);
        noMatch *= 1 - probability;
        benefit = Math.max(benefit, slot.card ? slot.expected : points(discard));
      }
      const match = 1 - noMatch;
      const wins = player.isBot ? 0.5 : 1;
      none *= 1 - match * wins;
      const relevance = player.id === ctx.bot.id ? 1 : relevantWeight(ctx, player);
      rivalBenefit = Math.max(rivalBenefit, match * (benefit + (slots.length === 1 ? 5 : 1)) * relevance);
      if (match && special(discard)) rivalSpecial = Math.max(rivalSpecial, match * (discard.rank === 'A' && !ctx.final ? deps.unknownExpectedPoints(ctx.bot) + ctx.knowledge : discard.rank === 'J' && !ctx.final ? 3 : 0));
    }
    return { index: canOwn ? ownIndex : -1, probability: canOwn ? none : 0, opponentCost: rivalBenefit, rivalSpecial };
  }

  // Forecast a single opponent's final turn without giving it access to the
  // bot's private cards. Known placements are exact; unknown slots stay distributions.
  function opponentFinish(ctx, player, top, threshold, terminalTotal = null) {
    const hand = ctx.hands.get(player.id);
    if (!hand.length) return [{ value: 0, probability: 1 }];
    const quality = distribution => distribution.reduce((sum, item) => {
      if (terminalTotal !== null) {
        const total = scoreAfter(player.total, item.value);
        return sum + item.probability * ((total <= terminalTotal ? 150 : 0) - total);
      }
      return sum + item.probability * ((item.value < threshold ? 30 : 0) - item.value);
    }, 0);
    function response(incoming, required) {
      const choices = [];
      for (const index of [...(required ? [] : [-1]), ...hand.map((_, i) => i)]) {
        let next = index < 0 ? hand.slice() : afterReplacement(hand, incoming, index);
        const discard = index < 0 ? incoming : hand[index].card;
        const match = discard && matchingIndex(next, discard.rank);
        if (Number.isInteger(match) && match >= 0 && !redKing(next[match].card)) next = next.filter((_, i) => i !== match);
        if (discard?.rank === 'J') {
          let selected = null;
          for (const other of ctx.others) {
            if (other.id === player.id || protectedTarget(other.id)) continue;
            for (const low of ctx.hands.get(other.id)) if (low.card) {
              next.forEach((own, i) => {
                const gain = own.expected - low.expected;
                if (gain > (selected?.gain || 0)) selected = { i, low, gain };
              });
            }
          }
          if (selected) next = next.map((slot, i) => i === selected.i ? selected.low : slot);
        }
        // Only the low tail determines call failure. Preserve the exact mean
        // of the other outcomes as one tail bucket instead of convolving them.
        const distribution = scoreDistribution(next, threshold - 1).slice();
        const mass = distribution.reduce((sum, item) => sum + item.probability, 0);
        if (mass < 1 - 1e-12) distribution.push({ value: (expected(next) - mean(distribution)) / (1 - mass), probability: 1 - mass });
        choices.push({ distribution, utility: quality(distribution) });
      }
      return best(choices).distribution;
    }
    const deck = ctx.draw.flatMap(item => response(item.card, false).map(outcome => ({ ...outcome, probability: outcome.probability * item.probability })));
    const pile = top ? response(top, true) : null;
    return pile && quality(pile) > quality(deck) ? pile : deck;
  }

  function callAssessment(ctx, hand = ctx.own, top = ctx.round.discard?.at(-1)) {
    const score = knownScore(hand);
    if (score === null || score > 5) return { score, probability: 0, cost: Infinity, call: false };
    if (score === 0) return { score, probability: 1, cost: scoreAfter(ctx.bot.total, 0), call: true };
    const cacheKey = `call:${score}:${top ? key(top) : '-'}:${ctx.others.map(p => handKey(ctx.hands.get(p.id))).join('/')}`;
    if (ctx.memo.has(cacheKey)) return ctx.memo.get(cacheKey);
    let probability = 1;
    ctx.others.forEach((player, index) => {
      // Only the next player is guaranteed access to this pile card. Later
      // players receive a draw forecast rather than the same gifted card.
      const final = opponentFinish(ctx, player, index === 0 ? top : null, score);
      probability *= 1 - final.reduce((sum, item) => sum + (item.value < score ? item.probability : 0), 0);
    });
    const cost = probability * scoreAfter(ctx.bot.total, 0) + (1 - probability) * scoreAfter(ctx.bot.total, 2 * score);
    const ordinary = scoreAfter(ctx.bot.total, score);
    const nextGain = ctx.draw.reduce((sum, item) => sum + item.probability * Math.max(0, ...hand.map(slot => slot.expected - points(item.card))), 0);
    const waitCost = Math.min(ordinary, ctx.bot.total + Math.max(0, score - nextGain * (1 - ctx.threat) * 0.65));
    const minimum = score <= 1 ? 0.55 : (ctx.profile.tacticalCallMinimum ?? 0.80) - ctx.threat * 0.12;
    const result = { score, probability, cost, waitCost, call: probability >= minimum && cost + 0.25 < waitCost };
    ctx.memo.set(cacheKey, result);
    return result;
  }

  function halvingPlan(ctx, hand = ctx.own) {
    const score = knownScore(hand);
    if (!ctx.profile.scoreHalvingAttempts || score === null) return null;
    const ordinary = scoreAfter(ctx.bot.total, score);
    const plans = [];
    if (score > 0 && ctx.round.dutchCallerId !== ctx.bot.id && HALVING_TOTALS.includes(ctx.bot.total + score) && ordinary < ctx.bot.total + Math.min(score, 5)) {
      plans.push({ type: 'ordinary', desiredHandScore: score, target: ctx.bot.total + score, result: ordinary, utility: ctx.bot.total - ordinary });
    }
    if ((!ctx.final || ctx.round.dutchCallerId === ctx.bot.id) && score > 5 && HALVING_TOTALS.includes(ctx.bot.total + score * 2)) {
      const result = scoreAfter(ctx.bot.total, score * 2);
      if (result < Math.min(ordinary, ctx.bot.total)) plans.push({ type: 'wrong-dutch', desiredHandScore: score, target: ctx.bot.total + score * 2, result, utility: ctx.bot.total - result + 0.01 });
    }
    return best(plans);
  }

  function terminalCallAssessment(ctx, hand = ctx.own, top = ctx.round.discard?.at(-1)) {
    const score = knownScore(hand);
    const fixedEnd = state().roundLimit > 0 && state().roundNumber >= state().roundLimit;
    if (ctx.final || score === null || ctx.others.some(player => ctx.hands.get(player.id).length > 10)) return null;
    const failedTotal = scoreAfter(ctx.bot.total, 2 * score);
    if (!fixedEnd && !(score > 5 && failedTotal > ctx.target)) return null;
    const cacheKey = `terminal:${score}:${top ? key(top) : '-'}`;
    if (ctx.memo.has(cacheKey)) return ctx.memo.get(cacheKey);
    const successTotal = scoreAfter(ctx.bot.total, 0);
    if (score > 5 && ctx.others.some(player => {
      const current = scoreDistribution(ctx.hands.get(player.id));
      return current.reduce((sum, item) => sum + (scoreAfter(player.total, item.value) > failedTotal ? item.probability : 0), 0) < 0.98;
    })) {
      ctx.memo.set(cacheKey, null);
      return null;
    }
    let success = score <= 5 ? 1 : 0, winSuccess = success, winAtFailedTotal = 1, winAtFailedTotalAndSuccess = success;
    ctx.others.forEach((player, index) => {
      // Keep every outcome that could cross a winning or halving boundary.
      const relevantHalvings = HALVING_TOTALS.filter(total => total / 2 <= Math.max(failedTotal, successTotal));
      const limit = Math.max(score, failedTotal - player.total + 1, successTotal - player.total + 1, ...relevantHalvings.map(total => total - player.total + 1));
      const outcomes = opponentFinish(ctx, player, index === 0 ? top : null, limit, failedTotal);
      const probability = predicate => outcomes.reduce((sum, item) => sum + (predicate(item.value) ? item.probability : 0), 0);
      success *= probability(value => value >= score);
      winSuccess *= probability(value => value >= score && scoreAfter(player.total, value) > successTotal);
      winAtFailedTotal *= probability(value => scoreAfter(player.total, value) > failedTotal);
      winAtFailedTotalAndSuccess *= probability(value => value >= score && scoreAfter(player.total, value) > failedTotal);
    });
    const probability = clamp(winSuccess + winAtFailedTotal - winAtFailedTotalAndSuccess);
    const result = { score, probability, cost: success * successTotal + (1 - success) * failedTotal, call: probability >= 0.98 };
    ctx.memo.set(cacheKey, result);
    return result;
  }

  function ownTotalCost(ctx, hand, top) {
    const score = knownScore(hand);
    const distribution = scoreDistribution(hand);
    let cost = distribution.reduce((sum, item) => sum + item.probability * scoreAfter(ctx.bot.total, item.value), 0);
    if (!ctx.final) {
      // Non-caller halvings still need someone to end the round. Value misses
      // and waiting explicitly instead of treating a temporary exact sum as secured.
      cost = distribution.reduce((sum, item) => {
        const raw = ctx.bot.total + item.value;
        const finishChance = 0.45 + ctx.threat * 0.5;
        return sum + item.probability * (raw - (raw - scoreAfter(ctx.bot.total, item.value)) * finishChance);
      }, 0);
      if (score !== null && score <= 5) {
        const call = callAssessment(ctx, hand, top);
        if (call.call) cost = Math.min(cost, call.cost);
      }
      const plan = halvingPlan(ctx, hand);
      if (plan?.type === 'wrong-dutch') cost = Math.min(cost, plan.result);
    }
    if (ctx.round.dutchCallerId === ctx.bot.id) {
      if (score !== null && score > 5) cost = scoreAfter(ctx.bot.total, 2 * score);
      else if (score !== null) {
        let success = 1;
        for (const player of ctx.others) success *= 1 - scoreDistribution(ctx.hands.get(player.id), score - 1).reduce((sum, item) => sum + item.probability, 0);
        cost = success * scoreAfter(ctx.bot.total, 0) + (1 - success) * scoreAfter(ctx.bot.total, 2 * score);
      }
    }
    return cost;
  }

  function positionValue(ctx, hand, top, rivalDelta = 0) {
    const cacheKey = `value:${handKey(hand)}:${top ? key(top) : '-'}:${rivalDelta.toFixed(3)}`;
    if (ctx.memo.has(cacheKey)) return ctx.memo.get(cacheKey);
    const cost = ownTotalCost(ctx, hand, top);
    const unknowns = hand.filter(slot => !slot.card && !slot.informed).length;
    const knowledge = ctx.final ? 0 : ctx.knowledge * (1 - ctx.threat * 0.7);
    let value = -cost - unknowns * knowledge + rivalDelta * ctx.opponentWeight;
    if (!ctx.final) {
      const terminal = terminalCallAssessment(ctx, hand, top);
      if (terminal?.call) value = -terminal.cost + 150 * (2 * terminal.probability - 1);
    }
    // Known terminal totals take precedence over a point-saving heuristic.
    if (ctx.final && ctx.hands.size && hand.every(slot => slot.card) && ctx.others.every(player => ctx.hands.get(player.id).every(slot => slot.card))) {
      const ownScore = expected(hand);
      const raw = new Map(ctx.players.map(player => [player.id, player.id === ctx.bot.id ? ownScore : expected(ctx.hands.get(player.id))]));
      const min = Math.min(...raw.values());
      const totals = ctx.players.map(player => {
        const s = raw.get(player.id);
        return { id: player.id, total: scoreAfter(player.total, player.id === ctx.round.dutchCallerId ? s <= 5 && s === min ? 0 : 2 * s : s) };
      });
      const ending = totals.some(player => player.total > ctx.target) || (state().roundLimit > 0 && state().roundNumber >= state().roundLimit);
      if (ending) {
        const ours = totals.find(player => player.id === ctx.bot.id).total;
        const lower = Math.min(...totals.filter(player => player.id !== ctx.bot.id).map(player => player.total));
        value += ours < lower ? 150 : ours > lower ? -150 : 0;
      }
    }
    ctx.memo.set(cacheKey, value);
    return value;
  }

  function bestJack(ctx, hand = ctx.own) {
    const candidates = [];
    for (const opponent of ctx.others) {
      if (protectedTarget(opponent.id) || protectedTarget(ctx.bot.id)) continue;
      const repair = ctx.final && !finalTurnPending(ctx, opponent) ? 1 : 0.65;
      for (const b of ctx.hands.get(opponent.id)) {
        if (!b.card) continue;
        for (const a of hand) {
          const gain = a.expected - b.expected;
          const knowledge = !a.card && !ctx.final ? ctx.knowledge * (1 - ctx.threat * 0.7) : 0;
          const opponentBefore = expected(ctx.hands.get(opponent.id));
          const opponentGain = scoreAfter(opponent.total, opponentBefore + gain) - scoreAfter(opponent.total, opponentBefore);
          const utility = gain + knowledge + opponentGain * ctx.opponentWeight * relevantWeight(ctx, opponent) * repair;
          if (utility > 0 && (gain >= 0 || knowledge > -gain)) candidates.push({ a, b, type: 'self', utility, actionValue: utility, eligible: true });
        }
      }
    }
    for (let i = 0; i < ctx.others.length; i++) for (let j = i + 1; j < ctx.others.length; j++) {
      const first = ctx.others[i], second = ctx.others[j];
      if (protectedTarget(first.id) || protectedTarget(second.id)) continue;
      for (const a of ctx.hands.get(first.id)) for (const b of ctx.hands.get(second.id)) {
        if (!a.card || !b.card) continue;
        const shift = b.expected - a.expected;
        const utility = shift * (relevantWeight(ctx, first) - relevantWeight(ctx, second)) * ctx.opponentWeight;
        if (utility > 0.25) candidates.push({ a, b, type: 'opponents', utility, actionValue: utility, eligible: true });
      }
    }
    return candidates.sort((a, b) => b.utility - a.utility);
  }

  function aceTargets(ctx) {
    return ctx.others.filter(player => !protectedTarget(player.id)).map(player => {
      const hand = ctx.hands.get(player.id);
      const scores = scoreDistribution(hand);
      const before = scores.reduce((sum, item) => sum + item.probability * scoreAfter(player.total, item.value), 0);
      const after = scores.reduce((sum, item) => sum + item.probability * ctx.draw.reduce((value, draw) => value + draw.probability * scoreAfter(player.total, item.value + points(draw.card)), 0), 0);
      const urgency = !ctx.final ? scoreDistribution(hand, 5).reduce((sum, item) => sum + item.probability, 0) * 4 : 0;
      const repair = ctx.final && !finalTurnPending(ctx, player) ? 1 : 0.7;
      const utility = (after - before) * relevantWeight(ctx, player) * repair + urgency;
      return { player, utility, actionValue: utility, aceScore: utility, eligible: utility > 0 };
    }).filter(target => target.eligible).sort((a, b) => b.utility - a.utility);
  }

  function applyOwnSpecial(ctx, hand, card, rivalDelta) {
    const branch = { ctx, hand, rivalDelta, probability: 1 };
    if (!special(card)) return [branch];
    if (card.rank === 'A') {
      const attack = aceTargets(ctx)[0];
      if (!attack) return [branch];
      const hands = new Map(ctx.hands);
      const distribution = ctx.draw.map(draw => ({ card: draw.card, value: points(draw.card), probability: draw.probability }));
      hands.set(attack.player.id, hands.get(attack.player.id).concat({ card: null, expected: mean(distribution), distribution, ownerKnows: 0 }));
      return [{ ...branch, ctx: { ...ctx, hands, memo: new Map() }, rivalDelta: rivalDelta + attack.utility }];
    }
    if (card.rank === 'J') {
      const swap = bestJack(ctx, hand)[0];
      if (!swap) return [branch];
      const hands = new Map(ctx.hands);
      if (swap.type !== 'self') {
        hands.set(swap.a.player.id, hands.get(swap.a.player.id).map(slot => slot.index === swap.a.index ? { ...swap.b, player: swap.a.player, index: slot.index } : slot));
        hands.set(swap.b.player.id, hands.get(swap.b.player.id).map(slot => slot.index === swap.b.index ? { ...swap.a, player: swap.b.player, index: slot.index } : slot));
        return [{ ...branch, ctx: { ...ctx, hands, memo: new Map() }, rivalDelta: rivalDelta + swap.utility / ctx.opponentWeight }];
      }
      const next = hand.map(slot => slot === swap.a ? knownSlot(swap.b.card, slot) : slot);
      hands.set(swap.b.player.id, hands.get(swap.b.player.id).map(slot => slot.index === swap.b.index ? { ...swap.a, player: swap.b.player, index: slot.index } : slot));
      return [{ ...branch, hand: next, ctx: { ...ctx, hands, memo: new Map() }, rivalDelta: rivalDelta + (swap.a.expected - swap.b.expected) * relevantWeight(ctx, swap.b.player) * 0.65 }];
    }
    const unknowns = hand.filter(slot => !slot.card && !slot.informed);
    if (!unknowns.length || ctx.final) return [branch];
    const selected = unknowns.reduce((a, b) => a.expected >= b.expected ? a : b);
    if (unknowns.length === 1 && expected(hand) - selected.expected <= 5) {
      return selected.distribution.map(outcome => ({ ...branch, hand: hand.map(slot => slot === selected ? knownSlot(outcome.card, slot) : slot), probability: outcome.probability }));
    }
    return [{ ...branch, hand: hand.map(slot => slot === selected ? { ...slot, informed: true } : slot) }];
  }

  function specialOutcome(ctx, hand, discard, rivalDelta, thrown = null) {
    let branches = [{ ctx, hand, rivalDelta, probability: 1 }];
    for (const card of [discard, thrown].filter(Boolean)) {
      branches = branches.flatMap(branch => applyOwnSpecial(branch.ctx, branch.hand, card, branch.rivalDelta).map(next => ({ ...next, probability: branch.probability * next.probability })));
    }
    return branches.reduce((sum, branch) => sum + branch.probability * positionValue(branch.ctx, branch.hand, thrown || discard, branch.rivalDelta), 0);
  }

  function actionValue(ctx, hand, incoming, index, options = {}) {
    ctx.nodes += 1;
    const next = index < 0 ? hand.slice() : afterReplacement(hand, incoming, index);
    const outgoing = index < 0 ? [{ card: incoming, probability: 1 }] : hand[index].card
      ? [{ card: hand[index].card, probability: 1 }]
      : hand[index].distribution;
    let utility = 0;
    // A penalty-heavy hand cannot finish soon. Limit it to immediate point,
    // information and matching-card gains rather than expanding special trees.
    // Actual Queen, Jack and Ace choices still use the normal decision rules.
    const crowded = hand.length > 10 || ctx.others.some(player => ctx.hands.get(player.id).length > 10);
    if (crowded) {
      utility = -expected(next) - next.filter(slot => !slot.card).length * ctx.knowledge;
      for (const outcome of outgoing) {
        const discard = outcome.card;
        if (!discard) continue;
        const race = throwRace(ctx, next, discard);
        let gain = race.index >= 0 ? race.probability * (next[race.index].expected + 2) : 0;
        if (discard.rank === 'Q' && next.some(slot => !slot.card)) gain += ctx.knowledge;
        if (discard.rank === 'J') gain += bestJack(ctx, next)[0]?.utility || 0;
        if (discard.rank === 'A' && ctx.others.some(player => !protectedTarget(player.id))) gain += deps.unknownExpectedPoints(ctx.bot) * ctx.opponentWeight;
        utility += outcome.probability * (gain - race.opponentCost * ctx.opponentWeight);
      }
      return { index, target: index < 0 ? null : hand[index], utility, actionValue: utility, improvement: index < 0 ? 0 : hand[index].expected - points(incoming), incoming, next };
    }
    for (const outcome of outgoing) {
      const discard = outcome.card;
      if (!discard) continue;
      const race = throwRace(ctx, next, discard);
      const plan = halvingPlan(ctx, next);
      const canThrow = race.index >= 0 && (!plan || knownScore(next) - next[race.index].expected === plan.desiredHandScore);
      const probability = canThrow ? race.probability : 0;
      const noOwn = specialOutcome(ctx, next, discard, -race.opponentCost);
      let own = noOwn;
      if (probability) {
        const thrown = next[race.index].card;
        const afterThrow = next.filter((_, i) => i !== race.index);
        own = specialOutcome(ctx, afterThrow, discard, 0, thrown);
      }
      const retaliation = !ctx.final ? race.rivalSpecial * (1 - probability) * 0.5 : 0;
      utility += outcome.probability * (probability * own + (1 - probability) * noOwn - retaliation);
      if (!ctx.final && !options.future && ctx.nodes < ctx.budget) {
        const nextPlayer = ctx.others[0];
        if (nextPlayer && points(discard) <= 5) {
          const highest = Math.max(0, ...ctx.hands.get(nextPlayer.id).map(slot => slot.expected));
          const gift = Math.max(0, highest - points(discard));
          utility -= outcome.probability * gift * relevantWeight(ctx, nextPlayer) * 0.12;
        }
      }
    }
    return { index, target: index < 0 ? null : hand[index], utility, actionValue: utility, improvement: index < 0 ? 0 : hand[index].expected - points(incoming), incoming, next };
  }

  function actionsFor(ctx, hand, incoming, required = false, options = {}) {
    const actions = [];
    if (!required) actions.push(actionValue(ctx, hand, incoming, -1, options));
    const seen = new Set();
    hand.forEach((slot, index) => {
      const signature = slot.card ? key(slot.card) : `?:${slot.expected}:${slot.memory?.source}`;
      if (seen.has(signature)) return;
      seen.add(signature);
      actions.push(actionValue(ctx, hand, incoming, index, options));
    });
    return actions;
  }

  function planActions(ctx, incoming, required = false) {
    const actions = actionsFor(ctx, ctx.own, incoming, required);
    if (ctx.final || ctx.profile.lookaheadTurns < 2 || ctx.threat > 0.75) return actions;
    const candidates = actions.slice().sort((a, b) => b.utility - a.utility).slice(0, ctx.profile.lookaheadBeamWidth || 3);
    // Extend only stable hands; uncertain outgoing/special branches already
    // have an information valuation and must not be treated as a known average.
    for (const action of candidates) {
      const outgoing = action.index < 0 ? incoming : ctx.own[action.index].card;
      if (!outgoing || special(outgoing) || action.next.some(slot => !slot.card) || matchingIndex(action.next, outgoing.rank) >= 0) continue;
      if (callAssessment(ctx, action.next, outgoing).call || terminalCallAssessment(ctx, action.next, outgoing)?.call || halvingPlan(ctx, action.next)?.type === 'wrong-dutch') continue;
      let gain = 0;
      const baseline = positionValue(ctx, action.next, outgoing);
      for (const draw of withoutDraw(ctx, incoming)) {
        if (ctx.nodes + action.next.length + 1 > ctx.budget) break;
        const response = best(actionsFor(ctx, action.next, draw.card, false, { future: true }));
        gain += draw.probability * Math.max(0, response.utility - baseline);
      }
      action.utility += gain * (ctx.profile.futureTurnWeight || 0.55) * (1 - ctx.threat);
      action.actionValue = action.utility;
    }
    return actions;
  }

  function selection(ctx, incoming, required) {
    const actions = planActions(ctx, incoming, required);
    const selected = best(actions);
    finishDiagnostics(ctx);
    return { selected, actions };
  }

  function evaluateDrawSources(bot) {
    const ctx = context(bot);
    const top = ctx.round.discard?.at(-1);
    const pile = top && ctx.own.length ? best(actionsFor(ctx, ctx.own, top, true)) : null;
    let deckValue = 0;
    for (const draw of ctx.draw) deckValue += draw.probability * best(actionsFor(ctx, ctx.own, draw.card)).utility;
    const deck = { actionType: 'take-deck', utility: deckValue, actionValue: deckValue };
    if (pile) pile.actionType = 'take-pile';
    // Small visible upgrades need to beat the deck's options clearly while
    // unresolved cards still need attention. A concrete finishing sequence wins on value.
    const margin = !ctx.final && ctx.own.some(slot => !slot.card) ? (ctx.profile.tacticalPileMargin ?? 0.35) : 0.1;
    // Exchanging equal cards while preserving an exact score makes no
    // progress. Two score-aware bots can otherwise repeat it forever.
    const idlePile = pile?.target?.card && key(pile.target.card) === key(top)
      && !special(top) && !!halvingPlan(ctx, pile.next);
    const selected = pile && !idlePile && pile.utility > deck.utility + margin ? pile : deck;
    finishDiagnostics(ctx);
    return { selected, pile, deck, actions: [pile, deck].filter(Boolean) };
  }

  function botBestSwapTarget(bot, incoming, options = {}) {
    if (!incoming) return null;
    const ctx = context(bot);
    const { selected } = selection(ctx, incoming, !!options.required);
    return selected?.target ? { ...selected.target, utility: selected.utility, actionValue: selected.utility, improvement: selected.improvement, eligible: true } : null;
  }

  function botQueenTargets(bot) {
    const ctx = context(bot);
    const canUseKnowledge = !ctx.final || !!ctx.round.throwIn?.open || (ctx.round.specialQueue || []).some(item => item.type === 'J' && item.actorId === bot.id);
    const ownUnknown = canUseKnowledge ? ctx.own.filter(slot => !slot.card).map(slot => ({ ...slot, utility: 4 + slot.expected / 10 + (ctx.own.filter(s => !s.card).length === 1 ? 3 : 0) })) : [];
    const opponentUnknown = canUseKnowledge ? ctx.others.flatMap(player => ctx.hands.get(player.id).filter(slot => !slot.card).map(slot => ({ ...slot, danger: relevantWeight(ctx, player), utility: relevantWeight(ctx, player) * 2 + (ctx.hands.get(player.id).length <= 2 ? 2 : 0) }))) : [];
    return { ownUnknown, opponentUnknown };
  }

  function botShouldCallDutch(bot) {
    const ctx = context(bot);
    if (ctx.final) return false;
    if (terminalCallAssessment(ctx)?.call) return true;
    const plan = halvingPlan(ctx);
    if (plan?.type === 'wrong-dutch') return true;
    if (plan?.type === 'ordinary') return false;
    const result = callAssessment(ctx);
    finishDiagnostics(ctx);
    const pending = ctx.round.stage === 'special' && ctx.round.specialQueue?.[0];
    if (result.call && result.score > 0 && pending?.actorId === bot.id) {
      const card = { rank: pending.type, suit: 'clubs' };
      if (specialOutcome(ctx, ctx.own, card, 0) > -result.cost + 0.25) return false;
    }
    return result.call;
  }

  function botThrowInCandidate(bot) {
    const ctx = context(bot);
    if (!ctx.round.throwIn?.open) return null;
    const plan = halvingPlan(ctx);
    const candidates = ctx.own.filter(slot => slot.card?.rank === ctx.round.throwIn.rank).filter(slot => !redKing(slot.card) || ctx.own.length === 1).filter(slot => {
      const score = knownScore(ctx.own);
      if (ctx.round.dutchCallerId !== bot.id || score === null || score <= 5) return true;
      // Preserve an intentional game-ending call if removing a card would
      // drop the doubled total back below the game's ending threshold.
      return scoreAfter(bot.total, 2 * score) <= ctx.target || scoreAfter(bot.total, 2 * (score - slot.expected)) > ctx.target;
    });
    const selected = best(candidates.filter(slot => !plan || knownScore(ctx.own) - slot.expected === plan.desiredHandScore).map(slot => {
      const confidence = slot.memory.confidence ?? 1;
      const gain = slot.expected + 2;
      const penalty = deps.unknownExpectedPoints(bot) + ctx.knowledge;
      return { ...slot, utility: confidence * gain - (1 - confidence) * penalty };
    }).filter(slot => slot.utility > 0));
    return selected ? { ...selected, actionValue: selected.utility, expectedValue: selected.expected, confidence: selected.memory.confidence || 1, eligible: true } : null;
  }

  return {
    evaluateDrawSources,
    shouldBotTakePile: bot => evaluateDrawSources(bot).selected.actionType === 'take-pile',
    botBestSwapTarget,
    botSwapTargets: (bot, incoming) => {
      const ctx = context(bot);
      return planActions(ctx, incoming, true).map(action => ({ ...action.target, utility: action.utility, actionValue: action.utility, eligible: true })).sort((a, b) => b.utility - a.utility);
    },
    botDeckCardDecision: (bot, incoming) => {
      const swapTarget = botBestSwapTarget(bot, incoming);
      return { actionType: swapTarget ? 'swap-drawn' : 'discard-drawn', swapTarget, actionValue: swapTarget?.actionValue || 0 };
    },
    shouldBotSwapDrawn: (bot, incoming) => !!botBestSwapTarget(bot, incoming),
    botQueenTargets,
    botQueenTarget: bot => { const targets = botQueenTargets(bot); return best([...targets.ownUnknown, ...targets.opponentUnknown]); },
    botJackCandidates: bot => bestJack(context(bot)),
    botAceTarget: bot => aceTargets(context(bot))[0] || null,
    botShouldCallDutch,
    botThrowInCandidate,
    activeHalvingPlan: bot => halvingPlan(context(bot)),
    deliberateWrongDutch: bot => { const ctx = context(bot); return halvingPlan(ctx)?.type === 'wrong-dutch' || (knownScore(ctx.own) > 5 && !!terminalCallAssessment(ctx)?.call); },
    botOwnSlots: bot => context(bot).own,
    botExpectedRoundScore: (bot, player) => expected(context(bot).hands.get(player.id)),
    botExpectedScore: (bot, player) => expected(context(bot).hands.get(player.id)),
    botRoundScoreConfidence: bot => { const hand = deps.ownSlots(bot); return hand.length ? hand.reduce((sum, slot) => sum + (slot.memory.confidence || 0), 0) / hand.length : 1; },
    botOpponentEstimates: bot => { const ctx = context(bot); return ctx.others.map(player => ({ player, expected: expected(ctx.hands.get(player.id)), cards: player.cards.length, total: player.total })); },
    dangerWeights: bot => { const ctx = context(bot); return ctx.others.map(player => ({ player, danger: relevantWeight(ctx, player) })).sort((a, b) => b.danger - a.danger); },
    botBestOwnSlot: (bot, mode = 'highest') => { const hand = context(bot).own; return best(hand.map(slot => ({ ...slot, utility: slot.expected * (mode === 'lowest' ? -1 : 1) }))); },
    botLowOpponentSlot: bot => { const ctx = context(bot); return best(ctx.others.flatMap(player => ctx.hands.get(player.id)).filter(slot => slot.card).map(slot => ({ ...slot, utility: -slot.expected }))); },
    botRiskMode: bot => { const others = deps.activePlayablePlayers().filter(player => player.id !== bot.id); return others.every(player => bot.total <= player.total) ? 'ahead' : others.every(player => bot.total >= player.total) ? 'behind' : 'middle'; },
    botThrowThreshold: () => 1,
    rankStatsForBot: (bot, rank) => { const total = (state().deckSetting === 'two' ? 8 : 4); const remaining = deps.remainingCards(bot).filter(card => card.rank === rank).length; return { total, remaining, seen: total - remaining }; },
    expectedEntryPoints: (bot, entry) => entry?.card ? points(entry.card) : deps.unknownExpectedPoints(bot),
    expectedEntryRawPoints: (bot, entry) => entry?.card ? points(entry.card) : deps.unknownExpectedPoints(bot),
    specialActionValue: (bot, card) => { const ctx = context(bot); return specialOutcome(ctx, ctx.own, card, 0) - positionValue(ctx, ctx.own, card, 0); },
    botPlannerDiagnostics: bot => diagnostics.get(bot) || { nodes: 0, budget: botProfile(bot).lookaheadNodeBudget, turns: 2, plans: 0 },
    botCallAssessment: bot => callAssessment(context(bot)),
    botReactionDelay: (bot, confidence) => Math.round(450 + (botProfile(bot).slow || 0) * 1200 - (botProfile(bot).fast || 0) * 260 + (1 - confidence) * 1100 + (deps.randomBetween || ((a, b) => a + random() * (b - a)))(0, 850))
  };
}

module.exports = { createSimpleTactics, scoreAfter, scoreDistribution };
