const app = require('../server/src/index');

module.exports = async (req, res) => {
  if (app.initPromise) {
    await app.initPromise;
  }
  return app(req, res);
};
