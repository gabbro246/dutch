# Dutch card game

Minimal local multiplayer version of Dutch.

## Run

```bash
npm install
npm start
```

Open `http://localhost:3000` in multiple browser windows or devices on the same network.

## Notes

- One global room only.
- No persistence. Restarting the server resets the game.
- During an active game, new visitors see a waiting message.
- If someone disconnects during a game, the game is not paused. A joined player can use `End game for all` to return to the waiting room.
- The draw pile automatically reshuffles from the discard pile when needed, keeping the top discard card in place.
- The server owns hidden-card state. Clients only receive cards they are allowed to see.
