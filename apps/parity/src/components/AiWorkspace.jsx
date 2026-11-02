import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Plus,
  Copy,
  SlidersHorizontal,
  ArrowUpRight,
} from "lucide-react";
import PageHeader from "./PageHeader";
import { integrationRequest as api } from "../services/integrations";
import { askChat } from "../services/ai-chat";
import { localToday } from "../utils";
import "./ai-workspace.css";
const AiDocumentInbox = lazy(() => import("./AiDocumentInbox"));
const AiImportReview = lazy(() => import("./AiImportReview"));
const AiMatching = lazy(() => import("./AiMatching"));
const AiCatalogReview = lazy(() => import("./AiCatalogReview"));
const AiReviewInsights = lazy(() => import("./AiReviewInsights"));
const workspaces = {
  chat: "Chat",
  documents: "Document inbox",
  insights: "Books & payments",
  matching: "Bank matching",
  catalog: "Catalog review",
  imports: "Import assistant",
};
const titles = {
  monthly: "Monthly review",
  review: "Bookkeeping review",
  collections: "Payment reminder drafts",
};
const routes = {
  bills: "invoices",
  products: "inventory",
  journal: "reports",
  audit: "reports",
  stockMovements: "reports",
  supplierPayments: "purchases",
  profile: "settings",
  clients: "clients",
  purchases: "purchases",
  expenses: "expenses",
  receipts: "receipts",
  recurring: "recurring",
};
export default function AiWorkspace({ activeProfile, onNavigate }) {
  const [workspaceTab, setWorkspaceTab] = useState("chat");
  const [messages, setMessages] = useState([]),
    [draft, setDraft] = useState(""),
    [models, setModels] = useState([]),
    [model, setModel] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [error, setError] = useState(""),
    [access, setAccess] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false),
    [task, setTask] = useState("monthly"),
    [month, setMonth] = useState(localToday().slice(0, 7)),
    [currency, setCurrency] = useState("INR");
  const [snapshot, setSnapshot] = useState(null),
    [summaryConsent, setSummaryConsent] = useState(false);
  const generation = useRef(0),
    requestLock = useRef(false),
    conversation = useRef(null),
    aborter = useRef(null),
    account = useRef(undefined),
    log = useRef(null),
    composer = useRef(null);
  function reset() {
    generation.current++;
    aborter.current?.abort();
    requestLock.current = false;
    conversation.current = null;
    setMessages([]);
    setDraft("");
    setSnapshot(null);
    setSummaryConsent(false);
    setAccess(false);
    setBusy(false);
    setError("");
    setProgress("");
  }
  useEffect(() => {
    reset();
    setReady(false);
    setModels([]);
    setModel("");
    account.current = undefined;
    let alive = true;
    if (!activeProfile?.id) return;
    Promise.all([api("/chatgpt/models"), api()])
      .then(([list, status]) => {
        if (!alive) return;
        account.current = status.chatgpt.active;
        setModels(list);
        setModel(list[0]?.id || "");
        setReady(true);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
      generation.current++;
      aborter.current?.abort();
    };
  }, [activeProfile?.id]);
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [messages, busy, snapshot]);
  async function verifyAccount(version) {
    const status = await api();
    if (version !== generation.current) return;
    if (
      account.current !== undefined &&
      account.current !== status.chatgpt.active
    ) {
      reset();
      account.current = status.chatgpt.active;
      setError(
        "ChatGPT account changed. Start a new chat with the selected account.",
      );
      throw new Error(
        "ChatGPT account changed. Start a new chat with the selected account.",
      );
    }
    account.current = status.chatgpt.active;
  }
  function append(message) {
    setMessages((previous) => [...previous, message].slice(-60));
  }
  async function send(event) {
    event?.preventDefault();
    const question = draft.trim();
    if (
      requestLock.current ||
      !ready ||
      !question ||
      !access ||
      !model ||
      !activeProfile?.id
    )
      return;
    requestLock.current = true;
    setBusy(true);
    setError("");
    setProgress("Connecting to your business…");
    const version = generation.current,
      messageId = crypto.randomUUID();
    try {
      await verifyAccount(version);
      if (version !== generation.current) return;
      setDraft("");
      append({ id: messageId, role: "user", text: question });
      aborter.current = new AbortController();
      const result = await askChat(
        {
          businessId: activeProfile.id,
          question,
          model,
          consent: true,
          ...(conversation.current
            ? { conversationId: conversation.current }
            : {}),
        },
        {
          signal: aborter.current.signal,
          onStatus: (message) => {
            if (version === generation.current) setProgress(message);
          },
        },
      );
      if (version !== generation.current) return;
      conversation.current = result.conversationId || null;
      append({ id: crypto.randomUUID(), role: "assistant", ...result });
    } catch (e) {
      if (version === generation.current) {
        setError(e.message);
        setDraft(question);
        setMessages((previous) =>
          previous.filter((message) => message.id !== messageId),
        );
      }
    } finally {
      if (version === generation.current) {
        requestLock.current = false;
        setBusy(false);
        setProgress("");
        composer.current?.focus();
      }
    }
  }
  async function summary(sendNow) {
    if (requestLock.current) return;
    requestLock.current = true;
    setBusy(true);
    setError("");
    const version = generation.current;
    try {
      await verifyAccount(version);
      if (version !== generation.current) return;
      if (sendNow) {
        const result = await api("/ai/analyze", {
          snapshotId: snapshot.id,
          consent: summaryConsent,
          model,
        });
        if (version !== generation.current) return;
        append({
          id: crypto.randomUUID(),
          role: "user",
          text: `${titles[task]} · ${month} · ${currency}`,
        });
        append({
          id: crypto.randomUUID(),
          role: "assistant",
          ...result,
          kind: "snapshot",
        });
        conversation.current = null;
        setSnapshot(null);
        setSummaryConsent(false);
        setToolsOpen(false);
      } else {
        const result = await api("/ai/preview", {
          businessId: activeProfile.id,
          task,
          month,
          currency,
        });
        if (version !== generation.current) return;
        setSnapshot(result);
        setSummaryConsent(false);
      }
    } catch (e) {
      if (version === generation.current) {
        setError(e.message);
        if (sendNow) {
          setSnapshot(null);
          setSummaryConsent(false);
        }
      }
    } finally {
      if (version === generation.current) {
        requestLock.current = false;
        setBusy(false);
      }
    }
  }
  function option(setter, value) {
    setter(value);
    setSnapshot(null);
    setSummaryConsent(false);
  }
  const starter = (question) => {
    setDraft(question);
    composer.current?.focus();
  };
  return (
    <div
      className={`ai-workspace ai-chat${workspaceTab !== "chat" ? " ai-workflow-view" : ""}`}
    >
      <PageHeader
        title="AI assistant"
        subtitle={activeProfile?.businessName || "Your business workspace"}
      >
        {workspaceTab === "chat" && (
          <button
            className="btn btn-secondary"
            onClick={() => {
              reset();
              composer.current?.focus();
            }}
          >
            <Plus size={15} /> New chat
          </button>
        )}
        <button
          className="btn btn-secondary"
          onClick={() => onNavigate("settings")}
        >
          Connection settings
        </button>
      </PageHeader>
      <div
        className="ai-workspace-tabs"
        role="tablist"
        aria-label="Assistant workspace"
      >
        {Object.entries(workspaces).map(([id, label], index) => (
          <button
            key={id}
            type="button"
            role="tab"
            tabIndex={workspaceTab === id ? 0 : -1}
            aria-selected={workspaceTab === id}
            aria-controls="ai-workspace-panel"
            disabled={busy}
            onClick={() => setWorkspaceTab(id)}
            onKeyDown={(event) => {
              const keys = Object.keys(workspaces),
                next =
                  event.key === "ArrowRight"
                    ? (index + 1) % keys.length
                    : event.key === "ArrowLeft"
                      ? (index + keys.length - 1) % keys.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? keys.length - 1
                          : null;
              if (next !== null) {
                event.preventDefault();
                setWorkspaceTab(keys[next]);
                event.currentTarget.parentElement.children[next].focus();
              }
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="ai-chat-toolbar">
        <label className="ai-model-label">
          Model
          <select
            aria-label="ChatGPT model"
            disabled={busy}
            value={model}
            onChange={(e) => {
              reset();
              setModel(e.target.value);
            }}
          >
            <option value="" disabled>
              Connect ChatGPT to begin
            </option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <span className="ai-readonly">Reviewed assistance</span>
        {workspaceTab === "chat" && (
          <button
            className="btn btn-secondary"
            aria-expanded={toolsOpen}
            aria-controls="ai-review-tools"
            onClick={() => setToolsOpen((v) => !v)}
          >
            <SlidersHorizontal size={14} /> Reviews & drafts
          </button>
        )}
      </div>
      {workspaceTab !== "chat" && (
        <div
          id="ai-workspace-panel"
          role="tabpanel"
          aria-label={workspaces[workspaceTab]}
        >
          <Suspense fallback={<p role="status">Loading workspace…</p>}>
            {workspaceTab === "documents" && (
              <AiDocumentInbox
                activeProfile={activeProfile}
                model={model}
                onNavigate={onNavigate}
              />
            )}
            {workspaceTab === "imports" && (
              <AiImportReview
                activeProfile={activeProfile}
                model={model}
                onNavigate={onNavigate}
              />
            )}
            {workspaceTab === "matching" && (
              <AiMatching
                activeProfile={activeProfile}
                model={model}
                onNavigate={onNavigate}
              />
            )}
            {workspaceTab === "catalog" && (
              <AiCatalogReview
                activeProfile={activeProfile}
                model={model}
                onNavigate={onNavigate}
              />
            )}
            {workspaceTab === "insights" && (
              <AiReviewInsights
                activeProfile={activeProfile}
                model={model}
                onNavigate={onNavigate}
              />
            )}
          </Suspense>
        </div>
      )}
      {workspaceTab === "chat" && (
        <div
          id="ai-workspace-panel"
          role="tabpanel"
          aria-label="Chat"
          className="ai-chat-panel"
        >
          {toolsOpen && (
            <section
              id="ai-review-tools"
              className="ai-review-tools"
              aria-label="Reviews and drafts"
            >
              <div className="ai-fields">
                <label>
                  Task
                  <select
                    disabled={busy}
                    value={task}
                    onChange={(e) => option(setTask, e.target.value)}
                  >
                    {Object.entries(titles).map(([key, title]) => (
                      <option key={key} value={key}>
                        {title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Month
                  <input
                    type="month"
                    disabled={busy}
                    value={month}
                    onChange={(e) => option(setMonth, e.target.value)}
                  />
                </label>
                <label>
                  Currency
                  <input
                    maxLength={3}
                    disabled={busy}
                    value={currency}
                    onChange={(e) =>
                      option(setCurrency, e.target.value.toUpperCase())
                    }
                  />
                </label>
                <button
                  className="btn btn-secondary"
                  disabled={busy || !activeProfile?.id}
                  onClick={() => summary(false)}
                >
                  Preview data to share
                </button>
              </div>
              <p className="ai-caption">
                These one-off reviews use your saved totals. Preview the summary
                before sharing.
              </p>
              {snapshot && (
                <div className="ai-summary-preview">
                  <details>
                    <summary>Review what ChatGPT will receive</summary>
                    <pre>{snapshot.prompt}</pre>
                  </details>
                  <label className="ai-consent">
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={summaryConsent}
                      onChange={(e) => setSummaryConsent(e.target.checked)}
                    />{" "}
                    Send this summary to ChatGPT for this request
                  </label>
                  <button
                    className="btn btn-primary"
                    disabled={busy || !model || !summaryConsent}
                    onClick={() => summary(true)}
                  >
                    Generate {task === "collections" ? "drafts" : "review"}
                  </button>
                </div>
              )}
            </section>
          )}
          <div
            className="ai-conversation"
            ref={log}
            role="log"
            aria-label="Conversation"
            aria-live="polite"
            aria-relevant="additions"
            tabIndex={0}
          >
            {!messages.length && !busy && (
              <div className="ai-chat-empty">
                <span className="knowai-symbol" aria-hidden="true" />
                <h2>What would you like to know?</h2>
                <p>
                  Ask about an invoice, a payment, or a product.
                  <br />
                  I’ll look up the records and show you the sources.
                </p>
                <div className="ai-starters">
                  <button
                    onClick={() =>
                      starter("Show me recent invoices that need attention.")
                    }
                    type="button"
                  >
                    Review recent invoices <ArrowUpRight size={14} />
                  </button>
                  <button
                    onClick={() => starter("Find products with low stock.")}
                    type="button"
                  >
                    Check my products <ArrowUpRight size={14} />
                  </button>
                  <button
                    onClick={() => {
                      setTask("monthly");
                      setToolsOpen(true);
                    }}
                    type="button"
                  >
                    Review this month <ArrowUpRight size={14} />
                  </button>
                </div>
              </div>
            )}
            {messages.map((message) => (
              <article
                className={`ai-message ai-message-${message.role}`}
                key={message.id}
                aria-label={
                  message.role === "user" ? "Your message" : "Assistant reply"
                }
              >
                <div className="ai-message-author">
                  {message.role === "user" ? (
                    "You"
                  ) : (
                    <>
                      <span className="knowai-symbol" aria-hidden="true" />{" "}
                      KNOWGST
                    </>
                  )}
                </div>
                <div
                  className={
                    message.role === "assistant" ? "ai-answer" : "ai-question"
                  }
                >
                  {message.text}
                </div>
                {message.coverage && (
                  <p className="ai-caption">
                    Source coverage: {message.coverage.returned} of{" "}
                    {message.coverage.total} matching {message.coverage.module}{" "}
                    records.
                    {message.coverage.more
                      ? " More matches exist; narrow the question for detail."
                      : ""}
                  </p>
                )}
                {message.sources?.length > 0 && (
                  <details className="ai-sources">
                    <summary>Sources · {message.sources.length}</summary>
                    <ul>
                      {message.sources.map((source, i) => (
                        <li key={i}>
                          <span>{source.reference}</span>
                          <button
                            className="btn btn-secondary"
                            onClick={() =>
                              onNavigate(routes[source.module] || "reports", {
                                search: source.reference,
                              })
                            }
                          >
                            Open source register <ArrowUpRight size={12} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {message.kind === "snapshot" && (
                  <p className="ai-caption">
                    Snapshot review · Start a specific record question below to
                    investigate further.
                  </p>
                )}
                {message.role === "assistant" && (
                  <button
                    className="ai-copy"
                    aria-label="Copy reply"
                    onClick={() =>
                      navigator.clipboard
                        .writeText(message.text)
                        .catch(() =>
                          setError(
                            "Copy failed. Select and copy the reply manually.",
                          ),
                        )
                    }
                  >
                    <Copy size={13} /> Copy
                  </button>
                )}
              </article>
            ))}
            {busy && (
              <div className="ai-chat-progress" role="status">
                <span className="ai-progress-dot" />
                {progress || "Preparing your review…"}
              </div>
            )}
          </div>
          <div className="ai-composer-wrap">
            {error && (
              <div className="ai-chat-error" role="alert">
                {error}{" "}
                <button
                  className="btn btn-secondary"
                  onClick={() => setError("")}
                >
                  Dismiss
                </button>
              </div>
            )}
            <form className="ai-composer" onSubmit={send}>
              <textarea
                aria-label="Message"
                ref={composer}
                placeholder="Ask about your business…"
                maxLength={1000}
                rows={2}
                disabled={busy || !ready}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <div className="ai-composer-actions">
                <span>Enter to send · Shift + Enter for a new line</span>
                <button
                  className="btn btn-primary"
                  type="submit"
                  aria-label="Send message"
                  disabled={
                    busy ||
                    !draft.trim() ||
                    !access ||
                    !model ||
                    !activeProfile?.id
                  }
                >
                  <ArrowUp size={18} />
                </button>
              </div>
            </form>
            <label className="ai-consent">
              <input
                type="checkbox"
                checked={access}
                disabled={busy || !ready}
                onChange={(e) => setAccess(e.target.checked)}
              />{" "}
              Allow relevant business records to be shared with ChatGPT in this
              chat
            </label>
            <details className="ai-privacy">
              <summary>Data access & chat history</summary>
              <p>
                Only this business is searched, up to five matching records per
                question. Party, tax and financial details may be shared;
                credentials, attachments and other businesses are excluded.
                Recent questions help resolve follow-ups; records are read again
                for each answer. History stays in memory and clears when you
                leave this page, switch business/model or start a new chat. No
                records are changed.
              </p>
              <p>
                AI has no access to credentials, SQL, files or sending tools.
                Requests are checked against the current business before sharing
                data. Draft suggestions need your review and a separate save or
                send action. GST and invoice totals use the app’s calculator.
              </p>
            </details>
            <p className="ai-caption ai-chat-footnote">
              AI suggests. You review and decide.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
