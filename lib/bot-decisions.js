const {
  SUITS,
  RANKS,
  SPECIAL_RANKS,
  isRedSuit,
  cardPoints
} = require('../public/shared.js');
const { botProfile, publicMemoryCard } = require('./bot-strategy.js');

const SPECIALS = new Set(SPECIAL_RANKS);

function createBotDecisions(deps) {
  const {
    getState,
    ensureBotMemory,
    botMemoryEntry,
    effectiveMemory,
    activePlayablePlayers,
    isProtectedSpecialTarget,
    findActiveIndexFrom,
    randomBetween
  } = deps;

  function unknownExpectedPoints(bot = null) {
    const state = getState();
    if (!bot || !state.round) return 6.4;
    const memory = ensureBotMemory(bot);
    if (!memory) return 6.4;
    const decks = state.deckSetting === 'two' ? 2 : 1;
    const seen = new Map();
    const addSeen = (card) => {
      if (!card || !card.rank || !card.suit) return;
      const key = card.rank + ':' + card.suit;
      seen.set(key, Math.min(decks, (seen.get(key) || 0) + 1));
    };
    for (const discard of memory.discards || []) addSeen(discard.card);
    for (const slots of Object.values(memory.slots || {})) {
      for (const entry of slots) {
        const effective = effectiveMemory(bot, entry);
        if (effective.card) addSeen(effective.card);
      }
    }
    let remainingPoints = 0;
    let remainingCards = 0;
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        const key = rank + ':' + suit;
        const remaining = Math.max(0, decks - (seen.get(key) || 0));
        remainingCards += remaining;
        remainingPoints += remaining * cardPoints({ rank, suit });
      }
    }
    return remainingCards > 0 ? remainingPoints / remainingCards : 6.4;
  }

  function rankStatsForBot(bot, rank) {
    const state = getState();
    const decks = state.deckSetting === 'two' ? 2 : 1;
    const totalRankCards = decks * SUITS.length;
    const seenBySuit = new Map();
    const addSeen = (card) => {
      if (!card || card.rank !== rank || !card.suit) return;
      seenBySuit.set(card.suit, Math.min(decks, (seenBySuit.get(card.suit) || 0) + 1));
    };
    const memory = ensureBotMemory(bot);
    if (memory) {
      for (const discard of memory.discards || []) addSeen(discard.card);
      for (const slots of Object.values(memory.slots || {})) {
        for (const entry of slots) {
          const effective = effectiveMemory(bot, entry);
          if (effective.card) addSeen(effective.card);
        }
      }
    }
    const seen = Array.from(seenBySuit.values()).reduce((sum, count) => sum + count, 0);
    return {
      seen,
      total: totalRankCards,
      remaining: Math.max(0, totalRankCards - seen)
    };
  }

  function rankDiscardPressure(bot, rank) {
    let pressure = 0;
    for (const player of activePlayablePlayers()) {
      if (player.id === bot.id || isProtectedSpecialTarget(player.id)) continue;
      player.cards.forEach((card, index) => {
        const memory = effectiveMemory(bot, botMemoryEntry(bot, player.id, index));
        if (!memory.card || memory.card.rank !== rank) return;
        const points = memory.card.points;
        pressure += (memory.confidence || 0) * (0.25 + Math.min(1, Math.max(0, points) / 10));
      });
    }
    return pressure;
  }

  function throwInPotentialValue(bot, card) {
    if (!bot || !card || !card.rank) return 0;
    const stats = rankStatsForBot(bot, card.rank);
    const remainingRatio = stats.total > 0 ? stats.remaining / stats.total : 0;
    const pressure = Math.min(1.8, rankDiscardPressure(bot, card.rank));
    const points = typeof card.points === 'number' ? card.points : cardPoints(card);
    const cardCountUtility = card.rank === 'K' && card.red ? 0.55 : 0.22;
    const pointUtility = Math.min(1.25, Math.max(0, points) / 9);
    return (remainingRatio * 1.2 + pressure * 0.75) * (cardCountUtility + pointUtility);
  }

  function discardGiftPenalty(bot, card) {
    if (!card) return 0;
    const state = getState();
    const points = typeof card.points === 'number' ? card.points : cardPoints(card);
    let penalty = 0;
    if (card.rank === 'K' && (card.red || isRedSuit(card.suit))) penalty += 2.35;
    else if (points <= 2) penalty += 0.75;
    else if (points <= 4) penalty += 0.35;
    if (SPECIALS.has(card.rank)) penalty += specialActionValue(bot, card) * 0.2;
    const nextIndex = state.round ? findActiveIndexFrom((state.round.currentPlayerIndex + 1) % Math.max(1, state.players.length)) : -1;
    const next = nextIndex >= 0 ? state.players[nextIndex] : null;
    if (next && next.id !== bot.id) {
      const nextEstimate = botExpectedScore(bot, next);
      if (nextEstimate > 7 && points <= 3) penalty += 0.45;
    }
    return penalty;
  }

  function cardStrategicCost(bot, card, options = {}) {
    if (!card) return unknownExpectedPoints(bot);
    let cost = cardPoints(card);
    const publicCardView = publicMemoryCard(card) || card;
    if (card.rank === 'K' && isRedSuit(card.suit)) cost -= 1.15;
    if (card.rank === 'K' && !isRedSuit(card.suit)) cost += 0.85;
    if (SPECIALS.has(card.rank)) cost -= specialActionValue(bot, publicCardView) * (options.immediateSpecial ? 0.55 : 0.16);
    cost -= throwInPotentialValue(bot, publicCardView) * (options.ownCard ? 0.65 : 0.35);
    return cost;
  }

  function botSwapTargets(bot, incomingCard) {
    const state = getState();
    const incomingCost = cardStrategicCost(bot, incomingCard, { ownCard: true });
    const currentRoundScore = botExpectedRoundScore(bot, bot);
    const incomingRaw = cardPoints(incomingCard);
    const currentHalvingBonus = totalHalvingBonus(bot, currentRoundScore, { scale: 0.16 });
    const canTuneHalving = state.round && state.round.dutchCallerId && state.round.dutchCallerId !== bot.id;
    return botOwnSlots(bot)
      .map((slot) => {
        const effective = effectiveMemory(bot, slot.memory);
        const knownCard = effective.card || null;
        const currentCost = expectedEntryPoints(bot, slot.memory, { countSpecialUtility: true, ownDecision: true });
        const currentRaw = expectedEntryRawPoints(bot, slot.memory);
        const projectedRoundScore = currentRoundScore - currentRaw + incomingRaw;
        const halvingBonus = canTuneHalving
          ? totalHalvingBonus(bot, projectedRoundScore, { scale: 0.2 }) - currentHalvingBonus
          : 0;
        const giftPenalty = knownCard ? discardGiftPenalty(bot, knownCard) * Math.max(0.35, effective.confidence || 0) : 0;
        return {
          ...slot,
          expected: currentCost,
          improvement: currentCost - incomingCost - giftPenalty + halvingBonus,
          confidence: effective.confidence || 0
        };
      })
      .sort((a, b) => b.improvement - a.improvement || b.expected - a.expected);
  }

  function botBestSwapTarget(bot, incomingCard) {
    const targets = botSwapTargets(bot, incomingCard);
    if (targets.length === 0) return null;
    if (Math.random() < botProfile(bot).mistake && targets.length > 1) return targets[1];
    return targets[0];
  }

  function knownOwnCardUtility(bot, effective) {
    if (!effective || !effective.card) return 0;
    const profile = botProfile(bot);
    const points = effective.card.points;
    const confidence = effective.confidence || 0;
    let utility = profile.knownCardUtility * confidence;
    if (points >= 8) utility += Math.min(1.35, (points - 6) * 0.18) * confidence;
    if (SPECIALS.has(effective.card.rank)) utility += specialActionValue(bot, effective.card) * 0.22 * confidence;
    if (effective.card.rank === 'K' && effective.card.red) utility += 0.6 * confidence;
    return utility;
  }

  function specialActionValue(bot, card) {
    if (!card || !SPECIALS.has(card.rank)) return 0;
    const profile = botProfile(bot);
    if (card.rank === 'A') return 1.1 + profile.spiteful * 1.2 + profile.opportunistic * 0.6;
    if (card.rank === 'Q') return 1.0 + profile.cautious * 1.2;
    if (card.rank === 'J') return 1.3 + profile.opportunistic * 1.5 + profile.aggressive * 0.8;
    return 0;
  }

  function expectedEntryPoints(bot, entry, options = {}) {
    const effective = effectiveMemory(bot, entry);
    const unknown = unknownExpectedPoints(bot);
    const profile = botProfile(bot);
    if (!effective.card) return unknown + (options.ownDecision ? profile.unknownOwnPenalty : 0);
    let known = effective.card.points;
    if (effective.card.rank === 'K' && effective.card.red) known -= 0.7;
    if (effective.card.rank === 'K' && !effective.card.red) known += 0.7;
    if (options.ownDecision) known -= throwInPotentialValue(bot, effective.card) * 0.65;
    if (options.countSpecialUtility) known -= specialActionValue(bot, effective.card) * 0.35;
    if (options.ownDecision) known -= knownOwnCardUtility(bot, effective);
    return effective.confidence * known + (1 - effective.confidence) * unknown;
  }

  function botOwnSlots(bot) {
    ensureBotMemory(bot);
    return bot.cards.map((card, index) => ({ player: bot, index, card, memory: botMemoryEntry(bot, bot.id, index) }));
  }

  function botExpectedScore(bot, player) {
    ensureBotMemory(bot);
    return player.cards.reduce((sum, card, index) => sum + expectedEntryPoints(bot, botMemoryEntry(bot, player.id, index), { countSpecialUtility: player.id === bot.id }), 0);
  }

  function expectedEntryRawPoints(bot, entry) {
    const effective = effectiveMemory(bot, entry);
    const unknown = unknownExpectedPoints(bot);
    if (!effective.card) return unknown;
    return (effective.confidence || 0) * effective.card.points + (1 - (effective.confidence || 0)) * unknown;
  }

  function botExpectedRoundScore(bot, player) {
    ensureBotMemory(bot);
    return player.cards.reduce((sum, card, index) => sum + expectedEntryRawPoints(bot, botMemoryEntry(bot, player.id, index)), 0);
  }

  function botRoundScoreConfidence(bot) {
    const slots = botOwnSlots(bot);
    if (slots.length === 0) return 1;
    const total = slots.reduce((sum, slot) => sum + (effectiveMemory(bot, slot.memory).confidence || 0), 0);
    return total / slots.length;
  }

  function totalHalvingBonus(bot, projectedRoundScore, options = {}) {
    if (!bot || typeof projectedRoundScore !== 'number') return 0;
    const multiplier = options.multiplier || 1;
    const profile = botProfile(bot);
    const projectedTotal = bot.total + projectedRoundScore * multiplier;
    let best = 0;
    for (const target of [50, 100]) {
      if (target <= bot.total) continue;
      const distance = Math.abs(projectedTotal - target);
      const tolerance = options.tolerance ?? (0.65 + profile.aggressive * 0.35);
      if (distance > tolerance) continue;
      const payoff = target / 2;
      const saved = Math.max(0, projectedTotal - payoff);
      best = Math.max(best, saved * (options.scale || 0.22) * (1 - distance / (tolerance + 0.01)));
    }
    return best;
  }

  function botDeliberateDutchHalving(bot, expectedRoundScore) {
    const state = getState();
    const confidence = botRoundScoreConfidence(bot);
    const profile = botProfile(bot);
    const risk = botRiskMode(bot);
    if (confidence < 0.58 + profile.cautious * 0.12) return false;
    for (const target of [50, 100]) {
      const needed = target - bot.total;
      if (needed <= 10 || needed % 2 !== 0) continue;
      const desiredRaw = needed / 2;
      if (desiredRaw <= 5) continue;
      const tolerance = 0.45 + (1 - confidence) * 1.4 + profile.aggressive * 0.25;
      const distance = Math.abs(expectedRoundScore - desiredRaw);
      if (distance > tolerance) continue;
      const doubledTotal = bot.total + desiredRaw * 2;
      const missWouldLikelyLose = doubledTotal > state.gameTarget && target !== 100;
      if (missWouldLikelyLose && risk !== 'behind' && profile.aggressive < 0.5) continue;
      return true;
    }
    return false;
  }

  function botBestOwnSlot(bot, mode = 'highest') {
    const slots = botOwnSlots(bot).map((slot) => ({ ...slot, expected: expectedEntryPoints(bot, slot.memory, { countSpecialUtility: true, ownDecision: true }) }));
    if (slots.length === 0) return null;
    slots.sort((a, b) => mode === 'lowest' ? a.expected - b.expected : b.expected - a.expected);
    if (Math.random() < botProfile(bot).mistake && slots.length > 1) return slots[Math.min(slots.length - 1, 1 + Math.floor(Math.random() * (slots.length - 1)))];
    return slots[0];
  }

  function botLowOpponentSlot(bot) {
    const candidates = [];
    const profile = botProfile(bot);
    for (const player of activePlayablePlayers()) {
      if (player.id === bot.id || isProtectedSpecialTarget(player.id)) continue;
      player.cards.forEach((card, index) => {
        const memory = botMemoryEntry(bot, player.id, index);
        const effective = effectiveMemory(bot, memory);
        const expected = expectedEntryPoints(bot, memory);
        if (effective.card || Math.random() < profile.mistake * 0.8) {
          candidates.push({ player, index, expected, confidence: effective.confidence || 0, memory });
        }
      });
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.expected - b.expected || b.confidence - a.confidence);
    return candidates[0];
  }

  function botOpponentEstimates(bot) {
    return activePlayablePlayers()
      .filter((p) => p.id !== bot.id && !isProtectedSpecialTarget(p.id))
      .map((player) => ({ player, expected: botExpectedScore(bot, player), cards: player.cards.length, total: player.total }))
      .sort((a, b) => a.expected - b.expected);
  }

  function botRiskMode(bot) {
    const totals = activePlayablePlayers().map((p) => p.total);
    const min = Math.min(...totals);
    const max = Math.max(...totals);
    if (bot.total >= max - 3 && bot.total > min + 10) return 'behind';
    if (bot.total <= min + 3 && max > bot.total + 8) return 'ahead';
    return 'middle';
  }

  function shouldBotTakePile(bot) {
    const state = getState();
    const round = state.round;
    const top = round && round.discard[round.discard.length - 1];
    if (!top) return false;
    const profile = botProfile(bot);
    const best = botBestSwapTarget(bot, top);
    if (!best) return false;
    let margin = best.improvement + discardGiftPenalty(bot, publicMemoryCard(top)) * 0.42;
    const risk = botRiskMode(bot);
    if (risk === 'behind') margin += profile.aggressive * 0.85;
    if (risk === 'ahead') margin -= profile.cautious * 0.65;
    if (Math.random() < profile.mistake) margin += randomBetween(-2.3, 1.3);
    return margin > profile.pileMargin;
  }

  function shouldBotSwapDrawn(bot, drawnCard) {
    const profile = botProfile(bot);
    const best = botBestSwapTarget(bot, drawnCard);
    if (!best || !drawnCard) return false;
    let improvement = best.improvement;
    const specialUtility = SPECIALS.has(drawnCard.rank) ? specialActionValue(bot, publicMemoryCard(drawnCard)) : 0;
    if (SPECIALS.has(drawnCard.rank)) improvement -= specialUtility * (0.42 + profile.opportunistic * 0.18);
    if (best.expected < 2.5 && cardPoints(drawnCard) > best.expected) improvement -= profile.cautious * 1.05;
    if (botRiskMode(bot) === 'behind') improvement += profile.aggressive * 0.35;
    if (Math.random() < profile.mistake) improvement += randomBetween(-2.4, 2.0);
    return improvement > profile.swapMargin;
  }

  function botThrowThreshold(bot) {
    const state = getState();
    const profile = botProfile(bot);
    let threshold = profile.throwConfidence;
    const risk = botRiskMode(bot);
    if (risk === 'behind') threshold -= 0.12;
    if (risk === 'ahead') threshold += 0.08;
    if (state.gameTarget - bot.total <= 20) threshold -= 0.05;
    return Math.max(0.45, Math.min(0.97, threshold));
  }

  function botReactionDelay(bot, confidence) {
    const profile = botProfile(bot);
    return Math.round(450 + profile.slow * 1200 - profile.fast * 260 + (1 - confidence) * 1100 + randomBetween(0, 850));
  }

  function botAceTargetScore(bot, estimate) {
    const state = getState();
    const memory = ensureBotMemory(bot);
    const profile = botProfile(bot);
    const player = estimate.player;
    const tableTotals = activePlayablePlayers().map((p) => p.total);
    const bestTotal = Math.min(...tableTotals);
    const scoreThreat = Math.max(0, 10 - estimate.expected) * 1.15;
    const cardCountThreat = Math.max(0, 5 - player.cards.length) * 1.2;
    const standingsThreat = Math.max(0, bot.total - player.total + 8) * 0.08 + Math.max(0, bestTotal + 5 - player.total) * 0.06;
    const revenge = memory && memory.aceAttackers ? (memory.aceAttackers[player.id] || 0) * (0.8 + profile.spiteful * 0.9) : 0;
    const finalTurnThreat = state.round && state.round.dutchQueue && state.round.dutchQueue.includes(player.id) ? 0.9 : 0;
    return scoreThreat + cardCountThreat + standingsThreat + revenge + finalTurnThreat;
  }

  function botAceTarget(bot) {
    const state = getState();
    const round = state.round;
    const targets = botOpponentEstimates(bot).filter((entry) => !round || entry.player.id !== round.dutchCallerId);
    if (targets.length === 0) return null;
    const scoredTargets = targets
      .map((entry) => ({ ...entry, aceScore: botAceTargetScore(bot, entry) }))
      .sort((a, b) => b.aceScore - a.aceScore || a.expected - b.expected || a.cards - b.cards);
    const target = scoredTargets[0];
    const unknown = unknownExpectedPoints(bot);
    if (target.aceScore < 1.6 && target.expected > unknown * Math.max(1.7, target.player.cards.length - 1) && Math.random() > botProfile(bot).aggressive) return null;
    return target;
  }

  function botQueenTargets(bot) {
    const ownUnknown = bot.cards
      .map((card, index) => {
        const rawMemory = botMemoryEntry(bot, bot.id, index);
        return {
          player: bot,
          index,
          score: expectedEntryPoints(bot, rawMemory, { countSpecialUtility: true, ownDecision: true }),
          memory: effectiveMemory(bot, rawMemory)
        };
      })
      .filter((slot) => !slot.memory.card || slot.memory.state === 'stale');
    const opponentUnknown = [];
    for (const estimate of botOpponentEstimates(bot)) {
      estimate.player.cards.forEach((card, index) => {
        const rawMemory = botMemoryEntry(bot, estimate.player.id, index);
        const memory = effectiveMemory(bot, rawMemory);
        if (!memory.card || memory.state === 'stale') opponentUnknown.push({ player: estimate.player, index, memory, estimate: estimate.expected, total: estimate.total });
      });
    }
    ownUnknown.sort((a, b) => b.score - a.score);
    opponentUnknown.sort((a, b) => a.estimate - b.estimate || a.total - b.total);
    return { ownUnknown, opponentUnknown };
  }

  function botQueenTarget(bot) {
    const targets = botQueenTargets(bot);
    const profile = botProfile(bot);
    const ownScore = botExpectedScore(bot, bot);
    let target = null;
    const ownNeed = targets.ownUnknown.length * (0.85 + profile.cautious * 0.6) + Math.max(0, ownScore - 5) * 0.16;
    const opponentNeed = targets.opponentUnknown.length > 0
      ? Math.max(0, 8 - targets.opponentUnknown[0].estimate) * 0.22 + Math.max(0, 4 - targets.opponentUnknown[0].player.cards.length) * 0.25
      : 0;
    if (targets.ownUnknown.length > 0 && (ownNeed >= opponentNeed || Math.random() < profile.queenOwnBias)) {
      target = targets.ownUnknown[0];
    } else if (targets.opponentUnknown.length > 0) {
      target = targets.opponentUnknown[0];
    } else if (targets.ownUnknown.length > 0) {
      target = targets.ownUnknown[0];
    }
    return target;
  }

  function botJackCandidates(bot) {
    const candidates = [];
    const botScore = botExpectedScore(bot, bot);
    const ownSlots = botOwnSlots(bot).map((slot) => {
      const effective = effectiveMemory(bot, slot.memory);
      return {
        player: bot,
        index: slot.index,
        card: slot.card,
        expected: expectedEntryPoints(bot, slot.memory, { ownDecision: true }),
        confidence: effective.confidence || 0
      };
    });
    const opponentSlots = [];
    for (const player of activePlayablePlayers()) {
      if (player.id === bot.id || isProtectedSpecialTarget(player.id)) continue;
      const playerExpected = botExpectedScore(bot, player);
      player.cards.forEach((card, index) => {
        const memory = botMemoryEntry(bot, player.id, index);
        const effective = effectiveMemory(bot, memory);
        if (!effective.card) return;
        opponentSlots.push({
          player,
          index,
          card,
          expected: expectedEntryPoints(bot, memory),
          confidence: effective.confidence || 0,
          playerExpected
        });
      });
    }

    for (const own of ownSlots) {
      for (const opp of opponentSlots) {
        const threatBonus = Math.max(0, botScore + 2 - opp.playerExpected) * 0.18 + Math.max(0, 4 - opp.player.cards.length) * 0.18;
        const utility = own.expected - opp.expected + threatBonus - Math.max(0, 0.58 - opp.confidence);
        if (utility > 0) candidates.push({ type: 'self', a: own, b: opp, utility });
      }
    }

    for (const threat of opponentSlots) {
      if (threat.playerExpected > botScore + 3 && threat.player.total >= bot.total - 4) continue;
      for (const donor of opponentSlots) {
        if (donor.player.id === threat.player.id) continue;
        const diff = donor.expected - threat.expected;
        if (diff <= 0) continue;
        const threatPriority = Math.max(0, botScore + 3 - threat.playerExpected) * 0.28 + Math.max(0, 4 - threat.player.cards.length) * 0.25 + Math.max(0, bot.total - threat.player.total + 6) * 0.04;
        const donorCost = Math.max(0, botScore - donor.playerExpected) * 0.12;
        const utility = diff * 0.58 + threatPriority - donorCost - Math.max(0, 0.62 - Math.min(threat.confidence, donor.confidence));
        if (utility > 0) candidates.push({ type: 'sabotage', a: threat, b: donor, utility });
      }
    }

    return candidates.sort((a, b) => b.utility - a.utility);
  }

  function estimatedTurnImprovement(bot, player) {
    const state = getState();
    const slots = player.cards.map((card, index) => ({
      expected: expectedEntryPoints(bot, botMemoryEntry(bot, player.id, index), { ownDecision: player.id === bot.id }),
      memory: effectiveMemory(bot, botMemoryEntry(bot, player.id, index))
    }));
    if (slots.length === 0) return 0;
    const highest = slots.sort((a, b) => b.expected - a.expected)[0];
    const unknown = unknownExpectedPoints(bot);
    const drawImprovement = Math.max(0, highest.expected - unknown) * 0.42;
    const top = state.round && state.round.discard[state.round.discard.length - 1];
    const pileImprovement = top ? Math.max(0, highest.expected - cardStrategicCost(bot, top, { ownCard: true })) * 0.65 : 0;
    const knowledgePenalty = slots.filter((slot) => !slot.memory.card).length * 0.18;
    return Math.max(0, Math.max(drawImprovement, pileImprovement) - knowledgePenalty);
  }

  function botShouldCallDutch(bot) {
    const state = getState();
    const expected = botExpectedRoundScore(bot, bot);
    const profile = botProfile(bot);
    const opponents = activePlayablePlayers()
      .filter((p) => p.id !== bot.id && !isProtectedSpecialTarget(p.id))
      .map((player) => ({ player, expected: botExpectedRoundScore(bot, player), cards: player.cards.length, total: player.total }))
      .sort((a, b) => a.expected - b.expected);
    const bestOpponent = opponents[0] || null;
    const unknownOwn = botOwnSlots(bot).filter((slot) => !effectiveMemory(bot, slot.memory).card).length;
    const projectedLower = opponents.some((entry) => entry.expected - estimatedTurnImprovement(bot, entry.player) < expected - 0.35);
    const alreadyLower = opponents.some((entry) => entry.expected < expected - 0.45);
    if (botDeliberateDutchHalving(bot, expected)) return true;
    const risk = botRiskMode(bot);
    let threshold = 5 - profile.cautious * 0.55 + profile.aggressive * 0.35 + profile.dutchMargin;
    if (state.gameTarget === 50) threshold -= 0.2;
    if (risk === 'behind') threshold += 0.35 + profile.aggressive * 0.35;
    if (risk === 'ahead') threshold -= 0.35 + profile.cautious * 0.25;
    if (unknownOwn === 0) threshold += 0.28 + profile.cautious * 0.28;
    else threshold -= unknownOwn * (0.45 + profile.cautious * 0.23);
    if (bestOpponent && expected < bestOpponent.expected - 2.0) threshold += profile.cautious * 0.32;
    if (alreadyLower) threshold -= 1.25 + profile.cautious * 0.8;
    if (projectedLower) threshold -= 0.9 + profile.cautious * 0.75;
    if (expected <= 2.2 && unknownOwn === 0 && !alreadyLower) threshold = Math.max(threshold, 2.6);
    const cap = unknownOwn === 0 ? 5.25 + (risk === 'behind' ? 0.2 : 0) : 4.75 - unknownOwn * 0.32;
    threshold = Math.min(threshold, cap);
    if (Math.random() < profile.mistake * 0.5) threshold += randomBetween(0.4, 1.4);
    return expected <= threshold;
  }

  function botThrowInCandidate(bot) {
    const state = getState();
    const round = state.round;
    if (!round || !round.throwIn || !round.throwIn.open) return null;
    const threshold = botThrowThreshold(bot);
    const candidates = [];
    bot.cards.forEach((card, index) => {
      const entry = botMemoryEntry(bot, bot.id, index);
      const memory = effectiveMemory(bot, entry);
      if (!memory.rank && !memory.card) return;
      const rank = memory.rank || (memory.card && memory.card.rank);
      const confidence = memory.confidence || 0;
      if (rank === round.throwIn.rank && confidence >= threshold) candidates.push({ index, confidence, expected: expectedEntryPoints(bot, entry) });
      else if (rank === round.throwIn.rank && confidence >= threshold - 0.18 && Math.random() < botProfile(bot).mistake) candidates.push({ index, confidence, expected: 99 });
    });
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.expected - a.expected);
    if (Math.random() < botProfile(bot).throwMiss * (1.1 - candidates[0].confidence)) return null;
    return candidates[0];
  }

  return {
    unknownExpectedPoints,
    rankStatsForBot,
    rankDiscardPressure,
    throwInPotentialValue,
    discardGiftPenalty,
    cardStrategicCost,
    botSwapTargets,
    botBestSwapTarget,
    knownOwnCardUtility,
    specialActionValue,
    expectedEntryPoints,
    botOwnSlots,
    botExpectedScore,
    expectedEntryRawPoints,
    botExpectedRoundScore,
    botRoundScoreConfidence,
    totalHalvingBonus,
    botDeliberateDutchHalving,
    botBestOwnSlot,
    botLowOpponentSlot,
    botOpponentEstimates,
    botRiskMode,
    shouldBotTakePile,
    shouldBotSwapDrawn,
    botThrowThreshold,
    botReactionDelay,
    botAceTargetScore,
    botAceTarget,
    botQueenTargets,
    botQueenTarget,
    botJackCandidates,
    estimatedTurnImprovement,
    botShouldCallDutch,
    botThrowInCandidate
  };
}

module.exports = { createBotDecisions };
