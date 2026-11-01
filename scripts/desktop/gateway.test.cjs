const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { startGateway } = require("../../apps/desktop/gateway.cjs");
test("desktop assets require the application secret and exact local origin", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowgst-gateway-"));
  fs.writeFileSync(path.join(root, "index.html"), "KNOWGST");
  const secret = "a".repeat(64);
  const { server, origin } = await startGateway({ root, apiPort: 1, secret });
  try {
    assert.equal((await fetch(origin)).status, 403);
    assert.equal(
      (
        await fetch(origin, {
          headers: { "x-knowgst-key": secret, origin: "https://example.com" },
        })
      ).status,
      403,
    );
    assert.equal(
      await (
        await fetch(origin, { headers: { "x-knowgst-key": secret } })
      ).text(),
      "KNOWGST",
    );
    assert.equal(
      (await fetch(origin + "/.env", { headers: { "x-knowgst-key": secret } }))
        .status,
      404,
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
