const { cardPoints, SPECIAL_RANKS } = require('../public/shared.js');
const { chooseCharacterAction } = require('./bot-character.js');
const { distributionMoments } = require('./bot-belief-state.js');
const { mixActionEvaluations } = require('./bot-evaluator.js');
const { addPointDistributions } = require('./bot-probability.js');

const SPECIALS = new Set(SPECIAL_RANKS);

function createThrowInDecision(deps) {
  const {
    botMemoryEntry,
    contextFor,
    currentEvaluation,
    drawPointDistribution,
    effectiveMemory,
    isConfirmedCard,
    isForcedFinalTurn,
    isRedKing,
    nextPlayer,
    random
  } = deps;

  function guaranteedRedKingRecoveryPlan(bot, ctx, entry, index) {
    const round = ctx.state.round;
    const top = round && round.discard && round.discard.at(-1);
    if (
      !round || !round.throwIn || !round.throwIn.open || !round.turnComplete ||
      round.drawn || (round.stage && round.stage !== 'turn') ||
      (Array.isArray(round.specialQueue) && round.specialQueue.length > 0) ||
      !isConfirmedCard(entry) || (entry.confidence || 0) < 0.999 ||
      !isRedKing(entry.card) || !top || top.rank !== 'K' || cardPoints(top) !== 13
    ) return null;
    const current = ctx.state.players[round.currentPlayerIndex];
    if (!current || current.id === bot.id) return null;
    const nextId = round.dutchCallerId
      ? (round.dutchQueue || [])[0]
      : (nextPlayer(bot) && nextPlayer(bot).id);
    if (nextId !== bot.id) return null;
    const replacement = bot.cards.map((_, candidateIndex) => ({
      index: candidateIndex,
      expected: distributionMoments(ctx.slotDistributionFor(bot, candidateIndex)).mean
    })).filter((candidate) => candidate.index !== index)
      .sort((a, b) => b.expected - a.expected)[0];
    if (!replacement || replacement.expected <= 0) return null;
    return {
      cardId: bot.cards[index] && bot.cards[index].id,
      replacementIndex: replacement.index,
      expectedHandImprovement: replacement.expected,
      reliability: 'guaranteed-next-action'
    };
  }

  function botThrowInCandidate(bot) {
    const ctx = contextFor(bot);
    const round = ctx.state.round;
    if (!round || !round.throwIn || !round.throwIn.open) return null;
    const wait = currentEvaluation(bot, 'wait-throw-in', { context: ctx });
    const drawPoints = drawPointDistribution(ctx);
    const candidates = [];
    for (let index = 0; index < bot.cards.length; index += 1) {
      const entry = effectiveMemory(bot, botMemoryEntry(bot, bot.id, index));
      const rememberedRank = entry.card && entry.card.rank || entry.rank;
      const matchingDistribution = (entry.distribution || []).reduce((sum, item) => sum + (item.card.rank === round.throwIn.rank ? item.probability : 0), 0);
      const confidence = rememberedRank === round.throwIn.rank ? Math.max(entry.confidence || 0, matchingDistribution) : matchingDistribution;
      if (confidence <= 0) continue;
      const redKingRecoveryPlan = isRedKing(entry.card)
        ? guaranteedRedKingRecoveryPlan(bot, ctx, entry, index)
        : null;
      const protectedRedKing = isRedKing(entry.card) && !redKingRecoveryPlan;
      const successDistribution = ctx.scoreWithoutSlotFor(bot, index);
      const failureDistribution = addPointDistributions(ctx.scoreDistributionFor(bot), drawPoints);
      const success = currentEvaluation(bot, 'throw-in-success', {
        context: ctx,
        ownDistribution: successDistribution,
        immediatePointReduction: distributionMoments(ctx.slotDistributionFor(bot, index)).mean
      });
      const failure = currentEvaluation(bot, 'throw-in-failure', {
        context: ctx,
        ownDistribution: failureDistribution,
        extraVariance: distributionMoments(drawPoints).variance
      });
      const mixed = mixActionEvaluations('throw-in', [
        { probability: confidence, evaluation: success },
        { probability: 1 - confidence, evaluation: failure }
      ], { index, rank: round.throwIn.rank });
      const futureOpportunity = isForcedFinalTurn(bot, ctx)
        ? 0
        : ctx.belief.probabilityOfRank(round.throwIn.rank) * Math.min(1, mixed.turnsRemaining / 4);
      mixed.actionValue -= futureOpportunity * Math.max(0, success.immediatePointReduction) * 0.12;
      mixed.finalActionValue = mixed.actionValue;
      const certainSafeThrow = confidence >= 0.999 &&
        !(entry.card && (SPECIALS.has(entry.card.rank) || isRedKing(entry.card)));
      if (!protectedRedKing && (mixed.actionValue > wait.actionValue || certainSafeThrow || redKingRecoveryPlan)) {
        candidates.push({
          index,
          confidence,
          expected: distributionMoments(ctx.slotDistributionFor(bot, index)).mean,
          expectedValue: redKingRecoveryPlan
            ? redKingRecoveryPlan.expectedHandImprovement
            : mixed.actionValue - wait.actionValue,
          recoveryPlan: redKingRecoveryPlan,
          throwInReliability: redKingRecoveryPlan ? 'guaranteed-next-action' : 'guaranteed-current-action',
          eligible: true,
          rejectionReason: null,
          ...mixed
        });
      }
    }
    return chooseCharacterAction(bot, candidates, random);
  }


  return { botThrowInCandidate };
}

module.exports = { createThrowInDecision };

