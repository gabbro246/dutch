(function initClientSounds(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DutchClientSounds = api;
})(typeof window !== 'undefined' ? window : globalThis, function createClientSounds(root) {
  const STORAGE_KEY = 'dutchSoundEffects';
  const REMOTE_VOLUME = 0.75;
  const DEFAULT_DISCARD_DELAY_MS = 360;
  const WRONG_THROW_PILE_DELAY_MS = 580;

  function configureAmbientAudioSession(target = root) {
    try {
      const audioSession = target.navigator && target.navigator.audioSession;
      if (!audioSession) return false;
      audioSession.type = 'ambient';
      return audioSession.type === 'ambient';
    } catch (error) {
      return false;
    }
  }

  function audioAssetQuery(target = root) {
    try {
      const script = target.document && target.document.currentScript;
      if (!script || !script.src) return '';
      const UrlConstructor = target.URL || URL;
      const version = new UrlConstructor(script.src, target.location && target.location.href).searchParams.get('v');
      return version ? '?v=' + encodeURIComponent(version) : '';
    } catch (error) {
      return '';
    }
  }

  const assetQuery = audioAssetQuery();
  const SOUND_PATHS = {
    add: 'sounds/card-add.mp3' + assetQuery,
    draw: 'sounds/card-draw.mp3' + assetQuery,
    discard: 'sounds/card-discard.mp3' + assetQuery,
    peek: 'sounds/card-peek.mp3' + assetQuery,
    remove: 'sounds/card-remove.mp3' + assetQuery,
    shuffle: 'sounds/card-shuffle.mp3' + assetQuery,
    turn: 'sounds/turn-begin.mp3' + assetQuery
  };

  function getStoredEnabled(target = root) {
    try {
      return target.localStorage.getItem(STORAGE_KEY) !== 'off';
    } catch (error) {
      return true;
    }
  }

  function storeEnabled(enabled, target = root) {
    try {
      target.localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
    } catch (error) {
      // The in-memory setting still works when storage is unavailable.
    }
    return !!enabled;
  }

  function soundEventsForTransition(previousState, state) {
    if (!previousState || !state || !previousState.round || !state.round) return [];
    if (
      previousState.phase !== 'playing'
      || state.phase !== 'playing'
      || previousState.joined !== true
      || state.joined !== true
    ) return [];
    if (previousState.gameStartedAt !== state.gameStartedAt) return [];

    const previousRound = previousState.round;
    const round = state.round;
    const sameRound = previousState.roundNumber === state.roundNumber;
    const events = [];

    if (sameRound) {
      const previousReshuffleToken = Number(previousRound.reshuffleToken) || 0;
      const reshuffleToken = Number(round.reshuffleToken) || 0;
      if (reshuffleToken && reshuffleToken !== previousReshuffleToken) {
        events.push({
          name: 'shuffle',
          volume: 1,
          eventId: [state.gameStartedAt, state.roundNumber, 'shuffle', reshuffleToken].join(':')
        });
      }

      const previousDrawnId = previousRound.drawn && previousRound.drawn.card && previousRound.drawn.card.id;
      const drawnId = round.drawn && round.drawn.card && round.drawn.card.id;
      if (drawnId && drawnId !== previousDrawnId) {
        const actorId = round.drawn.playerId || round.currentPlayerId || '';
        events.push({ name: 'draw', volume: actorId === state.user ? 1 : REMOTE_VOLUME });
      }

      const previousDiscardId = previousRound.pendingPileReveal && previousRound.pendingPileReveal.cardId;
      const discardId = round.pendingPileReveal && round.pendingPileReveal.cardId;
      if (discardId && discardId !== previousDiscardId) {
        const actorId = round.pendingPileReveal.actorId || round.currentPlayerId || '';
        const moveMs = Number(round.pendingPileReveal.moveMs);
        const userThrowIn = round.pendingPileReveal.kind === 'throw-in' && actorId === state.user;
        events.push({
          name: userThrowIn ? 'remove' : 'discard',
          volume: actorId === state.user ? 1 : REMOTE_VOLUME,
          delayMs: userThrowIn ? 0 : (Number.isFinite(moveMs) ? Math.max(0, moveMs) : DEFAULT_DISCARD_DELAY_MS),
          eventId: [state.gameStartedAt, state.roundNumber, 'pile', discardId].join(':')
        });
      }

      const previousWrongThrowId = previousRound.wrongThrowIn && previousRound.wrongThrowIn.id;
      const wrongThrow = round.wrongThrowIn;
      if (wrongThrow && wrongThrow.id !== previousWrongThrowId) {
        events.push({
          name: 'discard',
          volume: wrongThrow.playerId === state.user ? 1 : REMOTE_VOLUME,
          delayMs: WRONG_THROW_PILE_DELAY_MS,
          eventId: [state.gameStartedAt, state.roundNumber, 'wrong-throw', wrongThrow.id].join(':')
        });
      }

      const previousAddId = previousRound.cardAddEvent && previousRound.cardAddEvent.id;
      const addEvent = round.cardAddEvent;
      if (
        addEvent
        && addEvent.id !== previousAddId
        && addEvent.playerId === state.user
      ) {
        events.push({
          name: 'add',
          volume: 1,
          delayMs: DEFAULT_DISCARD_DELAY_MS,
          eventId: [state.gameStartedAt, state.roundNumber, 'add', addEvent.id].join(':')
        });
      }

      const previousPeekId = previousRound.peekEvent && previousRound.peekEvent.id;
      const peekEvent = round.peekEvent;
      if (peekEvent && peekEvent.id !== previousPeekId) {
        events.push({
          name: 'peek',
          volume: 1,
          eventId: [state.gameStartedAt, state.roundNumber, 'peek', peekEvent.id].join(':')
        });
      }
    }

    const localTurnStarted = round.stage === 'turn'
      && round.currentPlayerId === state.user
      && (
        !sameRound
        || previousRound.currentPlayerId !== round.currentPlayerId
        || ['peek', 'opening'].includes(previousRound.stage)
      );
    if (localTurnStarted) events.push({ name: 'turn', volume: 1 });

    return events;
  }

  function create(options = {}) {
    const target = options.target || root;
    const AudioContextConstructor = options.AudioContext
      || target.AudioContext
      || target.webkitAudioContext;
    const fetchAudio = options.fetch
      || (target && typeof target.fetch === 'function' ? target.fetch.bind(target) : null);
    const AudioConstructor = options.Audio || target.Audio;
    const paths = { ...SOUND_PATHS, ...(options.paths || {}) };
    const schedule = options.setTimeoutFn
      || (target && typeof target.setTimeout === 'function' ? target.setTimeout.bind(target) : setTimeout);
    const audioByName = new Map();
    const bufferByName = new Map();
    const activeAudio = new Set();
    const activeSources = new Set();
    const handledEventIds = new Set();
    const blockedPlays = [];
    let audioContext = null;
    let webAudioUnavailable = !AudioContextConstructor || !fetchAudio;
    let unlockPromise = null;
    let enabled = getStoredEnabled(target);

    configureAmbientAudioSession(target);

    function webAudioContext() {
      if (webAudioUnavailable) return null;
      if (audioContext) return audioContext;
      try {
        audioContext = new AudioContextConstructor();
        return audioContext;
      } catch (error) {
        webAudioUnavailable = true;
        return null;
      }
    }

    function bufferFor(name) {
      const context = webAudioContext();
      if (!context || !paths[name]) return Promise.resolve(null);
      if (!bufferByName.has(name)) {
        const loading = Promise.resolve(fetchAudio(paths[name]))
          .then((response) => {
            if (!response || response.ok === false) throw new Error('Unable to load sound: ' + paths[name]);
            return response.arrayBuffer();
          })
          .then((data) => context.decodeAudioData(data));
        bufferByName.set(name, loading);
      }
      return bufferByName.get(name);
    }

    function baseAudioFor(name) {
      if (!AudioConstructor || !paths[name]) return null;
      if (!audioByName.has(name)) {
        const audio = new AudioConstructor(paths[name]);
        audio.preload = 'auto';
        if (typeof audio.load === 'function') audio.load();
        audioByName.set(name, audio);
      }
      return audioByName.get(name);
    }

    function audioFor(name) {
      const original = baseAudioFor(name);
      if (!original) return null;
      return typeof original.cloneNode === 'function' ? original.cloneNode() : new AudioConstructor(paths[name]);
    }

    function queueBlockedPlay(name, volume) {
      blockedPlays.push({ name, volume });
      if (unlockPromise) unlockPromise.then(flushBlockedPlays);
    }

    function playWebAudio(name, volume, allowBlockedRetry) {
      const context = webAudioContext();
      if (!context) return false;
      const ready = context.state === 'suspended' && typeof context.resume === 'function'
        ? context.resume()
        : Promise.resolve();
      Promise.resolve(ready)
        .then(() => bufferFor(name))
        .then((buffer) => {
          if (!enabled || !buffer) return;
          const source = context.createBufferSource();
          const gain = context.createGain();
          source.buffer = buffer;
          gain.gain.value = Math.max(0, Math.min(1, Number(volume) || 0));
          source.connect(gain);
          gain.connect(context.destination);
          activeSources.add(source);
          source.onended = () => activeSources.delete(source);
          source.start();
        })
        .catch((error) => {
          if (allowBlockedRetry && error && error.name === 'NotAllowedError') {
            queueBlockedPlay(name, volume);
          }
        });
      return true;
    }

    function play(name, volume = 1, allowBlockedRetry = true) {
      if (!enabled) return false;
      if (!paths[name]) return false;
      if (webAudioContext()) return playWebAudio(name, volume, allowBlockedRetry);
      const audio = audioFor(name);
      if (!audio) return false;
      audio.volume = Math.max(0, Math.min(1, Number(volume) || 0));
      activeAudio.add(audio);
      const release = () => activeAudio.delete(audio);
      if (typeof audio.addEventListener === 'function') audio.addEventListener('ended', release, { once: true });
      try {
        const playback = audio.play();
        if (playback && typeof playback.catch === 'function') playback.catch((error) => {
          release();
          if (allowBlockedRetry && error && error.name === 'NotAllowedError') {
            queueBlockedPlay(name, volume);
          }
        });
      } catch (error) {
        release();
        if (allowBlockedRetry && error && error.name === 'NotAllowedError') {
          queueBlockedPlay(name, volume);
        }
        return false;
      }
      return true;
    }

    function flushBlockedPlays() {
      if (!enabled) {
        blockedPlays.length = 0;
        return;
      }
      blockedPlays.splice(0).forEach((item) => play(item.name, item.volume, false));
    }

    function unlock() {
      if (!enabled) return Promise.resolve(false);
      const context = webAudioContext();
      if (context) {
        if (unlockPromise) return unlockPromise;
        configureAmbientAudioSession(target);
        const resume = context.state === 'suspended' && typeof context.resume === 'function'
          ? context.resume()
          : Promise.resolve();
        unlockPromise = Promise.resolve(resume)
          .then(() => {
            flushBlockedPlays();
            return true;
          })
          .catch(() => false)
          .finally(() => { unlockPromise = null; });
        return unlockPromise;
      }
      if (!AudioConstructor) return Promise.resolve(false);
      if (unlockPromise) return unlockPromise.then(() => {
        flushBlockedPlays();
        return true;
      });
      const attempts = Object.keys(paths).map((name) => {
        const audio = baseAudioFor(name);
        if (!audio) return Promise.resolve();
        audio.muted = true;
        let playback;
        try {
          playback = audio.play();
        } catch (error) {
          audio.muted = false;
          return Promise.reject(error);
        }
        return Promise.resolve(playback).finally(() => {
          if (typeof audio.pause === 'function') audio.pause();
          try { audio.currentTime = 0; } catch (error) {}
          audio.muted = false;
        });
      });
      unlockPromise = Promise.allSettled(attempts).then(() => {
        flushBlockedPlays();
        return true;
      });
      return unlockPromise;
    }

    function preload() {
      if (!enabled) return;
      if (webAudioContext()) {
        Object.keys(paths).forEach((name) => bufferFor(name).catch(() => {}));
      } else {
        Object.keys(paths).forEach(baseAudioFor);
      }
    }

    function schedulePreload() {
      const requestIdle = options.requestIdleCallbackFn
        || (target && typeof target.requestIdleCallback === 'function' ? target.requestIdleCallback.bind(target) : null);
      if (requestIdle) {
        requestIdle(preload, { timeout: 1000 });
        return;
      }
      preload();
    }

    function setEnabled(value) {
      enabled = storeEnabled(value, target);
      if (enabled) preload();
      if (!enabled) {
        blockedPlays.length = 0;
        activeAudio.forEach((audio) => {
          if (typeof audio.pause === 'function') audio.pause();
        });
        activeAudio.clear();
        activeSources.forEach((source) => {
          try { source.stop(); } catch (error) {}
        });
        activeSources.clear();
      }
      return enabled;
    }

    function handleStateTransition(previousState, state) {
      const events = soundEventsForTransition(previousState, state);
      events.forEach((event) => {
        if (event.eventId && handledEventIds.has(event.eventId)) return;
        if (event.eventId) handledEventIds.add(event.eventId);
        if (event.delayMs > 0) schedule(() => play(event.name, event.volume), event.delayMs);
        else play(event.name, event.volume);
      });
      return events;
    }

    schedulePreload();

    return {
      isEnabled: () => enabled,
      setEnabled,
      unlock,
      play,
      handleStateTransition
    };
  }

  return {
    STORAGE_KEY,
    REMOTE_VOLUME,
    DEFAULT_DISCARD_DELAY_MS,
    WRONG_THROW_PILE_DELAY_MS,
    configureAmbientAudioSession,
    audioAssetQuery,
    SOUND_PATHS,
    getStoredEnabled,
    storeEnabled,
    soundEventsForTransition,
    create
  };
});
