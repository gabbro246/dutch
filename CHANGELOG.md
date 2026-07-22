# Changelog

## 1.3.34
- increased discard-gift penalties for Aces, red Kings, low cards, and ranks the next player can throw in
- scaled discard danger using card count, known low cards, Dutch-call probability, and known high-card replacement value
- modeled seat order and reduced discard exposure when other players act before a threat
- reused the shared discard-control assessment for Ace pile exposure without double-counting its special action

## 1.3.33
- limited Queen peeks to information that can change replacements, specials, throw-ins, Dutch calls, threat classification, or exact score thresholds
- skipped Queen actions for known cards, Dutch-committed hands, and final turns with no remaining decision that can use the result
- prioritized uncertain bot cards with the greatest high-card exposure
- inspected the most informative card position of threatening humans when direct hand information has little value

## 1.3.32
- evaluated the full cost of Ace discards, including hand degradation, target recovery, retaliation risk, and pile exposure
- rejected Ace actions when the bot's guaranteed score increase exceeds the opponent's expected disadvantage
- reserved strong Ace bonuses for immediate threats whose Dutch-call or round-win chances are materially reduced
- selected Ace targets by score impact, Dutch disruption, round-win reduction, and loss of reliable card-position knowledge

## 1.3.31
- added early opponent-threat detection using hand size, estimated score, known low cards, and call timing
- tracked recent low pile takes and throw-ins with recency decay
- treated opponents with reliable knowledge of their low-card positions as more dangerous
- shifted threat-mode priorities toward immediate reduction, discard denial, special attacks, useful reveals, and calling Dutch first
- discounted speculative throw-ins, unrelated information, small improvements, and long-term card plans while under threat

## 1.3.30
- prioritized direct Jack hand improvements, especially the highest known bot card for the lowest known opponent card
- added a separate estimated human-memory model for peeks, reveals, pile acquisitions, and visible card movement
- scored Jack swaps by human knowledge loss, Dutch threat pressure, and dual-purpose disruption
- rebuilt Jack candidates from current knowledge after swaps, throw-ins, Aces, reveals, pile takes, and Dutch calls

## 1.3.29
- froze confidently known Dutch-ready hands and avoided unnecessary special actions or added variance
- evaluated Dutch calls against opponents' estimated hands after their final turns
- restricted calls above five and deliberate failed calls to guaranteed throw-ins or beneficial exact score arithmetic
- modeled doubled failures, 50/100 halving, resulting totals, and projected game-win outcomes explicitly

## 1.3.28
- protected confirmed low cards and red Kings from avoidable bot hand degradation
- required concrete benefits for bot discard-pile choices and discounted speculative throw-ins
- fixed bots stalling after drawing a deck card when every swap target is protected

## 1.3.27
- improved saved-log formatting for score tables, game events, and bot strategy diagnostics
- moved Deck, Drawn, and Pile labels clear of the card stacks

## 1.3.26
- added in-game switching between 50 and 100 point targets before anyone reaches 50
- added configurable 15, 30, 60, and 90 minute inactivity timeouts

## 1.3.25
- animated and synchronized the opening discard reveal
- made Jack swap selections animated and reversible

## 1.3.24
- highlighted wrong Dutch calls
- synced browser title bar with theme

## 1.3.15
- fixed partial-name reconnects
- fixed reload disconnects

## 1.3.14
- made game layout denser

## 1.3.13
- added manual reconnects

## 1.3.12
- fixed card movement animations

## README `e614246`
- tightened README formatting

## README `0d1fdc9`
- simplified setup steps

## 1.3.7
- expanded setup and rules documentation

## 1.3.6
- rewrote interface styling
- simplified log navigation

## 1.3.2
- reorganized side-panel drawers
- preserved panel scroll positions
- fixed spectator layout
- added log navigation

## 1.3.1
- added rankings to saved logs
- highlighted winners and game end
- moved usage logs into `game-logs`

## 1.3.0
- split game server into modules
- expanded automated tests

## 1.2.25
- added saved-log browser
- added log viewing and downloads

## 1.2.24
- reset finished bot games after 60 seconds

## 1.2.23
- no functional changes

## 1.2.22
- showed active players and round to visitors
- logged game summaries in terminal

## 1.2.21
- no functional changes

## 1.2.18
- added spectator mode

## 1.2.17
- moved player list outside drawer

## 1.2.16
- reorganized waiting room into drawers
- added player reordering
- allowed bot and setting changes before joining

## 1.2.3
- improved card event highlights
- clarified Jack swap selection

## 1.2.2
- added Jack swap feedback
- highlighted card actions
- fixed special-action timing

## 1.2.1
- split client code into modules
- added automated tests

## 1.1.33
- added downloadable game logs
- saved finished games on server
- added log timestamps and score tables

## 1.1.26
- added expandable game logs

## 1.1.25
- logged round point changes

## 1.1.24
- moved Ace actions onto cards
- fixed stale browser assets

## 1.1.21
- clarified game action logs

## 1.1.20
- revealed pile cards when taken
- reduced turn log noise

## 1.1.19
- allowed 16-character names
- shortened score-table names
- prevented display-name collisions

## 1.1.18
- added Roswell elite bot
- improved bot swaps, specials, and Dutch calls

## 1.1.16
- forced Dutch when out of cards
- blocked throw-ins during Jack swaps

## 1.1.15
- named bots Athena, Norman, and Dory
- expanded bot descriptions

## 1.1.14
- added bot personality stats

## 1.1.12
- ended inactive games after 15 minutes

## 1.1.11
- showed active game start time
- limited names to 10 characters
- simplified special-card controls

## Workflow `be2bb1d`
- synced updates to `dutch-haos`

## 1.1.9
- showed completed final turns
- allowed Dutch after special actions
- aligned deck, drawn card, and pile

## 1.1.7
- clarified waiting-room instructions
- highlighted add-bot action

## 1.1.6
- improved bot memory and decisions
- highlighted expected actions
- disabled repeat starting peeks

## 1.1.3
- standardized controls and badges

## 1.1.2
- added strategic, casual, and distracted bots

## 1.0.6
- replaced waiting-room options with dropdowns

## 1.0.5
- added 50 and 100 point games
- added player removal and confirmations
- added collapsible game info
- added waiting timeouts and usage logs

## 1.0.2
- showed local network addresses

## 1.0.1
- renamed project to Dutch
- moved game status to sidebar
- simplified final-turn controls
- protected Dutch caller from Ace and Jack

## 1.0.0
- added reconnectable player sessions
- redesigned waiting and game layouts
- added repository link

## Initial commit
- added browser-based multiplayer Dutch
