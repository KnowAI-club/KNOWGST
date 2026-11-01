import { useEffect, useRef, useState } from "react";
import PageHeader from "./PageHeader";
import { integrationRequest as api } from "../services/integrations";
import { localToday } from "../utils";
import "./ai-workspace.css";
export default function AiWorkspace({ activeProfile, onNavigate }) {
  const [task, setTask] = useState("monthly"),
    [month, setMonth] = useState(localToday().slice(0, 7)),
    [currency, setCurrency] = useState("INR");
  const [models, setModels] = useState([]),
    [model, setModel] = useState(""),
    [snapshot, setSnapshot] = useState(null),
    [consent, setConsent] = useState(false);
  const [answer, setAnswer] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [recordQuestion, setRecordQuestion] = useState("");
  const [recordConsent, setRecordConsent] = useState(false);
  const [sources, setSources] = useState([]);
  const [coverage, setCoverage] = useState(null);
  const generation = useRef(0);
  useEffect(() => {
    let cancelled = false;
    ++generation.current;
    setSources([]);
    setCoverage(null);
    setRecordConsent(false);
    setSnapshot(null);
    setConsent(false);
    setAnswer("");
    setError("");
    setBusy(false);
    api("/chatgpt/models")
      .then((items) => {
        if (cancelled) return;
        setModels(items);
        setModel(items[0]?.id || "");
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
      generation.current++;
    };
  }, [activeProfile?.id]);
  function change(setter, value) {
    generation.current++;
    setter(value);
    setSources([]);
    setCoverage(null);
    setRecordConsent(false);
    setSnapshot(null);
    setConsent(false);
    setAnswer("");
    setError("");
    setBusy(false);
  }
  async function run(send) {
    const g = generation.current;
    setBusy(true);
    setError("");
    setAnswer("");
    setSources([]);
    setCoverage(null);
    try {
      if (send) {
        const result = await api("/ai/analyze", {
          snapshotId: snapshot.id,
          consent,
          model,
        });
        if (g === generation.current) {
          setAnswer(result.text);
          setSnapshot(null);
          setConsent(false);
        }
      } else {
        const result = await api("/ai/preview", {
          businessId: activeProfile?.id,
          task,
          month,
          currency,
        });
        if (g === generation.current) {
          setSnapshot(result);
          setConsent(false);
        }
      }
    } catch (e) {
      if (g === generation.current) {
        setError(e.message);
        if (send) {
          setSnapshot(null);
          setConsent(false);
        }
      }
    } finally {
      if (g === generation.current) setBusy(false);
    }
  }
  async function askRecords() {
    const g = generation.current;
    setBusy(true);
    setError("");
    setAnswer("");
    setSources([]);
    setCoverage(null);
    setRecordConsent(false);
    try {
      const result = await api("/ai/records", {
        businessId: activeProfile?.id,
        question: recordQuestion,
        consent: recordConsent,
        model,
      });
      if (g === generation.current) {
        setAnswer(result.text);
        setSources(result.sources);
        setCoverage(result.coverage);
      }
    } catch (e) {
      if (g === generation.current) setError(e.message);
    } finally {
      if (g === generation.current) setBusy(false);
    }
  }

  return (
    <div className="ai-workspace">
      <PageHeader
        title="AI assistant"
        subtitle="Understand your books. Prepare your next step."
      >
        <button
          className="btn btn-secondary"
          onClick={() => onNavigate("settings")}
        >
          Connection settings
        </button>
      </PageHeader>
      <div className="card ai-panel">
        <h2>What would you like help with?</h2>
        <div className="ai-fields">
          <label>
            Task
            <select
              value={task}
              onChange={(e) => change(setTask, e.target.value)}
            >
              <option value="monthly">Monthly review</option>
              <option value="review">Bookkeeping review</option>
              <option value="collections">Payment reminder drafts</option>
            </select>
          </label>
          <label>
            Month
            <input
              type="month"
              value={month}
              onChange={(e) => change(setMonth, e.target.value)}
            />
          </label>
          <label>
            Currency
            <input
              value={currency}
              maxLength={3}
              onChange={(e) =>
                change(setCurrency, e.target.value.toUpperCase())
              }
            />
          </label>
          <label>
            ChatGPT model
            <select
              value={model}
              onChange={(e) => change(setModel, e.target.value)}
            >
              <option value="" disabled>
                Select a model
              </option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p>
          Uses your connected ChatGPT account. The summary tasks share aggregate
          totals and review counts only. Record questions below can share
          relevant business records with your approval. Drafts use placeholders
          and are never sent automatically.
        </p>
        <button
          className="btn btn-primary"
          disabled={busy || !activeProfile?.id}
          onClick={() => run(false)}
        >
          {busy ? "Working…" : "Preview data to share"}
        </button>
      </div>
      <section className="card ai-panel">
        <h2>Ask about your business records</h2>
        <p>
          Find an invoice, client, product, purchase, expense, receipt,
          recurring schedule, journal, stock movement or audit record in this
          business. AI searches one module per question and reads up to five
          matching records. Ask for a specific reference for the clearest
          answer.
        </p>
        <label>
          Question
          <textarea
            aria-label="Business records question"
            maxLength={1000}
            disabled={busy}
            value={recordQuestion}
            onChange={(e) => {
              setRecordQuestion(e.target.value);
              setRecordConsent(false);
            }}
            style={{ width: "100%", minHeight: 80 }}
          />
        </label>
        <label className="ai-consent">
          <input
            type="checkbox"
            disabled={busy}
            checked={recordConsent}
            onChange={(e) => setRecordConsent(e.target.checked)}
          />{" "}
          Allow ChatGPT to search and read relevant records in this business for
          this question
        </label>
        <p>
          Relevant record details may be shared, including party and tax
          information. Credentials, attachments and other businesses are
          excluded. Nothing is changed.
        </p>
        <button
          className="btn btn-primary"
          disabled={busy || !recordConsent || !recordQuestion.trim() || !model}
          onClick={askRecords}
        >
          Ask about records
        </button>
      </section>
      {error && <p role="alert">{error}</p>}
      {snapshot && (
        <section className="card ai-panel">
          <h2>Review what ChatGPT will receive</h2>
          <p>
            This exact request expires after five minutes. Changes to your
            summary require a fresh preview.
          </p>
          <pre className="ai-context">{snapshot.prompt}</pre>
          <label className="ai-consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />{" "}
            Send this summary to ChatGPT for this request
          </label>
          <button
            className="btn btn-primary"
            disabled={!consent || !model || busy}
            onClick={() => run(true)}
          >
            Generate {task === "collections" ? "drafts" : "review"}
          </button>
        </section>
      )}
      {answer && (
        <section className="card ai-panel">
          <h2>
            {task === "collections"
              ? "Payment reminder drafts"
              : "Your AI review"}
          </h2>
          <p>
            AI-generated suggestions. Verify against your records before acting.
            No records were changed.
          </p>
          <div className="ai-answer">{answer}</div>
          {coverage && (
            <p>
              Source coverage: {coverage.returned} of {coverage.total} matching{" "}
              {coverage.module} records.{" "}
              {coverage.more
                ? "More matches exist; ask a narrower question."
                : ""}
            </p>
          )}
          {sources.length > 0 && (
            <ul>
              {sources.map((source, i) => (
                <li key={i}>
                  {source.module}: {source.reference}{" "}
                  <button
                    className="btn btn-secondary"
                    onClick={() =>
                      onNavigate(
                        {
                          bills: "invoices",
                          products: "inventory",
                          journal: "reports",
                          audit: "reports",
                          stockMovements: "reports",
                          supplierPayments: "purchases",
                          profile: "settings",
                        }[source.module] || source.module,
                        { search: source.reference },
                      )
                    }
                  >
                    Open source register
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            className="btn btn-secondary"
            onClick={() =>
              navigator.clipboard
                .writeText(answer)
                .catch(() =>
                  setError("Copy failed. Select and copy the text manually."),
                )
            }
          >
            Copy text
          </button>
        </section>
      )}
      <div className="ai-links">
        <button
          className="btn btn-secondary"
          onClick={() => onNavigate("dashboard")}
        >
          Open dashboard
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => onNavigate("invoices")}
        >
          Open invoice register
        </button>
      </div>
    </div>
  );
}
