import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, RefreshCw, Sparkles } from "lucide-react";
import { integrationRequest as api } from "../services/integrations";
import { localToday } from "../utils";
import "./ai-review-insights.css";

const tabs = [
  ["review", "Book review"],
  ["reports", "Report details"],
  ["collections", "Collections"],
  ["suppliers", "Supplier plan"],
];
const destinations = {
  bills: "invoices",
  expenses: "expenses",
  receipts: "receipts",
  purchases: "purchases",
  supplierPayments: "purchases",
  journal: "reports",
};
const amount = (value, currency) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format((value || 0) / 100);

export default function AiReviewInsights({ activeProfile, onNavigate, model }) {
  const [tab, setTab] = useState("review"),
    [month, setMonth] = useState(localToday().slice(0, 7)),
    [currency, setCurrency] = useState("INR"),
    [asOf, setAsOf] = useState(localToday()),
    [budget, setBudget] = useState("");
  const [loaded, setLoaded] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState(null),
    [consent, setConsent] = useState(false),
    [answer, setAnswer] = useState("");
  const [editing, setEditing] = useState(null),
    [note, setNote] = useState(""),
    [holdReason, setHoldReason] = useState("disputed"),
    [dueDate, setDueDate] = useState("");
  const generation = useRef(0),
    locked = useRef(false);
  const options = { businessId: activeProfile?.id, month, currency, asOf };
  const selection = JSON.stringify({ ...options, tab, budget });
  const data = loaded?.selection === selection ? loaded.value : null;
  const setData = (value) => setLoaded(value ? { selection, value } : null);
  const fmt = (value) => amount(value, data?.currency || currency || "INR");
  function clear() {
    generation.current++;
    locked.current = false;
    setBusy(false);
    setError("");
    setData(null);
    setPreview(null);
    setConsent(false);
    setAnswer("");
    setEditing(null);
    setNote("");
  }
  useEffect(() => {
    clear();
  }, [activeProfile?.id, tab, month, currency, asOf, budget]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  function sourceLink(source, label) {
    return (
      <button
        className="btn btn-secondary ai-insight-source"
        type="button"
        key={`${source.module}:${source.id}`}
        onClick={() =>
          onNavigate?.(
            destinations[source.module] || "reports",
            source.module === "bills"
              ? { search: source.reference }
              : source.module === "journal"
                ? { tab: "journal" }
                : { search: source.reference },
          )
        }
        title={`Open ${source.module}: ${source.id}`}
      >
        {label || source.reference}
        <ArrowUpRight size={12} aria-hidden="true" />
      </button>
    );
  }
  async function run(path, body, done) {
    if (locked.current) return;
    const version = generation.current;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api(`/ai/insights/${path}`, body);
      if (version === generation.current) done(result);
    } catch (exception) {
      if (version === generation.current) setError(exception.message);
    } finally {
      if (version === generation.current) {
        locked.current = false;
        setBusy(false);
      }
    }
  }
  function load() {
    setPreview(null);
    setConsent(false);
    setAnswer("");
    setEditing(null);
    run(
      tab,
      { ...options, ...(tab === "suppliers" ? { budget } : {}) },
      setData,
    );
  }
  function mutate(path, fields) {
    run(
      path,
      {
        ...options,
        revision: data.revision,
        fingerprint: data.fingerprint,
        ...fields,
      },
      (result) => {
        setData(result);
        setEditing(null);
        setNote("");
        setPreview(null);
        setAnswer("");
        setConsent(false);
      },
    );
  }
  function explainPreview() {
    setAnswer("");
    setConsent(false);
    run("preview", { ...options, task: tab }, setPreview);
  }
  function explain() {
    run(
      "explain",
      { businessId: activeProfile?.id, snapshotId: preview.id, consent, model },
      (result) => {
        setAnswer(result.text);
        setPreview(null);
        setConsent(false);
      },
    );
  }
  function exclusionList(items, holds = false) {
    if (!items?.length) return null;
    return (
      <details className="ai-insight-excluded">
        <summary>
          {items.length} excluded {tab === "collections" ? "invoices" : "bills"}
        </summary>
        <ul>
          {items.map((row) => (
            <li key={row.source.id}>
              <div>
                {sourceLink(row.source)}{" "}
                <span>
                  {row.party} · {row.reason}
                </span>
                {row.note && <small>{row.note}</small>}
              </div>
              {holds && row.held && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() =>
                    mutate("hold", {
                      invoiceId: row.source.id,
                      reason: "remove",
                      note: "",
                    })
                  }
                >
                  Remove review hold
                </button>
              )}
            </li>
          ))}
        </ul>
      </details>
    );
  }
  return (
    <section
      className="ai-review-insights"
      aria-label="Business reviews and plans"
    >
      <div className="ai-insight-tabs" role="tablist" aria-label="Review type">
        {tabs.map(([id, title]) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls="ai-insight-panel"
            id={`ai-insight-tab-${id}`}
            key={id}
            className={`btn ${tab === id ? "btn-primary" : "btn-secondary"}`}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => {
              clear();
              setTab(id);
            }}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const position = tabs.findIndex(([value]) => value === id);
              const target =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? tabs.length - 1
                    : (position +
                        (event.key === "ArrowRight" ? 1 : -1) +
                        tabs.length) %
                      tabs.length;
              clear();
              setTab(tabs[target][0]);
              event.currentTarget.parentElement
                ?.querySelectorAll('[role="tab"]')
                [target]?.focus();
            }}
          >
            {title}
          </button>
        ))}
      </div>
      <div className="ai-insight-filters">
        <label>
          Month
          <input
            className="form-input"
            type="month"
            min="1900-01"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
        </label>
        <label>
          Currency
          <input
            className="form-input ai-insight-currency"
            maxLength={3}
            value={currency}
            onChange={(event) =>
              setCurrency(
                event.target.value.toUpperCase().replace(/[^A-Z]/g, ""),
              )
            }
          />
        </label>
        <label>
          Review date
          <input
            className="form-input"
            type="date"
            min="1900-01-01"
            value={asOf}
            onChange={(event) => setAsOf(event.target.value)}
          />
        </label>
        {tab === "suppliers" && (
          <label>
            Planning budget
            <input
              className="form-input"
              inputMode="decimal"
              placeholder="Optional"
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
            />
          </label>
        )}
        <button
          type="button"
          className="btn btn-primary"
          onClick={load}
          disabled={
            busy ||
            !activeProfile?.id ||
            !month ||
            !asOf ||
            currency.length !== 3
          }
        >
          <RefreshCw size={14} aria-hidden="true" />
          {busy ? "Working…" : "Review records"}
        </button>
      </div>
      {error && (
        <p className="ai-insight-error" role="alert">
          {error}
        </p>
      )}
      <div
        id="ai-insight-panel"
        role="tabpanel"
        aria-labelledby={`ai-insight-tab-${tab}`}
        aria-busy={busy}
      >
        {!data && (
          <div className="glass-panel p-4">
            <h3>{tabs.find(([id]) => id === tab)?.[1]}</h3>
            <p className="text-muted">
              Choose a period and review your saved records. Totals and
              priorities are calculated on this device. ChatGPT explanations are
              optional.
            </p>
          </div>
        )}
        {data && (
          <>
            <p className="text-muted ai-insight-note">{data.note}</p>
            {tab === "review" && (
              <div className="glass-panel p-4">
                <div className="table-header">
                  <h3>
                    {data.open} open review {data.open === 1 ? "item" : "items"}
                  </h3>
                  <span className="text-muted">
                    {data.total} findings · {data.coverage.sourceRecords} source
                    records checked
                  </span>
                </div>
                {!data.findings.length && (
                  <p className="text-muted">
                    No candidates found by these checks for the selected month.
                    This is not a complete audit.
                  </p>
                )}
                <div className="ai-insight-findings">
                  {data.findings.map((finding) => (
                    <article key={finding.id} className="ai-insight-finding">
                      <div className="ai-insight-finding-heading">
                        <h4>{finding.title}</h4>
                        <span className="text-muted">
                          {finding.status === "dismissed" ? "Reviewed" : "Open"}
                        </span>
                      </div>
                      <p>{finding.detail}</p>
                      {finding.amount !== null && (
                        <strong>{fmt(finding.amount)}</strong>
                      )}
                      <div className="ai-insight-sources">
                        {finding.sources.map((ref) => sourceLink(ref))}
                      </div>
                      {finding.note && (
                        <p className="text-muted">
                          Review note: {finding.note}
                        </p>
                      )}
                      {editing === finding.id ? (
                        <div className="ai-insight-edit">
                          <label>
                            Review note
                            <input
                              className="form-input"
                              value={note}
                              maxLength={300}
                              onChange={(event) => setNote(event.target.value)}
                            />
                          </label>
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={busy || !note.trim()}
                            onClick={() =>
                              mutate("resolve", {
                                findingId: finding.id,
                                status: "dismissed",
                                note,
                              })
                            }
                          >
                            Mark reviewed
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => setEditing(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={busy}
                          onClick={() =>
                            finding.status === "dismissed"
                              ? mutate("resolve", {
                                  findingId: finding.id,
                                  status: "open",
                                  note: "",
                                })
                              : (setEditing(finding.id), setNote(""))
                          }
                        >
                          {finding.status === "dismissed"
                            ? "Reopen"
                            : "Add review note"}
                        </button>
                      )}
                    </article>
                  ))}
                </div>
                {data.coverage.displayed < data.total && (
                  <p className="text-muted">
                    Showing the first {data.coverage.displayed} findings. Review
                    the underlying modules for the remaining records.
                  </p>
                )}
              </div>
            )}
            {tab === "reports" && (
              <>
                <p className="text-muted ai-insight-note">{data.basis}</p>
                <div className="ai-insight-summary">
                  {[
                    [
                      "Posted income",
                      data.profitLoss.income,
                      data.profitLoss.incomeDelta,
                    ],
                    [
                      "Posted expenses",
                      data.profitLoss.expenses,
                      data.profitLoss.expenseDelta,
                    ],
                    [
                      "Posted net result",
                      data.profitLoss.profit,
                      data.profitLoss.profitDelta,
                    ],
                  ].map(([title, value, delta]) => (
                    <div className="glass-panel p-4" key={title}>
                      <span>{title}</span>
                      <strong>{fmt(value)}</strong>
                      <small>
                        {fmt(delta)} change from {data.previousMonth}
                      </small>
                    </div>
                  ))}
                </div>
                <section className="glass-panel p-4">
                  <div className="table-header">
                    <h3>Balance sheet · {data.asOf}</h3>
                    <span className="text-muted">
                      {data.coverage.entries} posted entries
                    </span>
                  </div>
                  <dl className="ai-insight-balances">
                    {[
                      ["Assets", data.balanceSheet.assets],
                      ["Liabilities", data.balanceSheet.liabilities],
                      [
                        "Equity before accumulated earnings",
                        data.balanceSheet.equity,
                      ],
                      [
                        "Accumulated posted earnings",
                        data.balanceSheet.retainedEarnings,
                      ],
                      ["Balance difference", data.balanceSheet.difference],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{fmt(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
                <section className="glass-panel p-4">
                  <h3>Account contributions</h3>
                  <p className="text-muted">
                    Expand an account to inspect its journal sources. Income,
                    liabilities and equity use credit-positive balances; assets
                    and expenses use debit-positive balances.
                  </p>
                  <div className="ai-insight-accounts">
                    {data.accounts.map((account) => (
                      <details key={account.code}>
                        <summary>
                          <span>
                            {account.code} · {account.name}
                          </span>
                          <strong>{fmt(account.current)} this month</strong>
                        </summary>
                        <p>
                          Previous month {fmt(account.previous)} · Change{" "}
                          {fmt(account.delta)} · Balance at month end{" "}
                          {fmt(account.balance)}
                        </p>
                        <div className="table-scroll">
                          <table className="data-table">
                            <thead>
                              <tr>
                                <th>Date</th>
                                <th>Source</th>
                                <th>Debit</th>
                                <th>Credit</th>
                                <th>Entry</th>
                              </tr>
                            </thead>
                            <tbody>
                              {account.contributions
                                .slice(0, 100)
                                .map((row) => (
                                  <tr key={row.entryId}>
                                    <td>{row.date}</td>
                                    <td>{sourceLink(row.source)}</td>
                                    <td>{fmt(row.debit)}</td>
                                    <td>{fmt(row.credit)}</td>
                                    <td>
                                      {row.reversalOf ? "Reversal" : "Posting"}
                                      <small className="ai-insight-id">
                                        {row.entryId}
                                      </small>
                                    </td>
                                  </tr>
                                ))}
                              {!account.contributions.length && (
                                <tr>
                                  <td colSpan={5}>No posted contributions.</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                        {account.contributions.length > 100 && (
                          <p className="text-muted">
                            Showing 100 of {account.contributions.length}{" "}
                            journal contributions. Open Accounts & history to
                            inspect the full ledger.
                          </p>
                        )}
                      </details>
                    ))}
                  </div>
                </section>
              </>
            )}
            {tab === "collections" && (
              <section className="glass-panel p-4">
                <div className="table-header">
                  <h3>{data.rows.length} invoices to review</h3>
                  <strong>{fmt(data.totalOutstanding)} outstanding</strong>
                </div>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Order</th>
                        <th>Customer / invoice</th>
                        <th>Due / overdue</th>
                        <th>Outstanding</th>
                        <th>Payment history</th>
                        <th>Review</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((row) => (
                        <tr key={row.source.id}>
                          <td>{row.priority}</td>
                          <td>
                            {row.party}
                            <div>{sourceLink(row.source)}</div>
                          </td>
                          <td>
                            {row.dueDate || "Due date unknown"}
                            <small>
                              {row.daysOverdue > 0
                                ? `${row.daysOverdue} days overdue`
                                : row.dueDate
                                  ? "Not overdue"
                                  : row.note}
                            </small>
                          </td>
                          <td>{fmt(row.balance)}</td>
                          <td>
                            {row.lastPaymentDate || "No dated payment"}
                            <small>
                              {row.paymentCount} recorded positive payments ·{" "}
                              {fmt(row.paid)} saved as paid
                            </small>
                          </td>
                          <td>
                            {editing === row.source.id ? (
                              <div className="ai-insight-row-edit">
                                <label>
                                  Reason
                                  <select
                                    className="form-input"
                                    value={holdReason}
                                    onChange={(event) =>
                                      setHoldReason(event.target.value)
                                    }
                                  >
                                    <option value="disputed">Disputed</option>
                                    <option value="do-not-contact">
                                      Do not contact
                                    </option>
                                  </select>
                                </label>
                                <label>
                                  Note
                                  <input
                                    className="form-input"
                                    maxLength={300}
                                    value={note}
                                    onChange={(event) =>
                                      setNote(event.target.value)
                                    }
                                  />
                                </label>
                                <button
                                  type="button"
                                  className="btn btn-primary"
                                  disabled={busy}
                                  onClick={() =>
                                    mutate("hold", {
                                      invoiceId: row.source.id,
                                      reason: holdReason,
                                      note,
                                    })
                                  }
                                >
                                  Save hold
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  onClick={() => setEditing(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-secondary"
                                disabled={busy}
                                onClick={() => {
                                  setEditing(row.source.id);
                                  setNote("");
                                  setHoldReason("disputed");
                                }}
                              >
                                Place on hold
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                      {!data.rows.length && (
                        <tr>
                          <td colSpan={6}>No eligible outstanding invoices.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {exclusionList(data.excluded, true)}
              </section>
            )}
            {tab === "suppliers" && (
              <section className="glass-panel p-4">
                <div className="table-header">
                  <h3>{data.rows.length} supplier bills</h3>
                  <strong>{fmt(data.outstanding)} outstanding</strong>
                </div>
                {data.budget !== null && (
                  <p>
                    Budget {fmt(data.budget)} · Proposed{" "}
                    {fmt(data.proposedTotal)} · Remaining{" "}
                    {fmt(data.remainingBudget)}
                  </p>
                )}
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Supplier / bill</th>
                        <th>Due date</th>
                        <th>Paid</th>
                        <th>Outstanding</th>
                        <th>Proposed</th>
                        <th>Review</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((row) => (
                        <tr key={row.source.id}>
                          <td>
                            {row.party}
                            <div>{sourceLink(row.source)}</div>
                            {!row.tracked && (
                              <small>
                                Unpaid bill · accounting begins when a payment
                                is recorded
                              </small>
                            )}
                          </td>
                          <td>
                            {row.dueDate || "Due date unknown"}
                            <small>
                              {row.planningDate
                                ? "Planning date"
                                : row.dueDate
                                  ? "Saved bill due date"
                                  : "Add a planning date"}
                              {row.daysOverdue > 0
                                ? ` · ${row.daysOverdue} days overdue`
                                : ""}
                            </small>
                          </td>
                          <td>{fmt(row.paid)}</td>
                          <td>{fmt(row.balance)}</td>
                          <td>
                            {data.budget === null
                              ? "No budget entered"
                              : fmt(row.proposedAmount)}
                          </td>
                          <td>
                            {editing === row.source.id ? (
                              <div className="ai-insight-row-edit">
                                <label>
                                  Planning due date
                                  <input
                                    className="form-input"
                                    type="date"
                                    min="1900-01-01"
                                    value={dueDate}
                                    onChange={(event) =>
                                      setDueDate(event.target.value)
                                    }
                                  />
                                </label>
                                <button
                                  type="button"
                                  className="btn btn-primary"
                                  disabled={busy}
                                  onClick={() =>
                                    mutate("planDue", {
                                      purchaseId: row.source.id,
                                      date: dueDate,
                                      budget,
                                    })
                                  }
                                >
                                  Save planning date
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  onClick={() => setEditing(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-secondary"
                                disabled={
                                  busy || (row.dueDate && !row.planningDate)
                                }
                                onClick={() => {
                                  setEditing(row.source.id);
                                  setDueDate(row.dueDate || "");
                                }}
                              >
                                Set planning date
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                      {!data.rows.length && (
                        <tr>
                          <td colSpan={6}>
                            No eligible unpaid supplier bills.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {exclusionList(data.excluded)}
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => onNavigate?.("purchases")}
                >
                  Open Purchases
                  <ArrowUpRight size={14} aria-hidden="true" />
                </button>
              </section>
            )}
            <section className="glass-panel p-4 ai-insight-explanation">
              <div className="table-header">
                <div>
                  <h3>Explain these results</h3>
                  <p className="text-muted">
                    Review exactly what will be shared before asking ChatGPT.
                    The explanation cannot change records or send messages.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={explainPreview}
                  disabled={busy || !model}
                >
                  <Sparkles size={14} aria-hidden="true" />
                  Preview for ChatGPT
                </button>
              </div>
              {!model && (
                <p className="text-muted">
                  Connect ChatGPT and choose a model to use optional
                  explanations.
                </p>
              )}
              {preview && (
                <>
                  <details open>
                    <summary>Data to share</summary>
                    <pre className="ai-insight-context">
                      {JSON.stringify(preview.context, null, 2)}
                    </pre>
                  </details>
                  <label className="ai-insight-consent">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(event) => setConsent(event.target.checked)}
                    />
                    Send this preview to my selected ChatGPT account.
                  </label>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || !consent || !model}
                    onClick={explain}
                  >
                    Ask ChatGPT
                  </button>
                </>
              )}
              {answer && (
                <div className="ai-insight-answer" role="status">
                  <strong>ChatGPT explanation</strong>
                  <p>{answer}</p>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </section>
  );
}
