# Beta 1.3.81: knowledge and round-winning rules

The current Beta bots use one strategy in single-round, five-round and points games. Roswell keeps perfect recall of legitimately observed cards. The other Beta characters retain their existing memory limits. The only game-length differences concern actual final standings: a move that ends the whole game can deserve different treatment from a move in an ordinary round.

## What to do, and why

| Situation | Rule | Why it helps |
| --- | --- | --- |
| Some own cards are unknown | Prefer actions that reduce the work needed to obtain a fully known hand worth five or fewer. Compare learning, replacement, pair removal and immediate point reduction together. | Information matters because it enables safe throws, deliberate replacements and an earlier Dutch call. |
| A poor draw could replace an unknown | Evaluate both choices. Do not automatically insert a high card just to learn a slot. Include the special and matching throw that either discard can create. | Knowing a large burden can be less useful than drawing again, or using a Queen immediately. |
| A known high card competes with an unknown for replacement | Compare their progress toward the finishing hand. Keep enough low known cards to total at most five; estimate the actions needed to clear the rest. | Removing a known ten may save points, but resolving the last unknown can unlock a call or a pair. Neither rule should always win. |
| Using or releasing a Queen | Usually peek an unknown own card. Evaluate every possible revealed rank and its resulting hand, rather than assigning the peek only a fixed information bonus. | A revealed two, Queen or matching eight creates different opportunities. |
| A Queen reveals a Queen while its discard opening remains available | Throw the newly known Queen, then use its extra peek. Allow only one successful throw for that opening. Reduce the combination's value when a rival is likely to take the opening first. | One draw can remove a card and reveal two slots. It also works during the final turn if the throw remains possible. |
| A Jack obtains a matching card during an open discard window | Include a legal subsequent throw and its special when evaluating the chosen exchange. | The value of a swap can include removing the incoming card immediately. |
| Choosing pile or deck | Compare the best compulsory pile replacement with the weighted best response to each possible deck draw. Require a clear advantage from the pile while unknowns remain. | Taking every small visible improvement can give up useful specials or pair-removal opportunities. |
| An opponent might throw the discard | Estimate the benefit of the matching card, plus card removal and any special. Do not charge for a different, unrelated high card in that opponent's hand. | This fixes an error that could discourage good discards. |
| An own known pair can be removed | Consider replacing one and throwing the other, including both resulting specials and the chance of losing the throw race. | Fewer cards reduce the remaining work and can put Dutch within reach. |
| A human can contest a throw | Respect the existing human-first window when valuing the combination. | Bot-only throw opportunities are not guaranteed against a human. |
| Using a Jack | Compare own point reduction, knowledge gained, progress toward five or fewer, and the harm an opponent can repair. Use known opposing cards; respect caller protection. | An exchange can both resolve uncertainty and improve the hand. |
| Using an Ace | Prefer delaying a dangerous opponent when the added card worsens their expected result. Account for possible score halving; skip an attack that appears beneficial to its target. | An unknown extra card can prevent an imminent call, but exact totals can reverse the benefit. |
| All cards are known and worth five or fewer | Forecast opponents' final turns and compare calling with waiting. Only the next player is assured access to the current pile. Call with zero at the first legal opportunity. | A low hand should finish promptly unless there is concrete evidence that waiting is better. |
| A useful special is pending | Compare resolving it with calling immediately. A legal Dutch call may skip an optional special in every game length. Never interrupt an active Jack selection. | Finishing and protecting the hand can be more valuable than another action. |
| Someone else has called | Stop valuing ordinary future learning. Still value a peek that enables a remaining throw or queued action. Concentrate on the final score and respect caller protection. | Information has little value after the last opportunity to use it. |
| An exact score halving is available | Retain the previous score-aware rules: preserve a beneficial ordinary halving or deliberately fail Dutch when the doubled score yields a better accumulated total. Avoid endless equal-card exchanges. | Better round play should not discard valuable whole-game scoring opportunities. |
| The whole game can be secured | Evaluate accumulated totals. An above-five Dutch call can be justified when the approximate forecast gives at least a 98% chance of a strict overall win. | Winning the game can occasionally justify losing the round. This is a model threshold, not a guarantee. |

## How planning works

The planner compares legal actions deterministically, grouping unknown cards into fourteen classes: each rank, with red and black Kings separated. It follows immediate replacement, discard, special and one-successful-throw sequences. It forecasts opponents' final responses before calling Dutch.

For ordinary unfinished hands, it also estimates remaining useful actions. Unknown slots count as roughly 1.6 actions. Known cards that do not fit in a retained total of five count as roughly one action, reduced for a plausible future matching throw or a known pair. Each estimated action carries a weight of eight alongside point cost and information value. These are heuristic weights, not exact expected turn counts.

The extra own-turn search used by 1.3.80 is disabled by default: it only extended already-known stable hands and performed worse in development comparisons. Forward planning here comes from evaluating action sequences, Dutch responses and progress toward a finish. It does not simulate an entire future game.

## Limits and comparison rules

- Physical faces of unknown cards and human-private observations are excluded. Unknown cards use approximate distributions, including approximate opponent retention behavior.
- A hand with more than ten cards uses the simpler immediate fallback to keep decisions fast.
- Calling, throw races and future card availability are approximate. Human play and live animation timing can differ from the simulator.
- Development trials rejected simply increasing the information bonus or forcing more early pile pickups. The final configuration must be judged on separate, previously unused tournament seeds.
- Historical 1.3.79 and 1.3.80 implementations are frozen. The 1.3.80 snapshot alone preserves its old single-round fallback to 1.3.79.
- Round wins use the game's lowest scored round result, before accumulated-score halving. Tied winners divide one round-win credit. Overall game wins follow the game's existing tie rule.
- A higher round-win rate does not automatically mean more overall wins: exact score halvings can change that relationship.
- Bot tournaments cannot establish that this bot wins almost every round against humans.

## Reproduce

Install with `npm ci`, then run `npm test`.

For the original baseline: `npm run benchmark:beta-strategy -- --suite core --case original-beta --games 400 --seed 92001`.

For the previous update, change the case to `previous-beta`. Add `--rounds 1` or `--rounds 5` to change game length. Reports include source hashes, both seat orders, replay logs, round wins, final scores, learning milestones and forced/truncated-game flags.
