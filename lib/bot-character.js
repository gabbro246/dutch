const { botProfile } = require('./bot-strategy.js');

function strategyLimits(bot, decisive = false) {
  const profile = botProfile(bot);
  return {
    depth: decisive ? (profile.searchDepth || 1) : Math.max(1, (profile.searchDepth || 1) - 1),
    samples: decisive ? (profile.decisiveSamples || profile.monteCarloSamples || 64) : (profile.monteCarloSamples || 64),
    operationBudget: profile.operationBudget || 5000
  };
}

const CLOSE_ACTION_SAFETY_MARGIN = 2;

function actionSafetyPenalty(action) {
  const metadata = action && action.metadata || {};
  const protection = metadata.protection || {};
  const followUp = metadata.throwInFollowUp || {};
  const gift = metadata.discardGiftAssessment || {};
  const freeze = metadata.dutchFreeze || {};
  const worsensKnownLow = !!(
    protection.confirmedLow && protection.worsensConfirmedCard ||
    metadata.finalTurnPile && metadata.finalTurnPile.protectedKnownLow
  );
  const guaranteedSequence = followUp.reliability === 'guaranteed-current-action' ||
    followUp.reliability === 'guaranteed-next-action' ||
    protection.guaranteedThrowIn;
  const speculativeSequence = (action.futureThrowInScoreSaving || 0) > 0 && !guaranteedSequence;
  const exposesUsefulDiscard = Math.max(
    0,
    Number(gift.totalPenalty) || 0,
    Number(action.opponentBenefit) || 0
  );
  const risksDutchReadyHand = !!(
    protection.worsensConfirmedCard && (freeze.active || metadata.strongReadyHand) ||
    metadata.winningPositionVariancePenalty > 0 && action.actionType === 'continue'
  );
  const variancePenalty = Math.sqrt(Math.max(0, Number(action.actionVariance) || 0)) * 0.35;
  return variancePenalty +
    (worsensKnownLow ? 8 : 0) +
    exposesUsefulDiscard * 0.45 +
    (speculativeSequence ? 3 : 0) +
    (risksDutchReadyHand ? 6 : 0);
}

function chooseCharacterAction(bot, actions, random = Math.random) {
  const ranked = (actions || []).filter(Boolean).slice().sort((a, b) => b.actionValue - a.actionValue);
  if (ranked.length < 2) return ranked[0] || null;
  const close = ranked.filter((action) => (
    ranked[0].actionValue - action.actionValue <= CLOSE_ACTION_SAFETY_MARGIN
  )).sort((a, b) => (
    actionSafetyPenalty(a) - actionSafetyPenalty(b) ||
    b.actionValue - a.actionValue
  ));
  const safestPenalty = actionSafetyPenalty(close[0]);
  const topPenalty = actionSafetyPenalty(ranked[0]);
  if (close[0] !== ranked[0] && safestPenalty < topPenalty - 0.05) return close[0];

  const profile = botProfile(bot);
  if (bot && bot.botType === 'roswell') return ranked[0];
  const window = Math.max(0, profile.equivalentWindow || 0);
  const near = ranked.filter((action) => ranked[0].actionValue - action.actionValue <= window);
  if (near.length < 2 || (profile.selectionTemperature || 0) <= 0) return ranked[0];
  const temperature = Math.max(0.01, profile.selectionTemperature);
  const weights = near.map((action) => Math.exp((action.actionValue - ranked[0].actionValue) / temperature));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = random() * total;
  for (let index = 0; index < near.length; index += 1) {
    roll -= weights[index];
    if (roll <= 0) return near[index];
  }
  return near[0];
}

module.exports = {
  CLOSE_ACTION_SAFETY_MARGIN,
  actionSafetyPenalty,
  strategyLimits,
  chooseCharacterAction
};
