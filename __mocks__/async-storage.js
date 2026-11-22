const storage = new Map();

const asyncStorage = {
  getItem: jest.fn(async (key) => (storage.has(key) ? storage.get(key) : null)),
  setItem: jest.fn(async (key, value) => { storage.set(key, value); }),
  removeItem: jest.fn(async (key) => { storage.delete(key); }),
  clear: jest.fn(async () => { storage.clear(); }),
  getAllKeys: jest.fn(async () => Array.from(storage.keys())),
};

module.exports = {
  __esModule: true,
  default: asyncStorage,
};
