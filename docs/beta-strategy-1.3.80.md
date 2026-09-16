# Beta 1.3.80: implemented strategy rules

This is the strategy implemented in Beta 1.3.80. It applies to Roswell, Athena, Norman and Dory Beta in points games and five-round games. Single-round mode deliberately retains the 1.3.79 strategy: the new evaluator lost more often in that mode during validation. Their existing memory accuracy and reaction speeds remain distinct. It implements a practical subset of the longer strategy proposal, with deterministic tactical evaluation and limited planning.

## What to do in each situation

| Situation | Action | Why this can help win |
| --- | --- | --- |
| Choosing between the deck and discard pile | Compare the best legal pile replacement with the weighted outcomes of drawing from the unseen card pool. When cards are still unknown, require a clear advantage before taking the pile. | Small visible improvements can cost an opportunity to draw a useful special or matching card. |
| A drawn card is worse than an unknown card's estimated value | Consider both discarding it and replacing the unknown. Include any special action and matching throw that the discard would create. | Learning a card does not always justify inserting eleven or twelve points. |
| A known Queen can be released while another card is unknown | Compare replacing the Queen and peeking with replacing the unknown directly. | It can remove twelve points and obtain the missing information in the same turn. |
| Replacing one card exposes a rank also held in the bot's hand | Evaluate the replacement plus one matching throw, including the chance that another player wins the opening. | A single turn can remove a pair and reduce the number of cards held. |
| A human can contest that throw | Account for the human's exclusive opening window when judging the combination. | A combination is worth less when the bot cannot reliably complete it. This does not change live reaction timing. |
| Discarding a card would help an opponent | Charge the move for likely opposing throws, special actions and useful low pile cards. Give more weight to relevant opponents. | A point saved is less useful if the same move helps a rival finish first. |
| Using a Queen | Usually learn an unknown own card, especially the last unknown. Once the hand is known, inspect a relevant opponent's unknown card. Skip a final-turn peek that cannot influence a remaining action. | Information should enable a decision or a throw, rather than merely increase the number of remembered cards. |
| Using a Jack | Compare useful swaps across all own cards and known legal opposing cards. Include the value of learning an unknown and the damage the opponent may repair. On a final turn, remove a known thirteen before an ordinary unknown when that gives the larger gain. | The highest-value exchange is not always the first unknown card. |
| No useful own Jack swap exists | Consider a swap between opponents only if it helps against the more relevant rival. Otherwise skip it. | Shuffling known cards without a competitive benefit wastes the action. |
| Using an Ace | Compare opponents' likely scored totals before and after the added card, including possible halvings. Favor dangerous opponents; skip an attack whose estimated scoring effect helps them. | An extra card can delay a caller, but an exact halving can make a careless attack beneficial to its target. |
| Another player has called Dutch | Respect the caller's Ace/Jack protection. Concentrate on the remaining final turn and useful throws; do not plan a later normal turn. | There is no time left to recover the cost of an ordinary long-term plan. |
| All own cards are known and total at most five | Forecast opponents' final turns, with the current pile available only to the next player. Compare calling with the expected benefit of waiting. A zero-point hand calls immediately at a legal opportunity. | A currently low hand is not enough if the next player can reliably finish lower. Waiting also gives opponents time to end the round. |
| An optional own special is pending and Dutch is legal | Compare resolving it with calling now. Call first when the special is less useful; never interrupt a Jack selection already in progress. | Calling protects the hand and can secure a favorable finish before another action changes it. |
| The known hand completes an ordinary score halving | Preserve the exact score when that plan is beneficial. Continue seeking useful opportunities rather than exchanging identical cards repeatedly. | A halving is valuable only if the round eventually ends. |
| A zero-point hand sits on a total of 50, 100 or 200 | Call rather than waiting for somebody else. | Adding zero still triggers the existing exact-total halving rule. The scoring engine applies one halving per round. |
| A known hand above five completes a beneficial halving through doubled Dutch points | Consider a deliberate failed call and preserve the required score. Do not make this plan after somebody else has called. | The doubled raw score can produce a lower accumulated total after the exact halving. |
| A call ends the game, including the last round of a five-round game | Evaluate final accumulated totals. An above-five call is allowed when the simplified forecast gives at least a 98% chance of a strict game win after doubling and opponents' responses. | Winning the complete game can justify a deliberately failed round call. The 98% threshold is a model estimate, not a measured guarantee. |
| A remembered card matches an open throw | Compare the estimated gain with the cost of a wrong attempt and an added unknown card. Skip unfavorable uncertain attempts. Retain a red King except when throwing the last card or preserving an evaluated plan dictates otherwise. | Forgetful characters should not accumulate penalties for small speculative gains. |
| A large penalty hand develops | Use immediate point reduction, information and matching-card gains instead of expanding special-action branches. | Decision time remains small even in pathological long rounds. |

## What planning actually does

The bot evaluates legal immediate replacements and discards. It groups unseen cards by rank and King color instead of running random game simulations. For up to three promising, fully known, stable resulting hands, it evaluates one additional own draw and response. That extra turn receives less weight when an opponent seems close to calling. A move that already ends the bot's normal turns receives no credit for another turn.

An immediate discard and a successful own matching throw can both create specials; their effects are evaluated in sequence. Hidden outgoing cards are averaged only after choosing the replacement slot. The planner does not inspect their physical faces.

The default future-search budget is 1,800 action evaluations. When any hand contains more than ten cards, replacement evaluation uses a simpler immediate calculation. Cached distributions avoid repeating the same calculations within the decision model.

## Information and limits

- Roswell uses cards it legitimately remembers and the public game state. Unknown physical faces and the private contents of a human's memory model are excluded from the new planner.
- The unseen pool includes cards that may be in hidden hands. Unknown slots use approximate distributions; this is not an exact joint reconstruction of the deck and every hand.
- A hidden deck replacement is evidence that an opponent retained a useful card. It is not treated as proof of that card's value.
- Opponent final turns are approximate. They do not reproduce every sequence of competing throws, special actions and hidden choices at a multiplayer table.
- Long-term leader targeting and game-ending evaluation remain heuristic. This is not a solved-game strategy or unrestricted search through the rest of a complete game.
- Beta 1.3.79 is preserved for comparison. The 1.3.77 and 1.3.78 labels share that captured baseline; independent historical snapshots for those labels were not stored.
- Bot-only tournaments establish performance against those bots under the simulator's timing model. They do not establish an almost-certain win rate against humans.

## Reproducing comparisons

Install dependencies with `npm ci`, then run `npm test`.

Example: `npm run benchmark:beta-strategy -- --suite core --games 400 --seed 70001`.

Add `--rounds 1` or `--rounds 5` for fixed-round games. Other suites are `characters`, `field`, and `older`. Both seat orders use matching shuffled seeds; four-player comparisons rotate all four seats. The report records source hashes and saves replay logs.

Games stopped by a round or turn limit must not be counted as ordinary evidence of a win. The report exposes these flags and a descriptive result excluding the entire paired seed whenever either seat order was affected.
