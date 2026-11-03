import { useEffect, useState } from "react";
import { integrationRequest as api } from "../services/integrations";
export default function IntegrationSettings() {
  const [status, setStatus] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [sender, setSender] = useState({ from: "", name: "", replyTo: "" }),
    [key, setKey] = useState(""),
    [models, setModels] = useState([]),
    [model, setModel] = useState(""),
    [prompt, setPrompt] = useState(""),
    [answer, setAnswer] = useState(""),
    [signInUrl, setSignInUrl] = useState("");
  async function load(initial = false) {
    try {
      const s = await api();
      setStatus(s);
      setSignInUrl(s.chatgpt.pending ? s.chatgpt.authorizationUrl || "" : "");
      if (initial)
        setSender({
          from: s.resend.from,
          name: s.resend.name,
          replyTo: s.resend.replyTo,
        });
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load(true);
  }, []);
  useEffect(() => {
    if (!status?.chatgpt.pending) return;
    const timer = setInterval(() => load(), 2000);
    return () => clearInterval(timer);
  }, [status?.chatgpt.pending]);
  async function run(fn) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const active = status?.chatgpt.accounts.find(
    (a) => a.clientId === status.chatgpt.active,
  );
  const unfinished = status?.chatgpt.unfinishedRegistrations || [];
  async function connect(clientId, newAccount) {
    const tab = navigator.userAgent.includes("Electron")
      ? null
      : window.open("about:blank", "_blank");
    await run(async () => {
      try {
        const r = await api("/chatgpt/start", { clientId, newAccount });
        setSignInUrl(r.url);
        if (tab) {
          tab.location.href = r.url;
        } else window.open(r.url, "_blank");
      } catch (e) {
        tab?.close();
        throw e;
      }
    });
  }
  return (
    <section
      id="section-integrations"
      className="glass-panel p-6 mb-6 integration-settings"
      style={{ order: 9 }}
    >
      <h3 className="section-title">Integrations</h3>
      <p className="page-subtitle">
        Connect ChatGPT for AI assistance and Resend for document emails.
        Connections apply to this device.
      </p>
      {error && (
        <p role="alert" className="integration-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!status ? (
        <button className="btn btn-secondary" onClick={() => load(true)}>
          Reload connections
        </button>
      ) : (
        <>
          <div className="integration-card">
            <div className="integration-heading">
              <h4>ChatGPT</h4>
              <span className="status-badge">
                {active?.connected ? "Connected" : "Not connected"}
              </span>
            </div>
            <p>
              Use your own eligible ChatGPT plan. Sign in in your browser and
              choose whether to authorize plan usage.
            </p>
            <div className="integration-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || status.chatgpt.pending}
                onClick={() => connect()}
              >
                Continue with ChatGPT
              </button>
              {(unfinished.length > 0 ||
                status.chatgpt.accounts.length > 0) && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy || status.chatgpt.pending}
                  onClick={() => connect(undefined, true)}
                >
                  Use another account or workspace
                </button>
              )}
              <a
                href="https://chatgpt.com/settings/usage"
                target="_blank"
                rel="noreferrer"
              >
                Manage ChatGPT usage
              </a>
              {status.chatgpt.pending && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => run(() => api("/chatgpt/cancel", {}))}
                >
                  Cancel sign-in
                </button>
              )}
            </div>
            {status.chatgpt.pending && (
              <p role="status">
                {status.chatgpt.notice ||
                  "Complete sign-in in your browser. This page updates automatically."}{" "}
                {signInUrl && (
                  <a href={signInUrl} target="_blank" rel="noreferrer">
                    Open sign-in browser
                  </a>
                )}
              </p>
            )}
            {status.chatgpt.error && <p role="alert">{status.chatgpt.error}</p>}
            {unfinished.length > 0 && (
              <details className="integration-assistant">
                <summary>Unfinished connections</summary>
                <p>
                  Continue with the account and workspace used for that
                  connection. To connect a different one, choose Use another
                  account or workspace above.
                </p>
                {unfinished.map((registration) => (
                  <div
                    className="integration-account"
                    key={registration.clientId}
                  >
                    <span>Connection {registration.clientId.slice(-8)}</span>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={busy || status.chatgpt.pending}
                      aria-label={`Resume connection ${registration.clientId.slice(-8)}`}
                      onClick={() => connect(registration.clientId)}
                    >
                      Resume connection
                    </button>
                  </div>
                ))}
              </details>
            )}
            {status.chatgpt.accounts.map((a, i) => (
              <div className="integration-account" key={a.clientId}>
                <span>
                  {a.email} · Connection {a.clientId.slice(-8)}
                  {a.clientId === status.chatgpt.active ? " · Active" : ""}
                  {a.connected && !a.planEnabled
                    ? " · Plan permission needed"
                    : ""}
                </span>
                <div className="integration-actions">
                  {a.connected && a.clientId !== status.chatgpt.active && (
                    <button
                      className="btn btn-secondary"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await api("/chatgpt/select", {
                            clientId: a.clientId,
                          });
                          setModels([]);
                          setAnswer("");
                        })
                      }
                    >
                      Use account
                    </button>
                  )}
                  <button
                    className="btn btn-secondary"
                    disabled={busy}
                    onClick={() => connect(a.clientId)}
                  >
                    Reconnect
                  </button>
                  {a.connected && (
                    <button
                      className="btn btn-secondary"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          const r = await api("/chatgpt/disconnect", {
                            clientId: a.clientId,
                          });
                          setModels([]);
                          setAnswer("");
                          setNotice(
                            r.revoked
                              ? "Signed out."
                              : "Signed out on this device. Remote revocation was not confirmed; disconnect KNOWGST in ChatGPT settings.",
                          );
                        })
                      }
                    >
                      Sign out
                    </button>
                  )}
                </div>
              </div>
            ))}
            {active?.connected && active.planEnabled && (
              <details className="integration-assistant">
                <summary>Ask ChatGPT</summary>
                <p>
                  Only the question you enter is sent to OpenAI. No business
                  records are attached automatically. Answers do not change your
                  books.
                </p>
                <button
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const list = await api("/chatgpt/models");
                      setModels(list);
                      setModel(list[0]?.id || "");
                    })
                  }
                >
                  Load available models
                </button>
                <label className="form-label">
                  Model
                  <select
                    className="form-input"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  >
                    <option value="">Choose a model</option>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-label">
                  Your question
                  <textarea
                    className="form-input"
                    rows={4}
                    maxLength={12000}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                </label>
                <button
                  className="btn btn-primary"
                  disabled={busy || !model || !prompt.trim()}
                  onClick={() =>
                    run(async () => {
                      setAnswer("");
                      const r = await api("/chatgpt/ask", { model, prompt });
                      setAnswer(r.text);
                    })
                  }
                >
                  {busy ? "Working…" : "Ask ChatGPT"}
                </button>
                {answer && (
                  <div className="integration-answer" role="status">
                    {answer}
                  </div>
                )}
              </details>
            )}
          </div>
          <div className="integration-card">
            <div className="integration-heading">
              <h4>Email with Resend</h4>
              <span className="status-badge">
                {status.resend.configured ? "Key saved" : "Not configured"}
              </span>
            </div>
            <p>
              Send invoices and payment receipts as PDF attachments from your
              verified email domain.
            </p>
            <div className="integration-grid">
              {[
                ["name", "Sender name"],
                ["from", "Sender email"],
                ["replyTo", "Reply-to email (optional)"],
              ].map(([name, label]) => (
                <label className="form-label" key={name}>
                  {label}
                  <input
                    className="form-input"
                    type={name === "name" ? "text" : "email"}
                    value={sender[name]}
                    onChange={(e) =>
                      setSender({ ...sender, [name]: e.target.value })
                    }
                  />
                </label>
              ))}
              <label className="form-label">
                Resend API key
                <input
                  type="password"
                  autoComplete="new-password"
                  className="form-input"
                  value={key}
                  placeholder={
                    status.resend.configured
                      ? "Saved · enter a new key to replace"
                      : "re_…"
                  }
                  onChange={(e) => setKey(e.target.value)}
                />
              </label>
            </div>
            <p className="field-hint">
              Use a sending-access key for your verified domain. Saved keys are
              never returned to this page. Credentials stay in protected local
              storage and are excluded from portable backups.
            </p>
            <div className="integration-actions">
              <button
                className="btn btn-primary"
                disabled={busy || (!key && !status.resend.configured)}
                onClick={() =>
                  run(async () => {
                    await api("/resend", {
                      ...sender,
                      ...(key ? { apiKey: key.trim() } : {}),
                    });
                    setKey("");
                    setNotice(
                      "Email settings saved. Send a document to verify delivery.",
                    );
                  })
                }
              >
                Save email settings
              </button>
              {status.resend.configured && (
                <button
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api("/resend/disconnect", {});
                      setKey("");
                    })
                  }
                >
                  Remove API key
                </button>
              )}
              <a
                href="https://resend.com/api-keys"
                target="_blank"
                rel="noreferrer"
              >
                Get a Resend key
              </a>
              <a
                href="/docs/?topic=integrations"
                target="_blank"
                rel="noreferrer"
              >
                Setup guide
              </a>
            </div>
            {status.resend.recent.length > 0 && (
              <details>
                <summary>Recent email requests</summary>
                {status.resend.recent.map((r, i) => (
                  <p key={i}>
                    {r.to} · {r.subject} ·{" "}
                    {r.status === "accepted" ? "Accepted by Resend" : r.status}{" "}
                    · {new Date(r.created).toLocaleString()}
                  </p>
                ))}
                <p>
                  Accepted means queued by Resend, not confirmed delivery. Check
                  the Resend dashboard for delivery and bounces.
                </p>
              </details>
            )}
          </div>
          <p className="field-hint">
            Integration changes save separately from the business profile.
            Reconnect integrations after moving to another device.
          </p>
        </>
      )}
    </section>
  );
}
