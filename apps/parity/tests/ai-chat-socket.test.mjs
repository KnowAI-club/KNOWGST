import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { WebSocket } from "ws";
import { attachAiChatSocket, closeAiChatSocket } from "../ai-chat-socket.mjs";
const { startGateway } = createRequire(import.meta.url)(
  "../../desktop/gateway.cjs",
);
const secret = "a".repeat(64);
async function fixture(t, ask) {
  const server = http.createServer((_req, res) => res.end("local"));
  const wss = attachAiChatSocket(server, { secret, ask });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    closeAiChatSocket(wss);
    await new Promise((resolve) => server.close(resolve));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    server,
    wss,
    origin,
    url: origin.replace("http:", "ws:") + "/api/ai/chat",
  };
}
async function open(url, origin, key = secret) {
  const ws = new WebSocket(url, {
    headers: { Origin: origin, "x-knowgst-key": key },
  });
  ws.on("error", () => {});
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  return ws;
}
function message(ws, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", listener);
      reject(new Error("Missing socket response"));
    }, 5000);
    const listener = (data) => {
      const value = JSON.parse(data);
      if (predicate(value)) {
        clearTimeout(timer);
        ws.off("message", listener);
        resolve(value);
      }
    };
    ws.on("message", listener);
  });
}
const askMessage = (id) => ({
  id,
  type: "ask",
  payload: {
    businessId: "business",
    question: "Find invoice",
    model: "model",
    consent: true,
  },
});
async function refused(url, origin, key = secret, headers = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, {
      headers: { Origin: origin, "x-knowgst-key": key, ...headers },
    });
    ws.on("error", () => {});
    ws.once("open", () => {
      ws.terminate();
      reject(new Error("Unauthorized upgrade accepted"));
    });
    ws.once("unexpected-response", (_request, response) => {
      response.resume();
      resolve(response.statusCode);
      ws.terminate();
    });
  });
}

test("WebSocket requires local origin, host and application secret before dispatch", async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => {
    calls++;
    return { text: "hello" };
  });
  assert.equal(await refused(f.url, f.origin, ""), 403);
  assert.equal(await refused(f.url, "https://attacker.example"), 403);
  assert.equal(
    await refused(f.url, f.origin, secret, { Host: "attacker.example" }),
    403,
  );
  assert.equal(await refused(f.url, "null"), 403);
  assert.equal(await refused(f.url + "?unexpected=1", f.origin), 404);
  assert.equal(calls, 0);
});

test("WebSocket sends progress and correlated result; rejects malformed, duplicate and concurrent requests", async (t) => {
  let release,
    started,
    calls = 0;
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const f = await fixture(t, async (payload, { onStatus }) => {
    calls++;
    assert.equal(payload.consent, true);
    onStatus("Reading records");
    started();
    await hold;
    return { text: "Answer", sources: [], conversationId: "id" };
  });
  const ws = await open(f.url, f.origin);
  t.after(() => ws.terminate());
  let response = message(ws, (m) => m.type === "error");
  ws.send("{bad");
  assert.match((await response).error, /Invalid/);
  response = message(ws, (m) => m.type === "error");
  ws.send(
    JSON.stringify({
      ...askMessage("unapproved"),
      payload: { ...askMessage("x").payload, consent: false },
    }),
  );
  await response;
  assert.equal(calls, 0);
  const progress = message(
    ws,
    (m) => m.type === "status" && m.message === "Reading records",
  );
  ws.send(JSON.stringify(askMessage("one")));
  await ready;
  assert.equal((await progress).id, "one");
  response = message(ws, (m) => m.type === "error" && m.id === "two");
  ws.send(JSON.stringify(askMessage("two")));
  assert.match((await response).error, /already in progress/);
  response = message(ws, (m) => m.type === "result");
  release();
  const result = await response;
  assert.equal(result.id, "one");
  assert.equal(result.result.text, "Answer");
  response = message(ws, (m) => m.type === "error");
  ws.send(JSON.stringify(askMessage("one")));
  assert.match((await response).error, /already handled/);
  assert.equal(calls, 1);
});

test("WebSocket caps payload size and exposes cancellation when the client closes", async (t) => {
  let cancelled,
    release,
    calls = 0;
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  const f = await fixture(t, async (_payload, options) => {
    calls++;
    cancelled = options.isCancelled;
    await hold;
    return { text: "ignored" };
  });
  const large = await open(f.url, f.origin);
  const closed = new Promise((resolve) => large.once("close", resolve));
  large.send("x".repeat(9000));
  assert.equal(await closed, 1009);
  assert.equal(calls, 0);
  const ws = await open(f.url, f.origin);
  const started = message(ws, (m) => m.type === "status");
  ws.send(JSON.stringify(askMessage("one")));
  await started;
  await new Promise((resolve) => {
    ws.once("close", resolve);
    ws.close();
  });
  assert.equal(cancelled(), true);
  release();
});

test("desktop gateway proxies authenticated chat but rejects foreign origins and missing secret", async (t) => {
  const f = await fixture(t, async () => ({
    text: "Gateway answer",
    sources: [],
  }));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowgst-chat-gateway-"));
  const gateway = await startGateway({
    root,
    apiPort: f.server.address().port,
    secret,
  });
  t.after(async () => {
    await new Promise((resolve) => gateway.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const url = gateway.origin.replace("http:", "ws:") + "/api/ai/chat";
  assert.equal(await refused(url, gateway.origin, ""), 403);
  assert.equal(await refused(url, f.origin), 403);
  assert.equal(await refused(url, "https://attacker.example"), 403);
  const ws = await open(url, gateway.origin);
  const response = message(ws, (m) => m.type === "result");
  ws.send(JSON.stringify(askMessage("gateway")));
  assert.equal((await response).result.text, "Gateway answer");
  const disconnected = new Promise((resolve) => ws.once("close", resolve));
  await new Promise((resolve) => gateway.close(resolve));
  await disconnected;
});

test(
  "backend chat shutdown closes an active upgraded connection before HTTP close",
  { timeout: 3000 },
  async (t) => {
    const f = await fixture(t, async () => ({ text: "hello" }));
    const ws = await open(f.url, f.origin);
    const disconnected = new Promise((resolve) => ws.once("close", resolve));
    closeAiChatSocket(f.wss);
    await new Promise((resolve) => f.server.close(resolve));
    await disconnected;
    assert.equal(ws.readyState, WebSocket.CLOSED);
  },
);
