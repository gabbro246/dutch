(function initSelectInteraction(root) {
  const OPEN_KEYS = new Set([' ', 'Enter', 'ArrowDown', 'ArrowUp', 'F4']);
  const CLOSE_KEYS = new Set(['Escape', 'Tab']);

  function createSelectInteraction(options = {}) {
    const schedule = options.schedule || ((callback) => root.setTimeout(callback, 0));
    let activeElement = null;
    let releaseScheduled = false;

    function begin(element) {
      activeElement = element;
    }

    function release(element) {
      if (element && activeElement !== element) return;
      activeElement = null;
      releaseScheduled = false;
    }

    function releaseSoon(element) {
      if (element && activeElement !== element) return;
      if (releaseScheduled) return;
      releaseScheduled = true;
      schedule(() => {
        releaseScheduled = false;
        release(element);
      });
    }

    function releaseIfOutside(element) {
      if (activeElement && activeElement !== element) releaseSoon(activeElement);
    }

    function current() {
      if (activeElement && activeElement.isConnected === false) release(activeElement);
      return activeElement;
    }

    function wire(select) {
      if (!select) return;
      select.addEventListener('pointerdown', () => begin(select));
      select.addEventListener('pointercancel', () => releaseSoon(select));
      select.addEventListener('keydown', (event) => {
        if (OPEN_KEYS.has(event.key)) begin(select);
        if (CLOSE_KEYS.has(event.key)) releaseSoon(select);
      });
      select.addEventListener('change', () => releaseSoon(select));
      select.addEventListener('blur', () => releaseSoon(select));
    }

    return {
      begin,
      release,
      releaseSoon,
      releaseIfOutside,
      current,
      wire
    };
  }

  const api = { create: createSelectInteraction };
  root.DutchSelectInteraction = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
