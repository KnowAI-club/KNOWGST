import Fastify from "fastify";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { Store, Conflict } from "./store.js";

export function createApi(store: Store, secret: string) {
  if (secret.length < 32)
    throw new Error("Local service requires a strong secret");
  const app = Fastify({ bodyLimit: 128 * 1024, logger: false });
  app.addHook("onRequest", async (request, reply) => {
    const supplied = Buffer.from(
      String(request.headers["x-knowgst-key"] ?? ""),
    );
    const expected = Buffer.from(secret);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      return reply
        .code(401)
        .send({
          code: "UNAUTHORIZED",
          message: "Local session is not authorized",
        });
  });
  app.addHook("onSend", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError)
      return reply
        .code(422)
        .send({
          code: "VALIDATION",
          message: "Check the fields and try again",
          fields: error.issues.map((i) => ({
            field: i.path.join("."),
            message: i.message,
          })),
          request_id: request.id,
        });
    if (error instanceof Conflict)
      return reply
        .code(409)
        .send({
          code: "CONFLICT",
          message: error.message,
          request_id: request.id,
        });
    return reply
      .code(500)
      .send({
        code: "INTERNAL",
        message: "The operation could not be completed",
        request_id: request.id,
      });
  });
  app.get("/api/v1/workspace", async () => store.snapshot());
  app.get("/api/v1/health", async () => ({
    status: "ok",
    mode: "local-development",
  }));
  app.post("/api/v1/business", async (req) =>
    store.command(
      String(req.headers["idempotency-key"] ?? ""),
      "setup",
      req.body,
      () => store.setup(req.body),
    ),
  );
  app.post("/api/v1/invoices", async (req) =>
    store.command(
      String(req.headers["idempotency-key"] ?? ""),
      "draft",
      req.body,
      () => store.draft(req.body),
    ),
  );
  app.post<{ Params: { id: string } }>(
    "/api/v1/invoices/:id/issue",
    async (req) => {
      const { version } = z
        .object({ version: z.number().int().positive() })
        .strict()
        .parse(req.body);
      return store.command(
        String(req.headers["idempotency-key"] ?? ""),
        `issue:${req.params.id}`,
        req.body,
        () => store.issue(req.params.id, version),
      );
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/v1/invoices/:id/payments",
    async (req) =>
      store.command(
        String(req.headers["idempotency-key"] ?? ""),
        `pay:${req.params.id}`,
        req.body,
        () => store.pay(req.params.id, req.body),
      ),
  );
  return app;
}
