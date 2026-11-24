const clipboard = {
  getString: jest.fn(async () => ''),
  setString: jest.fn(),
  hasString: jest.fn(async () => false),
};

module.exports = {
  __esModule: true,
  default: clipboard,
};
