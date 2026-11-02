import { useEffect, useRef, useState } from "react";
import { integrationRequest as api } from "../services/integrations";
import "./ai-review-workflows.css";

export default function AiCatalogReview({ activeProfile, model, onNavigate }) {
  const [kind, setKind] = useState("clients"),
    [data, setData] = useState(null);
  const [instruction, setInstruction] = useState(""),
    [preview, setPreview] = useState(null),
    [draft, setDraft] = useState(null);
  const [consent, setConsent] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [allowDuplicate, setAllowDuplicate] = useState(false);
  const [alias, setAlias] = useState(""),
    [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0),
    lock = useRef(false);
  const businessId = activeProfile?.id;
  const latest = useRef({ businessId, kind, model });
  latest.current = { businessId, kind, model };
  useEffect(() => {
    const version = ++generation.current;
    setData(null);
    setPreview(null);
    setDraft(null);
    setConsent(false);
    setReviewed(false);
    setAllowDuplicate(false);
    setAlias("");
    setTargetId("");
    setError("");
    setInstruction("");
    if (businessId)
      api("/ai/catalog/list", { businessId, kind })
        .then((result) => {
          if (version === generation.current) setData(result);
        })
        .catch((e) => {
          if (version === generation.current) setError(e.message);
        });
    return () => {
      generation.current++;
    };
  }, [businessId, kind]);
  useEffect(() => {
    setPreview(null);
    setDraft(null);
    setConsent(false);
  }, [model]);
  async function run(handler, body, accept) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const version = generation.current,
      selectedModel = model;
    try {
      const result = await api("/ai/catalog/" + handler, {
        businessId,
        kind,
        ...body,
      });
      if (
        version === generation.current &&
        latest.current.model === selectedModel
      )
        accept(result);
    } catch (e) {
      if (version === generation.current) setError(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const navigateExisting = () =>
    onNavigate(kind === "clients" ? "clients" : "inventory");
  return (
    <div className="ai-review-workflow ai-catalog-review">
      {error && <div role="alert">{error}</div>}
      <section aria-label="Catalog review">
        <h3>Clients & catalog</h3>
        <p>
          Review alternate names and possible duplicates. Existing invoices,
          stock and accounting history stay attached to their original records.
        </p>
        <label>
          Catalog
          <select
            aria-label="Catalog"
            className="form-input"
            disabled={busy}
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="clients">Clients</option>
            <option value="products">Products & services</option>
          </select>
        </label>
        <div className="ai-review-actions">
          <button className="btn btn-secondary" onClick={navigateExisting}>
            Open {kind === "clients" ? "clients" : "products"}
          </button>
        </div>
        {data && (
          <p>
            {data.records.length} records · {data.duplicates.length}{" "}
            duplicate-name groups · {data.aliases.length} alternate names
          </p>
        )}
        {data?.duplicates.length > 0 && (
          <details>
            <summary>Review duplicate names</summary>
            <ul className="ai-review-list">
              {data.duplicates.map((rows, i) => (
                <li key={i}>
                  {rows.map((row) => row.name).join(" / ")}
                  <br />
                  <small>
                    {rows.length} separate records. Review them in the catalog;
                    no automatic merge is performed.
                  </small>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
      <section aria-label="Create catalog draft">
        <h3>Prepare a new {kind === "clients" ? "client" : "item"}</h3>
        <p>
          ChatGPT extracts only details you provide. Prices, HSN, GST, cess and
          opening stock are entered and reviewed in the normal form.
        </p>
        <label>
          Description
          <textarea
            className="form-input"
            rows={3}
            maxLength={1600}
            disabled={busy}
            value={instruction}
            placeholder={
              kind === "clients"
                ? "Add Ananya Traders, Pune, Maharashtra, India. Email: accounts@example.com"
                : "Add Office notebook. Unit: Pcs. Description: A5 ruled notebook."
            }
            onChange={(e) => {
              setInstruction(e.target.value);
              setPreview(null);
              setDraft(null);
              setConsent(false);
            }}
          />
        </label>
        <div className="ai-review-actions">
          <button
            className="btn btn-secondary"
            disabled={busy || !businessId || !instruction.trim()}
            onClick={() =>
              run("preview", { instruction }, (result) => {
                setPreview(result);
                setDraft(null);
                setConsent(false);
              })
            }
          >
            Preview description
          </button>
        </div>
        {preview && (
          <>
            <details open>
              <summary>Data to share with ChatGPT</summary>
              <pre>{preview.context.instruction}</pre>
            </details>
            <label className="ai-review-check">
              <input
                type="checkbox"
                checked={consent}
                disabled={busy}
                onChange={(e) => setConsent(e.target.checked)}
              />
              Send this description to the selected ChatGPT model
            </label>
            <button
              className="btn btn-primary"
              disabled={busy || !model || !consent}
              onClick={() =>
                run(
                  "generate",
                  { ticketId: preview.ticketId, consent: true, model },
                  (result) => {
                    setDraft(result);
                    setPreview(null);
                    setConsent(false);
                    setReviewed(false);
                    setAllowDuplicate(false);
                  },
                )
              }
            >
              {busy ? "Preparing…" : "Prepare draft"}
            </button>
          </>
        )}
        {draft && (
          <>
            <h3 style={{ marginTop: 16 }}>Review proposed fields</h3>
            <dl>
              {Object.entries(draft.draft).map(([key, value]) => (
                <div key={key} style={{ display: "contents" }}>
                  <dt>{key}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {draft.clarifications.length > 0 && (
              <ul>
                {draft.clarifications.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            )}
            {draft.duplicates.length > 0 && (
              <>
                <p>
                  A saved record matches:{" "}
                  {draft.duplicates.map((row) => row.name).join(", ")}.
                </p>
                <label className="ai-review-check">
                  <input
                    type="checkbox"
                    checked={allowDuplicate}
                    disabled={busy}
                    onChange={(e) => setAllowDuplicate(e.target.checked)}
                  />
                  I reviewed the existing record and need a separate new record
                </label>
              </>
            )}
            <label className="ai-review-check">
              <input
                type="checkbox"
                checked={reviewed}
                disabled={busy}
                onChange={(e) => setReviewed(e.target.checked)}
              />
              I reviewed these details. Open an unsaved form.
            </label>
            <button
              className="btn btn-primary"
              disabled={
                busy ||
                !reviewed ||
                (draft.duplicates.length > 0 && !allowDuplicate)
              }
              onClick={() =>
                run(
                  "resolve",
                  { ticketId: draft.ticketId, confirm: true, allowDuplicate },
                  (result) => {
                    setDraft(null);
                    onNavigate(
                      result.kind === "clients" ? "clients" : "inventory",
                      { aiCatalogDraft: result },
                    );
                  },
                )
              }
            >
              Open draft form
            </button>
            <p>Save is a separate step in the form.</p>
          </>
        )}
      </section>
      <section aria-label="Alternate catalog names">
        <h3>Reviewed alternate names</h3>
        <p>
          Use a supplier's wording to identify the correct existing item during
          document review. Alternate names never combine or delete records.
        </p>
        <div className="ai-review-fields">
          <label>
            Alternate name
            <input
              className="form-input"
              maxLength={160}
              disabled={busy}
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
            />
          </label>
          <label>
            Existing record
            <select
              aria-label="Existing record"
              className="form-input"
              disabled={busy}
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
            >
              <option value="">Select a record</option>
              {data?.records.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          className="btn btn-secondary"
          disabled={busy || !data || !alias.trim() || !targetId}
          onClick={() =>
            run(
              "saveAlias",
              {
                revision: data.revision,
                alias,
                targetId,
                targetFingerprint: data.records.find(
                  (row) => row.id === targetId,
                )?.fingerprint,
                confirm: true,
              },
              (result) => {
                setData(result);
                setAlias("");
                setTargetId("");
                setPreview(null);
                setDraft(null);
              },
            )
          }
        >
          Confirm alternate name
        </button>
        <ul className="ai-review-list">
          {data?.aliases.map((row) => (
            <li key={row.id}>
              <strong>{row.alias}</strong> →{" "}
              {data.records.find((record) => record.id === row.targetId)
                ?.name || "Record unavailable"}
              {row.stale && (
                <p>
                  Record changed. Reconfirm this alternate name before it can be
                  used.
                </p>
              )}
              <div className="ai-review-actions">
                {row.stale && (
                  <button
                    className="btn btn-secondary"
                    disabled={busy}
                    onClick={() => {
                      setAlias(row.alias);
                      setTargetId(row.targetId);
                    }}
                  >
                    Review again
                  </button>
                )}
                <button
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() =>
                    run(
                      "removeAlias",
                      { revision: data.revision, id: row.id, confirm: true },
                      setData,
                    )
                  }
                >
                  Remove alternate name
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
