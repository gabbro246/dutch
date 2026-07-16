const http = require('http');
const test = require('node:test');
const assert = require('node:assert/strict');
const { server, startServer, closeServer, getState } = require('../server.js');

function serverPort() {
  const address = server.address();
  if (!address || typeof address !== 'object') throw new Error('Server is not listening.');
  return address.port;
}

function requestText(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: serverPort(),
      path,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error('HTTP ' + res.statusCode + ': ' + body));
          return;
        }
        resolve(body);
      });
    });
    req.setTimeout(2500, () => req.destroy(new Error('Request timed out.')));
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function parsePackets(payload) {
  return String(payload || '').split('\x1e').filter(Boolean);
}

function parseEventPacket(packet) {
  if (!packet.startsWith('42')) return null;
  const data = JSON.parse(packet.slice(2));
  return { name: data[0], payload: data[1] };
}


async function waitFor(predicate, message = 'condition was not met') {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

async function openPollingClient() {
  const openPayload = await requestText('/socket.io/?EIO=4&transport=polling');
  assert.equal(openPayload[0], '0');
  const handshake = JSON.parse(openPayload.slice(1));
  const sid = handshake.sid;

  async function getPackets() {
    return parsePackets(await requestText('/socket.io/?EIO=4&transport=polling&sid=' + encodeURIComponent(sid)));
  }

  async function postPacket(packet) {
    await requestText('/socket.io/?EIO=4&transport=polling&sid=' + encodeURIComponent(sid), {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: packet
    });
  }

  async function nextEvent(name) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      for (const packet of await getPackets()) {
        const event = parseEventPacket(packet);
        if (event && event.name === name) return event.payload;
      }
    }
    throw new Error('Socket event not received: ' + name);
  }

  async function nextStateWhere(predicate) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const state = await nextEvent('state');
      if (predicate(state)) return state;
    }
    throw new Error('Expected state was not received.');
  }

  await postPacket('40');
  await getPackets();

  return {
    emit: (name, payload) => postPacket('42' + JSON.stringify([name, payload])),
    nextEvent,
    nextStateWhere,
    close: () => postPacket('1').catch(() => {})
  };
}

test('socket gameplay flow covers turns, throw-ins, specials, Dutch, reconnect, and leave', async (t) => {
  await new Promise((resolve) => startServer(0, resolve));

  const ada = await openPollingClient();
  const ben = await openPollingClient();
  t.after(async () => {
    await closeServer();
  });

  await ada.emit('join', { name: 'Ada', token: 'ada-token' });
  await waitFor(() => getState().players.some((player) => player.id === 'ada-token'), 'Ada did not join.');

  await ben.emit('join', { name: 'Ben', token: 'ben-token' });
  await waitFor(() => getState().players.length === 2, 'Ben did not join.');
  assert.equal(getState().phase, 'waiting');

  await ada.emit('startGame');
  await waitFor(() => getState().phase === 'playing' && getState().round && getState().round.stage === 'peek', 'Game did not enter start peek.');

  const adaCards = getState().players.find((player) => player.id === 'ada-token').cards;
  const benCards = getState().players.find((player) => player.id === 'ben-token').cards;
  assert.equal(adaCards.length, 4);
  assert.equal(benCards.length, 4);

  await ada.emit('peekStart', adaCards[0].id);
  await ada.emit('peekStart', adaCards[1].id);
  await ben.emit('peekStart', benCards[0].id);
  await ben.emit('peekStart', benCards[1].id);

  await waitFor(() => getState().round && getState().round.stage === 'turn', 'Round did not enter turn stage.');
  assert.equal(getState().phase, 'playing');
  assert.equal(getState().round.deck.length, 43);
  assert.equal(getState().round.discard.length, 1);

  const clientsByPlayerId = {
    'ada-token': ada,
    'ben-token': ben
  };
  const firstPlayerId = getState().players[getState().round.currentPlayerIndex].id;
  const firstClient = clientsByPlayerId[firstPlayerId];
  assert.ok(firstClient, 'Current player has a connected test client.');

  assert.equal(getState().round.throwIn.open, true);
  await firstClient.emit('takeDeck');
  await waitFor(() => getState().round.drawn && getState().round.drawn.playerId === firstPlayerId && getState().round.drawn.source === 'deck', 'Current player did not draw from deck.');
  assert.equal(getState().round.throwIn.open, false);
  assert.equal(getState().round.deck.length, 42);
  assert.equal(getState().round.discard.length, 1);

  await firstClient.emit('discardDrawn');
  await waitFor(() => !getState().round.drawn && getState().round.turnComplete && getState().round.discard.length === 2, 'Current player did not discard drawn card.');

  await firstClient.emit('endTurn');
  await waitFor(() => getState().round.stage === 'turn' && !getState().round.turnComplete && getState().players[getState().round.currentPlayerIndex].id !== firstPlayerId, 'Turn did not advance to the next player.');

  const secondPlayerId = getState().players[getState().round.currentPlayerIndex].id;
  const secondClient = clientsByPlayerId[secondPlayerId];
  assert.ok(secondClient, 'Next player has a connected test client.');
  const secondPlayer = getState().players.find((player) => player.id === secondPlayerId);
  const swapTargetId = secondPlayer.cards[0].id;

  await secondClient.emit('takePile');
  await waitFor(() => getState().round.drawn && getState().round.drawn.playerId === secondPlayerId && getState().round.drawn.source === 'pile', 'Next player did not take the pile.');
  assert.equal(getState().round.discard.length, 1);

  await secondClient.emit('swapDrawn', swapTargetId);
  await waitFor(() => !getState().round.drawn && getState().round.turnComplete && getState().round.discard.length === 2, 'Next player did not swap pile card into their hand.');
  assert.equal(getState().players.find((player) => player.id === secondPlayerId).cards.length, 4);
  assert.equal(getState().round.throwIn.open, true);

  const throwPlayer = getState().players.find((player) => player.id === secondPlayerId);
  const throwCard = throwPlayer.cards[0];
  const deckBeforeWrongThrow = getState().round.deck.length;
  const discardBeforeWrongThrow = getState().round.discard.length;
  getState().round.throwIn.rank = 'not-a-real-rank';
  await secondClient.emit('throwIn', throwCard.id);
  await waitFor(() => getState().players.find((player) => player.id === secondPlayerId).cards.length === 5, 'Wrong throw-in did not add a penalty card.');
  assert.equal(getState().round.deck.length, deckBeforeWrongThrow - 1);
  assert.equal(getState().round.discard.length, discardBeforeWrongThrow);
  assert.equal(getState().round.throwIn.open, true);

  throwCard.rank = '9';
  throwCard.suit = 'clubs';
  const discardBeforeValidThrow = getState().round.discard.length;
  getState().round.throwIn.rank = throwCard.rank;
  await secondClient.emit('throwIn', throwCard.id);
  await waitFor(() => getState().players.find((player) => player.id === secondPlayerId).cards.length === 4 && getState().round.discard.length === discardBeforeValidThrow + 1, 'Valid throw-in did not remove the card and add it to discard.');
  assert.equal(getState().round.throwIn.open, false);

  const actorClient = secondClient;
  const actorId = secondPlayerId;
  const targetId = firstPlayerId;
  const actor = getState().players.find((player) => player.id === actorId);
  const target = getState().players.find((player) => player.id === targetId);
  getState().round.dutchCallerId = null;
  getState().round.dutchQueue = [];

  getState().round.stage = 'special';
  getState().round.specialQueue = [{ type: 'A', actorId, selected: [] }];
  const targetCardsBeforeAce = target.cards.length;
  await actorClient.emit('aceAdd', targetId);
  await waitFor(() => target.cards.length === targetCardsBeforeAce + 1 && getState().round.specialQueue.length === 0, 'Ace did not give the target a card and finish.');
  assert.equal(getState().round.stage, 'turn');

  getState().round.stage = 'special';
  getState().round.specialQueue = [{ type: 'Q', actorId, selected: [] }];
  const queenCardId = target.cards[0].id;
  await actorClient.emit('queenPeek', queenCardId);
  await waitFor(() => getState().round.specialQueue.length === 0 && getState().round.reveals.some((reveal) => reveal.viewerId === actorId && reveal.cardId === queenCardId), 'Queen did not reveal the selected card and finish.');
  assert.equal(getState().round.stage, 'turn');

  getState().round.stage = 'special';
  getState().round.specialQueue = [{ type: 'J', actorId, selected: [] }];
  const actorCardBeforeJack = actor.cards[0];
  const targetCardBeforeJack = target.cards[0];
  await actorClient.emit('jackSelect', actorCardBeforeJack.id);
  await actorClient.emit('jackSelect', targetCardBeforeJack.id);
  await waitFor(() => actor.cards[0].id === targetCardBeforeJack.id && target.cards[0].id === actorCardBeforeJack.id && getState().round.specialQueue.length === 0, 'Jack did not swap the selected cards and finish.');
  assert.equal(getState().round.stage, 'turn');

  const adaPlayer = getState().players.find((player) => player.id === 'ada-token');
  const benPlayer = getState().players.find((player) => player.id === 'ben-token');
  adaPlayer.total = 12;
  benPlayer.total = 48;
  adaPlayer.cards = [{ id: 'ada-score-2', rank: '2', suit: 'clubs', deckColor: 'blue' }];
  benPlayer.cards = [{ id: 'ben-score-2', rank: '2', suit: 'spades', deckColor: 'blue' }];
  getState().round.stage = 'turn';
  getState().round.currentPlayerIndex = getState().players.findIndex((player) => player.id === 'ada-token');
  getState().round.drawn = null;
  getState().round.turnComplete = true;
  getState().round.throwIn = null;
  getState().round.specialQueue = [];
  getState().round.dutchCallerId = null;
  getState().round.dutchQueue = [];
  getState().round.roundWinnerIds = [];

  await ada.emit('sayDutch');
  await waitFor(() => getState().round.dutchCallerId === 'ada-token' && getState().players[getState().round.currentPlayerIndex].id === 'ben-token', 'Dutch call did not advance to the next player.');
  getState().round.turnComplete = true;
  await ben.emit('endTurn');
  await waitFor(() => getState().round.stage === 'roundEnd', 'Dutch final turn did not end the round.');
  assert.equal(adaPlayer.roundPoints, 0);
  assert.equal(adaPlayer.total, 12);
  assert.equal(benPlayer.roundPoints, 2);
  assert.equal(benPlayer.total, 25);

  const playerCountBeforeReconnect = getState().players.length;
  const previousAdaSocketId = adaPlayer.socketId;
  const adaReconnect = await openPollingClient();
  await adaReconnect.emit('identify', 'ada-token');
  await waitFor(() => adaPlayer.socketId && adaPlayer.socketId !== previousAdaSocketId, 'Identify did not reconnect to the existing player.');
  assert.equal(getState().players.length, playerCountBeforeReconnect);
  assert.equal(adaPlayer.connected, true);

  await adaReconnect.emit('leave');
  await waitFor(() => getState().phase === 'waiting' && getState().players.length === 1 && getState().players[0].id === 'ben-token', 'Leave did not reset the table and keep the remaining player.');
});
