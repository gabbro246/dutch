(function initClientSounds(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DutchClientSounds = api;
})(typeof window !== 'undefined' ? window : globalThis, function createClientSounds(root) {
  const STORAGE_KEY = 'dutchSoundEffects';
  const REMOTE_VOLUME = 0.75;
  const DEFAULT_DISCARD_DELAY_MS = 360;
  const SOUND_PATHS = {
    draw: 'sounds/card-draw.mp3',
    discard: 'sounds/card-discard.mp3',
    turn: 'sounds/turn-begin.mp3'
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
    if (previousState.gameStartedAt !== state.gameStartedAt) return [];

    const previousRound = previousState.round;
    const round = state.round;
    const sameRound = previousState.roundNumber === state.roundNumber;
    const events = [];

    if (sameRound) {
      const previousDrawnId = previousRound.drawn && previousRound.drawn.card && previousRound.drawn.card.id;
      const drawnId = round.drawn && round.drawn.card && round.drawn.card.id;
      if (drawnId && drawnId !== previousDrawnId) {
        const actorId = round.drawn.playerId || round.currentPlayerId || '';
        events.push({ name: 'draw', volume: actorId === state.you ? 1 : REMOTE_VOLUME });
      }

      const previousDiscardId = previousRound.pendingPileReveal && previousRound.pendingPileReveal.cardId;
      const discardId = round.pendingPileReveal && round.pendingPileReveal.cardId;
      if (discardId && discardId !== previousDiscardId) {
        const actorId = round.pendingPileReveal.actorId || round.currentPlayerId || '';
        const moveMs = Number(round.pendingPileReveal.moveMs);
        events.push({
          name: 'discard',
          volume: actorId === state.you ? 1 : REMOTE_VOLUME,
          delayMs: Number.isFinite(moveMs) ? Math.max(0, moveMs) : DEFAULT_DISCARD_DELAY_MS,
          eventId: [state.gameStartedAt, state.roundNumber, 'discard', discardId].join(':')
        });
      }
    }

    const localTurnStarted = round.stage === 'turn'
      && round.currentPlayerId === state.you
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
    const AudioConstructor = options.Audio || target.Audio;
    const paths = { ...SOUND_PATHS, ...(options.paths || {}) };
    const schedule = options.setTimeoutFn
      || (target && typeof target.setTimeout === 'function' ? target.setTimeout.bind(target) : setTimeout);
    const audioByName = new Map();
    const activeAudio = new Set();
    const handledEventIds = new Set();
    let enabled = getStoredEnabled(target);

    function audioFor(name) {
      if (!AudioConstructor || !paths[name]) return null;
      if (!audioByName.has(name)) {
        const audio = new AudioConstructor(paths[name]);
        audio.preload = 'auto';
        audioByName.set(name, audio);
      }
      const original = audioByName.get(name);
      return typeof original.cloneNode === 'function' ? original.cloneNode() : new AudioConstructor(paths[name]);
    }

    function play(name, volume = 1) {
      if (!enabled) return false;
      const audio = audioFor(name);
      if (!audio) return false;
      audio.volume = Math.max(0, Math.min(1, Number(volume) || 0));
      activeAudio.add(audio);
      const release = () => activeAudio.delete(audio);
      if (typeof audio.addEventListener === 'function') audio.addEventListener('ended', release, { once: true });
      try {
        const playback = audio.play();
        if (playback && typeof playback.catch === 'function') playback.catch(release);
      } catch (error) {
        release();
        return false;
      }
      return true;
    }

    function setEnabled(value) {
      enabled = storeEnabled(value, target);
      if (!enabled) {
        activeAudio.forEach((audio) => {
          if (typeof audio.pause === 'function') audio.pause();
        });
        activeAudio.clear();
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

    return {
      isEnabled: () => enabled,
      setEnabled,
      play,
      handleStateTransition
    };
  }

  return {
    STORAGE_KEY,
    REMOTE_VOLUME,
    DEFAULT_DISCARD_DELAY_MS,
    SOUND_PATHS,
    getStoredEnabled,
    storeEnabled,
    soundEventsForTransition,
    create
  };
});
