import { useEffect, useMemo, useState } from "react";
import { Plus, ArrowUpRight, RefreshCw, X } from "lucide-react";
import PageHeader from "./PageHeader";
import useDialogFocus from "./useDialogFocus";
import { getDashboardSummary } from "../store";
import { localToday } from "../utils";
import "./dashboard-overview.css";
const routes = {
  Invoice: "invoices",
  Receipt: "receipts",
  Expense: "expenses",
  Purchase: "purchases",
};
export default function DashboardOverview({
  activeProfile,
  onNavigate,
  onNew,
}) {
  const [month, setMonth] = useState(localToday().slice(0, 7)),
    [currency, setCurrency] = useState("INR"),
    [data, setData] = useState(null),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0),
    [loading, setLoading] = useState(true),
    [type, setType] = useState("All"),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState(null);
  useDialogFocus(!!selected, () => setSelected(null));
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setSelected(null);
    getDashboardSummary(month, currency)
      .then((value) => {
        if (active) {
          setData(value);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [month, currency, activeProfile?.id, refresh]);
  const activity = useMemo(
    () =>
      (data?.activity || []).filter(
        (r) =>
          (type === "All" || r.type === type) &&
          `${r.party} ${r.reference}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [data, type, search],
  );
  const fmt = (n) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(n / 100);
  const go = (view, options = {}) => {
    setSelected(null);
    onNavigate(view, options);
  };
  const ready = data && !loading && data.businessId === activeProfile?.id;
  const change =
    data?.previousSales > 0
      ? ((data.sales - data.previousSales) / data.previousSales) * 100
      : null;
  return (
    <div className="dashboard-overview">
      <PageHeader
        title="Dashboard"
        subtitle="Your business, at a glance. Know what moved and what needs attention."
      >
        <label className="overview-control">
          Month
          <input
            aria-label="Dashboard month"
            type="month"
            min="1900-01"
            value={month}
            onChange={(e) => {
              if (e.target.value) setMonth(e.target.value);
            }}
          />
        </label>
        <label className="overview-control">
          Currency
          <select
            aria-label="Dashboard currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            {[...new Set([currency, ...(data?.currencies || ["INR"])])].map(
              (c) => (
                <option key={c}>{c}</option>
              ),
            )}
          </select>
        </label>
        <button
          className="btn btn-secondary"
          aria-label="Refresh dashboard"
          disabled={loading}
          onClick={() => setRefresh((v) => v + 1)}
        >
          <RefreshCw size={15} />
        </button>
        <button className="btn btn-primary" onClick={onNew}>
          <Plus size={15} />
          New Invoice
        </button>
      </PageHeader>
      <div className="overview-shortcuts" aria-label="Quick actions">
        <button onClick={() => go("receipts")}>
          Record receipt <ArrowUpRight size={12} />
        </button>
        <button onClick={() => go("expenses")}>
          Add expense <ArrowUpRight size={12} />
        </button>
        <button onClick={() => go("purchases")}>
          Add purchase <ArrowUpRight size={12} />
        </button>
        <button onClick={() => go("invoices")}>
          Invoice register <ArrowUpRight size={12} />
        </button>
      </div>
      {error ? (
        <div className="overview-message" role="alert">
          <h2>Dashboard could not load</h2>
          <p>{error}</p>
          <button
            className="btn btn-secondary"
            onClick={() => setRefresh((v) => v + 1)}
          >
            Retry
          </button>
        </div>
      ) : !ready ? (
        <div className="overview-message" role="status">
          Loading dashboard…
        </div>
      ) : (
        <>
          {!data.businessId && (
            <p className="overview-message">
              Add your business details in Settings to see its dashboard.
            </p>
          )}
          {(data.unassigned > 0 || data.warnings.length > 0) && (
            <div className="overview-warning" role="status">
              {data.unassigned > 0 &&
                `${data.unassigned} unassigned records are excluded from these totals. `}
              {data.warnings.join(" ")}
            </div>
          )}
          <section className="overview-metrics" aria-label="Business summary">
            <button className="overview-metric" onClick={() => go("invoices")}>
              <span>Sales · excluding GST</span>
              <strong>{fmt(data.sales)}</strong>
              <small>
                {change === null
                  ? "No comparable prior-month sales"
                  : `${change >= 0 ? "↑" : "↓"} ${Math.abs(change).toFixed(1)}% vs previous month`}
              </small>
            </button>
            <button
              className="overview-metric"
              onClick={() => setSelected({ kind: "movement" })}
            >
              <span>Money received</span>
              <strong>{fmt(data.received)}</strong>
              <small>Recorded inflows · selected month</small>
            </button>
            <button className="overview-metric" onClick={() => go("invoices")}>
              <span>Customers owe you</span>
              <strong>{fmt(data.outstanding)}</strong>
              <small>
                {fmt(data.overdueAmount)} overdue · current balances
              </small>
            </button>
            <button className="overview-metric" onClick={() => go("purchases")}>
              <span>You owe suppliers</span>
              <strong>{fmt(data.payable)}</strong>
              <small>Tracked purchases · current balances</small>
            </button>
          </section>
          <p className="overview-scope">
            Sales and movements use the selected month. Outstanding balances use
            all dates.{" "}
            {data.untrackedPurchases > 0 &&
              `${data.untrackedPurchases} untracked purchases are excluded from supplier balances.`}
          </p>
          <div className="overview-middle">
            <section className="overview-card">
              <div className="overview-card-head">
                <h2>Recorded money in & out</h2>
                <span>{month}</span>
              </div>
              <div className="overview-chart-summary">
                <div>
                  <span>Net movement</span>
                  <strong>{fmt(data.received - data.spent)}</strong>
                </div>
                <div className="overview-legend">
                  <span>
                    <i />
                    In
                  </span>
                  <span>
                    <i />
                    Out
                  </span>
                </div>
              </div>
              {data.received === 0 && data.spent === 0 ? (
                <div className="overview-chart-empty">
                  No recorded money movement this month.
                </div>
              ) : (
                <div className="overview-chart">
                  <svg
                    viewBox="0 0 600 165"
                    role="img"
                    aria-label={`Recorded money in ${fmt(data.received)}, out ${fmt(data.spent)} for ${month}`}
                  >
                    <g className="overview-grid">
                      <path d="M30 20H585 M30 60H585 M30 100H585 M30 140H585" />
                    </g>
                    {data.weeks.map((w, i) => {
                      const max = Math.max(
                          1,
                          ...data.weeks.flatMap((x) => [x.in, x.out]),
                        ),
                        step = 550 / data.weeks.length,
                        x = 40 + i * step;
                      return (
                        <g key={w.label}>
                          <rect
                            className="overview-bar-in"
                            x={x}
                            y={140 - (w.in / max) * 115}
                            width={24}
                            height={(w.in / max) * 115}
                            rx="2"
                          >
                            <title>
                              {w.label}: in {fmt(w.in)}
                            </title>
                          </rect>
                          <rect
                            className="overview-bar-out"
                            x={x + 29}
                            y={140 - (w.out / max) * 115}
                            width={24}
                            height={(w.out / max) * 115}
                            rx="2"
                          >
                            <title>
                              {w.label}: out {fmt(w.out)}
                            </title>
                          </rect>
                          <text x={x + 26} y="160" textAnchor="middle">
                            {w.label}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>
              )}
              <div className="overview-card-foot">
                <span>Out {fmt(data.spent)}</span>
                <button onClick={() => setSelected({ kind: "movement" })}>
                  See breakdown
                </button>
              </div>
              <p className="overview-chart-note">
                Recorded payments, receipts and expenses-not a bank balance.
                Untracked purchase payments and manual journals are excluded.
              </p>
            </section>
            <section className="overview-card">
              <div className="overview-card-head">
                <h2>Needs your attention</h2>
                <span>Current workspace</span>
              </div>
              {[
                {
                  count: data.overdue.length,
                  title: "Overdue invoices",
                  hint: `${fmt(data.overdueAmount)} waiting to be collected`,
                  click: () => go("invoices", { status: "overdue" }),
                },
                {
                  count: data.unallocated.length,
                  title: "Unallocated receipts",
                  hint: "Review receipts without an invoice link",
                  click: () => go("receipts"),
                },
                {
                  count: data.lowStock.length,
                  title: "Products running low",
                  hint: "At or below your saved stock threshold",
                  click: () => setSelected({ kind: "stock" }),
                },
                {
                  count:
                    (data.coverage?.ready || 0) + (data.coverage?.review || 0),
                  title: "Older records need review",
                  hint: `${data.coverage?.ready || 0} eligible · ${data.coverage?.review || 0} need reconciliation`,
                  click: () => go("reports", { tab: "backfill" }),
                },
              ].map((a) => (
                <div className="overview-attention" key={a.title}>
                  <span className="overview-count">{a.count}</span>
                  <div>
                    <h3>{a.title}</h3>
                    <p>{a.hint}</p>
                  </div>
                  <button
                    onClick={a.click}
                    aria-label={`Review ${a.title.toLowerCase()}`}
                  >
                    Review <ArrowUpRight size={12} />
                  </button>
                </div>
              ))}
            </section>
          </div>
          <section className="overview-card">
            <div className="overview-card-head">
              <h2>Recent activity</h2>
              <span>{data.activityTotal} records · selected month</span>
            </div>
            <div className="overview-table-toolbar">
              <div
                className="overview-tabs"
                role="group"
                aria-label="Activity type"
              >
                {["All", "Invoice", "Receipt", "Expense", "Purchase"].map(
                  (t) => (
                    <button
                      key={t}
                      aria-pressed={type === t}
                      onClick={() => setType(t)}
                    >
                      {t === "All" ? "All" : `${t}s`}
                    </button>
                  ),
                )}
              </div>
              <input
                aria-label="Search recent activity"
                placeholder="Search party or reference…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="table-scroll">
              <table className="data-table overview-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Party / description</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th className="overview-number">Amount</th>
                    <th>
                      <span className="sr-only">Details</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {activity.slice(0, 8).map((r) => (
                    <tr key={`${r.type}:${r.id}`}>
                      <td>{r.date}</td>
                      <td>
                        <button
                          className="overview-record-link"
                          onClick={() => setSelected(r)}
                        >
                          {r.party}
                        </button>
                        <small>{r.reference}</small>
                      </td>
                      <td>{r.type}</td>
                      <td>
                        <span
                          className={`overview-status ${r.status.toLowerCase() === "overdue" ? "is-overdue" : ""}`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="overview-number">{fmt(r.amount)}</td>
                      <td>
                        <button
                          className="overview-row-open"
                          aria-label={`Inspect ${r.reference}`}
                          onClick={() => setSelected(r)}
                        >
                          <ArrowUpRight size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!activity.length && (
                    <tr>
                      <td colSpan="6">
                        <div className="overview-empty">
                          <h3>
                            {data.activityTotal
                              ? "No matching activity"
                              : "No activity this month"}
                          </h3>
                          <p>
                            {data.activityTotal
                              ? "Try a different search or activity type."
                              : "Create an invoice, record a receipt or choose another month."}
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="overview-card-foot">
              <span>
                Showing {Math.min(activity.length, 8)} of {activity.length}{" "}
                matching records
                {data.activityTotal > 100 ? " (latest 100 loaded)" : ""}
              </span>
              <button
                onClick={() => go(type === "All" ? "invoices" : routes[type])}
              >
                Open{" "}
                {type === "All"
                  ? "invoice register"
                  : `${type.toLowerCase()} register`}
                <ArrowUpRight size={12} aria-hidden="true" />
              </button>
            </div>
          </section>
          <div className="overview-bottom">
            <section className="overview-card">
              <div className="overview-card-head">
                <h2>Books & tax</h2>
                <button onClick={() => go("filing")}>
                  Open GST workspace <ArrowUpRight size={12} aria-hidden="true" />
                </button>
              </div>
              <div className="overview-bottom-content">
                <div>
                  <h3>Invoice tax · {month}</h3>
                  <strong>{fmt(data.invoiceTax)}</strong>
                  <p>
                    Saved invoice tax, not cash collected. Input tax eligibility
                    and filing status need review.
                  </p>
                </div>
              </div>
            </section>
            <section className="overview-card">
              <div className="overview-card-head">
                <h2>Workspace health</h2>
                <span>On this device</span>
              </div>
              <div className="overview-bottom-content">
                <div>
                  <h3>
                    {data.backupUnavailable
                      ? "Backup status unavailable"
                      : data.backup
                        ? `Last snapshot · ${data.backup.date}`
                        : "No backup snapshots found"}
                  </h3>
                  <p>
                    Open backups to manage snapshots and restoration. Snapshot
                    presence does not verify its integrity.
                  </p>
                  <p>
                    Accounting review ·{" "}
                    {(data.coverage?.ready || 0) + (data.coverage?.review || 0)}{" "}
                    records
                  </p>
                </div>
                <button onClick={() => go("controlpanel")}>
                  Manage <ArrowUpRight size={12} aria-hidden="true" />
                </button>
              </div>
            </section>
          </div>
        </>
      )}
      {selected && (
        <div
          className="overview-inspector-backdrop"
          onClick={() => setSelected(null)}
        >
          <aside
            className="accounting-dialog overview-inspector"
            role="dialog"
            aria-modal="true"
            aria-labelledby="overview-detail-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="overview-close"
              aria-label="Close details"
              onClick={() => setSelected(null)}
            >
              <X size={20} />
            </button>
            <small>WORKSPACE DETAILS</small>
            <h2 id="overview-detail-title">
              {selected.kind === "stock"
                ? "Low-stock products"
                : selected.kind === "movement"
                  ? "Recorded money movement"
                  : selected.party}
            </h2>
            {selected.kind === "stock" ? (
              <>
                <p>Current stock across all dates.</p>
                {data.lowStock.length ? (
                  <ul>
                    {data.lowStock.map((p) => (
                      <li key={p.id}>
                        {p.name}{" "}
                        <b>
                          {p.stock} {p.unit}
                        </b>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No products are below your threshold.</p>
                )}
                <button
                  className="btn btn-primary"
                  onClick={() => go("inventory")}
                >
                  Open products
                </button>
              </>
            ) : selected.kind === "movement" ? (
              <>
                <dl>
                  <dt>Month</dt>
                  <dd>{month}</dd>
                  <dt>Recorded inflows</dt>
                  <dd>{fmt(data.received)}</dd>
                  <dt>Recorded outflows</dt>
                  <dd>{fmt(data.spent)}</dd>
                  <dt>Net movement</dt>
                  <dd>{fmt(data.received - data.spent)}</dd>
                </dl>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Days</th>
                      <th>In</th>
                      <th>Out</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.weeks.map((w) => (
                      <tr key={w.label}>
                        <td>{w.label}</td>
                        <td>{fmt(w.in)}</td>
                        <td>{fmt(w.out)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p>
                  This is recorded cash activity, not your bank balance or
                  profit. Mirrored invoice receipts are counted once. Supplier
                  payment reversals count as inflows; manual journals are
                  excluded.
                </p>
              </>
            ) : (
              <>
                <dl>
                  <dt>Reference</dt>
                  <dd>{selected.reference}</dd>
                  <dt>Date</dt>
                  <dd>{selected.date}</dd>
                  <dt>Type</dt>
                  <dd>{selected.type}</dd>
                  <dt>Status</dt>
                  <dd>{selected.status}</dd>
                  <dt>Amount</dt>
                  <dd>{fmt(selected.amount)}</dd>
                </dl>
                <button
                  className="btn btn-primary"
                  onClick={() =>
                    go(routes[selected.type], { search: selected.reference })
                  }
                >
                  Open {selected.type.toLowerCase()} register
                </button>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
