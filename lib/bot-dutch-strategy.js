function createDutchDecisionSelector(deps) {
  const { evaluateDutch, chooseCharacterAction, random } = deps;

  return function botShouldCallDutch(bot, suppliedEvaluation = null) {
    const result = suppliedEvaluation || evaluateDutch(bot);
    let selected;
    if (result.call.eligible && result.call.metadata.strongReadyHand && !result.call.metadata.continuingImprovesGameTotal) {
      selected = result.call;
    } else {
      selected = chooseCharacterAction(bot, [result.call.eligible ? result.call : null, result.continue], random);
    }
    return !!selected && selected.actionType === 'call-dutch';
  };
}

module.exports = { createDutchDecisionSelector };
