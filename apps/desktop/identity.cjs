const path = require("node:path");

const displayName = "KnowGST";
// Display branding must never relocate an existing workspace or its credentials.
const dataDirectoryName = "KNOWGST";

function configureIdentity(app, env = process.env) {
  const userData = env.KNOWGST_DESKTOP_DATA
    ? path.resolve(env.KNOWGST_DESKTOP_DATA)
    : path.join(app.getPath("appData"), dataDirectoryName);
  app.setName(displayName);
  app.setPath("userData", userData);
}

module.exports = { displayName, dataDirectoryName, configureIdentity };
