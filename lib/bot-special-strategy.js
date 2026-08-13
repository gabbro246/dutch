function createSpecialDecisionSelectors(deps) {
  const {
    allSlotTargets,
    contextFor,
    dutchFreezeState,
    currentEvaluation,
    evaluateAceTarget,
    ensureBotMemory,
    chooseCharacterAction,
    random
  } = deps;

  function botQueenTargets(bot) {
    const all = allSlotTargets(bot).filter((target) => target.eligible);
    return {
      ownUnknown: all.filter((target) => target.player.id === bot.id)
        .sort((a, b) => b.informationValue - a.informationValue),
      opponentUnknown: all.filter((target) => target.player.id !== bot.id)
        .sort((a, b) => b.informationValue - a.informationValue)
    };
  }

  function botQueenTarget(bot) {
    const ctx = contextFor(bot);
    const freeze = dutchFreezeState(bot, ctx);
    if (freeze.active) return null;
    const targets = allSlotTargets(bot, ctx);
    const actions = targets.map((target) => ({
      ...target,
      ...currentEvaluation(bot, 'queen-peek', {
        context: ctx,
        informationValue: target.informationValue,
        metadata: {
          targetId: target.player.id,
          index: target.index,
          threatRelevantInformation: target.queenDecisionImpact.humanOpponent &&
            target.queenDecisionImpact.immediateThreat,
          queenDecisionImpact: target.queenDecisionImpact,
          eligible: target.eligible,
          rejectionReason: target.rejectionReason
        }
      })
    }));
    return chooseCharacterAction(bot, actions.filter((action) => action.eligible), random);
  }

  function botAceTargetScore(bot, estimate) {
    const target = evaluateAceTarget(bot, estimate.player);
    return target ? target.actionValue : -Infinity;
  }

  function botAceTarget(bot) {
    const ctx = contextFor(bot);
    const freeze = dutchFreezeState(bot, ctx);
    const memory = ensureBotMemory(bot);
    if (freeze.active) {
      if (memory) memory.pendingAceDiscardAssessment = null;
      return null;
    }
    const actions = ctx.opponents.map((player) => evaluateAceTarget(bot, player, ctx)).filter(Boolean);
    const eligibleActions = actions.filter((action) => action.eligible);
    const selected = chooseCharacterAction(bot, eligibleActions, random);
    if (memory) memory.pendingAceDiscardAssessment = null;
    return selected;
  }

  return { botQueenTargets, botQueenTarget, botAceTargetScore, botAceTarget };
}

module.exports = { createSpecialDecisionSelectors };
