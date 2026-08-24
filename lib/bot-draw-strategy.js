function createDrawDecisionDomain(deps) {
  const {
    contextFor,
    evaluateDeckDiscard,
    dutchFreezeState,
    botSwapTargets,
    isForcedFinalTurn,
    finalTurnPileAssessment,
    publicMemoryCard,
    isRedKing,
    mixActionEvaluations,
    chooseCharacterAction,
    strategyRelease,
    random
  } = deps;
  const previousStrategy = strategyRelease === '1.3.64';

  function bestResponseToDeckCard(bot, drawnCard, ctx, options = {}) {
    const discard = evaluateDeckDiscard(bot, drawnCard, ctx);
    if (options.freeze && options.freeze.active) return discard;
    const swaps = botSwapTargets(bot, drawnCard, { context: ctx, actionType: 'swap-drawn', source: 'deck' });
    return [discard, ...swaps.filter((swap) => swap.eligible)]
      .sort((a, b) => b.actionValue - a.actionValue)[0];
  }

  function evaluateDrawSources(bot) {
    const ctx = contextFor(bot);
    const round = ctx.state.round;
    const top = round && round.discard[round.discard.length - 1];
    const freeze = dutchFreezeState(bot, ctx);
    let pile = null;
    if (top && bot.cards.length) {
      const replacements = botSwapTargets(bot, top, { context: ctx, actionType: 'take-pile', source: 'pile' });
      if (isForcedFinalTurn(bot, ctx)) {
        for (const replacement of replacements) {
          replacement.metadata.finalTurnPile = finalTurnPileAssessment(bot, top, replacement, ctx);
        }
        pile = replacements.find((replacement) => (
          replacement.eligible && replacement.metadata.finalTurnPile.eligible
        )) || null;
      } else {
        pile = replacements.find((replacement) => replacement.eligible && replacement.pileConcreteBenefit) || null;
      }
      if (pile) pile.metadata = { ...pile.metadata, source: 'pile', replacements };
    }
    const branches = ctx.belief.drawDistribution.map((item) => ({
      probability: item.probability,
      card: item.card,
      evaluation: bestResponseToDeckCard(bot, item.card, ctx, { freeze })
    }));
    const deck = mixActionEvaluations('draw-deck', branches, { source: 'deck', dutchFreeze: freeze });
    const selectableActions = [pile, deck].filter(Boolean);
    const pendingRecovery = ctx.memory && ctx.memory.pendingRedKingRecovery;
    const recoveringRedKing = !!(
      pendingRecovery && pile && top && isRedKing(publicMemoryCard(top)) &&
      (!pendingRecovery.cardId || pendingRecovery.cardId === top.id)
    );
    const selected = recoveringRedKing
      ? pile
      : (freeze.active ? deck : chooseCharacterAction(bot, selectableActions, random));
    if (recoveringRedKing) pile.metadata = { ...pile.metadata, guaranteedRedKingRecovery: true };
    return { pile, deck, selected, belief: ctx.belief };
  }

  function shouldBotTakePile(bot) {
    const result = evaluateDrawSources(bot);
    return !!(result.selected && result.selected.actionType === 'take-pile');
  }

  function botDeckCardDecision(bot, drawnCard) {
    const ctx = contextFor(bot);
    const discard = evaluateDeckDiscard(bot, drawnCard, ctx);
    const freeze = dutchFreezeState(bot, ctx);
    let swaps = [];
    let selected = discard;
    if (freeze.active) {
      if (ctx.memory) {
        ctx.memory.pendingAceDiscardAssessment =
          discard.metadata && discard.metadata.aceDiscardAssessment || null;
      }
      return { selected, swapTarget: null, discard, swaps, freeze };
    }
    swaps = botSwapTargets(bot, drawnCard, { context: ctx, actionType: 'swap-drawn', source: 'deck' });
    const eligibleSwaps = swaps.filter((swap) => swap.eligible);
    selected = chooseCharacterAction(bot, [discard, ...eligibleSwaps], random) || discard;
    const swapTarget = selected.actionType === 'swap-drawn'
      ? (previousStrategy ? chooseCharacterAction(bot, eligibleSwaps, random) : selected)
      : null;
    const finalSelection = swapTarget || selected;
    if (ctx.memory) {
      ctx.memory.pendingAceDiscardAssessment =
        finalSelection.metadata && finalSelection.metadata.aceDiscardAssessment || null;
    }
    return { selected, swapTarget, discard, swaps, freeze };
  }

  function shouldBotSwapDrawn(bot, drawnCard) {
    return !!botDeckCardDecision(bot, drawnCard).swapTarget;
  }

  return {
    bestResponseToDeckCard,
    evaluateDrawSources,
    shouldBotTakePile,
    botDeckCardDecision,
    shouldBotSwapDrawn
  };
}

module.exports = { createDrawDecisionDomain };
