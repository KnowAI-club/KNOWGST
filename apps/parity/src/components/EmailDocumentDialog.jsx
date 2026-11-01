import AiEmailDraft from "./AiEmailDraft";
import { useEffect, useRef, useState } from "react";
import {
  integrationRequest as api,
  pdfAttachment,
} from "../services/integrations";
export default function EmailDocumentDialog({ document, onClose }) {
  const [to, setTo] = useState(document.to || ""),
    [subject, setSubject] = useState(document.subject),
    [text, setText] = useState(document.text),
    [attachment, setAttachment] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [attempted, setAttempted] = useState(false),
    [accepted, setAccepted] = useState(false),
    [preview, setPreview] = useState(""),
    [sender, setSender] = useState(null),
    [aiBusy, setAiBusy] = useState(false);
  const requestId = useRef(crypto.randomUUID()),
    dialog = useRef(null),
    source = useRef(document);
  source.current = document;
  useEffect(() => {
    let alive = true,
      url;
    const previous = window.document.activeElement;
    dialog.current?.focus();
    setTo(document.to || "");
    setSubject(document.subject);
    setText(document.text);
    setAttachment(null);
    setPreview("");
    setSender(null);
    setError("");
    setAttempted(false);
    setAccepted(false);
    setAiBusy(false);
    setBusy(false);
    requestId.current = crypto.randomUUID();
    api()
      .then((s) => {
        if (alive) setSender(s.resend);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    document
      .buildPdf()
      .then(async (blob) => {
        const file = await pdfAttachment(blob, document.name);
        url = URL.createObjectURL(blob);
        if (alive) {
          setAttachment(file);
          setPreview(url);
        } else URL.revokeObjectURL(url);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
      previous?.focus?.();
    };
  }, [document]);
  async function send() {
    if (busy || aiBusy || accepted) return;
    const sendingDocument = document;
    setBusy(true);
    setAttempted(true);
    setError("");
    try {
      await api("/resend/send", {
        requestId: requestId.current,
        to,
        subject,
        text,
        attachment,
        expectedSender: sender?.from,
      });
      if (source.current === sendingDocument) setAccepted(true);
    } catch (e) {
      if (source.current === sendingDocument) setError(e.message);
    } finally {
      if (source.current === sendingDocument) setBusy(false);
    }
  }
  function keydown(e) {
    if (e.key === "Escape" && !busy) onClose();
    if (e.key === "Tab") {
      const elements = [
        ...dialog.current.querySelectorAll(
          "button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,a[href]",
        ),
      ];
      const first = elements[0],
        last = elements.at(-1);
      if (
        e.shiftKey &&
        (window.document.activeElement === first ||
          window.document.activeElement === dialog.current)
      ) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && window.document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  }
  return (
    <div className="modal-overlay">
      <div
        className="glass-panel email-document-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="email-document-title"
        ref={dialog}
        tabIndex={-1}
        onKeyDown={keydown}
      >
        <div className="integration-heading">
          <h3 id="email-document-title">Email {document.kind}</h3>
          <button
            className="btn btn-secondary"
            disabled={busy}
            onClick={onClose}
          >
            Close
          </button>
        </div>
        {accepted ? (
          <p role="status">
            Accepted by Resend. Check your Resend dashboard for delivery status.
          </p>
        ) : (
          <>
            <p>
              Review the PDF and recipient before sending through your
              configured Resend account.
            </p>
            <p>
              {sender?.configured
                ? `From: ${sender.name ? sender.name + " · " : ""}${sender.from}`
                : "Configure Resend in Settings → Integrations before sending."}
            </p>
            <label>
              Recipient email
              <input
                type="email"
                className="form-input"
                value={to}
                disabled={attempted}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
            <label>
              Subject
              <input
                className="form-input"
                maxLength={200}
                value={subject}
                disabled={attempted}
                onChange={(e) => setSubject(e.target.value)}
              />
            </label>
            <label>
              Message
              <textarea
                rows={5}
                className="form-input"
                maxLength={12000}
                value={text}
                disabled={attempted}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            {!attempted && (
              <AiEmailDraft
                context={{
                  kind: document.kind,
                  reference: document.name || "",
                  senderName: sender?.name || "",
                  senderFrom: sender?.from || "",
                  recipient: to,
                  subject,
                  message: text,
                  documentIdentity: JSON.stringify({
                    kind: document.kind,
                    name: document.name,
                    to: document.to,
                    subject: document.subject,
                    text: document.text,
                  }),
                }}
                disabled={attempted || busy || !sender}
                onBusyChange={setAiBusy}
                onApply={(draft) => {
                  setSubject(draft.subject);
                  setText(draft.message);
                }}
              />
            )}
            {attachment ? (
              <p>
                <a href={preview} download={attachment.filename}>
                  Review PDF · {attachment.filename}
                </a>
              </p>
            ) : (
              <p role="status">Preparing PDF…</p>
            )}
            {error && (
              <p role="alert" className="integration-error">
                {error}
              </p>
            )}
            {attempted && error && (
              <p>
                Retry keeps the same request ID to prevent duplicate emails.
                Check any unconfirmed request in Resend before starting another
                draft.
              </p>
            )}
            <button
              className="btn btn-primary"
              disabled={
                busy ||
                aiBusy ||
                !sender?.configured ||
                !attachment ||
                !to.trim() ||
                !subject.trim() ||
                !text.trim()
              }
              onClick={send}
            >
              {busy
                ? "Sending…"
                : attempted
                  ? "Retry same email"
                  : "Send email"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
