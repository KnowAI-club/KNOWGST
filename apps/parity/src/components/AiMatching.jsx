import { useEffect, useRef, useState } from "react";
import { integrationRequest as api } from "../services/integrations";
import { parseBankReviewCsv, bankReviewCsv } from "../utils/ai-bank-import.mjs";
import { confirmAction } from "./ConfirmModal";
import "./ai-review-workflows.css";

const normalize = (value) =>
  String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
const emptyRule = {
  contains: "",
  direction: "debit",
  currency: "INR",
  category: "business_out",
  account: null,
  partyId: null,
};
const amount = (minor, currency) =>
  `${currency} ${(minor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export default function AiMatching({ activeProfile, model }) {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [accountLabel, setAccountLabel] = useState(""),
    [currency, setCurrency] = useState("INR"),
    [rows, setRows] = useState(null),
    [filename, setFilename] = useState("");
  const [preview, setPreview] = useState(null),
    [duplicates, setDuplicates] = useState("skip"),
    [importReviewed, setImportReviewed] = useState(false);
  const [selected, setSelected] = useState([]),
    [rule, setRule] = useState(emptyRule),
    [page, setPage] = useState(0);
  const [aiPreview, setAiPreview] = useState(null),
    [consent, setConsent] = useState(false),
    [suggestions, setSuggestions] = useState(null),
    [reviewed, setReviewed] = useState(false);
  const generation = useRef(0),
    lock = useRef(false),
    latestModel = useRef(model);
  latestModel.current = model;
  const businessId = activeProfile?.id;
  useEffect(() => {
    const version = ++generation.current;
    setData(null);
    setRows(null);
    setFilename("");
    setPreview(null);
    setSelected([]);
    setAiPreview(null);
    setSuggestions(null);
    setConsent(false);
    setError("");
    setRule(emptyRule);
    setAccountLabel("");
    setPage(0);
    if (businessId)
      api("/ai/matching/list", { businessId })
        .then((result) => {
          if (version === generation.current) setData(result);
        })
        .catch((e) => {
          if (version === generation.current) setError(e.message);
        });
    return () => {
      generation.current++;
    };
  }, [businessId]);
  useEffect(() => {
    setAiPreview(null);
    setSuggestions(null);
    setConsent(false);
  }, [model]);
  function accept(result) {
    setData(result);
    setAiPreview(null);
    setSuggestions(null);
    setSelected([]);
    setConsent(false);
  }
  async function run(handler, body, done = accept) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const version = generation.current,
      chosenModel = model;
    try {
      const result = await api("/ai/matching/" + handler, {
        businessId,
        ...body,
      });
      if (version === generation.current && chosenModel === latestModel.current)
        done(result);
    } catch (e) {
      if (version === generation.current) setError(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function loadFile(event) {
    const file = event.target.files?.[0],
      version = generation.current;
    event.target.value = "";
    if (!file) return;
    setError("");
    setPreview(null);
    setRows(null);
    setFilename("");
    try {
      if (file.size > 500000)
        throw new Error("Choose a CSV smaller than 500 KB.");
      const parsed = parseBankReviewCsv(await file.text());
      if (version === generation.current) {
        setRows(parsed);
        setFilename(file.name);
      }
    } catch (e) {
      if (version === generation.current) setError(e.message);
    }
  }
  const statements = data?.data.statements || [],
    rules = data?.data.rules || [];
  const allRows = statements.flatMap((statement) =>
    statement.rows.map((row) => ({
      ...row,
      accountLabel: statement.accountLabel,
      currency: statement.currency,
    })),
  );
  const visible = allRows.slice(page * 50, page * 50 + 50);
  const matches = (row) =>
    rules.filter(
      (item) =>
        item.currency === row.currency &&
        item.direction === row.direction &&
        normalize(row.description).includes(item.contains),
    );
  const canApplyRules =
    selected.length > 0 &&
    selected.every(
      (id) => matches(allRows.find((row) => row.id === id)).length === 1,
    );
  const importingRows =
    preview?.rows.filter((row) => duplicates === "keep" || !row.duplicate) ||
    [];
  const importingTotal = (direction) =>
    importingRows
      .filter((row) => row.direction === direction)
      .reduce((sum, row) => sum + row.amountMinor, 0);
  const toggle = (id) => {
    setSelected((previous) =>
      previous.includes(id)
        ? previous.filter((value) => value !== id)
        : [...previous, id],
    );
    setAiPreview(null);
    setSuggestions(null);
    setConsent(false);
  };
  function download() {
    const blob = new Blob(
      [bankReviewCsv(statements, data.categories, data.parties, data.accounts)],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = "knowgst-bank-review.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="ai-review-workflow ai-matching">
      {error && <div role="alert">{error}</div>}
      <section aria-label="Bank statement import">
        <h3>Bank matching review</h3>
        <p>
          Keep statement rows and reviewed classifications on this device. This
          workspace does not reconcile a bank account or post entries to your
          books.
        </p>
        <div className="ai-review-fields">
          <label>
            Account nickname
            <input
              className="form-input"
              maxLength={80}
              disabled={busy}
              placeholder="Business current account"
              value={accountLabel}
              onChange={(e) => {
                setAccountLabel(e.target.value);
                setPreview(null);
              }}
            />
          </label>
          <label>
            Statement currency
            <input
              className="form-input"
              maxLength={3}
              disabled={busy}
              value={currency}
              onChange={(e) => {
                setCurrency(e.target.value.toUpperCase());
                setPreview(null);
              }}
            />
          </label>
          <label>
            Statement CSV
            <input
              className="form-input"
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              onChange={loadFile}
            />
          </label>
        </div>
        <p>
          Columns: date, description, amount, direction, reference (optional).
          Use YYYY-MM-DD dates, positive amounts, and debit or credit. Up to 500
          rows per import.
        </p>
        {rows && (
          <p>
            {filename} · {rows.length} rows ready to preview
          </p>
        )}
        <button
          className="btn btn-secondary"
          disabled={busy || !businessId || !rows || !accountLabel.trim()}
          onClick={() =>
            run("previewImport", { accountLabel, currency, rows }, (result) => {
              setPreview(result);
              setImportReviewed(false);
            })
          }
        >
          Preview import
        </button>
        {preview && (
          <>
            <p>
              <strong>{preview.rows.length} source rows</strong> · Debit{" "}
              {amount(preview.debitMinor, preview.currency)} · Credit{" "}
              {amount(preview.creditMinor, preview.currency)} ·{" "}
              {preview.duplicateCount} possible duplicates
            </p>
            <label>
              Possible duplicates
              <select
                aria-label="Possible duplicates"
                className="form-input"
                disabled={busy}
                value={duplicates}
                onChange={(e) => {
                  setDuplicates(e.target.value);
                  setImportReviewed(false);
                }}
              >
                <option value="skip">Skip possible duplicates</option>
                <option value="keep">
                  Keep them as separate real transactions
                </option>
              </select>
            </label>
            <p>
              Will import {importingRows.length} rows · Debit{" "}
              {amount(importingTotal("debit"), preview.currency)} · Credit{" "}
              {amount(importingTotal("credit"), preview.currency)}
            </p>
            <details>
              <summary>Review imported rows</summary>
              <div className="ai-review-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description</th>
                      <th>Direction</th>
                      <th>Amount</th>
                      <th>Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => (
                      <tr key={row.id}>
                        <td>{row.date}</td>
                        <td>{row.description}</td>
                        <td>{row.direction}</td>
                        <td>{amount(row.amountMinor, preview.currency)}</td>
                        <td>
                          {row.duplicate ? "Possible duplicate" : "New row"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
            <label className="ai-review-check">
              <input
                type="checkbox"
                disabled={busy}
                checked={importReviewed}
                onChange={(e) => setImportReviewed(e.target.checked)}
              />
              I checked the dates, totals and duplicate handling
            </label>
            <button
              className="btn btn-primary"
              disabled={busy || !importReviewed || !importingRows.length}
              onClick={() =>
                run(
                  "importStatement",
                  { ticketId: preview.ticketId, duplicates, confirm: true },
                  (result) => {
                    accept(result);
                    setPreview(null);
                    setRows(null);
                    setFilename("");
                  },
                )
              }
            >
              Import review rows
            </button>
          </>
        )}
      </section>
      <section aria-label="Statement classifications">
        <h3>Statement rows</h3>
        <p>
          {allRows.length} rows across {statements.length} statements ·{" "}
          {selected.length} selected
        </p>
        {statements.length > 0 && (
          <details>
            <summary>Manage imported statements</summary>
            <ul className="ai-review-list">
              {statements.map((statement) => (
                <li key={statement.id}>
                  {statement.accountLabel} · {statement.currency} ·{" "}
                  {statement.rows.length} rows
                  <div className="ai-review-actions">
                    <button
                      className="btn btn-secondary"
                      disabled={busy}
                      onClick={async () => {
                        if (
                          await confirmAction({
                            title: "Remove this statement review?",
                            message:
                              "Its imported rows and classifications will be removed from this review workspace. Saved invoices, receipts and journals are unaffected. Export the reviewed CSV first if you need a copy.",
                            confirmLabel: "Remove statement",
                          })
                        )
                          run(
                            "removeStatement",
                            {
                              revision: data.revision,
                              id: statement.id,
                              confirm: true,
                            },
                            (result) => {
                              accept(result);
                              setPage(0);
                            },
                          );
                      }}
                    >
                      Remove statement review
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className="ai-review-actions">
          <button
            className="btn btn-secondary"
            disabled={busy || !allRows.length}
            onClick={download}
          >
            Export reviewed CSV
          </button>
          <button
            className="btn btn-secondary"
            disabled={busy || !selected.length || selected.length > 10}
            onClick={() =>
              run("previewClassification", { rowIds: selected }, (result) => {
                setAiPreview(result);
                setConsent(false);
                setSuggestions(null);
              })
            }
          >
            Preview AI matching
          </button>
          <button
            className="btn btn-secondary"
            disabled={busy || !canApplyRules}
            onClick={() =>
              run("applyRule", {
                revision: data.revision,
                rowIds: selected,
                confirm: true,
              })
            }
          >
            Confirm matching rules
          </button>
          <button
            className="btn btn-secondary"
            disabled={busy || !selected.length}
            onClick={() => {
              setSelected([]);
              setAiPreview(null);
              setSuggestions(null);
            }}
          >
            Clear selection
          </button>
        </div>
        <p>
          AI reviews up to 10 selected rows. Rules apply only when exactly one
          saved rule matches; overlapping rules need review.
        </p>
        <div className="ai-review-scroll">
          <table>
            <thead>
              <tr>
                <th>Select</th>
                <th>Date / account</th>
                <th>Description</th>
                <th>Amount</th>
                <th>Classification</th>
                <th>Matching rule</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const matched = matches(row);
                return (
                  <tr key={row.id}>
                    <td>
                      <input
                        aria-label={`Select ${row.description} ${row.date}`}
                        type="checkbox"
                        checked={selected.includes(row.id)}
                        disabled={busy}
                        onChange={() => toggle(row.id)}
                      />
                    </td>
                    <td>
                      {row.date}
                      <br />
                      <small>{row.accountLabel}</small>
                    </td>
                    <td>{row.description}</td>
                    <td>
                      {row.direction === "debit" ? "Out " : "In "}
                      {amount(row.amountMinor, row.currency)}
                    </td>
                    <td>
                      {data.categories[row.classification?.category] ||
                        "Not reviewed"}
                      {row.classification?.partyId && (
                        <>
                          <br />
                          {data.parties.find(
                            (party) => party.id === row.classification.partyId,
                          )?.name || "Party changed"}
                        </>
                      )}
                      {row.classification?.account && (
                        <>
                          <br />
                          {
                            data.accounts.find(
                              (account) =>
                                account.id === row.classification.account,
                            )?.name
                          }
                        </>
                      )}
                    </td>
                    <td>
                      {matched.length === 1 ? (
                        <>
                          {matched[0].contains}
                          <br />
                          {data.categories[matched[0].category]}
                          {matched[0].partyId && (
                            <>
                              <br />
                              {data.parties.find(
                                (party) => party.id === matched[0].partyId,
                              )?.name || "Party unavailable"}
                            </>
                          )}
                          {matched[0].account && (
                            <>
                              <br />
                              {
                                data.accounts.find(
                                  (account) =>
                                    account.id === matched[0].account,
                                )?.name
                              }
                            </>
                          )}
                        </>
                      ) : matched.length > 1 ? (
                        `${matched.length} conflicting rules`
                      ) : (
                        "No rule"
                      )}
                    </td>
                  </tr>
                );
              })}
              {!visible.length && (
                <tr>
                  <td colSpan={6}>
                    Import a statement to start reviewing rows.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {allRows.length > 50 && (
          <div className="ai-review-actions">
            <button
              className="btn btn-secondary"
              disabled={!page || busy}
              onClick={() => setPage((value) => value - 1)}
            >
              Previous
            </button>
            <span>
              Page {page + 1} of {Math.ceil(allRows.length / 50)}
            </span>
            <button
              className="btn btn-secondary"
              disabled={busy || (page + 1) * 50 >= allRows.length}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </button>
          </div>
        )}
        {aiPreview && (
          <>
            <details open>
              <summary>Data to share with ChatGPT</summary>
              <pre>{JSON.stringify(aiPreview.context, null, 2)}</pre>
            </details>
            <label className="ai-review-check">
              <input
                type="checkbox"
                checked={consent}
                disabled={busy}
                onChange={(e) => setConsent(e.target.checked)}
              />
              Share these descriptions, amounts and matching party names for
              this request
            </label>
            <button
              className="btn btn-primary"
              disabled={busy || !model || !consent}
              onClick={() =>
                run(
                  "classify",
                  { ticketId: aiPreview.ticketId, consent: true, model },
                  (result) => {
                    setSuggestions(result);
                    setAiPreview(null);
                    setConsent(false);
                    setReviewed(false);
                  },
                )
              }
            >
              Suggest classifications
            </button>
          </>
        )}
        {suggestions && (
          <>
            <h3 style={{ marginTop: 16 }}>Review suggestions</h3>
            <ul className="ai-review-list">
              {suggestions.suggestions.map((item) => (
                <li key={item.id}>
                  <strong>
                    {allRows.find((row) => row.id === item.id)?.description}
                  </strong>
                  <br />
                  {item.category
                    ? data.categories[item.category]
                    : "Needs manual review"}
                  {item.partyId && (
                    <>
                      {" "}
                      ·{" "}
                      {
                        data.parties.find((party) => party.id === item.partyId)
                          ?.name
                      }
                    </>
                  )}
                  {item.account && (
                    <>
                      {" "}
                      ·{" "}
                      {
                        data.accounts.find(
                          (account) => account.id === item.account,
                        )?.name
                      }
                    </>
                  )}
                  <p>{item.reason}</p>
                </li>
              ))}
            </ul>
            <label className="ai-review-check">
              <input
                type="checkbox"
                checked={reviewed}
                disabled={busy}
                onChange={(e) => setReviewed(e.target.checked)}
              />
              I reviewed the complete suggestions. Save them as classifications
              only.
            </label>
            <button
              className="btn btn-primary"
              disabled={
                busy ||
                !reviewed ||
                !suggestions.suggestions.some((item) => item.category)
              }
              onClick={() =>
                run("applyClassification", {
                  ticketId: suggestions.ticketId,
                  rowIds: suggestions.suggestions
                    .filter((item) => item.category)
                    .map((item) => item.id),
                  confirm: true,
                })
              }
            >
              Save reviewed classifications
            </button>
          </>
        )}
      </section>
      <section aria-label="Saved matching rules">
        <h3>Rules you confirm</h3>
        <p>
          Rules match description text, direction and currency. Saving a rule
          never changes existing classifications until you select rows and
          confirm.
        </p>
        <div className="ai-review-fields">
          <label>
            Description contains
            <input
              className="form-input"
              maxLength={120}
              disabled={busy}
              value={rule.contains}
              onChange={(e) => setRule({ ...rule, contains: e.target.value })}
            />
          </label>
          <label>
            Direction
            <select
              aria-label="Direction"
              className="form-input"
              disabled={busy}
              value={rule.direction}
              onChange={(e) => setRule({ ...rule, direction: e.target.value })}
            >
              <option value="debit">Debit / money out</option>
              <option value="credit">Credit / money in</option>
            </select>
          </label>
          <label>
            Rule currency
            <input
              className="form-input"
              maxLength={3}
              disabled={busy}
              value={rule.currency}
              onChange={(e) =>
                setRule({ ...rule, currency: e.target.value.toUpperCase() })
              }
            />
          </label>
          <label>
            Category
            <select
              aria-label="Category"
              className="form-input"
              disabled={busy}
              value={rule.category}
              onChange={(e) => setRule({ ...rule, category: e.target.value })}
            >
              {Object.entries(data?.categories || {}).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Ledger account (optional)
            <select
              aria-label="Ledger account (optional)"
              className="form-input"
              disabled={busy}
              value={rule.account || ""}
              onChange={(e) =>
                setRule({ ...rule, account: e.target.value || null })
              }
            >
              <option value="">Unassigned</option>
              {data?.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Party (optional)
            <select
              aria-label="Party (optional)"
              className="form-input"
              disabled={busy}
              value={rule.partyId || ""}
              onChange={(e) =>
                setRule({ ...rule, partyId: e.target.value || null })
              }
            >
              <option value="">Unassigned</option>
              {data?.parties.map((party) => (
                <option key={party.id} value={party.id}>
                  {party.name} · {party.kind}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="ai-review-actions">
          <button
            className="btn btn-secondary"
            disabled={busy || !data || rule.contains.trim().length < 3}
            onClick={() =>
              run(
                "saveRule",
                {
                  ...rule,
                  revision: data.revision,
                  partyFingerprint: data.parties.find(
                    (party) => party.id === rule.partyId,
                  )?.fingerprint,
                  confirm: true,
                },
                (result) => {
                  accept(result);
                  setRule(emptyRule);
                },
              )
            }
          >
            {rule.id ? "Confirm rule update" : "Confirm new rule"}
          </button>
          {rule.id && (
            <button
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => setRule(emptyRule)}
            >
              Cancel edit
            </button>
          )}
        </div>
        <ul className="ai-review-list">
          {rules.map((item) => (
            <li key={item.id}>
              <strong>{item.contains}</strong> · {item.direction} ·{" "}
              {item.currency} → {data.categories[item.category]}
              <div className="ai-review-actions">
                <button
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => setRule(item)}
                >
                  Edit rule
                </button>
                <button
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() =>
                    run("removeRule", {
                      revision: data.revision,
                      id: item.id,
                      confirm: true,
                    })
                  }
                >
                  Remove rule
                </button>
              </div>
            </li>
          ))}
        </ul>
        {(data?.data.ruleHistory?.length || 0) > 0 && (
          <details>
            <summary>
              Rule change history · latest {data.data.ruleHistory.length}
            </summary>
            <p>
              The latest 100 changes are retained. Export or back up this
              workspace to keep earlier history.
            </p>
            <ul className="ai-review-list">
              {[...data.data.ruleHistory].reverse().map((item) => (
                <li key={item.id}>
                  <strong>{item.action}</strong> · {item.at}
                  <br />
                  {item.before && (
                    <>
                      Before: {item.before.contains} · {item.before.direction} ·{" "}
                      {item.before.currency} ·{" "}
                      {data.categories[item.before.category]} · account{" "}
                      {item.before.account || "unassigned"} ·{" "}
                      {data.parties.find(
                        (party) => party.id === item.before.partyId,
                      )?.name ||
                        item.before.partyId ||
                        "no party"}
                      <br />
                    </>
                  )}
                  {item.after && (
                    <>
                      After: {item.after.contains} · {item.after.direction} ·{" "}
                      {item.after.currency} ·{" "}
                      {data.categories[item.after.category]} · account{" "}
                      {item.after.account || "unassigned"} ·{" "}
                      {data.parties.find(
                        (party) => party.id === item.after.partyId,
                      )?.name ||
                        item.after.partyId ||
                        "no party"}
                    </>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
