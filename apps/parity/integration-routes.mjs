import { categoryAssistant } from "./ai-categorization.mjs";
import { invoiceDraftAssistant } from "./ai-invoice-draft.mjs";
import { emailDraftAssistant } from "./ai-email-draft.mjs";
import { recordAssistant } from "./ai-records.mjs";
import { extractBill } from "./ocr-extraction.mjs";
import { aiWorkspace } from "./ai-workspace.mjs";
import { credentialStore } from "./integration-vault.mjs";
import { chatgptOAuth } from "./chatgpt-oauth.mjs";
import { resendEmail } from "./resend-email.mjs";
import { workflowStore } from './ai-workflow-store.mjs';
import { documentInbox } from './ai-document-inbox.mjs';
import { importReview } from './ai-import-review.mjs';
import { matchingAssistant } from './ai-matching.mjs';
import { catalogAssistant } from './ai-catalog.mjs';
import { reviewInsights } from './ai-review-insights.mjs';
export function integrationRoutes(app, runtime, readSummary, readModule, workflowOptions) {
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
  route("post", "/chatgpt/start", (b) =>
    chat.start(b.clientId, { newAccount: b.newAccount }),
  );
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
  route("post", "/chatgpt/ocr", (b) => extractBill(chat, b, { readModule }));
  route("post", "/chatgpt/ask", (b) => chat.ask(b));
  const askRecords = readModule
    ? recordAssistant({ chat, readModule })
    : undefined;
  if (askRecords) {
    route("post", "/ai/records", askRecords);
    route("post", "/ai/categorize", categoryAssistant({ chat, readModule }));
    const invoiceDraft = invoiceDraftAssistant({ chat, readModule });
    route("post", "/ai/invoice-draft/preview", invoiceDraft.preview);
    route("post", "/ai/invoice-draft/generate", invoiceDraft.generate);
    route("post", "/ai/invoice-draft/resolve", invoiceDraft.resolve);
    if (workflowOptions?.dataDir) {
      const state = workflowStore({dataDir:workflowOptions.dataDir, readModule});
      const dependencies = {...workflowOptions, chat, readModule, store:state};
      for (const [group, handlers] of Object.entries({
        documents:documentInbox(dependencies),
        imports:importReview(dependencies),
        matching:matchingAssistant(dependencies),
        catalog:catalogAssistant(dependencies),
        insights:reviewInsights(dependencies),
      })) for (const [action, handler] of Object.entries(handlers)) route('post', `/ai/${group}/${action}`, handler);
    }
  }
  route("post", "/ai/email-draft", emailDraftAssistant({ chat }));
  if (readSummary) {
    const assistant = aiWorkspace({ readSummary, chat });
    route("post", "/ai/preview", (b) => assistant.preview(b));
    route("post", "/ai/analyze", (b) => assistant.analyze(b));
  }
  route("post", "/resend", (b) => mail.configure(b));
  route("post", "/resend/disconnect", () => mail.disconnect());
  route("post", "/resend/send", (b) => mail.send(b));
  return { askRecords };
}
