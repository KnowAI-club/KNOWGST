import { useEffect, useRef, useState } from "react";
import {
  Upload,
  RefreshCw,
  Trash2,
  FileImage,
  ArrowUpRight,
} from "lucide-react";
import { integrationRequest as api } from "../services/integrations";
import "./ai-intake.css";

const readImage = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("The image could not be read."));
    reader.readAsDataURL(file);
  });
const numberValue = (value) => (value === "" ? null : Number(value));
export default function AiDocumentInbox({ activeProfile, model, onNavigate }) {
  const [inbox, setInbox] = useState({ revision: 0, documents: [] }),
    [selected, setSelected] = useState(null),
    [kind, setKind] = useState("expense");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [consent, setConsent] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [currencyConfirmed, setCurrencyConfirmed] = useState(false);
  const generation = useRef(0),
    lock = useRef(false),
    businessId = activeProfile?.id;
  useEffect(() => {
    const current = ++generation.current;
    lock.current = false;
    setBusy(true);
    setSelected(null);
    setConsent(false);
    setReviewed(false);
    setCurrencyConfirmed(false);
    setError("");
    setInbox({ revision: 0, documents: [] });
    if (businessId)
      api("/ai/documents/list", { businessId })
        .then((result) => {
          if (generation.current === current) setInbox(result);
        })
        .catch((e) => {
          if (generation.current === current) setError(e.message);
        })
        .finally(() => {
          if (generation.current === current) setBusy(false);
        });
    return () => {
      generation.current++;
    };
  }, [businessId]);
  async function run(action) {
    if (lock.current || !businessId) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const current = generation.current;
    try {
      const result = await action(current);
      return generation.current === current ? result : undefined;
    } catch (e) {
      if (generation.current === current)
        setError(e.message || "The document could not be updated.");
    } finally {
      if (generation.current === current) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  async function refresh() {
    await run(async (current) => {
      const result = await api("/ai/documents/list", { businessId });
      if (generation.current === current) {
        setInbox(result);
        setSelected(null);
        setReviewed(false);
      }
    });
  }
  async function upload(event) {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    if (!files.length) return;
    await run(async (current) => {
      let revision = inbox.revision;
      for (const file of files) {
        if (
          !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
          file.size > 3 * 1024 * 1024
        )
          throw new Error("Choose PNG, JPEG or WebP images up to 3 MB each.");
        const image = await readImage(file);
        if (generation.current !== current) return;
        const result = await api("/ai/documents/add", {
          businessId,
          revision,
          image,
          name: file.name,
        });
        if (generation.current !== current) return;
        revision = result.revision;
        setInbox(result);
      }
    });
  }
  async function open(documentId) {
    await run(async (current) => {
      const result = await api("/ai/documents/get", { businessId, documentId });
      if (generation.current === current) {
        setSelected(result.document);
        setInbox((old) => ({ ...old, revision: result.revision }));
        setReviewed(false);
        setConsent(false);
        setCurrencyConfirmed(false);
      }
    });
  }
  async function extract() {
    await run(async (current) => {
      const result = await api("/ai/documents/extract", {
        businessId,
        documentId: selected.id,
        revision: inbox.revision,
        model,
        consent,
      });
      if (generation.current === current) {
        setSelected(result.document);
        setInbox((old) => ({
          ...old,
          revision: result.revision,
          documents: old.documents.map((d) =>
            d.id === selected.id
              ? { ...d, status: "needs-review", hasExtraction: true }
              : d,
          ),
        }));
        setConsent(false);
        setReviewed(false);
      }
    });
  }
  function edit(field, value) {
    setReviewed(false);
    setSelected((old) => ({
      ...old,
      extraction: { ...old.extraction, [field]: value },
    }));
  }
  function editTax(field, value) {
    setReviewed(false);
    setSelected((old) => ({
      ...old,
      extraction: {
        ...old.extraction,
        taxBreakdown: {
          ...old.extraction.taxBreakdown,
          [field]: numberValue(value),
        },
      },
    }));
  }
  function editItem(index, field, value) {
    setReviewed(false);
    setSelected((old) => ({
      ...old,
      extraction: {
        ...old.extraction,
        items: old.extraction.items.map((item, i) =>
          i === index
            ? {
                ...item,
                [field]: ["name", "hsn"].includes(field)
                  ? value
                  : numberValue(value),
              }
            : item,
        ),
      },
    }));
  }
  async function apply() {
    await run(async (current) => {
      const result = await api("/ai/documents/review", {
        businessId,
        documentId: selected.id,
        revision: inbox.revision,
        extraction: selected.extraction,
        kind,
        currency: currencyConfirmed ? "INR" : "",
        confirm: reviewed,
      });
      if (generation.current === current)
        onNavigate?.(kind === "expense" ? "expenses" : "purchases", {
          aiDocumentDraft: result,
        });
    });
  }
  const extracted = selected?.extraction;
  return (
    <section className="ai-intake" aria-label="Document inbox">
      <div className="ai-intake-heading">
        <div>
          <h3>Document inbox</h3>
          <p className="text-muted">
            Keep receipt and supplier-bill images together. Scan, review, then
            open an unsaved expense or purchase.
          </p>
        </div>
        <div className="ai-intake-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={refresh}
          >
            <RefreshCw size={14} /> Refresh
          </button>
          <label className="btn btn-secondary">
            <Upload size={14} /> Add images
            <input
              aria-label="Add inbox images"
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp"
              disabled={busy}
              onChange={upload}
              hidden
            />
          </label>
        </div>
      </div>
      <p className="text-muted">
        Images saved from email are supported. PNG, JPEG or WebP · 3 MB each ·
        30 documents / 8 MB total. Originals stay on this device and in verified
        backups. Nothing is emailed automatically.
      </p>
      {error && (
        <p role="alert" className="ai-intake-error">
          {error}
        </p>
      )}
      {!inbox.documents.length && (
        <p className="ai-intake-empty">
          <FileImage size={20} /> Add your first receipt or supplier bill.
        </p>
      )}
      {!!inbox.documents.length && (
        <div className="ai-intake-list" role="list">
          {inbox.documents.map((doc) => (
            <div className="ai-intake-row" role="listitem" key={doc.id}>
              <button
                type="button"
                className="btn btn-secondary ai-intake-file"
                aria-pressed={selected?.id === doc.id}
                onClick={() => open(doc.id)}
                disabled={busy}
              >
                {doc.name}
              </button>
              <span className="text-muted">
                {doc.status === "new"
                  ? "Ready to scan"
                  : doc.status === "draft-opened"
                    ? "Draft opened · check saved records"
                    : "Needs review"}
              </span>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remove ${doc.name}`}
                disabled={busy}
                onClick={() => {
                  if (
                    !window.confirm(
                      "Remove this local image from the inbox? Saved accounting records are kept.",
                    )
                  )
                    return;
                  run(async (current) => {
                    const result = await api("/ai/documents/remove", {
                      businessId,
                      documentId: doc.id,
                      revision: inbox.revision,
                      confirm: true,
                    });
                    if (generation.current === current) {
                      setInbox(result);
                      if (selected?.id === doc.id) setSelected(null);
                    }
                  });
                }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
      {selected && (
        <div className="ai-inbox-detail">
          <div className="ai-inbox-original">
            <img src={selected.image} alt={`Original ${selected.name}`} />
            <a
              href={selected.image}
              download={selected.name}
              className="btn btn-secondary"
            >
              Save original image
            </a>
          </div>
          <div className="ai-inbox-fields">
            <h4>{selected.name}</h4>
            <label className="ai-intake-check">
              <input
                type="checkbox"
                checked={consent}
                disabled={busy}
                onChange={(e) => setConsent(e.target.checked)}
              />{" "}
              Send this entire image to my selected ChatGPT account for
              extraction.
            </label>
            <button
              className="btn btn-secondary"
              type="button"
              disabled={busy || !consent || !model}
              onClick={extract}
            >
              {busy
                ? "Working…"
                : extracted
                  ? "Scan again"
                  : "Scan with ChatGPT"}
            </button>
            {!model && (
              <p className="text-muted">
                Connect ChatGPT and choose a model to scan.
              </p>
            )}
            {extracted && (
              <>
                <div className="ai-intake-grid">
                  {[
                    ["supplierName", "Supplier"],
                    ["supplierGstin", "Supplier GSTIN"],
                    ["invoiceNumber", "Invoice / receipt number"],
                    ["date", "Date"],
                    ["grandTotal", "Total paid / payable (INR)"],
                  ].map(([field, label]) => (
                    <label key={field}>
                      {label}
                      <input
                        className="form-input"
                        disabled={busy}
                        type={
                          field === "date"
                            ? "date"
                            : field === "grandTotal"
                              ? "number"
                              : "text"
                        }
                        step="0.01"
                        min={field === "grandTotal" ? "0" : undefined}
                        value={extracted[field] ?? ""}
                        onChange={(e) =>
                          edit(
                            field,
                            field === "grandTotal"
                              ? numberValue(e.target.value)
                              : e.target.value,
                          )
                        }
                      />
                    </label>
                  ))}
                  {[
                    "taxableValue",
                    "cgst",
                    "sgst",
                    "igst",
                    "cess",
                    "roundOff",
                  ].map((field) => (
                    <label key={field}>
                      {field === "taxableValue"
                        ? "Taxable value"
                        : field === "roundOff"
                          ? "Round off"
                          : field.toUpperCase()}
                      <input
                        className="form-input"
                        disabled={busy}
                        type="number"
                        step="0.01"
                        value={extracted.taxBreakdown[field] ?? ""}
                        onChange={(e) => editTax(field, e.target.value)}
                      />
                    </label>
                  ))}
                </div>
                {!!extracted.items.length && (
                  <div className="ai-intake-table">
                    <table>
                      <thead>
                        <tr>
                          {[
                            "Item",
                            "HSN/SAC",
                            "Qty",
                            "Rate",
                            "GST %",
                            "Cess %",
                          ].map((v) => (
                            <th key={v}>{v}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {extracted.items.map((item, i) => (
                          <tr key={i}>
                            {[
                              "name",
                              "hsn",
                              "quantity",
                              "rate",
                              "taxPercent",
                              "cessPercent",
                            ].map((field) => (
                              <td key={field}>
                                <input
                                  className="form-input"
                                  aria-label={`Item ${i + 1} ${field}`}
                                  disabled={busy}
                                  value={item[field] ?? ""}
                                  type={
                                    ["name", "hsn"].includes(field)
                                      ? "text"
                                      : "number"
                                  }
                                  step="any"
                                  onChange={(e) =>
                                    editItem(i, field, e.target.value)
                                  }
                                />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <label>
                  Use as
                  <select
                    className="form-input"
                    value={kind}
                    disabled={busy}
                    onChange={(e) => {
                      setKind(e.target.value);
                      setReviewed(false);
                    }}
                  >
                    <option value="expense">Paid expense receipt</option>
                    <option value="purchase">Supplier purchase bill</option>
                  </select>
                </label>
                <p className="text-muted">
                  Only INR documents can be applied from this inbox. Expense
                  records represent money already paid. Bills with cess need the
                  purchase form. Match every amount and tax field to the
                  original.
                </p>
                <label className="ai-intake-check">
                  <input
                    type="checkbox"
                    checked={currencyConfirmed}
                    disabled={busy}
                    onChange={(e) => {
                      setCurrencyConfirmed(e.target.checked);
                      setReviewed(false);
                    }}
                  />{" "}
                  This document is in INR (Indian rupees).
                </label>
                <label className="ai-intake-check">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    disabled={busy}
                    onChange={(e) => setReviewed(e.target.checked)}
                  />{" "}
                  I checked these fields and the document type against the
                  original.
                </label>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || !reviewed || !currencyConfirmed}
                  onClick={apply}
                >
                  Open {kind} draft <ArrowUpRight size={14} />
                </button>
                <p className="text-muted">
                  Opening a draft does not save a record or change stock. Review
                  the form and save separately.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
