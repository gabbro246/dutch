const { cardPoints, SPECIAL_RANKS, isHalvingTotal } = require('../public/shared.js');
const { publicMemoryCard } = require('./bot-strategy.js');
const {
  probabilityAtLeast,
  projectedGameWinProbability,
  scoreAfterRound
} = require('./bot-evaluator.js');

const SPECIALS = new Set(SPECIAL_RANKS);

function createDutchRollout(deps) {
  const {
    activePlayablePlayers,
    botMemoryEntry,
    currentEvaluation,
    effectiveMemory,
    isRedKing,
    opponentDistributions,
    opponentThreatState
  } = deps;

  function sampleCard(distribution, rng) {
    let roll = rng();
    for (const item of distribution || []) {
      roll -= item.probability || 0;
      if (roll <= 0) return item.card;
    }
    return distribution && distribution.length ? distribution[distribution.length - 1].card : null;
  }

  function handScore(cards) {
    return (cards || []).reduce((sum, card) => sum + cardPoints(card), 0);
  }

  function sampleRolloutWorld(ctx, rng) {
    const hands = new Map();
    for (const player of [ctx.bot, ...ctx.opponents]) {
      hands.set(player.id, player.cards.map((_, index) => sampleCard(ctx.slotCardDistributionFor(player, index), rng))
        .filter(Boolean));
    }
    const knownThrowRanks = new Map();
    const ownKnownRanks = new Map();
    for (let index = 0; index < ctx.bot.cards.length; index += 1) {
      const entry = effectiveMemory(ctx.bot, botMemoryEntry(ctx.bot, ctx.bot.id, index));
      if (!entry.card || (entry.confidence || 0) < 0.999) continue;
      ownKnownRanks.set(entry.card.rank, (ownKnownRanks.get(entry.card.rank) || 0) + 1);
    }
    knownThrowRanks.set(ctx.bot.id, ownKnownRanks);
    return {
      hands,
      initialScores: new Map(Array.from(hands, ([playerId, cards]) => [playerId, handScore(cards)])),
      callerThrowIns: new Map(),
      knownThrowRanks
    };
  }

  function activePlayersAfter(ctx, playerId) {
    const players = activePlayablePlayers();
    const index = players.findIndex((player) => player.id === playerId);
    if (index < 0) return players.filter((player) => player.id !== playerId);
    const ordered = [];
    for (let offset = 1; offset < players.length; offset += 1) {
      ordered.push(players[(index + offset) % players.length]);
    }
    return ordered;
  }

  function simulateCardTurn(hand, ctx, rng, topCard, otherScores) {
    if (!hand.length) return { hand: [], topCard, source: 'none', discarded: null };
    const currentScore = handScore(hand);
    const highestIndex = hand.reduce((best, card, index) => (
      best < 0 || cardPoints(card) > cardPoints(hand[best]) ? index : best
    ), -1);
    const highestPoints = cardPoints(hand[highestIndex]);
    const pileScore = topCard
      ? currentScore - highestPoints + cardPoints(topCard)
      : Infinity;
    let deckMean = 0;
    let deckVariance = 0;
    const deckOutcomes = [];
    for (const item of ctx.belief.drawDistribution) {
      const score = currentScore - Math.max(0, highestPoints - cardPoints(item.card));
      deckMean += item.probability * score;
      deckOutcomes.push({ score, probability: item.probability });
    }
    for (const outcome of deckOutcomes) {
      deckVariance += outcome.probability * Math.pow(outcome.score - deckMean, 2);
    }
    const bestOther = otherScores.length ? Math.min(...otherScores) : currentScore;
    const leading = currentScore <= bestOther;
    const safePileWindow = leading ? Math.sqrt(deckVariance) * 0.12 : 0;
    const takePile = !!topCard && pileScore <= deckMean + safePileWindow;
    const incoming = takePile ? topCard : sampleCard(ctx.belief.drawDistribution, rng);
    if (!incoming) return { hand: hand.slice(), topCard, source: 'none', discarded: null };
    const nextHand = hand.slice();
    let discarded = incoming;
    if (takePile || cardPoints(incoming) < highestPoints) {
      discarded = nextHand[highestIndex];
      nextHand[highestIndex] = incoming;
    }
    return {
      hand: nextHand,
      topCard: discarded,
      source: takePile ? 'pile' : 'deck',
      discarded
    };
  }

  function applyRolloutSpecial(world, actor, discarded, protectedCallerId, ctx, rng) {
    if (!discarded || !SPECIALS.has(discarded.rank)) return;
    const legalOthers = [ctx.bot, ...ctx.opponents]
      .filter((player) => player.id !== actor.id && player.id !== protectedCallerId);
    if (discarded.rank === 'A' && legalOthers.length) {
      const target = legalOthers.slice().sort((a, b) => (
        handScore(world.hands.get(a.id)) - handScore(world.hands.get(b.id)) ||
        (world.hands.get(a.id) || []).length - (world.hands.get(b.id) || []).length
      ))[0];
      const added = sampleCard(ctx.belief.drawDistribution, rng);
      if (target && added) world.hands.get(target.id).push(added);
      return;
    }
    if (discarded.rank !== 'J' || actor.id === protectedCallerId) return;
    const own = world.hands.get(actor.id) || [];
    if (!own.length) return;
    const ownIndex = own.reduce((best, card, index) => (
      best < 0 || cardPoints(card) > cardPoints(own[best]) ? index : best
    ), -1);
    let bestTarget = null;
    for (const player of legalOthers) {
      const cards = world.hands.get(player.id) || [];
      cards.forEach((card, index) => {
        if (!bestTarget || cardPoints(card) < cardPoints(bestTarget.card)) {
          bestTarget = { cards, index, card };
        }
      });
    }
    if (bestTarget && cardPoints(bestTarget.card) < cardPoints(own[ownIndex])) {
      [own[ownIndex], bestTarget.cards[bestTarget.index]] = [bestTarget.cards[bestTarget.index], own[ownIndex]];
    }
  }

  function simulateRolloutTurn(world, player, ctx, rng, topCard, protectedCallerId = null) {
    const hand = world.hands.get(player.id) || [];
    const otherScores = [ctx.bot, ...ctx.opponents]
      .filter((item) => item.id !== player.id)
      .map((item) => handScore(world.hands.get(item.id)));
    const result = simulateCardTurn(hand, ctx, rng, topCard, otherScores);
    world.hands.set(player.id, result.hand);
    applyRolloutSpecial(world, player, result.discarded, protectedCallerId, ctx, rng);
    return result.topCard;
  }

  function rolloutCallProbability(player, world, ctx) {
    const score = handScore(world.hands.get(player.id));
    let probability;
    if (score <= 2) probability = 0.995;
    else if (score === 3) probability = 0.98;
    else if (score === 4) probability = 0.95;
    else if (score === 5) probability = 0.9;
    else if (score === 6) probability = 0.08;
    else if (score === 7) probability = 0.02;
    else probability = 0;
    const bestOther = Math.min(...[ctx.bot, ...ctx.opponents]
      .filter((item) => item.id !== player.id)
      .map((item) => handScore(world.hands.get(item.id))));
    if (bestOther + 2 < score) probability *= 0.72;
    const inference = ctx.memory && ctx.memory.inference && ctx.memory.inference[player.id];
    if (inference) probability = Math.min(1, probability + (inference.dutchReadiness || 0) * 0.08);
    if ((world.hands.get(player.id) || []).length <= 2) probability = Math.min(1, probability + 0.04);
    const threatProfile = opponentThreatState(ctx.bot, ctx).profiles.find((profile) => profile.playerId === player.id);
    if (threatProfile) probability = Math.max(
      probability,
      threatProfile.callBeforeNextProbability * 0.86
    );
    return probability;
  }

  function probabilityAnyOpponentLower(ctx, ownScore) {
    return 1 - opponentDistributions(ctx).reduce((noOpponentLower, opponent) => (
      noOpponentLower * probabilityAtLeast(opponent.distribution, ownScore)
    ), 1);
  }

  function rolloutBotCalls(bot, world, ctx) {
    const ownScore = handScore(world.hands.get(bot.id));
    if (ownScore > 5) {
      const doubledScore = ownScore * 2;
      const rawFailedTotal = bot.total + doubledScore;
      const failedTotal = scoreAfterRound(bot.total, doubledScore);
      const ordinaryTotal = scoreAfterRound(bot.total, ownScore);
      const successfulTotal = scoreAfterRound(bot.total, 0);
      return isHalvingTotal(rawFailedTotal) &&
        failedTotal < ordinaryTotal && failedTotal < successfulTotal;
    }
    // A sampled rollout measures outcomes; it is not hidden information that the
    // bot may use to decide whether to call.
    const lowerProbability = probabilityAnyOpponentLower(ctx, ownScore);
    const successfulTotal = scoreAfterRound(bot.total, 0);
    const failedTotal = scoreAfterRound(bot.total, ownScore * 2);
    const expectedCallTotal =
      (1 - lowerProbability) * successfulTotal +
      lowerProbability * failedTotal;
    const continueTotal = scoreAfterRound(bot.total, ownScore);
    return expectedCallTotal <= continueTotal;
  }

  function simulateCallerFinalThrowIn(world, caller, topCard, ctx) {
    if (!topCard || caller.id !== ctx.bot.id) return topCard;
    const knownRanks = world.knownThrowRanks.get(caller.id);
    if (!knownRanks || (knownRanks.get(topCard.rank) || 0) <= 0) return topCard;
    const hand = world.hands.get(caller.id) || [];
    let bestIndex = -1;
    for (let index = 0; index < hand.length; index += 1) {
      const card = hand[index];
      if (!card || card.rank !== topCard.rank || SPECIALS.has(card.rank) || isRedKing(publicMemoryCard(card))) continue;
      if (bestIndex < 0 || cardPoints(card) > cardPoints(hand[bestIndex])) bestIndex = index;
    }
    if (bestIndex < 0) return topCard;
    const thrown = hand.splice(bestIndex, 1)[0];
    knownRanks.set(thrown.rank, Math.max(0, (knownRanks.get(thrown.rank) || 0) - 1));
    world.callerThrowIns.set(caller.id, (world.callerThrowIns.get(caller.id) || 0) + 1);
    return thrown;
  }

  function simulateFinalQueue(world, caller, ctx, rng, topCard) {
    const initialThrowInOpen = !!(ctx.state.round && ctx.state.round.throwIn && ctx.state.round.throwIn.open);
    let nextTop = initialThrowInOpen
      ? simulateCallerFinalThrowIn(world, caller, topCard, ctx) : topCard;
    for (const player of activePlayersAfter(ctx, caller.id)) {
      nextTop = simulateRolloutTurn(world, player, ctx, rng, nextTop, caller.id);
      nextTop = simulateCallerFinalThrowIn(world, caller, nextTop, ctx);
    }
    return nextTop;
  }

  function addRollout(bucket, world, ctx) {
    bucket.count += 1;
    const ownScore = handScore(world.hands.get(ctx.bot.id));
    bucket.own.set(ownScore, (bucket.own.get(ownScore) || 0) + 1);
    const opponentScores = [];
    for (const opponent of ctx.opponents) {
      const score = handScore(world.hands.get(opponent.id));
      opponentScores.push({ player: opponent, score });
      const counts = bucket.opponents.get(opponent.id);
      counts.set(score, (counts.get(score) || 0) + 1);
    }
    if (bucket.callerId !== ctx.bot.id) return;
    const success = ownScore <= 5 && opponentScores.every((item) => item.score >= ownScore);
    const doubledScore = ownScore * 2;
    const roundScore = success ? 0 : doubledScore;
    const rawTotal = ctx.bot.total + roundScore;
    const resultingTotal = scoreAfterRound(ctx.bot.total, roundScore);
    const winningTotal = scoreAfterRound(ctx.bot.total, 0);
    const ordinaryTotal = scoreAfterRound(ctx.bot.total, ownScore);
    const exactThreshold = isHalvingTotal(rawTotal);
    const beneficialFailure = !success && exactThreshold &&
      resultingTotal < winningTotal && resultingTotal < ordinaryTotal;
    const opponentTotals = opponentScores.map((item) => ({
      id: item.player.id,
      total: scoreAfterRound(item.player.total, item.score)
    }));
    const gameWinProbability = projectedGameWinProbability(
      ctx.bot,
      resultingTotal,
      opponentTotals,
      ctx.state.gameTarget || 100
    );
    const initialScore = world.initialScores.get(ctx.bot.id);
    const throwInCount = world.callerThrowIns.get(ctx.bot.id) || 0;
    const stats = bucket.callStats;
    stats.finalHandScore += ownScore;
    stats.roundScore += roundScore;
    stats.roundScoreSquared += roundScore * roundScore;
    stats.resultingTotal += resultingTotal;
    stats.gameWinProbability += gameWinProbability;
    if (ownScore <= 5) stats.finalAtMostFive += 1;
    if (success) stats.successes += 1;
    else {
      stats.failures += 1;
      stats.failedDoubledScore += doubledScore;
    }
    if (exactThreshold) stats.exactThresholdOutcomes += 1;
    if (!success && exactThreshold) stats.exactThresholdFailures += 1;
    if (beneficialFailure) stats.beneficialFailures += 1;
    if (initialScore > 5 && ownScore <= 5 && throwInCount > 0) stats.finalThrowInToFive += 1;
    const outcomeKey = [ownScore, success ? 'success' : 'failure', resultingTotal].join(':');
    const outcome = stats.outcomes.get(outcomeKey) || {
      finalHandScore: ownScore,
      success,
      doubledScore,
      rawTotal,
      exactThreshold,
      totalAfterHalving: resultingTotal,
      beneficialFailure,
      count: 0,
      gameWinProbability: 0
    };
    outcome.count += 1;
    outcome.gameWinProbability += gameWinProbability;
    stats.outcomes.set(outcomeKey, outcome);
  }

  function createRolloutBucket(ctx, callerId = null) {
    return {
      callerId,
      count: 0,
      own: new Map(),
      opponents: new Map(ctx.opponents.map((player) => [player.id, new Map()])),
      callStats: {
        finalHandScore: 0,
        finalAtMostFive: 0,
        finalThrowInToFive: 0,
        successes: 0,
        failures: 0,
        failedDoubledScore: 0,
        roundScore: 0,
        roundScoreSquared: 0,
        resultingTotal: 0,
        exactThresholdOutcomes: 0,
        exactThresholdFailures: 0,
        beneficialFailures: 0,
        gameWinProbability: 0,
        outcomes: new Map()
      }
    };
  }

  function dutchCallModel(bucket) {
    const samples = Math.max(1, bucket.count);
    const stats = bucket.callStats;
    return {
      samples: bucket.count,
      expectedFinalHandScore: stats.finalHandScore / samples,
      finalHandAtMostFiveProbability: stats.finalAtMostFive / samples,
      guaranteedFinalThrowInToFiveProbability: stats.finalThrowInToFive / samples,
      successProbability: stats.successes / samples,
      failureProbability: stats.failures / samples,
      expectedFailedDoubledScore: stats.failures ? stats.failedDoubledScore / stats.failures : 0,
      expectedRoundScore: stats.roundScore / samples,
      expectedResultingTotal: stats.resultingTotal / samples,
      exactThresholdOutcomeProbability: stats.exactThresholdOutcomes / samples,
      exactThresholdFailureProbability: stats.exactThresholdFailures / samples,
      beneficialFailureProbability: stats.beneficialFailures / samples,
      estimatedGameWinProbability: stats.gameWinProbability / samples,
      outcomes: Array.from(stats.outcomes.values(), (outcome) => ({
        finalHandScore: outcome.finalHandScore,
        probability: outcome.count / samples,
        success: outcome.success,
        doubledScore: outcome.doubledScore,
        rawTotal: outcome.rawTotal,
        exactThreshold: outcome.exactThreshold,
        totalAfterHalving: outcome.totalAfterHalving,
        beneficialFailure: outcome.beneficialFailure,
        gameWinProbability: outcome.gameWinProbability / outcome.count
      })).sort((a, b) => a.finalHandScore - b.finalHandScore || Number(b.success) - Number(a.success))
    };
  }

  function normalizedCounts(counts, total) {
    return Array.from(counts, ([value, count]) => ({ value, probability: count / Math.max(1, total) }));
  }

  function evaluationFromBucket(bot, ctx, bucket, actionType, metadata = {}) {
    const ownDistribution = normalizedCounts(bucket.own, bucket.count);
    const finalOpponents = ctx.opponents.map((player) => ({
      player,
      distribution: normalizedCounts(bucket.opponents.get(player.id), bucket.count)
    }));
    return currentEvaluation(bot, actionType, {
      context: ctx,
      ownDistribution,
      opponentDistributions: finalOpponents,
      callerId: bucket.callerId,
      turnsRemaining: bucket.callerId ? 0 : undefined,
      metadata: { ...metadata, callerId: bucket.callerId, rollouts: bucket.count }
    });
  }


  return {
    activePlayersAfter,
    addRollout,
    createRolloutBucket,
    dutchCallModel,
    evaluationFromBucket,
    normalizedCounts,
    rolloutBotCalls,
    rolloutCallProbability,
    sampleRolloutWorld,
    simulateFinalQueue,
    simulateRolloutTurn
  };
}

module.exports = { createDutchRollout };

