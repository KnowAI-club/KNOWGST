import { useEffect, useRef, useState } from "react";
import { Upload, RefreshCw, Check, Undo2 } from "lucide-react";
import { integrationRequest as api } from "../services/integrations";
import "./ai-intake.css";
const labels = {
  name: "Name",
  gstin: "GSTIN",
  email: "Email",
  phone: "Phone",
  address: "Address",
  city: "City",
  state: "State",
  pin: "PIN code",
  hsn: "HSN / SAC",
  unit: "Unit",
  sellingPrice: "Selling price",
  purchasePrice: "Purchase price",
  taxPercent: "GST %",
  cessPercent: "Cess %",
  description: "Description",
};
const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
function initialMapping(fields, headers) {
  const result = {},
    used = new Set();
  for (const field of fields) {
    const header = headers.find(
      (h) =>
        !used.has(h) &&
        [normalize(field), normalize(labels[field])].includes(normalize(h)),
    );
    if (header) {
      result[field] = header;
      used.add(header);
    }
  }
  return result;
}
export default function AiImportReview({ activeProfile, onNavigate }) {
  const [kind, setKind] = useState("clients"),
    [file, setFile] = useState(null),
    [inspection, setInspection] = useState(null),
    [mapping, setMapping] = useState({});
  const [plan, setPlan] = useState(null),
    [history, setHistory] = useState([]),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const generation = useRef(0),
    lock = useRef(false),
    businessId = activeProfile?.id;
  useEffect(() => {
    const current = ++generation.current;
    lock.current = false;
    setFile(null);
    setInspection(null);
    setPlan(null);
    setHistory([]);
    setConfirmed(false);
    setError("");
    setNotice("");
    if (businessId)
      api("/ai/imports/history", { businessId })
        .then((result) => {
          if (current === generation.current) setHistory(result.batches);
        })
        .catch((e) => {
          if (current === generation.current) setError(e.message);
        });
    return () => {
      generation.current++;
    };
  }, [businessId]);
  async function run(fn) {
    if (lock.current || !businessId) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const current = generation.current;
    try {
      await fn(current);
    } catch (e) {
      if (generation.current === current)
        setError(e.message || "Import could not be completed.");
    } finally {
      if (generation.current === current) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  async function reload(current) {
    const result = await api("/ai/imports/history", { businessId });
    if (current === generation.current) setHistory(result.batches);
  }
  function changeKind(value) {
    setKind(value);
    setPlan(null);
    setConfirmed(false);
    if (inspection)
      setMapping(initialMapping(inspection.fields[value], inspection.headers));
  }
  async function pick(event) {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) return;
    await run(async (current) => {
      if (selected.size > 250000)
        throw new Error("Choose a CSV file up to 250 KB.");
      const text = await selected.text();
      if (current !== generation.current) return;
      const result = await api("/ai/imports/inspect", { businessId, text });
      if (current !== generation.current) return;
      setFile({ name: selected.name, text });
      setInspection(result);
      setMapping(initialMapping(result.fields[kind], result.headers));
      setPlan(null);
      setConfirmed(false);
    });
  }
  async function preview() {
    await run(async (current) => {
      const result = await api("/ai/imports/preview", {
        businessId,
        kind,
        ...file,
        mapping,
      });
      if (current === generation.current) {
        setPlan(result);
        setConfirmed(false);
      }
    });
  }
  async function commit() {
    await run(async (current) => {
      const result = await api("/ai/imports/commit", {
        businessId,
        planId: plan.id,
        confirm: confirmed,
      });
      if (current !== generation.current) return;
      setNotice(
        `${result.batch.records.length} ${result.batch.kind} imported. Verified backup: ${result.batch.backup}.`,
      );
      setPlan(null);
      setConfirmed(false);
      await reload(current);
    });
  }
  async function undo(batch) {
    if (
      !window.confirm(
        `Undo this import of ${batch.records.length} ${batch.kind}? It is allowed only while every record is unchanged and unused.`,
      )
    )
      return;
    await run(async (current) => {
      await api("/ai/imports/undo", {
        businessId,
        batchId: batch.id,
        confirm: true,
      });
      if (current === generation.current) {
        setNotice(
          "Import undone. The audit history and verified backup are retained.",
        );
        await reload(current);
      }
    });
  }
  return (
    <section className="ai-intake" aria-label="Guided master-data import">
      <div className="ai-intake-heading">
        <div>
          <h3>Bring your clients and products</h3>
          <p className="text-muted">
            Map columns, check every row, then import a new-record batch with a
            verified backup.
          </p>
        </div>
        <button
          className="btn btn-secondary"
          type="button"
          disabled={busy}
          onClick={() => run(reload)}
        >
          <RefreshCw size={14} /> Refresh history
        </button>
      </div>
      <p className="text-muted">
        This local workflow does not send your CSV to ChatGPT. Up to 300 rows /
        250 KB. Opening balances, opening stock and historical invoices stay out
        of this import. Existing records are never overwritten.
      </p>
      {error && (
        <p className="ai-intake-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="ai-intake-actions">
        <label>
          Import
          <select
            className="form-input"
            value={kind}
            disabled={busy}
            onChange={(e) => changeKind(e.target.value)}
          >
            <option value="clients">Clients</option>
            <option value="products">Products and services</option>
          </select>
        </label>
        <label className="btn btn-secondary">
          <Upload size={14} /> Choose CSV
          <input
            type="file"
            aria-label="Choose master-data CSV"
            accept=".csv,text/csv"
            hidden
            disabled={busy}
            onChange={pick}
          />
        </label>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() =>
            onNavigate?.(kind === "clients" ? "clients" : "inventory")
          }
        >
          Open {kind}
        </button>
      </div>
      {inspection && (
        <>
          <p>
            <strong>{file.name}</strong> · {inspection.rowCount} source rows
          </p>
          <div className="ai-intake-grid">
            {inspection.fields[kind].map((field) => (
              <label key={field}>
                {labels[field]}
                {field === "name" ? " *" : ""}
                <select
                  className="form-input"
                  aria-label={`Map ${labels[field]}`}
                  disabled={busy}
                  value={mapping[field] || ""}
                  onChange={(e) => {
                    setMapping((old) => ({ ...old, [field]: e.target.value }));
                    setPlan(null);
                    setConfirmed(false);
                  }}
                >
                  <option value="">Leave empty</option>
                  {inspection.headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <details>
            <summary>Source sample · first three rows</summary>
            <div className="ai-intake-table">
              <table>
                <thead>
                  <tr>
                    {inspection.headers.map((header) => (
                      <th key={header}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {inspection.sample.map((row, i) => (
                    <tr key={i}>
                      {row.map((value, j) => (
                        <td key={j}>{value}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy || !mapping.name}
            onClick={preview}
          >
            Review import
          </button>
        </>
      )}
      {plan && (
        <>
          <div className="ai-intake-summary">
            <span>
              <strong>{plan.summary.ready}</strong> new records
            </span>
            <span>
              <strong>{plan.summary.skipped}</strong> duplicates skipped
            </span>
            <span>
              <strong>{plan.summary.errors}</strong> errors
            </span>
            <span>
              Opening stock: <strong>0</strong> · opening balances:{" "}
              <strong>0</strong>
            </span>
          </div>
          <div className="ai-intake-table">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  {kind === "products" ? (
                    <>
                      <th>Selling price</th>
                      <th>Purchase price</th>
                      <th>GST %</th>
                      <th>Cess %</th>
                    </>
                  ) : (
                    <>
                      <th>GSTIN</th>
                      <th>Email</th>
                      <th>Phone</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {plan.records.map((record) => (
                  <tr key={record.id}>
                    <td>{record.name}</td>
                    {kind === "products" ? (
                      <>
                        <td>{record.sellingPrice}</td>
                        <td>{record.purchasePrice}</td>
                        <td>{record.taxPercent}</td>
                        <td>{record.cessPercent}</td>
                      </>
                    ) : (
                      <>
                        <td>{record.gstin || "-"}</td>
                        <td>{record.email || "-"}</td>
                        <td>{record.phone || "-"}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!!plan.skipped.length && (
            <details>
              <summary>Skipped duplicates ({plan.skipped.length})</summary>
              <ul>
                {plan.skipped.map((row) => (
                  <li key={row.row}>
                    Row {row.row}: {row.name} - {row.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {!!plan.errors.length && (
            <div role="alert">
              <strong>
                Correct these rows in the source CSV, then upload it again.
              </strong>
              <ul>
                {plan.errors.map((row) => (
                  <li key={row.row}>
                    Row {row.row}: {row.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <label className="ai-intake-check">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy || !!plan.errors.length}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{" "}
            I checked this mapping, duplicate list and all new records. Create a
            verified backup and import.
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={
              busy || !confirmed || !!plan.errors.length || !plan.records.length
            }
            onClick={commit}
          >
            <Check size={14} /> {busy ? "Working…" : "Back up and import"}
          </button>
        </>
      )}
      <div className="ai-intake-history">
        <h4>Import history</h4>
        {!history.length && (
          <p className="text-muted">
            Imported batches will appear here. Undo is available only while
            their records are unchanged and unused.
          </p>
        )}
        {[...history].reverse().map((batch) => (
          <div className="ai-intake-row" key={batch.id}>
            <div>
              <strong>{batch.sourceName}</strong>
              <p className="text-muted">
                {batch.records.length} {batch.kind} ·{" "}
                {batch.createdAt.slice(0, 10)} ·{" "}
                {batch.status === "undone" ? "Undone" : "Imported"}
              </p>
              <p className="ai-intake-code text-muted">
                Backup: {batch.backup}
              </p>
            </div>
            {batch.status === "imported" && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => undo(batch)}
              >
                <Undo2 size={14} /> Undo batch
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
