// A fresh socket per turn avoids replaying a request after reconnecting.
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
function validResult(result) {
  return (
    object(result) &&
    typeof result.text === "string" &&
    result.text.length > 0 &&
    result.text.length <= 1000000 &&
    typeof result.conversationId === "string" &&
    /^[0-9a-f-]{36}$/i.test(result.conversationId) &&
    (result.sources === undefined ||
      (Array.isArray(result.sources) &&
        result.sources.length <= 5 &&
        result.sources.every(
          (source) =>
            object(source) &&
            [
              "bills",
              "clients",
              "products",
              "purchases",
              "expenses",
              "receipts",
              "recurring",
              "journal",
              "audit",
              "stockMovements",
              "supplierPayments",
              "profile",
            ].includes(source.module) &&
            typeof source.id === "string" &&
            typeof source.reference === "string",
        ))) &&
    (result.coverage === undefined ||
      (object(result.coverage) &&
        typeof result.coverage.module === "string" &&
        ["total", "returned"].every(
          (key) =>
            Number.isSafeInteger(result.coverage[key]) &&
            result.coverage[key] >= 0,
        ) &&
        typeof result.coverage.more === "boolean"))
  );
}
export function askChat(payload, { onStatus, signal } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL("/api/ai/chat", location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url),
      id = crypto.randomUUID();
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      socket.close();
      error ? reject(error) : resolve(result);
    };
    const abort = () => finish(new Error("Chat request stopped."));
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            "The chat connection timed out. Your message was not retried.",
          ),
        ),
      210000,
    );
    socket.onopen = () => {
      if (signal?.aborted) return abort();
      socket.send(JSON.stringify({ id, type: "ask", payload }));
    };
    socket.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return finish(new Error("Invalid chat response. Start a new chat."));
      }
      if (!object(message) || typeof message.id !== "string")
        return finish(new Error("Invalid chat response. Start a new chat."));
      if (message.id !== id) return;
      if (message.type === "status")
        onStatus?.(
          typeof message.message === "string"
            ? message.message
            : "Reviewing your records…",
        );
      if (message.type === "result") {
        if (!validResult(message.result))
          return finish(new Error("Incomplete chat response. Try again."));
        finish(null, message.result);
      }
      if (message.type === "error")
        finish(
          new Error(
            typeof message.error === "string"
              ? message.error
              : "Chat request failed.",
          ),
        );
    };
    socket.onerror = () =>
      finish(
        new Error("Cannot connect to chat. Check the local app and try again."),
      );
    socket.onclose = () => {
      if (!settled)
        finish(
          new Error(
            "Chat disconnected before the answer finished. Your message was not retried.",
          ),
        );
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
