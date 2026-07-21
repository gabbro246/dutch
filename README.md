# Dutch! 🂡
A card game where players try to finish with the lowest score by remembering, swapping, and revealing cards.
This project provides a minimal local multiplayer version that you can play in a browser against other players or bots.

## Run Dutch
Node.js must be installed first. If it is not installed, see the [Node.js installation instructions](https://nodejs.org/).
1. Click the green **Code** button near the top of this GitHub page, select **Download ZIP**, and extract the downloaded folder.
2. Open a terminal inside the extracted folder.
3. Install the required packages: `npm install`
4. Start the game: `npm start`
5. Open `http://localhost:3000` on the computer running the game. To play on another device connected to the same network, open the network address shown in the terminal.

It can also be hosted on Home Assistant OS using [gabbro246/dutch-haos](https://github.com/gabbro246/dutch-haos).

## How to Play

**Goal** Finish each round with as few points as possible. The player with the lowest total score at the end of the game wins.

**Setup** Use a standard deck of cards without jokers. Two decks may be shuffled together for larger groups.
Deal four cards face down to each player. Each player looks at exactly two of their own cards, then returns them face down in the same positions. Once everyone has finished looking, turn over the top card of the remaining deck to begin the discard pile.
Players must remember their cards and positions. Face-down cards may only be viewed when a rule allows it.

**Taking a Turn** On your turn, take the top card from either the draw pile or the discard pile and look at it.
* A card taken from the **discard pile** must replace one of your face-down cards.
* A card taken from the **draw pile** may replace one of your face-down cards or be placed directly on the discard pile.
When replacing a card, choose one of your face-down cards without looking at it. Place the drawn card face down in its position, then place the replaced card face up on the discard pile.

**Special Cards** An Ace, Queen, or Jack may perform a special action when placed face up on the discard pile. Using the action is optional.
* **Ace:** Give one face-down card from the draw pile to any player.
* **Queen:** Look at any one face-down card, then return it to the same position.
* **Jack:** Swap any two face-down cards without looking at them.

**Throwing In** Whenever a card is placed face up on the discard pile, any player may immediately discard one of their own face-down cards with the same rank.
Suits do not need to match. All Kings count as the same rank for throwing in, so a red King may be thrown in on a black King and vice versa, despite their different point values.
Only the first player to throw in a matching card may do so. Once a card has been thrown in, no other player may add another card.
If a player throws in the wrong card, they must take it back and receive one unknown face-down penalty card. The previous top card remains available for a correct throw-in until the next normal playing action.

**Calling Dutch** A player who believes their cards are worth five points or less and that they have the lowest score of all players may call **Dutch** at the end of their turn.
Every other player then takes exactly one final turn. After these turns, all cards are revealed and scored.

**Card Values** Aces are worth 1 point. Number cards from 2 to 10 are worth their displayed value. Jacks are worth 11 points, and Queens are worth 12 points.
Red Kings are worth 0 points. Black Kings are worth 13 points.

**Scoring the Round** The player who called Dutch scores **0 points** when their cards are worth five points or less and no other player has a lower score. A tie for the lowest score is allowed.
When the Dutch caller has more than five points or another player has a lower score, the value of the caller’s cards is doubled.
All other players add the normal value of their cards to their total score.
If a player’s total reaches exactly **50** or **100** points, that total is halved.

**Starting the Next Round** The player who scored the most points in the previous round starts the next round.
The game ends when a player exceeds 100 points after all scoring and score-halving rules have been applied. The player with the lowest total score wins.
