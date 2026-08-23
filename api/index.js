const app = require('../server/src/index');

module.exports = async (req, res) => {
  // Wait only for users/offices so login is not blocked by the 71k NSC snapshot.
  if (app.initAuthPromise) {
    await app.initAuthPromise;
  }
  return app(req, res);
};
