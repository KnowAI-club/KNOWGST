import { useState } from "react";
import { getBackfillPreview, applyBackfill } from "../store";
import { toast } from "./Toast";
export default function AccountingBackfill({ onApplied }) {
  const [preview, setPreview] = useState(null),
    [busy, setBusy] = useState(false),
    [reviewed, setReviewed] = useState(false);
  async function refresh() {
    setBusy(true);
    try {
      setPreview(await getBackfillPreview());
      setReviewed(false);
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    setBusy(true);
    try {
      const result = await applyBackfill({
        token: preview.token,
        reviewedManualEntries: reviewed,
      });
      toast(
        `${result.postedRecords} records posted; ${result.review} need review`,
        "success",
      );
      setPreview(null);
      setReviewed(false);
      await onApplied();
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mt-4">
      <h3>Historical backfill</h3>
      <p className="text-muted">
        Preview older INR sales, expenses and standalone receipts. Source
        documents, stock and PDFs stay unchanged. Records with existing source
        journal history are never posted again.
      </p>
      <button className="btn btn-secondary" disabled={busy} onClick={refresh}>
        Review older records
      </button>
      {preview && (
        <>
          <p role="status">
            {preview.ready} ready · {preview.review} need review ·{" "}
            {preview.manualEntries} manual journal entries
          </p>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Record</th>
                  <th>Module</th>
                  <th>Status</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={`${row.collection}:${row.id}`}>
                    <td>{row.label}</td>
                    <td>{row.collection}</td>
                    <td>{row.status}</td>
                    <td>
                      {row.reason}
                      {row.postings.length > 0 && (
                        <details>
                          <summary>Proposed journal lines</summary>
                          {row.postings.map((p) => (
                            <div key={p.key}>
                              <strong>
                                {p.memo} · {p.date}
                              </strong>
                              {p.lines.map((l, i) => (
                                <div key={i}>
                                  {l.account} · Dr {(l.debit / 100).toFixed(2)}{" "}
                                  / Cr {(l.credit / 100).toFixed(2)}
                                </div>
                              ))}
                            </div>
                          ))}
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="flex gap-2 mt-4">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={busy}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            I reviewed the proposed entries and checked that manual journals do
            not already cover these records.
          </label>
          <button
            className="btn btn-primary mt-4"
            disabled={busy || !reviewed || !preview.ready}
            onClick={apply}
          >
            {busy ? "Working…" : `Post ${preview.ready} eligible records`}
          </button>
        </>
      )}
    </section>
  );
}
