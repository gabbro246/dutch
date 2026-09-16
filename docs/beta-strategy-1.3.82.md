# Beta 1.3.82: forecast-based round play

These rules apply in single rounds, five-round games and points games. Actual game-ending positions still take the final standings into account. The 1.6-second human throw-in window and reaction settings are unchanged.

## What to do, and why

| Situation | What Roswell should do | Why this can help |
| --- | --- | --- |
| Choosing an ordinary move | Compare the likely resulting score after the next table cycle and up to three further own turns. Include learning, replacement, matching throws and special-card sequences. | The best immediate point reduction is not always the quickest route to a low, fully known hand. |
| Some own cards are unknown | Value a peek or replacement through the hands it could reveal and the subsequent actions those hands enable. Usually learn the own hand first. | Information becomes useful when it enables a throw, a better exchange or an earlier Dutch call. |
| Drawing a high card | Replace an unknown only when the resulting knowledge, matching opportunities or outgoing special outweigh the extra burden. | A known high card can be useful when it can soon be thrown; blindly collecting high cards to learn the hand can produce expensive losses. |
| Holding a known pair | Compare replacing one card and throwing the other, including the legal special-card effects. | One turn can remove two burdens and open a safe call. |
| Forecasting later throws | Count matching openings on opponents’ likely discards, as well as on Roswell’s own discards. | This values knowing a card now so it can leave on somebody else’s turn. |
| Choosing pile or deck | Compare the best compulsory pile replacement with the average best response to each possible deck draw. Require only a small advantage from the pile. | The forecast already values future information. Adding the old large pile penalty would count that opportunity twice and reject useful visible cards. |
| An opponent is near a call | Put more weight on what the hand could score after one final turn, and less on improvements that need several turns. | There may be time for only one repair. A promising long plan should not conceal a costly imminent loss. |
| Forecasting opponents | Use remembered cards, publicly observed acquisitions, which positions their owners have seen, likely draw responses, throws and specials. Pass likely discards to later seats. | Roswell should react to what the table can do before it gets another ordinary turn. These are estimates, not access to hidden cards. |
| An opponent keeps a deck card | Lower the estimate of its value, especially when a publicly seen higher card was deliberately replaced. Keep alternative ranks possible. | Choosing to retain a card is evidence of its usefulness; it does not reveal its face. |
| Roswell privately peeks at an opponent’s card | Remember the face without assuming the owner has seen it. Publicly observed own-card peeks reveal knowledge status to observers, not the face. | Knowing an opponent’s card and knowing that the opponent can confidently use it are different facts. |
| A discard may empty an opponent’s hand | Charge the move for the finishing opportunity as well as the removed points. | Giving away an empty or zero-point hand can decide a round even when the discarded card has little point value. |
| A Queen can reveal an own card | Compare the possible reveals by their future hand value. Include a newly discovered matching throw while the opening remains live. | A low card, a matching card and another Queen enable different continuations. |
| The own hand is already known | Prefer an opponent peek that could reveal a better Jack target. Discount the value by the chance of obtaining and using a Jack before the round ends; value an already queued Jack more strongly. | Opponent information should support a plausible next action. |
| Using a Jack | Compare the new own hand’s forecast with the opponent’s resulting score distribution. Include breaking an exact opponent halving and the opponent’s chance to repair the damage. | A swap can improve Roswell’s finish and disrupt a rival’s accumulated score at the same time. |
| Using an Ace | Prefer a target whose extra card delays a call or worsens its expected accumulated score. Reassess the table after the attack. | Adding a card is especially useful when it breaks an imminent finish or exact halving. |
| Dutch is available while a special is pending | Compare resolving the owned special with calling immediately, including at zero points and before a deliberate halving call. | An available Ace or Jack may spoil a rival’s halving without spending another normal turn. |
| A very low hand would hand a threatening rival an exact halving | If the rival’s complete hand is known, allow at most two table cycles to find an Ace or useful Jack. Do this only with an own total of two or less. Stop waiting when the budget expires, and take a forecast-certain whole-game win immediately. Empty hands still trigger the existing mandatory call. | A short opportunity to disrupt the rival can help full games; an unlimited wait could sacrifice a won round. |
| Own beneficial halving is available | Compare preserving that result with developing a different low hand. Do not claim both benefits for the same future. Preserve the needed sum, including against tempting throws, and avoid equal-card pile loops. | Halving should remain useful without disguising the quality of ordinary round play. |
| Another player has called | Remove ordinary future-learning rewards. Evaluate the final score and only information that can still enable a throw or queued action. Respect caller protection. | Unusable information cannot repair the final score. |
| The whole game can be won immediately | Retain the existing final-standings check, including exceptional above-five Dutch calls. | The actual game winner can matter more than winning its final round. This exception uses the same rules in every game length. |

## What the forecast actually computes

The immediate action tree evaluates legal replacements, discards, possible unknown outgoing ranks, specials and matching throws. One discard opening permits at most one successful throw. Queen reveals are evaluated as distinct possible cards, rather than as a fictional known average card.

A generated table covers 3,876 unordered hand compositions of up to four cards. Each entry estimates a final-turn score and future values over one, two and three own turns. Unknown cards remain unknown until an action observes or replaces them. Future-turn cost and matching opportunities encourage earlier finishes. A fully known hand worth five or less can finish in the reference model; the live evaluator separately checks whether calling is actually sensible against the opponents.

The next table cycle uses the current remembered card pool and public opponent information. Later seats receive the most likely previous discard plus a deck-only estimate for the remaining possibilities. Reference discards between more distant own turns favor high cards. Larger opponent hands use a simpler estimate, and own hands above four cards use a bounded progress fallback. These limits keep the planner practical.

The model approximates unknown cards with marginal distributions, uses reference probabilities for future throws and does not simulate every possible full game. Its predicted call probabilities are not measured confidence guarantees. It cannot guarantee wins against humans, and bot tournaments alone do not establish human-playing strength.

## How to compare versions

The old 1.3.79, 1.3.80 and 1.3.81 implementations remain selectable. The benchmark rotates seats and records game wins, final scores, round wins, raw round scores, loss severity and halvings. Round wins use the lowest round points after Dutch scoring but before accumulated-score halving; tied round wins split one credit.

Example comparisons:

```sh
node scripts/round-forecast-benchmark.js --opponents roswell-beta@1.3.80 --games 200 --seed 110001 --output results/points-v80.json
node scripts/round-forecast-benchmark.js --opponents roswell-beta@1.3.81 --games 1000 --seed 130001 --rounds 1 --output results/single-v81.json
```

Each result includes source fingerprints, settings, per-game metrics and round score histories. Fresh evaluation seeds should be kept separate from development comparisons. Forced endings and truncated games must be reported.
