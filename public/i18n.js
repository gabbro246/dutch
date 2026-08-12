(function initDutchI18n(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DutchI18n = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createDutchI18n() {
  const STORAGE_KEY = 'dutchLanguage';
  const de = {
    'Play the card game Dutch against other people or bots.': 'Spiele das Kartenspiel Dutch gegen andere Personen oder Bots.',
    Language: 'Sprache', English: 'Englisch', German: 'Deutsch',
    'Choose the language used by this device.': 'Wähle die Sprache für dieses Gerät.',
    Name: 'Name', Join: 'Beitreten', Rejoin: 'Erneut beitreten', Leave: 'Verlassen', Remove: 'Entfernen',
    Bots: 'Bots', 'Choose bot...': 'Bot auswählen ...', 'Add bot': 'Bot hinzufügen', Settings: 'Einstellungen', 'Show help': 'Hilfe anzeigen',
    Players: 'Spieler', 'No players yet.': 'Noch keine Spieler.', 'Start game': 'Spiel starten',
    bot: 'Bot', spectator: 'Zuschauer', you: 'du', missing: 'fehlt', Watching: 'Zuschauer',
    'Move up': 'Nach oben', 'Move down': 'Nach unten', 'Move {name} up': '{name} nach oben verschieben',
    'Move {name} down': '{name} nach unten verschieben', 'Waiting for a human player.': 'Warte auf einen menschlichen Spieler.',
    'Waiting for another human or a bot.': 'Warte auf einen weiteren Menschen oder Bot.',
    'A game is already active. If you were disconnected, enter your name to rejoin.': 'Ein Spiel läuft bereits. Gib deinen Namen ein, um nach einer Unterbrechung erneut beizutreten.',
    'A game is already active. Join after the game ends.': 'Ein Spiel läuft bereits. Tritt bei, nachdem es beendet wurde.',
    'Started {time} ({elapsed})': 'Begonnen um {time} ({elapsed})', 'just now': 'gerade eben', '1 min ago': 'vor 1 Min.',
    '{count} min ago': 'vor {count} Min.', 'Players: {players}. {round}.': 'Spieler: {players}. {round}.',
    none: 'keine', 'Round {number}': 'Runde {number}', 'Round not started': 'Runde nicht begonnen',
    'Game length': 'Spieldauer', 'Single round': 'Eine Runde', 'Short game, 50 points': 'Kurzes Spiel, 50 Punkte',
    'Full game, 100 points': 'Volles Spiel, 100 Punkte',
    'Double game, 200 points': 'Doppeltes Spiel, 200 Punkte',
    'Choose how long the game lasts: a double game ends when a player passes 200 points, a full game uses 100 points, a short game uses 50 points, and a single round ends after one round with the lowest score winning.': 'Wähle die Spieldauer: Ein doppeltes Spiel endet über 200 Punkten, ein volles über 100 Punkten, ein kurzes über 50 Punkten und ein Spiel mit einer Runde nach dieser Runde. Die niedrigste Punktzahl gewinnt.',
    'Deck amount': 'Anzahl Kartendecks', 'One deck': 'Ein Kartendeck', 'Two decks': 'Zwei Kartendecks',
    'More decks make the game less predictable and add more special cards, though some may remain undealt. Two decks are required for more than four players.': 'Mehr Kartendecks machen das Spiel unvorhersehbarer und bringen mehr Sonderkarten. Bei mehr als vier Spielern sind zwei Kartendecks erforderlich.',
    Appearance: 'Darstellung', 'Light mode': 'Heller Modus', 'Dark mode': 'Dunkler Modus',
    'Choose the light or dark color theme.': 'Wähle das helle oder dunkle Farbschema.',
    'Inactive after': 'Inaktiv nach', '{count} minutes': '{count} Minuten',
    'If nobody plays for this long, the game ends and the room is freed for new players. Choose a longer time if everyone plans to return.': 'Wenn so lange niemand spielt, endet das Spiel und der Raum wird für neue Spieler freigegeben. Wähle mehr Zeit, falls alle zurückkehren möchten.',
    'Changed cards': 'Geänderte Karten', Highlight: 'Hervorheben', "Don't highlight": 'Nicht hervorheben',
    'Highlight cards that were changed recently for all players, making swaps and other changes easier to follow.': 'Hebt kürzlich geänderte Karten für alle hervor, damit Änderungen leichter zu verfolgen sind.',
    'Confirm leave': 'Verlassen bestätigen', 'Confirm remove': 'Entfernen bestätigen', 'Confirm end game': 'Spielende bestätigen',
    'Round ended. Cards are revealed and points were counted.': 'Die Runde ist beendet. Die Karten wurden aufgedeckt und die Punkte gezählt.',
    'Game ended. <strong>{winner} won the {length} game.</strong>': 'Das Spiel ist beendet. <strong>{winner} hat das Spiel über {length} gewonnen.</strong>',
    '{count} point': '{count} Punkte', 'Unknown player': 'Unbekannter Spieler',
    '{name} made a wrong throw-in and gets a penalty card.': '{name} hat falsch eingeworfen und erhält eine Strafkarte.',
    'A player': 'Ein Spieler', 'Start peek: each player must look at exactly two own cards.': 'Startblick: Jeder muss genau zwei eigene Karten ansehen.',
    'Opening card…': 'Startkarte wird aufgedeckt …', '{name} may use {special} or click Next player.': '{name} darf {special} einsetzen oder auf „Nächster“ klicken.',
    'Your turn is complete. Say Dutch or click Next player.': 'Dein Zug ist beendet. Sage Dutch oder klicke auf „Nächster“.',
    "{name}'s turn is complete. Waiting for Next player.": 'Der Zug von {name} ist beendet. Warte auf „Nächster“.',
    "{name}'s move.": '{name} ist am Zug.', 'The current player': 'Der aktuelle Spieler',
    '{caller} called Dutch. {current} is taking their final turn, with {count} more {players} still to go afterward.': '{caller} hat Dutch gesagt. {current} macht den letzten Zug; danach sind noch {count} {players} an der Reihe.',
    '{caller} called Dutch. {current} is taking the final turn of the round.': '{caller} hat Dutch gesagt. {current} macht den letzten Zug der Runde.',
    player: 'Spieler', players: 'Spieler', 'End game for all': 'Für alle beenden', 'Leave game': 'Spiel verlassen', Finish: 'Fertig',
    'Total: {total}': 'Gesamt: {total}', 'Total: {total}, round: {round}': 'Gesamt: {total}, Runde: {round}',
    'your cards': 'deine Karten', spectating: 'Zuschauer', 'Next round': 'Nächste Runde',
    'Finish round': 'Runde beenden', 'Next player': 'Nächster', 'wrong Dutch call': 'Dutch falsch angesagt',
    'said Dutch': 'Dutch angesagt', 'won this round': 'Runde gewonnen', 'won the game': 'Spiel gewonnen',
    Drawn: 'Gezogen', Discard: 'Ablegen', 'Deck ({count})': 'Stapel ({count})', 'Pile ({count})': 'Ablage ({count})',
    Take: 'Nehmen', empty: 'leer', Peek: 'Anseh.', Swap: 'Tausch', 'Throw in': 'Einwurf', Action: 'Aktion',
    add: '+Karte', peek: 'Blick', swap: 'Tausch', Points: 'Punkte', 'Points graph': 'Punktediagramm',
    'Points table': 'Punktetabelle', 'Points over time': 'Punkteverlauf',
    'Target: {points}': 'Ziel: {points}', 'Round {round}: {name}, {points} points': 'Runde {round}: {name}, {points} Punkte',
    'Game log': 'Spielverlauf',
    'Quick guide': 'Kurzanleitung', 'Complete rules': 'Vollständige Regeln',
    'Download game logs': 'Spielverlauf laden', 'Show less': 'Weniger anzeigen', 'Show more': 'Mehr anzeigen',
    Round: 'Runde', 'No completed rounds yet.': 'Noch keine abgeschlossenen Runden.',
    'Values show total points after each round. Number cards count their value. A=1, J=11, Q=12, red K=0, black K=13.': 'Die Werte zeigen die Gesamtpunktzahl nach jeder Runde. Zahlenkarten zählen ihren Wert. A=1, J=11, Q=12, roter K=0, schwarzer K=13.',
    'Dutch game log {timestamp}': 'Dutch-Spielverlauf {timestamp}', 'Exported: {timestamp}': 'Exportiert: {timestamp}',
    'Points table:': 'Punktetabelle:', 'Game log:': 'Spielverlauf:',
    'Ace add card': 'Ass: Karte geben', 'Queen peek': 'Dame: Karte ansehen', 'Jack swap': 'Bube: Karten tauschen'
  };
  const germanBots = {
    athena: ['Merkt sich Karten genau, wartet auf starke Tauschaktionen und handelt selten ohne Grund.', ['Gedächtnis', 'Tempo', 'Risiko', 'Druck', 'Disziplin']],
    roswell: ['Analysiert den Tisch unermüdlich, nutzt Tricks mit exakter Punktzahl und verschenkt fast nie Kartenwert.', ['Gedächtnis', 'Tempo', 'Risiko', 'Druck', 'Disziplin']],
    norman: ['Trifft ausgewogene Entscheidungen, liest den Tisch gelassen und hat ein sicheres Gefühl für den richtigen Zeitpunkt.', ['Gedächtnis', 'Tempo', 'Risiko', 'Druck', 'Disziplin']],
    dory: ['Spielt sprunghaft und mutig, merkt sich Karten nur grob und lässt sich leicht zu riskanten Zügen verleiten.', ['Gedächtnis', 'Tempo', 'Risiko', 'Druck', 'Disziplin']]
  };
  function normalizeLanguage(value) { return String(value || '').toLowerCase().split('-')[0] === 'de' ? 'de' : 'en'; }
  function getStoredLanguage(target) {
    try { return normalizeLanguage(target && target.localStorage.getItem(STORAGE_KEY)); } catch (error) { return 'en'; }
  }
  function setLanguage(language, target) {
    const value = normalizeLanguage(language);
    try { if (target) target.localStorage.setItem(STORAGE_KEY, value); } catch (error) {}
    if (target && target.document) target.document.documentElement.lang = value;
    return value;
  }
  function translate(language, key, values) {
    const template = normalizeLanguage(language) === 'de' && de[key] ? de[key] : key;
    const data = values || {};
    return String(template).replace(/\{(\w+)\}/g, function replace(match, name) {
      return data[name] === undefined ? match : String(data[name]);
    });
  }
  function localizedBotPersonality(language, type, fallback) {
    const item = normalizeLanguage(language) === 'de' && germanBots[type];
    if (!item || !fallback) return fallback;
    return Object.assign({}, fallback, { summary: item[0], stats: fallback.stats.map(function map(stat, index) { return [item[1][index], stat[1]]; }) });
  }
  function specialLabel(language, type) {
    return translate(language, type === 'A' ? 'Ace add card' : type === 'Q' ? 'Queen peek' : type === 'J' ? 'Jack swap' : type);
  }
  function quickRulesHtml(language) {
    if (normalizeLanguage(language) !== 'de') return '';
    return '<p><strong>Ziel:</strong> So wenige Punkte wie möglich.</p><p><strong>Start:</strong> Jeder erhält 4 verdeckte Karten und darf 2 davon ansehen. Die erste Ablagekarte wird erst aufgedeckt, nachdem alle fertig sind.</p><p><strong>Zug:</strong> Ziehe eine Karte. Tausche sie gegen eine eigene Karte oder lege sie wieder ab.</p><p><strong>Einwerfen:</strong> Passende Karten dürfen sofort eingeworfen werden, außer die oberste Karte wurde selbst eingeworfen. Bei einem falschen Einwurf gibt es eine Strafkarte.</p><p><strong>Punkte:</strong> Zahlenkarten zählen ihren Wert. A=1, J=11, Q=12, ♥♦K=0, ♣♠K=13.</p><p><strong>Sonderkarten:</strong> Mit A darf jemandem eine Karte gegeben werden. Mit Q darf eine Karte angesehen werden. Mit J dürfen zwei Karten getauscht werden.</p><p>Wer glaubt, höchstens 5 Punkte zu haben, darf <strong>Dutch</strong> sagen. Danach erhält jeder andere einen letzten Zug. Dann wird aufgedeckt und gezählt.</p>';
  }
  function fullRulesHtml(language, gameTarget, singleRound) {
    if (normalizeLanguage(language) !== 'de') return '';
    const ending = singleRound
      ? 'Bei einem Spiel mit nur einer Runde endet das Spiel nach der ersten Runde. Wer insgesamt die wenigsten Punkte hat, gewinnt.'
      : 'Wer in der vorigen Runde die meisten Punkte hatte, beginnt die nächste. Sobald jemand nach Wertung und Halbierung mehr als ' + gameTarget + ' Punkte hat, endet das Spiel. Wer insgesamt die wenigsten Punkte hat, gewinnt.';
    return '<p>Dutch ist ein Kartenspiel, bei dem alle versuchen, so wenige Punkte wie möglich zu sammeln. Gespielt wird mit einem normalen Kartendeck ohne Joker. Bei vielen Spielern können zwei Kartendecks zusammengemischt werden.</p>' +
      '<p>Zu Beginn erhält jeder vier verdeckte Karten. Danach darf jeder genau zwei eigene Karten ansehen und legt sie wieder verdeckt ab. Wenn alle fertig sind, wird eine Karte vom Zugstapel aufgedeckt und eröffnet den Ablagestapel. Die übrigen Karten bilden den verdeckten Zugstapel.</p>' +
      '<p>Es wird der Reihe nach gespielt. Wer am Zug ist, zieht entweder vom Zug- oder Ablagestapel. Eine Karte vom Ablagestapel muss gegen eine eigene Karte getauscht werden. Eine Karte vom Zugstapel darf gegen eine eigene getauscht oder direkt offen abgelegt werden. Eine ersetzte eigene Karte kommt offen auf den Ablagestapel.</p>' +
      '<p>Zahlenkarten zählen ihren Wert. Das Ass zählt 1, der Bube 11 und die Dame 12 Punkte. Herz- und Karo-König zählen 0, Kreuz- und Pik-König 13 Punkte.</p>' +
      '<p>Ass, Dame und Bube sind Sonderkarten, sobald sie offen auf dem Ablagestapel liegen. Mit einem Ass darf einem beliebigen Spieler eine verdeckte Karte vom Zugstapel gegeben werden. Mit einer Dame darf eine beliebige Karte angesehen werden. Mit einem Buben dürfen zwei verdeckte Karten getauscht werden. Diese Aktionen sind freiwillig.</p>' +
      '<p>Liegt eine Karte offen auf dem Ablagestapel, darf sofort genau eine eigene verdeckte Karte mit demselben Kartenwert eingeworfen werden. Die Farbe ist egal und Könige passen aufeinander. Auf eine eingeworfene Karte darf nicht erneut eingeworfen werden. Nach einem falschen Einwurf bleibt dieselbe oberste Karte bis zur nächsten Spielaktion für weitere Einwürfe offen.</p>' +
      '<p>Wer falsch einwirft, nimmt seine Karte zurück und erhält eine unbekannte verdeckte Strafkarte.</p>' +
      '<p>Wer glaubt, höchstens 5 Punkte zu haben, darf am Ende des eigenen Zuges <strong>Dutch</strong> sagen. Danach erhält jeder andere genau einen letzten Zug. Anschließend decken alle ihre Karten auf und zählen die Punkte.</p>' +
      '<p>Hat der Dutch-Ansager höchstens 5 Punkte und niemand weniger, erhält er für die Runde 0 Punkte. Hat er mehr als 5 Punkte oder hat jemand weniger, werden seine Punkte verdoppelt. Alle anderen erhalten ihre normale Punktzahl.</p>' +
      '<p>Nach jeder Runde werden die Punkte zur Gesamtpunktzahl addiert. Erreicht jemand genau 50, 100 oder 200 Punkte, wird die Punktzahl halbiert. ' + ending + '</p>';
  }
  function translateGameText(language, input) {
    if (normalizeLanguage(language) !== 'de') return String(input || '');
    const value = String(input || '');
    const exact = { 'game started': 'Spiel begonnen', 'all active players finished peeking': 'Alle aktiven Spieler haben ihre Startkarten angesehen', 'discard pile reshuffled into draw pile': 'Der Ablagestapel wurde zum Zugstapel gemischt', 'A game is already active. Join after the game ends.': de['A game is already active. Join after the game ends.'], 'Bots can only be added in the waiting room.': 'Bots können nur im Warteraum hinzugefügt werden.', 'Unknown bot type.': 'Unbekannter Bot-Typ.', 'The player list is full.': 'Die Spielerliste ist voll.', 'That bot is already in the player list.': 'Dieser Bot ist bereits in der Spielerliste.' };
    if (exact[value]) return exact[value];
    const gameLengthChange = value.match(/^(.+) changed game length from (single round|\d+ points) to (single round|\d+ points)$/i);
    if (gameLengthChange) {
      const localizedLength = function localizedLength(length, dative) {
        if (length.toLowerCase() === 'single round') return dative ? 'einer Runde' : 'eine Runde';
        return length.replace(/ points$/i, dative ? ' Punkten' : ' Punkte');
      };
      return gameLengthChange[1] + ' hat die Spieldauer von ' + localizedLength(gameLengthChange[2], true) + ' auf ' + localizedLength(gameLengthChange[3], false) + ' geändert';
    }
    const inactivityChange = value.match(/^(.+) changed inactivity timeout from (\d+) to (\d+) minutes$/i);
    if (inactivityChange) {
      return inactivityChange[1] + ' hat die Inaktivitätsgrenze von ' + inactivityChange[2] + ' auf ' + inactivityChange[3] + ' Minuten geändert';
    }
    const highlightingChange = value.match(/^(.+) turned changed-card highlighting (on|off)$/i);
    if (highlightingChange) {
      return highlightingChange[1] + ' hat das Hervorheben geänderter Karten ' + (highlightingChange[2].toLowerCase() === 'on' ? 'eingeschaltet' : 'ausgeschaltet');
    }
    const rules = [[/^round (\d+) started$/i, 'Runde $1 begonnen'], [/^game ended\. (.+) won$/i, 'Spiel beendet. $1 hat gewonnen'], [/^(.+) finished start peek$/i, '$1 hat die Startkarten angesehen'], [/^(.+) said Dutch$/i, '$1 hat Dutch gesagt'], [/^(.+) used Jack swap$/i, '$1 hat mit dem Buben getauscht'], [/^(.+) used Queen peek$/i, '$1 hat mit der Dame eine Karte angesehen'], [/^(.+) gave a card to (.+)$/i, '$1 hat $2 eine Karte gegeben'], [/^(.+) made a wrong throw-in and took a penalty card$/i, '$1 hat falsch eingeworfen und eine Strafkarte genommen'], [/^(.+) threw in (?:an? )?(.+)$/i, '$1 hat $2 eingeworfen'], [/^(.+) joined as a spectator$/i, '$1 ist als Zuschauer beigetreten'], [/^(.+) joined$/i, '$1 ist beigetreten'], [/^(.+) reconnected$/i, '$1 ist wieder verbunden'], [/^(.+) disconnected$/i, '$1 hat die Verbindung verloren'], [/^(.+) left$/i, '$1 hat das Spiel verlassen']];
    for (const rule of rules) if (rule[0].test(value)) return value.replace(rule[0], rule[1]);
    return value.replace(/^round ended\./i, 'Runde beendet.')
      .replace(/^game ended because no human-playable table remains$/i, 'Spiel beendet, weil keine spielbare Runde mit Menschen mehr vorhanden ist')
      .replace(/^(.+) left, turn skipped$/i, '$1 hat das Spiel verlassen; der Zug wurde übersprungen')
      .replace(/^(.+) was removed after (\d+) minutes offline$/i, '$1 wurde nach $2 Minuten ohne Verbindung entfernt')
      .replace(/^(.+) skipped (Ace|Queen|Jack) because they left$/i, '$1 hat $2 übersprungen, weil die Person das Spiel verlassen hat')
      .replace(/^(.+) skipped (Ace|Queen|Jack)$/i, '$1 hat $2 übersprungen')
      .replace(/^(.+) cannot be added because that table name is already used\.$/i, '$1 kann nicht hinzugefügt werden, weil dieser Name bereits verwendet wird.')
      .replace(/ gained (\d+) points?\b/g, ' erhielt $1 Punkte')
      .replace(/ lost (\d+) points?\b/g, ' verlor $1 Punkte')
      .replace(/'s total was halved$/i, 's Gesamtpunktzahl wurde halbiert')
      .replace(/ made a wrong throw-in but no penalty card was available$/i, ' hat falsch eingeworfen, aber es war keine Strafkarte verfügbar')
      .replace(/\bAce\b/g, 'Ass')
      .replace(/\bQueen\b/g, 'Dame')
      .replace(/\bJack\b/g, 'Bube')
      .replace(/ drew from deck and discarded /g, ' zog vom Zugstapel und legte ')
      .replace(/ and may use /g, ' ab und darf einsetzen: ')
      .replace(/ placed /g, ' legte ');
  }
  return { STORAGE_KEY: STORAGE_KEY, normalizeLanguage: normalizeLanguage, getStoredLanguage: getStoredLanguage, setLanguage: setLanguage, translate: translate, localizedBotPersonality: localizedBotPersonality, specialLabel: specialLabel, quickRulesHtml: quickRulesHtml, fullRulesHtml: fullRulesHtml, translateGameText: translateGameText };
});
