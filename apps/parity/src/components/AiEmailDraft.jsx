import { useEffect, useRef, useState } from "react";
import { integrationRequest as api } from "../services/integrations";

// Suggestions never modify a draft until the user explicitly applies them.
export default function AiEmailDraft({
  context,
  disabled,
  onApply,
  onBusyChange,
}) {
  const [purpose, setPurpose] = useState("document"),
    [models, setModels] = useState([]),
    [model, setModel] = useState("");
  const [consent, setConsent] = useState(false),
    [suggestion, setSuggestion] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0),
    loaded = useRef(false),
    inFlight = useRef(false),
    mounted = useRef(true);
  const identity = JSON.stringify({ ...context, purpose, model });
  const latest = useRef(identity);
  latest.current = identity;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  useEffect(() => {
    generation.current++;
    setConsent(false);
    setSuggestion(null);
    setError("");
  }, [identity, disabled]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      generation.current++;
      mounted.current = false;
    };
  }, []);
  async function loadModels() {
    if (loaded.current) return;
    loaded.current = true;
    try {
      const list = await api("/chatgpt/models");
      if (mounted.current) {
        setModels(list);
        setModel(list[0]?.id || "");
      }
    } catch (e) {
      if (mounted.current) {
        setError(e.message);
        loaded.current = false;
      }
    }
  }
  const preview = {
    kind: context.kind,
    reference: context.reference,
    senderName: context.senderName || "",
    purpose,
    subject: context.subject,
    message: context.message,
  };
  const tooLong = context.message.length > 4000;
  async function generate() {
    if (disabled || inFlight.current || !consent || !model || tooLong) return;
    const g = generation.current,
      snapshot = identity;
    inFlight.current = true;
    setBusy(true);
    onBusyChange(true);
    setError("");
    setSuggestion(null);
    setConsent(false);
    try {
      const current = await api();
      if (
        (current.resend?.from || "") !== context.senderFrom ||
        (current.resend?.name || "") !== context.senderName
      )
        throw new Error(
          "Sender settings changed. Close and reopen this email before generating a draft.",
        );
      if (
        g !== generation.current ||
        snapshot !== latest.current ||
        disabledRef.current
      )
        return;
      const result = await api("/ai/email-draft", {
        ...preview,
        model,
        consent: true,
      });
      const latestStatus = await api();
      if (
        (latestStatus.resend?.from || "") !== context.senderFrom ||
        (latestStatus.resend?.name || "") !== context.senderName ||
        latestStatus.chatgpt?.active !== current.chatgpt?.active
      )
        throw new Error(
          "Sender or ChatGPT account changed. Review the context and generate again.",
        );
      if (
        g === generation.current &&
        snapshot === latest.current &&
        !disabledRef.current
      )
        setSuggestion({
          ...result,
          identity: snapshot,
          account: current.chatgpt?.active,
        });
    } catch (e) {
      if (g === generation.current && snapshot === latest.current)
        setError(
          e.message ||
            "Could not prepare a suggestion. Your current draft is unchanged.",
        );
    } finally {
      inFlight.current = false;
      if (mounted.current) {
        setBusy(false);
        onBusyChange(false);
      }
    }
  }
  async function apply() {
    if (
      disabled ||
      busy ||
      inFlight.current ||
      !suggestion ||
      suggestion.identity !== latest.current
    )
      return;
    const snapshot = suggestion.identity,
      g = generation.current;
    inFlight.current = true;
    setBusy(true);
    onBusyChange(true);
    setError("");
    try {
      const current = await api();
      if (
        (current.resend?.from || "") !== context.senderFrom ||
        (current.resend?.name || "") !== context.senderName ||
        current.chatgpt?.active !== suggestion.account
      )
        throw new Error(
          "Sender or ChatGPT account changed. Review the context and generate again.",
        );
      if (
        g !== generation.current ||
        snapshot !== latest.current ||
        disabledRef.current
      )
        return;
      onApply({ subject: suggestion.subject, message: suggestion.message });
      setSuggestion(null);
      setConsent(false);
    } catch (e) {
      if (g === generation.current) {
        setError(e.message);
        setSuggestion(null);
        setConsent(false);
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) {
        setBusy(false);
        onBusyChange(false);
      }
    }
  }
  return (
    <details
      className="ai-email-draft"
      onToggle={(e) => {
        if (e.currentTarget.open) loadModels();
      }}
      style={{
        margin: "16px 0",
        borderTop: "1px solid var(--border-color)",
        paddingTop: 12,
      }}
    >
      <summary style={{ cursor: "pointer" }}>Draft with ChatGPT</summary>
      <p style={{ fontSize: 13 }}>
        Review a suggestion before applying it. Sending remains a separate
        action.
      </p>
      <label>
        Draft purpose
        <select
          className="form-input"
          aria-label="Email draft purpose"
          disabled={disabled || busy}
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
        >
          <option value="document">Document delivery</option>
          <option value="reminder">Payment follow-up</option>
        </select>
      </label>
      <label>
        ChatGPT model
        <select
          className="form-input"
          aria-label="Email draft model"
          disabled={disabled || busy}
          value={model}
          onChange={(e) => {
            setModel(e.target.value);
            setConsent(false);
          }}
        >
          <option value="">Select a model</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <details>
        <summary>Preview what will be shared</summary>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            maxHeight: 200,
            overflow: "auto",
            fontSize: 12,
          }}
        >
          {JSON.stringify(preview, null, 2)}
        </pre>
      </details>
      <p style={{ fontSize: 12 }}>
        The shown document reference, sender name, subject and message go to
        ChatGPT. The PDF and recipient address are not added to this request;
        any private details already written in your message will be shared.
      </p>
      <label style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <input
          type="checkbox"
          disabled={disabled || busy}
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />{" "}
        Share this email context with ChatGPT for one suggestion
      </label>
      {tooLong && (
        <p role="alert">
          Shorten the current message to 4,000 characters before requesting an
          AI draft.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <button
        type="button"
        className="btn btn-secondary"
        disabled={disabled || busy || !consent || !model || tooLong}
        onClick={generate}
      >
        {busy ? "Preparing suggestion…" : "Generate email suggestion"}
      </button>
      {suggestion && (
        <section
          aria-label="Suggested email"
          style={{
            marginTop: 16,
            padding: 12,
            border: "1px solid var(--border-color)",
            borderRadius: 6,
          }}
        >
          <strong>{suggestion.subject}</strong>
          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {suggestion.message}
          </p>
          <p style={{ fontSize: 12 }}>
            Check names, amounts and payment details before applying.
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={disabled || busy}
            onClick={apply}
          >
            Apply suggested draft
          </button>
        </section>
      )}
    </details>
  );
}
