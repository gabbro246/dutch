function createFakeClock(start = 1_700_000_000_000) {
  let currentTime = Number(start);
  let nextId = 1;
  const timers = [];

  function now() {
    return currentTime;
  }

  function setTimeoutFn(callback, delay = 0) {
    const timer = {
      id: nextId++,
      at: currentTime + Math.max(0, Number(delay) || 0),
      callback,
      cancelled: false,
      unref() { return timer; }
    };
    timers.push(timer);
    return timer;
  }

  function clearTimeoutFn(timer) {
    if (timer) timer.cancelled = true;
  }

  function advanceTo(targetTime) {
    const target = Math.max(currentTime, Number(targetTime) || currentTime);
    while (true) {
      timers.sort((left, right) => left.at - right.at || left.id - right.id);
      const timer = timers.find((candidate) => !candidate.cancelled && candidate.at <= target);
      if (!timer) break;
      timer.cancelled = true;
      currentTime = timer.at;
      timer.callback();
    }
    currentTime = target;
  }

  function advanceBy(milliseconds) {
    advanceTo(currentTime + Math.max(0, Number(milliseconds) || 0));
  }

  return { now, setTimeoutFn, clearTimeoutFn, advanceTo, advanceBy };
}

module.exports = { createFakeClock };
