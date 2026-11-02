import { useEffect, useRef, useState } from "react";
import { integrationRequest as api } from "../services/integrations";
import { formatCurrency } from "../utils";
import {
  invoiceContextResponse,
  invoiceReviewResponse,
} from "../utils/ai-invoice-draft.mjs";

export default function AiInvoiceDraft({
  businessId,
  formIdentity,
  disabled,
  onApply,
}) {
  const [instruction, setInstruction] = useState(""),
    [models, setModels] = useState([]),
    [model, setModel] = useState("");
  const [preview, setPreview] = useState(null),
    [suggestion, setSuggestion] = useState(null);
  const [opened, setOpened] = useState(false);
  const [consent, setConsent] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const mounted = useRef(true),
    businessScope = useRef(businessId);
  businessScope.current = businessId;
  const generation = useRef(0),
    lock = useRef(false),
    loadingModels = useRef(false),
    applyCurrent = useRef(onApply);
  const identity = JSON.stringify({
      businessId,
      formIdentity,
      instruction,
      model,
      disabled,
    }),
    latest = useRef(identity);
  latest.current = identity;
  applyCurrent.current = onApply;
  useEffect(() => {
    generation.current++;
    setPreview(null);
    setSuggestion(null);
    setConsent(false);
    setReviewed(false);
    setError("");
  }, [identity]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    if (opened && !disabled) loadModels();
  }, [opened, disabled, businessId]);
  async function loadModels() {
    if (loadingModels.current || models.length) return;
    loadingModels.current = true;
    const scope = businessId;
    try {
      const list = await api("/chatgpt/models");
      if (mounted.current && scope === businessScope.current) {
        setModels(list);
        setModel(list[0]?.id || "");
      }
    } catch (e) {
      if (mounted.current && scope === businessScope.current)
        setError(e.message);
    } finally {
      loadingModels.current = false;
    }
  }
  async function run(action) {
    if (
      lock.current ||
      disabled ||
      !businessId ||
      !instruction.trim() ||
      (action === "generate" &&
        (!consent || !model || !preview?.canGenerate)) ||
      (action === "apply" && (!reviewed || !suggestion?.canApply))
    )
      return;
    const g = generation.current,
      snapshot = identity;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (action === "preview") {
        const result = await api("/ai/invoice-draft/preview", {
          businessId,
          instruction,
        });
        if (g === generation.current && snapshot === latest.current) {
          setPreview(invoiceContextResponse(result));
          setConsent(false);
          setSuggestion(null);
          setReviewed(false);
        }
      } else if (action === "generate") {
        setConsent(false);
        const result = await api("/ai/invoice-draft/generate", {
          businessId,
          snapshotId: preview.id,
          model,
          consent: true,
        });
        if (g === generation.current && snapshot === latest.current) {
          setSuggestion(invoiceReviewResponse(result));
          setPreview(null);
          setReviewed(false);
        }
      } else {
        const result = await api("/ai/invoice-draft/resolve", {
          businessId,
          draftId: suggestion.id,
        });
        if (g !== generation.current || snapshot !== latest.current) return;
        invoiceReviewResponse(result);
        if (JSON.stringify(result) !== JSON.stringify(suggestion))
          throw new Error(
            "The reviewed draft changed. Preview and review it again.",
          );
        if (applyCurrent.current(result, formIdentity) === false)
          throw new Error("The invoice changed. Start a fresh draft review.");
        setSuggestion(null);
        setReviewed(false);
        setConsent(false);
      }
    } catch (e) {
      if (g === generation.current && snapshot === latest.current) {
        setError(
          (e instanceof SyntaxError
            ? "Could not read the draft response. Your invoice is unchanged."
            : e.message) ||
            "Could not prepare this draft. Your invoice is unchanged.",
        );
        setPreview(null);
        setSuggestion(null);
        setConsent(false);
        setReviewed(false);
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <details
      className="glass-panel p-4 mb-4 ai-invoice-draft"
      onToggle={(e) => {
        setOpened(e.currentTarget.open);
      }}
    >
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>
        Draft an invoice with AI
      </summary>
      <p className="text-muted" style={{ fontSize: 13 }}>
        Describe a saved client, products and quantities. Review the draft here,
        apply it to the editor, then save when ready.
      </p>
      {disabled ? (
        <p role="status" className="text-muted">
          Start with a blank, unsaved INR tax invoice using tax-exclusive
          prices. Existing entries stay available for manual editing.
        </p>
      ) : (
        <>
          <label className="form-label">
            Invoice request
            <textarea
              className="form-input"
              aria-label="AI invoice request"
              rows={3}
              maxLength={1200}
              value={instruction}
              disabled={busy}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Create an invoice for Ananya Traders: 3 office notebooks and 2 desk organisers."
            />
          </label>
          <label className="form-label">
            ChatGPT model
            <select
              className="form-input"
              aria-label="Invoice draft model"
              value={model}
              disabled={busy}
              onChange={(e) => setModel(e.target.value)}
            >
              <option value="">Select a model</option>
              {models.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name || item.id}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy || !instruction.trim() || !businessId || !model}
            onClick={() => run("preview")}
          >
            Preview draft context
          </button>
          {preview && (
            <section
              aria-label="Invoice data to share"
              style={{ marginTop: 12 }}
            >
              <p className="text-muted" style={{ fontSize: 12 }}>
                Matched locally. Only this request and the displayed catalog
                names are shared. Saved contact details, GSTINs, prices and tax
                rates are excluded. Information you type in the request is
                shared.
              </p>
              <details open>
                <summary>Review data to share</summary>
                <pre
                  style={{
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                    maxHeight: 240,
                    overflow: "auto",
                    fontSize: 12,
                  }}
                >
                  {JSON.stringify(preview.context, null, 2)}
                </pre>
              </details>
              {!preview.canGenerate && <p role="status">{preview.message}</p>}
              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  fontSize: 12,
                  margin: "12px 0",
                }}
              >
                <input
                  type="checkbox"
                  checked={consent}
                  disabled={busy || !preview.canGenerate}
                  onChange={(e) => setConsent(e.target.checked)}
                />{" "}
                Share the displayed request and catalog names with ChatGPT for
                this draft
              </label>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy || !consent || !model || !preview.canGenerate}
                onClick={() => run("generate")}
              >
                Generate invoice draft
              </button>
            </section>
          )}
          {suggestion && (
            <section
              aria-label="Suggested invoice draft"
              style={{ marginTop: 16, overflowWrap: "anywhere" }}
            >
              <h4 style={{ margin: "0 0 8px" }}>Review invoice draft</h4>
              <strong>
                {suggestion.client?.name || "Client needs clarification"}
              </strong>
              {suggestion.client && (
                <p className="text-muted" style={{ fontSize: 12 }}>
                  {[
                    suggestion.client.address,
                    suggestion.client.city,
                    suggestion.client.state,
                    suggestion.client.gstin,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
              <ul style={{ listStyle: "none", padding: 0, margin: "12px 0" }}>
                {suggestion.items.map((item) => (
                  <li
                    key={item.productId}
                    style={{
                      padding: "10px 0",
                      borderBottom: "1px solid var(--border-color)",
                    }}
                  >
                    <strong>{item.name}</strong>
                    <div style={{ fontSize: 12 }}>
                      {item.quantity} {item.unit} ×{" "}
                      {formatCurrency(item.rate, "INR")} · GST {item.taxPercent}
                      % · Cess {item.cessPercent}%
                    </div>
                    {item.hsn && (
                      <div className="text-muted" style={{ fontSize: 12 }}>
                        HSN/SAC {item.hsn}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              {suggestion.clarifications.length > 0 && (
                <div role="status">
                  <strong>Clarify before applying</strong>
                  <ul>
                    {suggestion.clarifications.map((question, index) => (
                      <li key={index}>{question}</li>
                    ))}
                  </ul>
                  <p>
                    Edit your request and preview it again, or enter the invoice
                    manually.
                  </p>
                </div>
              )}
              <p className="text-muted" style={{ fontSize: 12 }}>
                Prices, GST and cess come from saved products. The invoice
                editor calculates all totals using its current settings. No
                invoice has been saved.
              </p>
              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  fontSize: 12,
                  margin: "12px 0",
                }}
              >
                <input
                  type="checkbox"
                  checked={reviewed}
                  disabled={busy || !suggestion.canApply}
                  onChange={(e) => setReviewed(e.target.checked)}
                />{" "}
                I reviewed the client, quantities, saved prices and tax rates
              </label>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !reviewed || !suggestion.canApply}
                onClick={() => run("apply")}
              >
                Apply reviewed invoice draft
              </button>
            </section>
          )}
        </>
      )}
      {busy && (
        <p role="status" style={{ fontSize: 12 }}>
          Preparing your draft…
        </p>
      )}
      {error && (
        <p role="alert">
          {error}{" "}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={loadModels}
            disabled={busy}
          >
            Retry connection
          </button>
        </p>
      )}
    </details>
  );
}
