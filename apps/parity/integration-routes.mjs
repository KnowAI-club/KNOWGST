import { recordAssistant } from "./ai-records.mjs";
import { extractBill } from "./ocr-extraction.mjs";
import { aiWorkspace } from "./ai-workspace.mjs";
import { credentialStore } from "./integration-vault.mjs";
import { chatgptOAuth } from "./chatgpt-oauth.mjs";
import { resendEmail } from "./resend-email.mjs";
export function integrationRoutes(app, runtime, readSummary, readModule) {
  let store;
  try {
    store = credentialStore(runtime);
  } catch {
    app.use("/api/integrations", (_req, res) =>
      res.status(503).json({
        error:
          "Integration settings could not be read. Your billing data is unaffected. Preserve the credentials file and contact support before reconnecting.",
      }),
    );
    return;
  }
  const chat = chatgptOAuth(store),
    mail = resendEmail(store);
  const route = (method, path, fn) =>
    app[method]("/api/integrations" + path, async (req, res) => {
      try {
        res.json(await fn(req.body || {}));
      } catch (e) {
        res.status(e.status || 502).json({
          error: e.status
            ? e.message
            : "The integration request failed. Check your connection and try again.",
        });
      }
    });
  route("get", "", () => ({ chatgpt: chat.status(), resend: mail.status() }));
  route("post", "/chatgpt/start", (b) => chat.start(b.clientId));
  route("post", "/chatgpt/cancel", () => {
    chat.cancel();
    return { ok: true };
  });
  route("post", "/chatgpt/select", (b) => {
    chat.select(b.clientId);
    return chat.status();
  });
  route("post", "/chatgpt/disconnect", (b) => chat.disconnect(b.clientId));
  route("get", "/chatgpt/models", () => chat.models());
  route("post", "/chatgpt/ocr", (b) => extractBill(chat, b));
  route("post", "/chatgpt/ask", (b) => chat.ask(b));
  if (readModule)
    route("post", "/ai/records", recordAssistant({ chat, readModule }));
  if (readSummary) {
    const assistant = aiWorkspace({ readSummary, chat });
    route("post", "/ai/preview", (b) => assistant.preview(b));
    route("post", "/ai/analyze", (b) => assistant.analyze(b));
  }
  route("post", "/resend", (b) => mail.configure(b));
  route("post", "/resend/disconnect", () => mail.disconnect());
  route("post", "/resend/send", (b) => mail.send(b));
}
