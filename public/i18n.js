(function initDutchI18n(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DutchI18n = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createDutchI18n() {
  const STORAGE_KEY = 'dutchLanguage';
  const de = {
    'Play the card game Dutch against other people or bots.': 'Spiele das Kartenspiel Dutch gegen andere Personen oder Bots.',
    Language: 'Sprache', English: 'Englisch', German: 'Deutsch', Russian: 'Russisch',
    'Choose the language used by this device.': 'Wähle die Sprache für dieses Gerät.',
    Name: 'Name', Join: 'Beitreten', Rejoin: 'Erneut beitreten', Leave: 'Verlassen', Remove: 'Entfernen',
    Bots: 'Bots', 'No bots left': 'Keine Bots übrig', 'Add bot': 'Bot hinzufügen', Settings: 'Einstellungen', 'Show help': 'Hilfe anzeigen',
    Players: 'Spieler', 'No players yet.': 'Noch keine Spieler.', 'Start game': 'Spiel starten',
    bot: 'Bot', spectator: 'Zuschauer', user: 'Benutzer', missing: 'fehlt', Watching: 'Zuschauer',
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
    'Sound effects': 'Soundeffekte', On: 'An', Off: 'Aus',
    'Play game sound effects on this device.': 'Spiele auf diesem Gerät Soundeffekte für das Spiel ab.',
    'Inactive after': 'Inaktiv nach', '{count} minutes': '{count} Minuten',
    'If nobody plays for this long, the game ends and the room is freed for new players. Choose a longer time if everyone plans to return.': 'Wenn so lange niemand spielt, endet das Spiel und der Raum wird für neue Spieler freigegeben. Wähle mehr Zeit, falls alle zurückkehren möchten.',
    'Bot speed': 'Bot-Geschwindigkeit', Instant: 'Sofort', Fast: 'Schnell', Medium: 'Mittel', Slow: 'Langsam', 'Human-like': 'Menschenähnlich',
    'Choose how quickly bots take their turns. The throw-in window always lasts 1.6 seconds and is not affected by bot speed. This setting is shared by everyone.': 'Wähle, wie schnell Bots ihre Züge machen. Das Zeitfenster zum Einwerfen beträgt immer 1,6 Sekunden und wird von der Bot-Geschwindigkeit nicht beeinflusst. Diese Einstellung gilt für alle.',
    'Changed cards': 'Geänderte Karten', Highlight: 'Hervorheben', "Don't highlight": 'Nicht hervorheben',
    'Highlight cards that were changed recently for all players, making swaps and other changes easier to follow.': 'Hebt kürzlich geänderte Karten für alle hervor, damit Änderungen leichter zu verfolgen sind.',
    'Confirm leave': 'Verlassen bestätigen', 'Confirm remove': 'Entfernen bestätigen', 'Confirm end game': 'Spielende bestätigen',
    'Round ended. Cards are revealed and points were counted.': 'Die Runde ist beendet. Die Karten wurden aufgedeckt und die Punkte gezählt.',
    'Game ended. <strong>{winner} won the {length} game.</strong>': 'Das Spiel ist beendet. <strong>{winner} hat das Spiel über {length} gewonnen.</strong>',
    '{count} point': '{count} Punkte', 'Unknown player': 'Unbekannter Spieler',
    '{name} made a wrong throw-in and gets a penalty card.': '{name} hat falsch eingeworfen und erhält eine Strafkarte.',
    'A player': 'Ein Spieler', 'Dealing cards…': 'Karten werden ausgeteilt …', 'Start peek: each player must look at exactly two own cards.': 'Startblick: Jeder muss genau zwei eigene Karten ansehen.',
    'Opening card…': 'Startkarte wird aufgedeckt …', '{name} may use {special} or click Next player.': '{name} darf {special} einsetzen oder auf „Nächster“ klicken.',
    'Last chance to throw in…': 'Letzte Chance zum Einwerfen …',
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
    Take: 'Nehmen', Shuffle: 'Mischen', empty: 'leer', Peek: 'Anseh.', Swap: 'Tausch', 'Throw in': 'Einwurf', Action: 'Aktion',
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
  const ru = {
    'Play the card game Dutch against other people or bots.': 'Играйте в карточную игру Dutch с другими людьми или ботами.',
    Language: 'Язык', English: 'Английский', German: 'Немецкий', Russian: 'Русский',
    'Choose the language used by this device.': 'Выберите язык для этого устройства.',
    Name: 'Имя', Join: 'Войти', Rejoin: 'Вернуться', Leave: 'Выйти', Remove: 'Удалить',
    Bots: 'Боты', 'No bots left': 'Ботов не осталось', 'Add bot': 'Добавить бота', Settings: 'Настройки', 'Show help': 'Показать справку',
    Players: 'Игроки', 'No players yet.': 'Игроков пока нет.', 'Start game': 'Начать игру',
    bot: 'бот', spectator: 'зритель', user: 'пользователь', missing: 'нет на месте', Watching: 'Наблюдают',
    'Move up': 'Переместить вверх', 'Move down': 'Переместить вниз', 'Move {name} up': 'Переместить {name} вверх',
    'Move {name} down': 'Переместить {name} вниз', 'Waiting for a human player.': 'Ожидание игрока-человека.',
    'Waiting for another human or a bot.': 'Ожидание ещё одного игрока или бота.',
    'A game is already active. If you were disconnected, enter your name to rejoin.': 'Игра уже идёт. Если связь прервалась, введите своё имя, чтобы вернуться.',
    'A game is already active. Join after the game ends.': 'Игра уже идёт. Присоединиться можно после её окончания.',
    'Started {time} ({elapsed})': 'Начало: {time} ({elapsed})', 'just now': 'только что', '1 min ago': '1 мин. назад',
    '{count} min ago': '{count} мин. назад', 'Players: {players}. {round}.': 'Игроки: {players}. {round}.',
    none: 'нет', 'Round {number}': 'Раунд {number}', 'Round not started': 'Раунд не начат',
    'Game length': 'Длина игры', 'Single round': 'Один раунд', 'Short game, 50 points': 'Короткая игра, 50 очков',
    'Full game, 100 points': 'Полная игра, 100 очков', 'Double game, 200 points': 'Двойная игра, 200 очков',
    'Choose how long the game lasts: a double game ends when a player passes 200 points, a full game uses 100 points, a short game uses 50 points, and a single round ends after one round with the lowest score winning.': 'Выберите длину игры: двойная заканчивается, когда игрок набирает больше 200 очков, полная — больше 100, короткая — больше 50, а игра из одного раунда заканчивается после первого раунда. Побеждает игрок с наименьшим счётом.',
    'Deck amount': 'Количество колод', 'One deck': 'Одна колода', 'Two decks': 'Две колоды',
    'More decks make the game less predictable and add more special cards, though some may remain undealt. Two decks are required for more than four players.': 'Дополнительная колода делает игру менее предсказуемой и добавляет особые карты, хотя некоторые карты могут остаться неразданными. Для игры более чем вчетвером нужны две колоды.',
    Appearance: 'Оформление', 'Light mode': 'Светлая тема', 'Dark mode': 'Тёмная тема',
    'Choose the light or dark color theme.': 'Выберите светлую или тёмную цветовую тему.',
    'Sound effects': 'Звуковые эффекты', On: 'Вкл.', Off: 'Выкл.',
    'Play game sound effects on this device.': 'Воспроизводить звуковые эффекты игры на этом устройстве.',
    'Inactive after': 'Завершить через', '{count} minutes': '{count} мин.',
    'If nobody plays for this long, the game ends and the room is freed for new players. Choose a longer time if everyone plans to return.': 'Если столько времени никто не делает ход, игра завершается и комната освобождается для новых игроков. Выберите больше времени, если все планируют вернуться.',
    'Bot speed': 'Скорость ботов', Instant: 'Мгновенно', Fast: 'Быстро', Medium: 'Средне', Slow: 'Медленно', 'Human-like': 'Как человек',
    'Choose how quickly bots take their turns. The throw-in window always lasts 1.6 seconds and is not affected by bot speed. This setting is shared by everyone.': 'Выберите, как быстро боты делают ходы. Окно для сброса всегда длится 1,6 секунды и не зависит от скорости ботов. Настройка общая для всех.',
    'Changed cards': 'Изменённые карты', Highlight: 'Подсвечивать', "Don't highlight": 'Не подсвечивать',
    'Highlight cards that were changed recently for all players, making swaps and other changes easier to follow.': 'Подсвечивает недавно изменённые карты у всех игроков, чтобы было легче следить за обменами и другими изменениями.',
    'Confirm leave': 'Подтвердить выход', 'Confirm remove': 'Подтвердить удаление', 'Confirm end game': 'Подтвердить завершение игры',
    'Round ended. Cards are revealed and points were counted.': 'Раунд завершён. Карты открыты, очки подсчитаны.',
    'Game ended. <strong>{winner} won the {length} game.</strong>': 'Игра завершена. <strong>{winner} побеждает в игре «{length}».</strong>',
    '{count} point': '{count} очк.', 'Unknown player': 'Неизвестный игрок',
    '{name} made a wrong throw-in and gets a penalty card.': '{name} ошибается при сбросе и получает штрафную карту.',
    'A player': 'Игрок', 'Dealing cards…': 'Карты раздаются…', 'Start peek: each player must look at exactly two own cards.': 'Начальный просмотр: каждый игрок должен посмотреть ровно две свои карты.',
    'Opening card…': 'Открывается первая карта…', '{name} may use {special} or click Next player.': '{name} может применить действие «{special}» или нажать «Следующий».',
    'Last chance to throw in…': 'Последняя возможность сбросить карту…',
    'Your turn is complete. Say Dutch or click Next player.': 'Ваш ход завершён. Объявите Dutch или нажмите «Следующий».',
    "{name}'s turn is complete. Waiting for Next player.": 'Ход игрока {name} завершён. Ожидание кнопки «Следующий».',
    "{name}'s move.": 'Ход игрока {name}.', 'The current player': 'Текущий игрок',
    '{caller} called Dutch. {current} is taking their final turn, with {count} more {players} still to go afterward.': '{caller} объявляет Dutch. {current} делает последний ход, после чего остаётся ещё игроков: {count}.',
    '{caller} called Dutch. {current} is taking the final turn of the round.': '{caller} объявляет Dutch. {current} делает последний ход в раунде.',
    player: 'игрок', players: 'игроков', 'End game for all': 'Завершить игру для всех', 'Leave game': 'Покинуть игру', Finish: 'Готово',
    'Total: {total}': 'Всего: {total}', 'Total: {total}, round: {round}': 'Всего: {total}, раунд: {round}',
    'your cards': 'ваши карты', spectating: 'наблюдение', 'Next round': 'Следующий раунд',
    'Finish round': 'Завершить раунд', 'Next player': 'Следующий', 'wrong Dutch call': 'ошибочно объявлен Dutch',
    'said Dutch': 'объявлен Dutch', 'won this round': 'победа в раунде', 'won the game': 'победа в игре',
    Drawn: 'Взятая карта', Discard: 'Сбросить', 'Deck ({count})': 'Колода ({count})', 'Pile ({count})': 'Сброс ({count})',
    Take: 'Взять', Shuffle: 'Мешать', empty: 'пусто', Peek: 'Смотр.', Swap: 'Обмен', 'Throw in': 'Сброс', Action: 'Действие',
    add: '+Карта', peek: 'Взгляд', swap: 'Обмен', Points: 'Очки', 'Points graph': 'График очков',
    'Points table': 'Таблица очков', 'Points over time': 'Очки по раундам',
    'Target: {points}': 'Цель: {points}', 'Round {round}: {name}, {points} points': 'Раунд {round}: {name}, {points} очк.',
    'Game log': 'Журнал игры', 'Quick guide': 'Краткие правила', 'Complete rules': 'Полные правила',
    'Download game logs': 'Скачать журнал игры', 'Show less': 'Показать меньше', 'Show more': 'Показать больше',
    Round: 'Раунд', 'No completed rounds yet.': 'Завершённых раундов пока нет.',
    'Values show total points after each round. Number cards count their value. A=1, J=11, Q=12, red K=0, black K=13.': 'Показано общее число очков после каждого раунда. Числовые карты дают свой номинал. A=1, J=11, Q=12, красный K=0, чёрный K=13.',
    'Dutch game log {timestamp}': 'Журнал игры Dutch {timestamp}', 'Exported: {timestamp}': 'Экспортировано: {timestamp}',
    'Points table:': 'Таблица очков:', 'Game log:': 'Журнал игры:',
    'Ace add card': 'Туз: дать карту', 'Queen peek': 'Дама: смотреть', 'Jack swap': 'Валет: обмен'
  };
  const germanBots = {
    athena: ['Merkt sich Karten genau, wartet auf starke Tauschaktionen und handelt selten ohne Grund.', ['Gedächtnis', 'Tempo', 'Risiko', 'Druck', 'Disziplin']],
    roswell: ['Analysiert den Tisch unermüdlich, nutzt Tricks mit exakter Punktzahl und verschenkt fast nie Kartenwert.', ['Gedächtnis', 'Tempo', 'Risiko', 'Druck', 'Disziplin']],
    norman: ['Trifft ausgewogene Entscheidungen, liest den Tisch gelassen und hat ein sicheres Gefühl für den richtigen Zeitpunkt.', ['Gedächtnis', 'Tempo', 'Risiko', 'Druck', 'Disziplin']],
    dory: ['Spielt sprunghaft und mutig, merkt sich Karten nur grob und lässt sich leicht zu riskanten Zügen verleiten.', ['Gedächtnis', 'Tempo', 'Risiko', 'Druck', 'Disziplin']]
  };
  const russianBots = {
    athena: ['Точно запоминает карты, ждёт выгодных обменов и редко действует без причины.', ['Память', 'Темп', 'Риск', 'Напор', 'Дисциплина']],
    roswell: ['Неустанно анализирует стол, точно рассчитывает хитрые ходы и почти никогда не отдаёт ценные карты.', ['Память', 'Темп', 'Риск', 'Напор', 'Дисциплина']],
    norman: ['Принимает взвешенные решения, спокойно читает стол и хорошо чувствует подходящий момент.', ['Память', 'Темп', 'Риск', 'Напор', 'Дисциплина']],
    dory: ['Играет порывисто и смело, помнит карты лишь приблизительно и легко решается на рискованные ходы.', ['Память', 'Темп', 'Риск', 'Напор', 'Дисциплина']]
  };
  function normalizeLanguage(value) {
    const language = String(value || '').toLowerCase().split('-')[0];
    return language === 'de' || language === 'ru' ? language : 'en';
  }
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
    const dictionary = { de: de, ru: ru }[normalizeLanguage(language)];
    const template = dictionary && dictionary[key] ? dictionary[key] : key;
    const data = values || {};
    return String(template).replace(/\{(\w+)\}/g, function replace(match, name) {
      return data[name] === undefined ? match : String(data[name]);
    });
  }
  function localizedBotPersonality(language, type, fallback) {
    const botTranslations = { de: germanBots, ru: russianBots }[normalizeLanguage(language)];
    const item = botTranslations && botTranslations[type];
    if (!item || !fallback) return fallback;
    return Object.assign({}, fallback, { summary: item[0], stats: fallback.stats.map(function map(stat, index) { return [item[1][index], stat[1]]; }) });
  }
  function specialLabel(language, type) {
    return translate(language, type === 'A' ? 'Ace add card' : type === 'Q' ? 'Queen peek' : type === 'J' ? 'Jack swap' : type);
  }
  function quickRulesHtml(language) {
    const locale = normalizeLanguage(language);
    if (locale === 'ru') return '<p><strong>Цель:</strong> набрать как можно меньше очков.</p><p><strong>Начало:</strong> каждый получает 4 закрытые карты и может посмотреть 2 из них. Первая карта сброса открывается только после того, как все закончат просмотр.</p><p><strong>Ход:</strong> возьмите карту. Обменяйте её на одну из своих карт или сбросьте.</p><p><strong>Быстрый сброс:</strong> совпадающую по достоинству карту можно сразу сбросить, кроме случая, когда верхняя карта сама была сыграна быстрым сбросом. За ошибку игрок получает штрафную карту.</p><p><strong>Очки:</strong> числовые карты дают свой номинал. A=1, J=11, Q=12, <span class="red-card-value">♥♦K=0</span>, ♣♠K=13.</p><p><strong>Особые карты:</strong> A позволяет дать кому-нибудь карту. Q позволяет посмотреть карту. J позволяет обменять две карты.</p><p>Игрок, который считает, что у него не больше 5 очков, может объявить <strong>Dutch</strong>. После этого каждый соперник делает последний ход, затем карты открываются и подсчитываются очки.</p>';
    if (locale !== 'de') return '';
    return '<p><strong>Ziel:</strong> So wenige Punkte wie möglich.</p><p><strong>Start:</strong> Jeder erhält 4 verdeckte Karten und darf 2 davon ansehen. Die erste Ablagekarte wird erst aufgedeckt, nachdem alle fertig sind.</p><p><strong>Zug:</strong> Ziehe eine Karte. Tausche sie gegen eine eigene Karte oder lege sie wieder ab.</p><p><strong>Einwerfen:</strong> Passende Karten dürfen sofort eingeworfen werden, außer die oberste Karte wurde selbst eingeworfen. Bei einem falschen Einwurf gibt es eine Strafkarte.</p><p><strong>Punkte:</strong> Zahlenkarten zählen ihren Wert. A=1, J=11, Q=12, <span class="red-card-value">♥♦K=0</span>, ♣♠K=13.</p><p><strong>Sonderkarten:</strong> Mit A darf jemandem eine Karte gegeben werden. Mit Q darf eine Karte angesehen werden. Mit J dürfen zwei Karten getauscht werden.</p><p>Wer glaubt, höchstens 5 Punkte zu haben, darf <strong>Dutch</strong> sagen. Danach erhält jeder andere einen letzten Zug. Dann wird aufgedeckt und gezählt.</p>';
  }
  function fullRulesHtml(language, gameTarget, singleRound) {
    const locale = normalizeLanguage(language);
    if (locale === 'ru') {
      const ending = singleRound
        ? 'В игре из одного раунда партия заканчивается после первого раунда. Побеждает игрок с наименьшим общим счётом.'
        : 'Следующий раунд начинает игрок, набравший больше всего очков в предыдущем. Когда после подсчёта и возможного деления счёта пополам у кого-либо оказывается больше ' + gameTarget + ' очков, игра заканчивается. Побеждает игрок с наименьшим общим счётом.';
      return '<p>Dutch — карточная игра, в которой все стараются набрать как можно меньше очков. Используется обычная колода без джокеров. Для большого числа игроков можно смешать две колоды.</p>' +
        '<p>В начале каждый получает четыре закрытые карты. Затем каждый игрок смотрит ровно две свои карты и снова кладёт их рубашкой вверх. Когда все закончат, одна карта из колоды открывается и начинает стопку сброса. Остальные карты образуют закрытую колоду.</p>' +
        '<p>Игроки ходят по очереди и берут карту из колоды или стопки сброса. Карту из сброса нужно обменять на одну из своих. Карту из колоды можно обменять на свою или сразу положить в сброс лицом вверх. Заменённая собственная карта кладётся в сброс лицом вверх.</p>' +
        '<p>Числовые карты дают очки по номиналу. Туз даёт 1, валет — 11, дама — 12 очков. Короли червей и бубен дают 0, короли треф и пик — 13 очков.</p>' +
        '<p>Туз, дама и валет становятся особыми картами, когда оказываются сверху стопки сброса лицом вверх. Туз позволяет дать любому игроку закрытую карту из колоды. Дама позволяет посмотреть любую карту. Валет позволяет обменять две закрытые карты. Использовать эти действия необязательно.</p>' +
        '<p>Когда карта лежит сверху стопки сброса лицом вверх, любой игрок может немедленно сбросить ровно одну свою закрытую карту того же достоинства. Масть не имеет значения, все короли совпадают. На карту, сыгранную таким быстрым сбросом, нельзя сразу сбросить ещё одну. После ошибочного сброса та же верхняя карта остаётся доступной для других быстрых сбросов до следующего игрового действия.</p>' +
        '<p>При ошибочном сбросе игрок забирает свою карту обратно и получает неизвестную закрытую штрафную карту.</p>' +
        '<p>Игрок, который считает, что у него не больше 5 очков, может в конце своего хода объявить <strong>Dutch</strong>. После этого каждый соперник делает ровно один последний ход. Затем все открывают карты и подсчитывают очки.</p>' +
        '<p>Если у объявившего Dutch не больше 5 очков и ни у кого нет меньшего результата, он получает за раунд 0 очков. Если у него больше 5 очков или у другого игрока меньше, его очки удваиваются. Все остальные получают обычное количество очков.</p>' +
        '<p>После каждого раунда очки прибавляются к общему счёту. Если счёт игрока становится ровно 50, 100 или 200 очков, он делится пополам. ' + ending + '</p>';
    }
    if (locale !== 'de') return '';
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
  function translateRussianGameText(input) {
    const value = String(input || '');
    const exact = {
      'game started': 'Игра началась',
      'all active players finished peeking': 'Все активные игроки закончили начальный просмотр',
      'discard pile reshuffled into draw pile': 'Стопка сброса перемешана и стала колодой',
      'A game is already active. Join after the game ends.': ru['A game is already active. Join after the game ends.'],
      'Bots can only be added in the waiting room.': 'Ботов можно добавлять только в комнате ожидания.',
      'Unknown bot type.': 'Неизвестный тип бота.',
      'The player list is full.': 'Список игроков заполнен.',
      'That bot is already in the player list.': 'Этот бот уже есть в списке игроков.'
    };
    if (exact[value]) return exact[value];
    const gameLengthChange = value.match(/^(.+) changed game length from (single round|\d+ points) to (single round|\d+ points)$/i);
    if (gameLengthChange) {
      const localizedLength = function localizedLength(length) {
        return length.toLowerCase() === 'single round' ? 'один раунд' : length.replace(/ points$/i, ' очков');
      };
      return gameLengthChange[1] + ' меняет длину игры: ' + localizedLength(gameLengthChange[2]) + ' → ' + localizedLength(gameLengthChange[3]);
    }
    const inactivityChange = value.match(/^(.+) changed inactivity timeout from (\d+) to (\d+) minutes$/i);
    if (inactivityChange) return inactivityChange[1] + ' меняет время до завершения при бездействии: ' + inactivityChange[2] + ' → ' + inactivityChange[3] + ' мин.';
    const botTimingChange = value.match(/^(.+) changed bot timing from (\d+)% to (\d+)%$/i);
    if (botTimingChange) return botTimingChange[1] + ' меняет время ожидания ботов: ' + botTimingChange[2] + '% → ' + botTimingChange[3] + '%';
    const botSpeedChange = value.match(/^(.+) changed bot speed from (Instant|Fast|Medium|Slow|Human-like) to (Instant|Fast|Medium|Slow|Human-like)$/i);
    if (botSpeedChange) return botSpeedChange[1] + ' меняет скорость ботов: ' + translate('ru', botSpeedChange[2]) + ' → ' + translate('ru', botSpeedChange[3]);
    const highlightingChange = value.match(/^(.+) turned changed-card highlighting (on|off)$/i);
    if (highlightingChange) return highlightingChange[1] + (highlightingChange[2].toLowerCase() === 'on' ? ' включает' : ' выключает') + ' подсветку изменённых карт';
    const rules = [
      [/^round (\d+) started$/i, 'Раунд $1 начался'],
      [/^game ended\. (.+) won$/i, 'Игра завершена. Побеждает $1'],
      [/^(.+) finished start peek$/i, '$1 заканчивает начальный просмотр'],
      [/^(.+) said Dutch$/i, '$1 объявляет Dutch'],
      [/^(.+) used Jack swap$/i, '$1 использует обмен валета'],
      [/^(.+) used Queen peek$/i, '$1 использует просмотр дамы'],
      [/^(.+) gave a card to (.+)$/i, '$1 даёт карту игроку $2'],
      [/^(.+) made a wrong throw-in and took a penalty card$/i, '$1 ошибается при сбросе и берёт штрафную карту'],
      [/^(.+) threw in (?:an? )?(.+)$/i, '$1 быстро сбрасывает $2'],
      [/^(.+) joined as a spectator$/i, '$1 присоединяется как зритель'],
      [/^(.+) joined$/i, '$1 присоединяется'],
      [/^(.+) reconnected$/i, '$1 восстанавливает соединение'],
      [/^(.+) disconnected$/i, '$1 теряет соединение'],
      [/^(.+) left$/i, '$1 покидает игру']
    ];
    for (const rule of rules) if (rule[0].test(value)) return value.replace(rule[0], rule[1]);
    return value.replace(/^round ended\./i, 'Раунд завершён.')
      .replace(/^game ended because no human-playable table remains$/i, 'Игра завершена: за столом не осталось активных игроков')
      .replace(/^game ended after (\d+) minutes without activity$/i, 'Игра завершена после $1 мин. бездействия')
      .replace(/^(.+) left, turn skipped$/i, '$1 покидает игру; ход пропущен')
      .replace(/^(.+) left after (\d+) minutes in the waiting room$/i, '$1 удалён(а) после $2 мин. в комнате ожидания')
      .replace(/^(.+) was removed after (\d+) minutes offline$/i, '$1 удалён(а) после $2 мин. без связи')
      .replace(/^(.+) skipped (Ace|Queen|Jack) because they left$/i, '$1 пропускает действие «$2», так как покидает игру')
      .replace(/^(.+) skipped (Ace|Queen|Jack)$/i, '$1 пропускает действие «$2»')
      .replace(/^(.+) cannot be added because that table name is already used\.$/i, '$1 нельзя добавить: это имя за столом уже занято.')
      .replace(/ gained (\d+) points?\b/g, ' получает $1 очк.')
      .replace(/ lost (\d+) points?\b/g, ' теряет $1 очк.')
      .replace(/'s total was halved$/i, ': общий счёт делится пополам')
      .replace(/ made a wrong throw-in but no penalty card was available$/i, ' ошибается при сбросе, но штрафных карт не осталось')
      .replace(/\bAce\b/g, 'туз').replace(/\bQueen\b/g, 'дама').replace(/\bJack\b/g, 'валет')
      .replace(/ drew (.+) from pile and discarded /g, ' берёт $1 из сброса и сбрасывает ')
      .replace(/ drew from deck and discarded /g, ' берёт карту из колоды и сбрасывает ')
      .replace(/ and may use /g, '; доступно действие: ')
      .replace(/ placed /g, ' кладёт ');
  }
  function translateGameText(language, input) {
    const locale = normalizeLanguage(language);
    if (locale === 'ru') return translateRussianGameText(input);
    if (locale !== 'de') return String(input || '');
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
    const botTimingChange = value.match(/^(.+) changed bot timing from (\d+)% to (\d+)%$/i);
    if (botTimingChange) {
      return botTimingChange[1] + ' hat die Bot-Wartezeit von ' + botTimingChange[2] + '% auf ' + botTimingChange[3] + '% geändert';
    }
    const botSpeedChange = value.match(/^(.+) changed bot speed from (Instant|Fast|Medium|Slow|Human-like) to (Instant|Fast|Medium|Slow|Human-like)$/i);
    if (botSpeedChange) {
      return botSpeedChange[1] + ' hat die Bot-Geschwindigkeit von ' + translate('de', botSpeedChange[2]) + ' auf ' + translate('de', botSpeedChange[3]) + ' geändert';
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
