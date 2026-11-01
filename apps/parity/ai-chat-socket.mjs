import { timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
const localAddress = (value) =>
  ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(value);
const localHostname = (value) =>
  ["127.0.0.1", "localhost", "[::1]"].includes(value);
const plainObject = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);
const requestId = (value) =>
  typeof value === "string" && /^[\w-]{1,64}$/.test(value);
// Close upgraded sockets before HTTP server.close(), which otherwise waits for them.
export function closeAiChatSocket(wss) {
  for (const ws of wss.clients) ws.terminate();
  wss.close();
}
export function attachAiChatSocket(server, { secret, ask }) {
  if (
    typeof secret !== "string" ||
    secret.length < 32 ||
    typeof ask !== "function"
  )
    throw new Error(
      "Local AI socket requires an authenticated application session.",
    );
  const expected = Buffer.from(secret);
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 8192,
    perMessageDeflate: false,
  });
  const upgrade = (req, socket, head) => {
    if (req.url !== "/api/ai/chat") {
      socket.end(
        "HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
      return;
    }
    let allowed = false;
    try {
      const origin = new URL(req.headers.origin || ""),
        host = new URL(`http://${req.headers.host}`);
      const supplied = Buffer.from(String(req.headers["x-knowgst-key"] || ""));
      allowed =
        req.method === "GET" &&
        localAddress(req.socket.remoteAddress) &&
        ["http:", "https:"].includes(origin.protocol) &&
        localHostname(origin.hostname) &&
        localHostname(host.hostname) &&
        !origin.username &&
        !origin.password &&
        origin.origin === req.headers.origin &&
        supplied.length === expected.length &&
        timingSafeEqual(supplied, expected);
    } catch {
      /* Reject malformed URLs and headers without revealing credentials. */
    }
    if (!allowed) {
      socket.end(
        "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req),
    );
  };
  server.on("upgrade", upgrade);
  wss.on("connection", (ws) => {
    let pending = false,
      alive = true;
    const seen = new Set();
    const send = (message) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    };
    ws.on("pong", () => {
      alive = true;
    });
    ws.on("error", () => {
      /* ws closes malformed frames; do not log request bodies. */
    });
    const heartbeat = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }, 30000);
    heartbeat.unref();
    ws.on("close", () => clearInterval(heartbeat));
    ws.on("message", async (data, binary) => {
      let message,
        id = "";
      try {
        if (binary) throw new Error("Use a JSON chat request.");
        message = JSON.parse(data.toString());
        if (requestId(message?.id)) id = message.id;
        const p = message?.payload;
        if (
          !plainObject(message) ||
          !id ||
          message.type !== "ask" ||
          !plainObject(p) ||
          typeof p.businessId !== "string" ||
          !p.businessId ||
          p.businessId.length > 200 ||
          typeof p.question !== "string" ||
          !p.question.trim() ||
          p.question.length > 1000 ||
          typeof p.model !== "string" ||
          !p.model ||
          p.model.length > 150 ||
          p.consent !== true ||
          (p.conversationId != null &&
            (typeof p.conversationId !== "string" ||
              p.conversationId.length !== 36))
        )
          throw new Error(
            "Enter a valid question and approve access to this business.",
          );
      } catch (error) {
        send({
          type: "error",
          id,
          error:
            error instanceof SyntaxError
              ? "Invalid chat request."
              : error.message,
        });
        return;
      }
      if (pending) {
        send({
          type: "error",
          id,
          error: "A reply is already in progress. Wait before sending again.",
        });
        return;
      }
      if (seen.has(id)) {
        send({
          type: "error",
          id,
          error:
            "This request was already handled. Send a new request to retry.",
        });
        return;
      }
      if (seen.size >= 20) {
        ws.close(1008, "Open a new chat connection.");
        return;
      }
      seen.add(id);
      pending = true;
      try {
        send({ type: "status", id, message: "Starting your request…" });
        const p = message.payload;
        const result = await ask(
          {
            businessId: p.businessId,
            question: p.question,
            model: p.model,
            consent: true,
            conversationId: p.conversationId,
          },
          {
            onStatus: (status) => send({ type: "status", id, message: status }),
            isCancelled: () => ws.readyState !== WebSocket.OPEN,
          },
        );
        send({ type: "result", id, result });
      } catch (error) {
        send({
          type: "error",
          id,
          error: error.status
            ? error.message
            : "The chat request failed. Check your connection and try again.",
        });
      } finally {
        pending = false;
      }
    });
  });
  const closeClients = () => closeAiChatSocket(wss);
  server.once("close", closeClients);
  wss.once("close", () => {
    server.off("upgrade", upgrade);
    server.off("close", closeClients);
  });
  return wss;
}
