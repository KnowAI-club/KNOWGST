import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  FileText,
  Plus,
  ArrowLeft,
  Check,
  Printer,
  Moon,
  Sun,
} from "lucide-react";
import {
  calculateInvoice,
  formatMinor,
  type Invoice,
  type InvoiceInput,
  type Snapshot,
} from "@know-gst/domain/invoicing";

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    `/api/v1${path}`,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify(body),
        },
  );
  const value = await response.json();
  if (!response.ok)
    throw new Error(
      value.fields
        ?.map(
          (f: { field: string; message: string }) => `${f.field}: ${f.message}`,
        )
        .join("; ") ||
        value.message ||
        "Request failed",
    );
  return value as T;
}
const today = () => new Date().toLocaleDateString("en-CA");
const blankLine = () => ({
  description: "",
  quantity: "1",
  unitPrice: "0",
  gstRate: "18",
});
export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"list" | "new" | "detail">("list");
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [dark, setDark] = useState(false);
  const [notice, setNotice] = useState("");
  const load = async () => setSnapshot(await request<Snapshot>("/workspace"));
  useEffect(() => {
    load().catch((e) => setError(String(e.message)));
  }, []);
  async function act(task: () => Promise<void>) {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await task();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again");
    } finally {
      setBusy(false);
    }
  }
  const issued = snapshot?.invoices.filter((i) => i.status === "issued") ?? [];
  const outstanding = issued
    .reduce(
      (sum, i) => sum + BigInt(i.calculation.totals.total) - BigInt(i.paid),
      0n,
    )
    .toString();
  const collected = issued
    .reduce((sum, i) => sum + BigInt(i.paid), 0n)
    .toString();
  return (
    <div className="app-shell" data-theme={dark ? "dark" : "light"}>
      <aside className="sidebar" aria-label="Primary navigation">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView("list");
          }}
        >
          <span className="brand-symbol">K</span>KNOW
          <span className="brand-gst">GST</span>
        </a>
        <div className="business-label">
          <span className="avatar">
            {snapshot?.business?.name.slice(0, 1) ?? "K"}
          </span>
          <div>
            <strong>{snapshot?.business?.name ?? "Your business"}</strong>
            <small>Local workspace</small>
          </div>
        </div>
        <nav>
          <button className="nav-item active" onClick={() => setView("list")}>
            <FileText size={18} />
            Invoices
          </button>
        </nav>
        <div className="sidebar-bottom">
          <span className="local-dot" />
          Saved on this device
          <button
            aria-label={dark ? "Use light theme" : "Use dark theme"}
            onClick={() => setDark(!dark)}
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </aside>
      <main>
        <div className="prototype-banner">
          Development preview · Use test data only. GST compliance and feature
          parity are still being implemented.
        </div>
        {error && (
          <div role="alert" className="error">
            {error}
            <button onClick={() => act(load)} disabled={busy}>
              Refresh
            </button>
          </div>
        )}
        {notice && (
          <p role="status" className="notice">
            <Check size={16} />
            {notice}
          </p>
        )}
        {!snapshot ? (
          <p role="status" className="loading">
            Opening your workspace…
          </p>
        ) : !snapshot.business ? (
          <section className="setup panel">
            <span className="eyebrow">Welcome to KNOWGST</span>
            <h1>Start with your business.</h1>
            <p className="muted">
              Create a local workspace to try your first invoice.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                void act(async () => {
                  await request("/business", {
                    name: data.get("name"),
                    address: data.get("address"),
                  });
                });
              }}
            >
              <Field label="Business name">
                <input
                  name="name"
                  required
                  maxLength={160}
                  autoComplete="organization"
                />
              </Field>
              <Field label="Business address">
                <textarea name="address" required maxLength={500} />
              </Field>
              <button className="primary" disabled={busy}>
                {busy ? "Creating…" : "Create workspace"}
              </button>
            </form>
          </section>
        ) : (
          <>
            {view === "list" && (
              <div className="page">
                <header>
                  <div>
                    <span className="eyebrow">Sales</span>
                    <h1>Invoices</h1>
                    <p className="muted">
                      Your invoices and payments, in one place.
                    </p>
                  </div>
                  <button className="primary" onClick={() => setView("new")}>
                    <Plus size={17} />
                    New invoice
                  </button>
                </header>
                <section className="metrics" aria-label="Invoice summary">
                  <Metric
                    label="Outstanding"
                    value={formatMinor(outstanding)}
                  />
                  <Metric label="Collected" value={formatMinor(collected)} />
                  <Metric
                    label="Drafts"
                    value={String(
                      snapshot.invoices.filter((i) => i.status === "draft")
                        .length,
                    )}
                  />
                </section>
                <section className="panel invoice-list">
                  <div className="panel-heading">
                    <h2>All invoices</h2>
                    <span className="muted">
                      {snapshot.invoices.length} records
                    </span>
                  </div>
                  {!snapshot.invoices.length ? (
                    <div className="empty">
                      <FileText size={32} />
                      <h2>Your first invoice starts here</h2>
                      <p className="muted">
                        Add a customer and line items. Review the totals before
                        issuing.
                      </p>
                      <button
                        className="secondary"
                        onClick={() => setView("new")}
                      >
                        Create an invoice
                      </button>
                    </div>
                  ) : (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Invoice</th>
                            <th>Customer</th>
                            <th>Date</th>
                            <th>Status</th>
                            <th className="numeric">Amount</th>
                            <th className="numeric">Outstanding</th>
                          </tr>
                        </thead>
                        <tbody>
                          {snapshot.invoices.map((i) => (
                            <tr key={i.id}>
                              <td>
                                <button
                                  className="text-button"
                                  onClick={() => {
                                    setSelected(i);
                                    setView("detail");
                                  }}
                                >
                                  {i.number ?? `Draft · ${i.id.slice(0, 6)}`}
                                </button>
                              </td>
                              <td>{i.calculation.customer}</td>
                              <td>{i.calculation.date}</td>
                              <td>
                                <span className={`badge ${i.status}`}>
                                  {i.status === "draft"
                                    ? "Draft"
                                    : i.paid === i.calculation.totals.total
                                      ? "Paid"
                                      : i.paid !== "0"
                                        ? "Part paid"
                                        : "Issued"}
                                </span>
                              </td>
                              <td className="numeric">
                                {formatMinor(i.calculation.totals.total)}
                              </td>
                              <td className="numeric">
                                {i.status === "draft"
                                  ? "—"
                                  : formatMinor(
                                      (
                                        BigInt(i.calculation.totals.total) -
                                        BigInt(i.paid)
                                      ).toString(),
                                    )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </div>
            )}
            {view === "new" && (
              <InvoiceEditor
                busy={busy}
                onBack={() => setView("list")}
                onSave={(input) =>
                  act(async () => {
                    const invoice = await request<Invoice>("/invoices", input);
                    setSelected(invoice);
                    setView("detail");
                    setNotice("Draft saved on this device");
                  })
                }
              />
            )}
            {view === "detail" && selected && (
              <div className="page">
                <header className="no-print">
                  <div>
                    <button className="back" onClick={() => setView("list")}>
                      <ArrowLeft size={16} />
                      Invoices
                    </button>
                    <h1>{selected.number ?? "Invoice draft"}</h1>
                    <p className="muted">
                      {selected.status === "draft"
                        ? "Review the details before issuing a test invoice."
                        : "Saved locally with a unique number and audit record."}
                    </p>
                  </div>
                  <button className="secondary" onClick={() => window.print()}>
                    <Printer size={16} />
                    Print preview
                  </button>
                </header>
                <div className="detail-grid">
                  <article className="panel paper">
                    <div className="paper-heading">
                      <div>
                        <span className="eyebrow">
                          {selected.status === "draft"
                            ? "Draft"
                            : selected.number}
                        </span>
                        <h2>{selected.business.name}</h2>
                        <p>{selected.business.address}</p>
                      </div>
                      <span className="badge">Test invoice</span>
                    </div>
                    <div className="bill-to">
                      <div>
                        <span className="eyebrow">Bill to</span>
                        <strong>{selected.calculation.customer}</strong>
                        <p>{selected.calculation.customerAddress}</p>
                      </div>
                      <div>
                        <span className="eyebrow">Issue date</span>
                        {selected.calculation.date}
                      </div>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Description</th>
                            <th>Qty</th>
                            <th className="numeric">Price</th>
                            <th className="numeric">GST</th>
                            <th className="numeric">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selected.calculation.lines.map((line, i) => (
                            <tr key={i}>
                              <td>{line.description}</td>
                              <td>{line.quantity}</td>
                              <td className="numeric">{line.unitPrice}</td>
                              <td className="numeric">{line.gstRate}%</td>
                              <td className="numeric">
                                {formatMinor(line.total)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <Totals calculation={selected.calculation} />
                    <p className="print-disclaimer">
                      DEVELOPMENT PREVIEW — NOT FOR TAX FILING OR CUSTOMER USE
                    </p>
                  </article>
                  <aside className="panel inspector no-print">
                    <h2>
                      {selected.status === "draft"
                        ? "Ready to issue?"
                        : "Payment summary"}
                    </h2>
                    <p className="muted">
                      {selected.status === "draft"
                        ? "Issuing reserves a number. This preview currently supports tax-exclusive INR lines only."
                        : "Record money received against this invoice."}
                    </p>
                    {selected.status === "draft" ? (
                      <button
                        disabled={busy}
                        className="primary"
                        onClick={() =>
                          act(async () => {
                            setSelected(
                              await request<Invoice>(
                                `/invoices/${selected.id}/issue`,
                                { version: selected.version },
                              ),
                            );
                            setNotice("Test invoice issued");
                          })
                        }
                      >
                        Issue test invoice
                      </button>
                    ) : (
                      <>
                        <div className="balance">
                          <span>Outstanding</span>
                          <strong>
                            {formatMinor(
                              (
                                BigInt(selected.calculation.totals.total) -
                                BigInt(selected.paid)
                              ).toString(),
                            )}
                          </strong>
                        </div>
                        {BigInt(selected.paid) <
                          BigInt(selected.calculation.totals.total) && (
                          <form
                            key={selected.version}
                            onSubmit={(e) => {
                              e.preventDefault();
                              const data = new FormData(e.currentTarget);
                              void act(async () => {
                                setSelected(
                                  await request<Invoice>(
                                    `/invoices/${selected.id}/payments`,
                                    {
                                      amount: data.get("amount"),
                                      date: data.get("date"),
                                      reference: data.get("reference"),
                                      version: selected.version,
                                    },
                                  ),
                                );
                                setNotice("Payment recorded");
                              });
                            }}
                          >
                            <Field label="Amount received (INR)">
                              <input
                                name="amount"
                                inputMode="decimal"
                                required
                              />
                            </Field>
                            <Field label="Payment date">
                              <input
                                name="date"
                                type="date"
                                defaultValue={today()}
                                required
                              />
                            </Field>
                            <Field label="Payment reference">
                              <input name="reference" maxLength={160} />
                            </Field>
                            <button className="primary" disabled={busy}>
                              Record payment
                            </button>
                          </form>
                        )}
                        <h3>Payment history</h3>
                        {selected.payments.length ? (
                          selected.payments.map((p) => (
                            <div className="payment" key={p.id}>
                              <strong>{formatMinor(p.amount)}</strong>
                              <small>
                                {p.date} · {p.reference || "No reference"}
                              </small>
                            </div>
                          ))
                        ) : (
                          <p className="muted">No payments recorded.</p>
                        )}
                      </>
                    )}
                  </aside>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function Totals({
  calculation,
}: {
  calculation: ReturnType<typeof calculateInvoice>;
}) {
  return (
    <dl className="totals">
      <div>
        <dt>Subtotal</dt>
        <dd>{formatMinor(calculation.totals.taxable)}</dd>
      </div>
      {(calculation.supply === "intra"
        ? (["cgst", "sgst"] as const)
        : (["igst"] as const)
      ).map((key) => (
        <div key={key}>
          <dt>{key.toUpperCase()}</dt>
          <dd>{formatMinor(calculation.totals[key])}</dd>
        </div>
      ))}
      <div className="grand-total">
        <dt>Total</dt>
        <dd>{formatMinor(calculation.totals.total)}</dd>
      </div>
    </dl>
  );
}
function InvoiceEditor({
  busy,
  onBack,
  onSave,
}: {
  busy: boolean;
  onBack: () => void;
  onSave: (input: InvoiceInput) => Promise<void>;
}) {
  const [input, setInput] = useState<InvoiceInput>({
    customer: "",
    customerAddress: "",
    date: today(),
    supply: "intra",
    lines: [blankLine()],
  });
  const [problem, setProblem] = useState("");
  let calculation: ReturnType<typeof calculateInvoice> | null = null;
  try {
    calculation = calculateInvoice({
      ...input,
      customer: input.customer || "Preview",
      customerAddress: input.customerAddress || "Preview",
      lines: input.lines.map((l) => ({
        ...l,
        description: l.description || "Item",
      })),
    });
  } catch {
    /* Incomplete forms have no authoritative total. */
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    try {
      calculateInvoice(input);
      setProblem("");
      void onSave(input);
    } catch {
      setProblem(
        "Check customer details, date and line amounts. Quantities must be positive; use up to two decimal places for prices and rates.",
      );
    }
  }
  return (
    <div className="page">
      <header>
        <div>
          <button className="back" onClick={onBack}>
            <ArrowLeft size={16} />
            Invoices
          </button>
          <h1>New invoice</h1>
          <p className="muted">Add the details. We’ll calculate as you go.</p>
        </div>
        <span className="badge">Draft</span>
      </header>
      <form onSubmit={submit} className="editor">
        <section className="panel form-section">
          <h2>Customer & details</h2>
          <div className="form-grid">
            <Field label="Customer name">
              <input
                required
                maxLength={160}
                value={input.customer}
                onChange={(e) =>
                  setInput({ ...input, customer: e.target.value })
                }
              />
            </Field>
            <Field label="Invoice date">
              <input
                type="date"
                required
                value={input.date}
                onChange={(e) => setInput({ ...input, date: e.target.value })}
              />
            </Field>
            <Field label="Customer address">
              <input
                required
                maxLength={500}
                value={input.customerAddress}
                onChange={(e) =>
                  setInput({ ...input, customerAddress: e.target.value })
                }
              />
            </Field>
            <Field label="Supply type">
              <select
                value={input.supply}
                onChange={(e) =>
                  setInput({
                    ...input,
                    supply: e.target.value as InvoiceInput["supply"],
                  })
                }
              >
                <option value="intra">Intra-state · CGST + SGST</option>
                <option value="inter">Inter-state · IGST</option>
              </select>
            </Field>
          </div>
        </section>
        <section className="panel form-section">
          <div className="panel-heading">
            <h2>Line items</h2>
            <span className="muted">INR · tax exclusive</span>
          </div>
          {input.lines.map((line, i) => (
            <fieldset className="line-editor" key={i}>
              <legend>Item {i + 1}</legend>
              {(
                ["description", "quantity", "unitPrice", "gstRate"] as const
              ).map((key, k) => (
                <Field
                  key={key}
                  label={
                    ["Description", "Quantity", "Unit price", "GST rate (%)"][
                      k
                    ]!
                  }
                >
                  <input
                    required
                    aria-label={`${["Description", "Quantity", "Unit price", "GST rate"][k]} ${i + 1}`}
                    inputMode={key === "description" ? "text" : "decimal"}
                    value={line[key]}
                    onChange={(e) =>
                      setInput({
                        ...input,
                        lines: input.lines.map((l, j) =>
                          j === i ? { ...l, [key]: e.target.value } : l,
                        ),
                      })
                    }
                  />
                </Field>
              ))}
              <button
                type="button"
                className="remove"
                disabled={input.lines.length === 1}
                aria-label={`Remove item ${i + 1}`}
                onClick={() =>
                  setInput({
                    ...input,
                    lines: input.lines.filter((_, j) => i !== j),
                  })
                }
              >
                ×
              </button>
            </fieldset>
          ))}
          <button
            className="text-button"
            type="button"
            disabled={input.lines.length >= 100}
            onClick={() =>
              setInput({ ...input, lines: [...input.lines, blankLine()] })
            }
          >
            <Plus size={16} />
            Add line item
          </button>
          <div className="editor-summary">
            {calculation ? (
              <Totals calculation={calculation} />
            ) : (
              <p className="muted">
                Complete valid quantities and prices to preview totals.
              </p>
            )}
          </div>
        </section>
        {problem && (
          <p role="alert" className="error">
            {problem}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="secondary" onClick={onBack}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save draft"}
          </button>
        </div>
      </form>
    </div>
  );
}
