function createIdCounter(start = 1) {
  let next = start;
  return function nextId() {
    return next++;
  };
}

module.exports = { createIdCounter };
