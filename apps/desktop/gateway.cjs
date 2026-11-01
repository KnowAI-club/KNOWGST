const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".gz": "application/gzip",
  ".ico": "image/x-icon",
};
exports.startGateway = async ({ root, apiPort, secret }) => {
  if (typeof secret !== "string" || secret.length < 32)
    throw new Error(
      "Local gateway requires an authenticated application session.",
    );
  const server = http.createServer((req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const supplied = Buffer.from(String(req.headers["x-knowgst-key"] || "")),
      expected = Buffer.from(secret);
    if (
      req.headers.host !== new URL(origin).host ||
      (req.headers.origin && req.headers.origin !== origin) ||
      supplied.length !== expected.length ||
      !crypto.timingSafeEqual(supplied, expected)
    ) {
      res.writeHead(403);
      res.end("Local application session required");
      return;
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    if (req.url.startsWith("/api/")) {
      const proxy = http.request(
        {
          host: "127.0.0.1",
          port: apiPort,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: `127.0.0.1:${apiPort}` },
        },
        (upstream) => {
          res.writeHead(upstream.statusCode, upstream.headers);
          upstream.pipe(res);
        },
      );
      proxy.on("error", () => {
        if (!res.headersSent)
          res.writeHead(503, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Local service unavailable. Restart KNOWGST.",
          }),
        );
      });
      req.on("aborted", () => proxy.destroy());
      req.pipe(proxy);
      return;
    }
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405);
      res.end();
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, origin).pathname);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    if (pathname.endsWith("/")) pathname += "index.html";
    const file = path.resolve(root, "." + pathname);
    if (
      !file.startsWith(path.resolve(root) + path.sep) ||
      pathname.split("/").some((p) => p.startsWith("."))
    ) {
      res.writeHead(404);
      res.end();
      return;
    }
    fs.stat(file, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.setHeader(
        "Content-Type",
        types[path.extname(file)] || "application/octet-stream",
      );
      res.setHeader("Cache-Control", "no-cache");
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      const stream = fs.createReadStream(file);
      stream.on("error", () => res.destroy());
      stream.pipe(res);
    });
  });
  // Browser WebSocket requests use the same trusted-renderer secret as HTTP.
  const tunnels = new Set();
  server.on("upgrade", (req, socket, head) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const supplied = Buffer.from(String(req.headers["x-knowgst-key"] || ""));
    const expected = Buffer.from(secret);
    if (
      req.url !== "/api/ai/chat" ||
      req.method !== "GET" ||
      req.headers.host !== new URL(origin).host ||
      req.headers.origin !== origin ||
      !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
        req.socket.remoteAddress,
      ) ||
      supplied.length !== expected.length ||
      !crypto.timingSafeEqual(supplied, expected)
    ) {
      socket.end(
        "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
      return;
    }
    let upstreamSocket,
      upgraded = false;
    tunnels.add(socket);
    const proxy = http.request({
      host: "127.0.0.1",
      port: apiPort,
      path: req.url,
      method: "GET",
      headers: {
        ...req.headers,
        host: `127.0.0.1:${apiPort}`,
        "x-knowgst-key": secret,
      },
    });
    const fail = () => {
      if (upgraded) socket.destroy();
      else if (!socket.destroyed)
        socket.end(
          "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
        );
    };
    proxy.setTimeout(10000, () => proxy.destroy());
    proxy.on("error", fail);
    proxy.on("response", (response) => {
      response.resume();
      fail();
    });
    proxy.on("upgrade", (response, upstream, upstreamHead) => {
      if (socket.destroyed) {
        upstream.destroy();
        return;
      }
      upgraded = true;
      upstreamSocket = upstream;
      proxy.setTimeout(0);
      tunnels.add(upstream);
      let headers = "HTTP/1.1 101 Switching Protocols\r\n";
      for (let i = 0; i < response.rawHeaders.length; i += 2)
        headers += `${response.rawHeaders[i]}: ${response.rawHeaders[i + 1]}\r\n`;
      socket.write(headers + "\r\n");
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) upstream.write(head);
      upstream.on("error", () => socket.destroy());
      upstream.on("close", () => {
        tunnels.delete(upstream);
        socket.destroy();
      });
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    socket.on("error", () => {
      proxy.destroy();
      upstreamSocket?.destroy();
    });
    socket.on("close", () => {
      tunnels.delete(socket);
      proxy.destroy();
      upstreamSocket?.destroy();
    });
    proxy.end();
  });
  const closeTunnels = () => {
    for (const socket of tunnels) socket.destroy();
    tunnels.clear();
  };
  server.once("close", closeTunnels);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    server,
    origin: `http://127.0.0.1:${server.address().port}`,
    close(callback) {
      closeTunnels();
      return server.close(callback);
    },
  };
};
