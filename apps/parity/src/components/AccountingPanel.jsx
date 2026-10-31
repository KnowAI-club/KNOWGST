import useDialogFocus from "./useDialogFocus";
import { useEffect, useState } from "react";
import { getAccounting, postJournal } from "../store";
import { toast } from "./Toast";
import { localToday } from "../utils";
const blank = () => ({
  id: crypto.randomUUID(),
  date: localToday(),
  currency: "INR",
  memo: "",
  lines: [
    { account: "1000", debit: "", credit: "" },
    { account: "3000", debit: "", credit: "" },
  ],
});
export default function AccountingPanel() {
  const [data, setData] = useState(null),
    [tab, setTab] = useState("journal"),
    [form, setForm] = useState(null),
    [busy, setBusy] = useState(false);
  useDialogFocus(!!form, () => {
    if (!busy) setForm(null);
  });
  const load = () =>
    getAccounting()
      .then(setData)
      .catch((e) => toast(e.message, "error"));
  useEffect(() => {
    load();
  }, []);
  async function save() {
    setBusy(true);
    try {
      await postJournal(form);
      setForm(null);
      await load();
      toast("Journal posted", "success");
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }
  if (!data) return <div className="glass-panel p-4">Loading accounts…</div>;
  const totals = {};
  for (const e of data.entries)
    for (const l of e.lines) {
      const key = e.currency + " " + l.account;
      totals[key] = (totals[key] || 0) + l.debit - l.credit;
    }
  return (
    <section className="glass-panel p-4">
      <div className="table-header">
        <div>
          <h3>Accounts & history</h3>
          <p className="text-muted">
            Posted journals and supplier payments only. Existing sales and
            expenses are not automatically posted here.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setForm(blank())}>
          New journal
        </button>
      </div>
      <div
        className="flex gap-2"
        style={{ flexWrap: "wrap", marginBottom: 16 }}
      >
        {[
          ["journal", "Journal"],
          ["balances", "Account balances"],
          ["audit", "Audit trail"],
          ["stock", "Stock movements"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={`btn ${tab === id ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "journal" && (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Currency</th>
                <th>Debit / credit</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {[...data.entries].reverse().map((e) => (
                <tr key={e.id}>
                  <td>{e.date}</td>
                  <td>
                    {e.memo}
                    {e.reversalOf && " · Reversal"}
                    <details>
                      <summary>Lines</summary>
                      {e.lines.map((l, i) => (
                        <div key={i}>
                          {data.accounts.find((a) => a[0] === l.account)?.[1]} ·
                          Dr {(l.debit / 100).toFixed(2)} / Cr{" "}
                          {(l.credit / 100).toFixed(2)}
                        </div>
                      ))}
                    </details>
                  </td>
                  <td>{e.currency}</td>
                  <td>
                    {(e.lines.reduce((s, l) => s + l.debit, 0) / 100).toFixed(
                      2,
                    )}
                  </td>
                  <td>
                    {!e.source &&
                      !e.reversalOf &&
                      !data.entries.some((r) => r.reversalOf === e.id) && (
                        <button
                          className="btn btn-secondary"
                          onClick={() =>
                            setForm({
                              ...blank(),
                              reversalOf: e.id,
                              currency: e.currency,
                              memo: "Reversal: " + e.memo,
                            })
                          }
                        >
                          Reverse
                        </button>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.entries.length && (
            <p className="text-muted">
              No posted entries. Add an opening or adjustment journal, or record
              a supplier payment.
            </p>
          )}
        </div>
      )}
      {tab === "balances" && (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Currency / account</th>
                <th>Debit balance</th>
                <th>Credit balance</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(totals).map(([key, value]) => (
                <tr key={key}>
                  <td>
                    {key} ·{" "}
                    {data.accounts.find((a) => a[0] === key.split(" ")[1])?.[1]}
                  </td>
                  <td>{(Math.max(value, 0) / 100).toFixed(2)}</td>
                  <td>{(Math.max(-value, 0) / 100).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {tab === "audit" && (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Record</th>
                <th>Changed fields / reason</th>
              </tr>
            </thead>
            <tbody>
              {[...data.audit].reverse().map((e) => (
                <tr key={e.id}>
                  <td>{new Date(e.at).toLocaleString()}</td>
                  <td>
                    {e.action.replaceAll(".", " ")}
                    <br />
                    <small>{e.actor}</small>
                  </td>
                  <td>{e.entityLabel || e.entityId}</td>
                  <td>{e.reason || e.fields?.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-muted">
            Actions identify the local session, not individual users. Backups
            restore the history captured in that snapshot.
          </p>
        </div>
      )}
      {tab === "stock" && (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Product</th>
                <th>Change</th>
                <th>Balance</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {[...data.movements].reverse().map((e) => (
                <tr key={e.id}>
                  <td>{new Date(e.at).toLocaleString()}</td>
                  <td>{e.productName || e.productId}</td>
                  <td>{e.quantity}</td>
                  <td>{e.balance}</td>
                  <td>{e.reason || e.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {form && (
        <div className="modal-overlay">
          <div
            className="modal-content accounting-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={form.reversalOf ? "Reverse journal" : "New journal"}
          >
            <h3>{form.reversalOf ? "Reverse journal" : "New journal"}</h3>
            <div className="form-grid">
              <label className="form-group">
                Date
                <input
                  className="form-input"
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </label>
              <label className="form-group">
                Currency
                <input
                  className="form-input"
                  maxLength={3}
                  disabled={!!form.reversalOf}
                  value={form.currency}
                  onChange={(e) =>
                    setForm({ ...form, currency: e.target.value.toUpperCase() })
                  }
                />
              </label>
            </div>
            <label className="form-group">
              Description / reason
              <input
                className="form-input"
                value={form.memo}
                onChange={(e) => setForm({ ...form, memo: e.target.value })}
              />
            </label>
            {!form.reversalOf &&
              form.lines.map((line, index) => (
                <div className="form-grid" key={index}>
                  <label className="form-group">
                    Account {index + 1}
                    <select
                      className="form-input"
                      value={line.account}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          lines: form.lines.map((l, i) =>
                            i === index ? { ...l, account: e.target.value } : l,
                          ),
                        })
                      }
                    >
                      {data.accounts.map((a) => (
                        <option key={a[0]} value={a[0]}>
                          {a[0]} · {a[1]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {["debit", "credit"].map((side) => (
                    <label className="form-group" key={side}>
                      {side === "debit" ? "Debit" : "Credit"} {index + 1}
                      <input
                        className="form-input"
                        type="number"
                        min="0"
                        step="0.01"
                        value={line[side]}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            lines: form.lines.map((l, i) =>
                              i === index
                                ? { ...l, [side]: e.target.value }
                                : l,
                            ),
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
              ))}
            <div className="flex gap-2" style={{ flexWrap: "wrap" }}>
              {!form.reversalOf && (
                <button
                  className="btn btn-secondary"
                  onClick={() =>
                    setForm({
                      ...form,
                      lines: [
                        ...form.lines,
                        { account: "5100", debit: "", credit: "" },
                      ],
                    })
                  }
                >
                  Add line
                </button>
              )}
              <button
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => setForm(null)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={save}
              >
                {busy ? "Posting…" : "Post journal"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
