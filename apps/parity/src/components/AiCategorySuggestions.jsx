import { useEffect, useRef, useState } from "react";
import { integrationRequest as api } from "../services/integrations";
import { getProfile } from "../store";
import { categoryLabels } from "../utils/ai-categories.mjs";

// Only draft category choices change here. Saving and posting remain separate actions.
export default function AiCategorySuggestions({
  kind,
  businessId,
  rows,
  onApply,
}) {
  const [models, setModels] = useState([]),
    [model, setModel] = useState("");
  const [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const generation = useRef(0),
    loadingModels = useRef(false),
    inFlight = useRef(false);
  // A category applied to one row must not discard other reviewed suggestions.
  const identity = JSON.stringify({
    businessId,
    kind,
    model,
    rows: rows.map(({ category: _category, ...row }) => row),
  });
  const latest = useRef(identity),
    currentRows = useRef(rows),
    currentApply = useRef(onApply);
  latest.current = identity;
  currentRows.current = rows;
  currentApply.current = onApply;
  useEffect(() => {
    generation.current++;
    setConsent(false);
    setResult(null);
    setError("");
  }, [identity]);
  const selectedData = JSON.stringify(rows);
  useEffect(() => {
    setConsent(false);
  }, [selectedData]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const labels = categoryLabels(kind);
  const invalid =
    !businessId ||
    !rows.length ||
    rows.length > 10 ||
    rows.some(
      (row) =>
        typeof row.description !== "string" ||
        !row.description.trim() ||
        row.description.length > 400 ||
        !Number.isFinite(row.amount) ||
        row.amount < 0 ||
        row.amount > 1e12,
    );
  async function loadModels() {
    if (models.length || loadingModels.current) return;
    loadingModels.current = true;
    try {
      const list = await api("/chatgpt/models");
      setModels(list);
      setModel(list[0]?.id || "");
      setError("");
    } catch (e) {
      setError(
        e.message || "Connect ChatGPT in Settings to request suggestions.",
      );
    } finally {
      loadingModels.current = false;
    }
  }
  async function suggest() {
    if (!consent || !model || invalid || inFlight.current) return;
    const g = generation.current,
      snapshot = identity,
      originals = rows.map((row) => ({ ...row }));
    inFlight.current = true;
    setBusy(true);
    setError("");
    setResult(null);
    setConsent(false);
    try {
      const [profile, status] = await Promise.all([getProfile(), api()]);
      if (profile?.id !== businessId)
        throw new Error("Business changed. Reopen this form before using AI.");
      if (g !== generation.current || snapshot !== latest.current) return;
      const response = await api("/ai/categorize", {
        kind,
        businessId,
        rows: originals,
        model,
        consent: true,
      });
      if (g === generation.current && snapshot === latest.current)
        setResult({
          ...response,
          originals,
          account: status.chatgpt.active,
          identity: snapshot,
        });
    } catch (e) {
      if (g === generation.current)
        setError(
          e.message ||
            "Could not prepare suggestions. Your categories are unchanged.",
        );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function apply(item) {
    if (
      !result ||
      inFlight.current ||
      busy ||
      item.category === null ||
      result.identity !== latest.current
    )
      return;
    const snapshot = result,
      g = generation.current;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const [profile, status] = await Promise.all([getProfile(), api()]);
      if (g !== generation.current || snapshot.identity !== latest.current)
        return;
      if (
        profile?.id !== businessId ||
        status.chatgpt.active !== snapshot.account
      )
        throw new Error(
          "Business or ChatGPT account changed. Request a new suggestion.",
        );
      const original = snapshot.originals.find((row) => row.id === item.id);
      const current = currentRows.current.find((row) => row.id === item.id);
      if (
        !original ||
        !current ||
        Object.entries(original).some(([key, value]) => current[key] !== value)
      )
        throw new Error(
          "This row changed. Request a new suggestion before applying.",
        );
      if (currentApply.current(item.id, item.category, original) === false)
        throw new Error(
          "This row changed. Request a new suggestion before applying.",
        );
      setResult(
        (prev) =>
          prev && {
            ...prev,
            suggestions: prev.suggestions.filter((row) => row.id !== item.id),
          },
      );
    } catch (e) {
      if (g === generation.current) setError(e.message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <details
      className="ai-category-suggestions"
      onToggle={(e) => {
        if (e.currentTarget.open) loadModels();
      }}
      style={{
        margin: "16px 0",
        borderTop: "1px solid var(--border-color)",
        paddingTop: 12,
      }}
    >
      <summary style={{ cursor: "pointer" }}>
        Suggest categories with ChatGPT
      </summary>
      <p className="text-muted" style={{ fontSize: 13 }}>
        Choose up to 10 rows and review each suggestion. Applying changes a
        draft category; saving or pushing to the calculator remains your next
        step.
      </p>
      <label>
        ChatGPT model
        <select
          className="form-input"
          aria-label="Category suggestion model"
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
      <details>
        <summary>Preview selected data ({rows.length} rows)</summary>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            maxHeight: 200,
            overflow: "auto",
            fontSize: 12,
          }}
        >
          {JSON.stringify(rows, null, 2)}
        </pre>
      </details>
      <p className="text-muted" style={{ fontSize: 12 }}>
        Only the shown descriptions, amounts, currencies, directions and
        categories are shared. Descriptions may contain personal details.
        Suggestions do not establish tax eligibility.
      </p>
      <label style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <input
          type="checkbox"
          checked={consent}
          disabled={busy || invalid}
          onChange={(e) => setConsent(e.target.checked)}
        />{" "}
        Share these selected rows with ChatGPT for one category suggestion
      </label>
      {invalid && (
        <p role="status">
          Select 1–10 rows with descriptions of up to 400 characters and valid
          amounts.
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
      <button
        type="button"
        className="btn btn-secondary"
        disabled={busy || invalid || !consent || !model}
        onClick={suggest}
      >
        {busy ? "Working…" : "Suggest selected categories"}
      </button>
      {result?.suggestions.map((item) => (
        <section
          key={item.id}
          aria-label="Category suggestion"
          style={{
            marginTop: 12,
            padding: 12,
            border: "1px solid var(--border-color)",
            borderRadius: 6,
            overflowWrap: "anywhere",
          }}
        >
          <div className="text-muted" style={{ fontSize: 12 }}>
            {result.originals.find((row) => row.id === item.id)?.description}
          </div>
          <strong>
            {item.category === null
              ? "Needs your review"
              : labels[item.category]}
          </strong>
          <p style={{ fontSize: 13 }}>{item.reason}</p>
          {item.category !== null && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busy}
              onClick={() => apply(item)}
            >
              Apply category
            </button>
          )}
        </section>
      ))}
    </details>
  );
}
