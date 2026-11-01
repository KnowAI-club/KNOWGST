import { createHash } from "node:crypto";
const email = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
const bad = (message) => Object.assign(new Error(message), { status: 400 });
export function resendEmail(store, { fetcher = fetch } = {}) {
  const running = new Set();
  function status() {
    const r = store.get().resend;
    return {
      configured: !!r.apiKey,
      from: r.from || "",
      name: r.name || "",
      replyTo: r.replyTo || "",
      recent: Object.values(store.get().outbox)
        .sort((a, b) => b.created.localeCompare(a.created))
        .slice(0, 10)
        .map(({ created, to, subject, status, providerId }) => ({
          created,
          to,
          subject,
          status,
          providerId,
        })),
    };
  }
  function configure(input) {
    const { from, name = "", replyTo = "", apiKey } = input || {};
    if (
      typeof from !== "string" ||
      !email.test(from) ||
      typeof replyTo !== "string" ||
      (replyTo && !email.test(replyTo)) ||
      typeof name !== "string" ||
      name.length > 100 ||
      /[\r\n<>]/.test(name)
    )
      throw bad("Enter a valid sender and reply-to email.");
    if (
      apiKey !== undefined &&
      (typeof apiKey !== "string" || !/^re_[A-Za-z0-9_-]{10,250}$/.test(apiKey))
    )
      throw bad("Enter a valid Resend API key.");
    store.update((s) => {
      s.resend = {
        ...s.resend,
        from,
        name,
        replyTo,
        ...(apiKey ? { apiKey } : {}),
      };
    });
    return status();
  }
  function disconnect() {
    store.update((s) => {
      delete s.resend.apiKey;
    });
    return status();
  }
  async function send(input) {
    const { requestId, to, subject, text, attachment } = input || {};
    if (
      typeof requestId !== "string" ||
      !/^[a-zA-Z0-9-]{16,80}$/.test(requestId)
    )
      throw bad("Invalid email request ID.");
    if (
      typeof to !== "string" ||
      !email.test(to) ||
      typeof subject !== "string" ||
      !subject.trim() ||
      subject.length > 200 ||
      /[\r\n]/.test(subject) ||
      typeof text !== "string" ||
      !text.trim() ||
      text.length > 12000
    )
      throw bad("Enter a recipient, subject and message.");
    if (
      !attachment ||
      typeof attachment.content !== "string" ||
      attachment.content.length > 4200000 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(attachment.content) ||
      typeof attachment.filename !== "string" ||
      !/^[\w .()-]{1,160}\.pdf$/i.test(attachment.filename)
    )
      throw bad("Attach a PDF up to 3 MB with a simple filename.");
    const bytes = Buffer.from(attachment.content, "base64");
    if (
      bytes.length > 3 * 1024 * 1024 ||
      bytes.subarray(0, 5).toString() !== "%PDF-" ||
      bytes.toString("base64") !== attachment.content
    )
      throw bad("The attachment is not a valid PDF file.");
    const config = store.get().resend;
    if (!config.apiKey || !email.test(config.from))
      throw bad("Configure Resend in Settings → Integrations first.");
    if (input.expectedSender !== config.from)
      throw bad(
        "The sender changed. Close this draft and review a new one before sending.",
      );
    const payload = {
      from: config.name ? `${config.name} <${config.from}>` : config.from,
      to: [to],
      subject,
      text,
      attachments: [
        { filename: attachment.filename, content: attachment.content },
      ],
      ...(config.replyTo ? { reply_to: config.replyTo } : {}),
    };
    const digest = createHash("sha256")
      .update(config.apiKey)
      .update(JSON.stringify(payload))
      .digest("hex");
    const prior = store.get().outbox[requestId];
    if (prior && prior.digest !== digest)
      throw bad(
        "The email configuration or draft changed. Check Resend for the previous request before starting a new draft.",
      );
    if (prior?.status === "accepted")
      return { id: prior.providerId, status: "accepted", replayed: true };
    if (running.has(requestId))
      throw Object.assign(bad("This email is already being sent."), {
        status: 409,
      });
    if (prior && Date.now() - Date.parse(prior.created) > 23 * 60 * 60 * 1000)
      throw bad(
        "This request is too old to retry safely. Check the Resend dashboard before creating a new draft.",
      );
    running.add(requestId);
    try {
      store.update((s) => {
        s.outbox[requestId] = {
          digest,
          created: prior?.created || new Date().toISOString(),
          to,
          subject,
          status: "unconfirmed",
        };
      });
      let response;
      try {
        response = await fetcher("https://api.resend.com/emails", {
          method: "POST",
          redirect: "error",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `knowgst-${requestId}`,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(20000),
        });
      } catch {
        throw Object.assign(
          bad(
            "Email outcome is unconfirmed. Retry this same draft or check Resend before starting another.",
          ),
          { status: 502 },
        );
      }
      if (!response.ok) {
        const status = response.status;
        const uncertain = status >= 500 || status === 409;
        store.update((s) => {
          s.outbox[requestId].status = uncertain ? "unconfirmed" : "rejected";
        });
        throw Object.assign(
          bad(
            status === 401 || status === 403
              ? "Resend rejected the credentials or sender. Check your API key and verified domain."
              : status === 429
                ? "Resend rate limit reached. Wait, then retry this same draft."
                : `Resend did not accept this request (${status}). Check Resend before creating another draft.`,
          ),
          { status: 502 },
        );
      }
      let result;
      try {
        result = await response.json();
      } catch {
        throw bad(
          "Email outcome is unconfirmed. Check Resend before starting another draft.",
        );
      }
      if (typeof result.id !== "string" || !result.id)
        throw bad(
          "Email outcome is unconfirmed. Check Resend before starting another draft.",
        );
      store.update((s) => {
        s.outbox[requestId].status = "accepted";
        s.outbox[requestId].providerId = result.id;
      });
      return { id: result.id, status: "accepted" };
    } finally {
      running.delete(requestId);
    }
  }
  return { status, configure, disconnect, send };
}
