const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { configureIdentity } = require("../../apps/desktop/identity.cjs");

test("KnowGST display branding keeps the existing workspace and credential directory", () => {
  const appData = path.resolve("fixture-application-support");
  const calls = [];
  configureIdentity({
    getPath(name) { assert.equal(name, "appData"); return appData; },
    setName(name) { calls.push(["name", name]); },
    setPath(name, value) { calls.push([name, value]); },
  }, {});
  assert.deepEqual(calls, [["name", "KnowGST"], ["userData", path.join(appData, "KNOWGST")]]);
});

test("isolated desktop test workspaces do not fall back to real user data", () => {
  const calls = [];
  configureIdentity({
    getPath() { throw Error("Real application data must not be read"); },
    setName(name) { calls.push(["name", name]); },
    setPath(name, value) { calls.push([name, value]); },
  }, { KNOWGST_DESKTOP_DATA: "fixture-isolated-workspace" });
  assert.deepEqual(calls, [["name", "KnowGST"], ["userData", path.resolve("fixture-isolated-workspace")]]);
});
