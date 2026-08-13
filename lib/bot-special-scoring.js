const { cardPoints, SPECIAL_RANKS } = require('../public/shared.js');
const { publicMemoryCard } = require('./bot-strategy.js');
const { distributionMoments } = require('./bot-belief-state.js');
const { clamp, probabilityAtLeast, probabilityAtMost } = require('./bot-evaluator.js');
const { addPointDistributions, entropy } = require('./bot-probability.js');

const SPECIALS = new Set(SPECIAL_RANKS);

function createSpecialScoring(deps) {
  const {
    allSlotTargets,
    contextFor,
    discardGiftAssessment,
    ensureBotMemory,
    isProtectedSpecialTarget,
    opponentSelfKnowledge,
    opponentThreatState
  } = deps;

  function playerRoundWinProbability(ctx, player, distribution) {
    const others = [ctx.bot, ...ctx.opponents].filter((item) => item.id !== player.id);
    return (distribution || []).reduce((sum, outcome) => {
      const noOtherLower = others.reduce((product, other) => (
        product * probabilityAtLeast(ctx.scoreDistributionFor(other), outcome.value)
      ), 1);
      return sum + (outcome.probability || 0) * noOtherLower;
    }, 0);
  }

  function mixDistributions(base, added, addedRetentionProbability) {
    const retained = clamp(addedRetentionProbability);
    return [
      ...base.map((item) => ({ ...item, probability: (item.probability || 0) * (1 - retained) })),
      ...added.map((item) => ({ ...item, probability: (item.probability || 0) * retained }))
    ].filter((item) => item.probability > 0);
  }

  function aceTargetImpact(bot, player, suppliedContext = null) {
    const ctx = suppliedContext || contextFor(bot);
    if (!player || isProtectedSpecialTarget(player.id)) return null;
    const base = ctx.scoreDistributionFor(player);
    const drawPoints = ctx.belief.drawDistribution.map((item) => ({
      value: cardPoints(item.card),
      probability: item.probability
    }));
    const added = addPointDistributions(base, drawPoints);
    const threatProfile = opponentThreatState(bot, ctx).profiles.find((profile) => profile.playerId === player.id);
    const selfKnowledge = threatProfile ? threatProfile.selfKnowledge : opponentSelfKnowledge(bot, player);
    const afterCardCount = player.cards.length + 1;
    const unknownSlotSelectionChance = clamp(
      (0.65 + selfKnowledge.knowledgeRatio * 0.75) / Math.max(1, afterCardCount)
    );
    const top = ctx.state.round && ctx.state.round.discard && ctx.state.round.discard.at(-1);
    const matchingTopChance = top ? ctx.belief.probabilityOfRank(top.rank) : 0;
    const discardAddedChance = clamp(
      unknownSlotSelectionChance * 0.78 +
      matchingTopChance * unknownSlotSelectionChance * 0.12,
      0,
      0.65
    );
    const retainedDistribution = mixDistributions(base, added, 1 - discardAddedChance);
    const beforeMean = distributionMoments(base).mean;
    const afterMean = distributionMoments(retainedDistribution).mean;
    const callProbabilityBefore = probabilityAtMost(base, 5);
    const callProbabilityAfter = probabilityAtMost(retainedDistribution, 5);
    const callProbabilityReduction = Math.max(0, callProbabilityBefore - callProbabilityAfter);
    const roundWinBefore = playerRoundWinProbability(ctx, player, base);
    const roundWinAfter = playerRoundWinProbability(ctx, player, retainedDistribution);
    const roundWinProbabilityReduction = Math.max(0, roundWinBefore - roundWinAfter);
    const knownBefore = player.cards.length
      ? selfKnowledge.knownPositions / player.cards.length
      : 1;
    const knownAfter = selfKnowledge.knownPositions / Math.max(1, afterCardCount);
    const knowledgePositionReduction = Math.max(0, knownBefore - knownAfter);
    const expectedScoreIncrease = Math.max(0, afterMean - beforeMean);
    const expectedDisadvantage = expectedScoreIncrease +
      callProbabilityReduction * 7 +
      roundWinProbabilityReduction * 9 +
      knowledgePositionReduction * 2.5;
    const materialRoundImpact = callProbabilityReduction >= 0.05 ||
      roundWinProbabilityReduction >= 0.05;
    const memory = ensureBotMemory(bot);
    const priorRetaliations = memory && memory.aceAttackers && memory.aceAttackers[player.id] || 0;
    const aceDrawChance = ctx.belief.probabilityOfRank('A');
    const retaliationChance = clamp(
      aceDrawChance * 0.45 * (0.55 + Math.min(0.35, priorRetaliations * 0.1))
    );
    const retaliationCost = retaliationChance * ctx.belief.expectedDrawPoints;

    return {
      player,
      threatProfile: threatProfile || null,
      baseDistribution: base,
      addedDistribution: added,
      retainedDistribution,
      discardAddedChance,
      retainedProbability: 1 - discardAddedChance,
      expectedScoreIncrease,
      callProbabilityBefore,
      callProbabilityAfter,
      callProbabilityReduction,
      roundWinBefore,
      roundWinAfter,
      roundWinProbabilityReduction,
      knowledgePositionReduction,
      expectedDisadvantage,
      materialRoundImpact,
      retaliationChance,
      retaliationCost
    };
  }

  function acePileExposureAssessment(bot, ctx) {
    return discardGiftAssessment(bot, { rank: 'A', suit: 'spades' }, ctx);
  }

  function aceDiscardAssessment(bot, ctx, options = {}) {
    const impacts = ctx.opponents.map((player) => aceTargetImpact(bot, player, ctx)).filter(Boolean);
    const bestTarget = impacts.sort((a, b) => (
      (b.expectedDisadvantage - b.retaliationCost) -
      (a.expectedDisadvantage - a.retaliationCost)
    ))[0] || null;
    const guaranteedScoreIncrease = Math.max(0, options.afterMean - options.beforeMean);
    const aceLowCardRetentionValue = options.aceWasOwned ? 1 : 0;
    const pileExposureAssessment = acePileExposureAssessment(bot, ctx);
    const pileExposureCost = pileExposureAssessment.totalPenalty;
    const retaliationCost = bestTarget ? bestTarget.retaliationCost : 0;
    const opponentExpectedDisadvantage = bestTarget ? bestTarget.expectedDisadvantage : 0;
    const additionalStrategicCost = aceLowCardRetentionValue * 0.35 +
      pileExposureCost + retaliationCost;
    const eligible = guaranteedScoreIncrease <= opponentExpectedDisadvantage + 1e-9;
    return {
      eligible,
      incomingCard: publicMemoryCard(options.incomingCard),
      guaranteedScoreIncrease,
      aceLowCardRetentionValue,
      opponentExpectedDisadvantage,
      pileExposureCost,
      pileExposureAssessment,
      retaliationCost,
      additionalStrategicCost,
      netValue: opponentExpectedDisadvantage - guaranteedScoreIncrease - additionalStrategicCost,
      bestTargetId: bestTarget && bestTarget.player.id || null,
      targets: impacts.map((impact) => ({
        playerId: impact.player.id,
        expectedDisadvantage: impact.expectedDisadvantage,
        expectedScoreIncrease: impact.expectedScoreIncrease,
        discardAddedChance: impact.discardAddedChance,
        callProbabilityReduction: impact.callProbabilityReduction,
        roundWinProbabilityReduction: impact.roundWinProbabilityReduction,
        knowledgePositionReduction: impact.knowledgePositionReduction,
        retaliationChance: impact.retaliationChance,
        retaliationCost: impact.retaliationCost,
        immediateThreat: !!(impact.threatProfile && impact.threatProfile.immediate),
        materialRoundImpact: impact.materialRoundImpact
      }))
    };
  }

  function specialStateValue(bot, card, suppliedContext = null) {
    if (!card || !SPECIALS.has(card.rank)) return 0;
    const ctx = suppliedContext || contextFor(bot);
    if (card.rank === 'Q') {
      const targets = allSlotTargets(bot, ctx);
      return targets.length ? Math.max(...targets.map((target) => target.informationValue)) : 0;
    }
    if (card.rank === 'A') {
      if (!ctx.opponents.length) return 0;
      return Math.max(0, ...ctx.opponents.map((player) => {
        const impact = aceTargetImpact(bot, player, ctx);
        return impact ? impact.expectedDisadvantage - impact.retaliationCost : 0;
      }));
    }
    if (card.rank === 'J') {
      const own = bot.cards.map((_, index) => distributionMoments(ctx.slotDistributionFor(bot, index)).mean);
      const opponent = ctx.opponents.flatMap((player) => player.cards.map((_, index) => distributionMoments(ctx.slotDistributionFor(player, index)).mean));
      return own.length && opponent.length ? Math.max(0, Math.max(...own) - Math.min(...opponent)) : 0;
    }
    return 0;
  }

  function specialActionValue(bot, card) {
    return specialStateValue(bot, card);
  }

  function knownOwnCardUtility(bot, effective) {
    if (!effective || (!effective.card && !(effective.distribution || []).length)) return 0;
    return (effective.confidence || 0) * entropy(effective.distribution || []);
  }

  function discardSpecialEffects(bot, discarded, ctx, aceAssessment = null) {
    if (!discarded || !SPECIALS.has(discarded.rank)) return { informationValue: 0, opponentBenefit: 0 };
    if (discarded.rank === 'Q') return { informationValue: specialStateValue(bot, discarded, ctx), opponentBenefit: 0 };
    if (discarded.rank === 'A') {
      const assessment = aceAssessment || aceDiscardAssessment(bot, ctx, {
        beforeMean: distributionMoments(ctx.scoreDistributionFor(bot)).mean,
        afterMean: distributionMoments(ctx.scoreDistributionFor(bot)).mean,
        incomingCard: null,
        aceWasOwned: false
      });
      return {
        informationValue: 0,
        opponentBenefit: assessment.additionalStrategicCost - assessment.opponentExpectedDisadvantage,
        aceAssessment: assessment
      };
    }
    if (discarded.rank === 'J') return { informationValue: specialStateValue(bot, discarded, ctx) * 0.65, opponentBenefit: -specialStateValue(bot, discarded, ctx) * 0.35 };
    return { informationValue: 0, opponentBenefit: 0 };
  }


  return {
    aceDiscardAssessment,
    aceTargetImpact,
    discardSpecialEffects,
    knownOwnCardUtility,
    specialActionValue,
    specialStateValue
  };
}

module.exports = { createSpecialScoring };
