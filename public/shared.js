(function initShared(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DutchShared = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildShared() {
  const PLAYER_NAME_MAX_LENGTH = 16;
  const GAME_DESCRIPTION = 'Play the card game Dutch against other people or bots.';
  const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const SPECIAL_RANKS = ['A', 'Q', 'J'];
  const RED_SUITS = ['hearts', 'diamonds'];

  const BOT_LABELS = {
    strategic: '🦉 Athena',
    roswell: '👽 Roswell',
    casual: '🐑 Norman',
    distracted: '🐠 Dory'
  };

  const BOT_PERSONALITIES = {
    strategic: {
      summary: 'Tracks cards carefully, waits for strong swaps, and rarely moves without a reason.',
      stats: [
        ['Memory', 9],
        ['Tempo', 8],
        ['Risk', 4],
        ['Pressure', 7],
        ['Discipline', 9]
      ]
    },
    roswell: {
      summary: 'Reads the table relentlessly, exploits exact-score tricks, and almost never gives away value.',
      stats: [
        ['Memory', 10],
        ['Tempo', 10],
        ['Risk', 5],
        ['Pressure', 10],
        ['Discipline', 10]
      ]
    },
    casual: {
      summary: 'Makes balanced choices with a relaxed read of the table and a steady sense of timing.',
      stats: [
        ['Memory', 6],
        ['Tempo', 5],
        ['Risk', 5],
        ['Pressure', 5],
        ['Discipline', 5]
      ]
    },
    distracted: {
      summary: 'Plays erratically and boldly, with loose card tracking and a weakness for tempting moves.',
      stats: [
        ['Memory', 3],
        ['Tempo', 3],
        ['Risk', 8],
        ['Pressure', 3],
        ['Discipline', 2]
      ]
    }
  };

  function nameGraphemes(value) {
    const text = String(value || '').trim();
    if (!text) return [];
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (part) => part.segment);
    }
    return Array.from(text);
  }

  function isEmojiGrapheme(value) {
    return Array.from(String(value || '')).some((char) => {
      const code = char.codePointAt(0);
      return (code >= 0x1F000 && code <= 0x1FAFF) ||
        (code >= 0x1F1E6 && code <= 0x1F1FF) ||
        (code >= 0x2600 && code <= 0x27BF) ||
        (code >= 0x2300 && code <= 0x23FF);
    });
  }

  function shortPlayerName(name) {
    const graphemes = nameGraphemes(name);
    if (graphemes.length === 0) return '';
    if (isEmojiGrapheme(graphemes[0])) return graphemes[0];
    if (graphemes.length > 5) return graphemes.slice(0, 4).join('') + '.';
    return graphemes.join('');
  }

  function normalizedShortPlayerName(name) {
    return shortPlayerName(name).toLocaleLowerCase();
  }

  function suitSymbol(suit) {
    return {
      hearts: '♥',
      diamonds: '♦',
      clubs: '♣',
      spades: '♠'
    }[suit];
  }

  function isRedSuit(suit) {
    return RED_SUITS.includes(suit);
  }

  function cardPoints(card) {
    if (!card) return 0;
    if (card.rank === 'A') return 1;
    if (card.rank === 'J') return 11;
    if (card.rank === 'Q') return 12;
    if (card.rank === 'K') return isRedSuit(card.suit) ? 0 : 13;
    return Number(card.rank);
  }

  function specialLabel(type) {
    if (type === 'A') return 'Ace add card';
    if (type === 'Q') return 'Queen peek';
    if (type === 'J') return 'Jack swap';
    return type;
  }

  function specialName(rank) {
    return rank === 'A' ? 'Ace' : rank === 'Q' ? 'Queen' : 'Jack';
  }

  function cardLabel(card) {
    if (!card) return 'card';
    return `${card.rank}${suitSymbol(card.suit)}`;
  }

  function logTimestamp(date = new Date()) {
    const pad = (value) => String(value).padStart(2, '0');
    return date.getFullYear() + '-' +
      pad(date.getMonth() + 1) + '-' +
      pad(date.getDate()) + '_' +
      pad(date.getHours()) + '-' +
      pad(date.getMinutes()) + '-' +
      pad(date.getSeconds());
  }

  function logEntryTimeMs(entry) {
    if (!entry || typeof entry === 'string') return null;
    const ms = Date.parse(entry.at || '');
    return Number.isFinite(ms) ? ms : null;
  }

  function logRelativeBaseMs(lines) {
    const times = lines.map(logEntryTimeMs).filter(Number.isFinite);
    return times.length ? Math.min(...times) : null;
  }

  function formatRelativeLogTime(ms, baseMs) {
    if (!Number.isFinite(ms) || !Number.isFinite(baseMs)) return '+--:--.---';
    const elapsed = Math.max(0, ms - baseMs);
    const milliseconds = elapsed % 1000;
    const totalSeconds = Math.floor(elapsed / 1000);
    const seconds = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const minutes = totalMinutes % 60;
    const hours = Math.floor(totalMinutes / 60);
    const pad = (value, size = 2) => String(value).padStart(size, '0');
    const clock = hours > 0
      ? hours + ':' + pad(minutes) + ':' + pad(seconds)
      : pad(minutes) + ':' + pad(seconds);
    return '+' + clock + '.' + pad(milliseconds, 3);
  }

  function scoreHistoryRows(history = []) {
    if (history.length === 0) return ['No completed rounds yet.'];
    const playerNames = [];
    for (const entry of history) {
      for (const player of entry.players || []) {
        if (!playerNames.includes(player.name)) playerNames.push(player.name);
      }
    }
    const rows = ['Round | ' + playerNames.join(' | ')];
    rows.push(['---', ...playerNames.map(() => '---')].join(' | '));
    for (const entry of history) {
      rows.push([
        'Round ' + entry.round,
        ...playerNames.map((name) => {
          const player = (entry.players || []).find((item) => item.name === name);
          return player ? String(player.total) : '';
        })
      ].join(' | '));
    }
    return rows;
  }

  function quickRulesHtml() {
    return `
    <p><strong>Goal:</strong> As few points as possible.</p>
    <p><strong>Start:</strong> Each player gets 4 cards face down and may look at 2 of them. The first discard card is turned up only after everyone has finished peeking.</p>
    <p><strong>Turn:</strong> Draw one card. Either swap it with one of your own cards or discard it again.</p>
    <p><strong>Throwing in:</strong> Matching cards may be thrown in immediately unless the top card was itself thrown in. Wrong throw-in: one penalty card, and the top card stays open for another throw-in.</p>
    <p><strong>Points:</strong> Number cards count their value. A=1, J=11, Q=12, ♥♦K=0, ♣♠K=13.</p>
    <p><strong>Special cards:</strong> A may add one card to someone. Q may look at any one card. J may swap any two cards. These actions are optional.</p>
    <p>Anyone who believes they have 5 points or less may say <strong>Dutch</strong>. After that, everyone else gets one more turn. Then reveal and count. The player with the most points in the last round starts the next round.</p>
  `;
  }

  function fullRulesHtml(gameTarget) {
    return `
    <p>Dutch is a card game in which players try to collect as few points as possible over several rounds. It is played with a normal deck of cards without jokers. With many players, two decks can be shuffled together.</p>
    <p>At the beginning, each player receives four cards face down. Then each player may look at exactly two of their own cards. These cards are then placed face down again. After every player has finished peeking, one card is turned up from the draw pile to start the face-up discard pile. The remaining cards form the face-down draw pile.</p>
    <p>Play goes in turn order. The player whose turn it is draws one card, either from the draw pile or from the discard pile. If the player takes the card from the discard pile, they must swap it with one of their own cards. If the player takes a card from the draw pile, they may either swap it with one of their own cards or place it directly face up on the discard pile. If one of their own cards is replaced, that card goes face up onto the discard pile.</p>
    <p>Number cards count their value. Ace counts 1 point. Jack counts 11 points. Queen counts 12 points. Heart King and Diamond King count 0 points. Club King and Spade King count 13 points.</p>
    <p>Ace, Queen, and Jack are special cards as soon as they are placed face up on the discard pile. With an Ace, the player may give any player one face-down card from the draw pile. With a Queen, the player may look at any one card. With a Jack, the player may swap any two face-down cards. These actions are optional.</p>
    <p>If a card is lying face up on the discard pile, a player may immediately throw in by placing exactly one own face-down card onto the discard pile, if it has the same card value. Suit does not matter. Kings may be placed on each other when throwing in. A card that was thrown in cannot be thrown on again. If someone throws in wrongly and takes a penalty card, the same top card stays open for another throw-in until the next playing action.</p>
    <p>Anyone who throws in incorrectly takes their card back and receives one unknown face-down penalty card.</p>
    <p>If a player believes they have 5 points or less, they may say <strong>Dutch</strong> at the end of their turn. After that, every other player gets exactly one more turn. Then everyone reveals their cards and counts the points.</p>
    <p>If the Dutch caller has 5 points or less and nobody has fewer points, they receive 0 points for that round. If they have more than 5 points or another player has fewer points, their points are doubled. All other players receive their normal points.</p>
    <p>After each round, points are added to the total score. If a player reaches exactly 50 or exactly 100 points, their score is halved. The player with the most points in the previous round starts the next round. As soon as a player has more than ${gameTarget} points after scoring and halving, the game ends. The winner is the player with the fewest total points.</p>
  `;
  }

  return {
    PLAYER_NAME_MAX_LENGTH,
    GAME_DESCRIPTION,
    SUITS,
    RANKS,
    SPECIAL_RANKS,
    RED_SUITS,
    BOT_LABELS,
    BOT_PERSONALITIES,
    nameGraphemes,
    isEmojiGrapheme,
    shortPlayerName,
    normalizedShortPlayerName,
    suitSymbol,
    isRedSuit,
    cardPoints,
    specialLabel,
    specialName,
    cardLabel,
    logTimestamp,
    logEntryTimeMs,
    logRelativeBaseMs,
    formatRelativeLogTime,
    scoreHistoryRows,
    quickRulesHtml,
    fullRulesHtml
  };
});
