const { botProfile } = require('./bot-strategy.js');

function createSpecialDecisionSelectors(deps) {
  const {
    allSlotTargets,
    contextFor,
    dutchFreezeState,
    currentEvaluation,
    evaluateAceTarget,
    ensureBotMemory,
    chooseCharacterAction,
    strategyRelease,
    random
  } = deps;
  const previousStrategy = strategyRelease === '1.3.64';
  const knowledgeFirstStrategy = strategyRelease === '1.3.67';

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
    const profile = botProfile(bot);
    const targets = allSlotTargets(bot, ctx);
    const actions = targets.map((target) => {
      const action = {
        ...target,
        ...currentEvaluation(bot, 'queen-peek', {
          context: ctx,
          informationValue: target.informationValue * (
            !previousStrategy && target.player.id === bot.id ? 2.2 : 1
          ),
          metadata: {
            targetId: target.player.id,
            index: target.index,
            selfInformation: !previousStrategy && target.player.id === bot.id,
            selfInformationDecisionImpact: !previousStrategy && target.player.id === bot.id
              ? 1
              : 0,
            threatRelevantInformation: target.queenDecisionImpact.humanOpponent &&
              target.queenDecisionImpact.immediateThreat,
            queenDecisionImpact: target.queenDecisionImpact,
            eligible: target.eligible,
            rejectionReason: target.rejectionReason
          }
        })
      };
      const readiness = target.queenDecisionImpact.selfReadiness;
      const knowledgePriorityBonus = knowledgeFirstStrategy && target.player.id === bot.id && readiness
        ? (profile.knowledgePriority || 0) * (1 - readiness.roundEndRisk) *
          (2 + readiness.unresolvedMass * 1.5)
        : 0;
      action.actionValue += knowledgePriorityBonus;
      action.finalActionValue = action.actionValue;
      action.metadata.knowledgePriorityBonus = knowledgePriorityBonus;
      return action;
    });
    const eligible = actions.filter((action) => action.eligible);
    const own = eligible.filter((action) => action.player.id === bot.id);
    const ownReadiness = own[0] && own[0].queenDecisionImpact.selfReadiness;
    const strictSelfKnowledge = knowledgeFirstStrategy && (profile.knowledgePriority || 0) >= 0.95 &&
      own.length > 0 && ownReadiness && ownReadiness.roundEndRisk < 0.7;
    return chooseCharacterAction(bot, strictSelfKnowledge ? own : eligible, random);
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
