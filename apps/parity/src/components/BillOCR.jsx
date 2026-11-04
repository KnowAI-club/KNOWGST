import { matchProduct, ocrReviewIssue } from "../utils/ocr-purchase.mjs";
import { integrationRequest } from "../services/integrations";
import "./bill-ocr.css";
import { useState, useRef, useEffect } from "react";
import {
  X,
  Upload,
  Loader,
  Wand2,
  Package,
  Sparkles,
  Trash2,
  Plus,
} from "lucide-react";
import { toast } from "./Toast";
import { validateGstin } from "../utils/addressValidation";
import { getAllProducts, getProfile } from "../store";

export default function BillOCR({ onClose, onExtracted }) {
  const [models, setModels] = useState([]);
  const [model, setModel] = useState("");
  const [consent, setConsent] = useState(false);
  const [aiError, setAiError] = useState("");
  const generation = useRef(0);
  const requestLock = useRef(false);
  const resultAccount = useRef(undefined);
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [status, setStatus] = useState("idle"); // 'idle' | 'ocr' | 'done' | 'error'
  const [rawText, setRawText] = useState("");
  const [parsed, setParsed] = useState(null);
  const latestParsed = useRef(parsed);
  latestParsed.current = parsed;
  // v1.10.35 - Products catalog loaded once on mount. Used to enrich
  // extracted line items with the user's known HSN + GST rate so they
  // don't have to retype for products they've already saved.
  const [catalog, setCatalog] = useState([]);
  const fileInputRef = useRef(null);
  const business = useRef(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getProfile(), getAllProducts()])
      .then(([profile, products]) => {
        if (!cancelled) {
          business.current = profile?.id;
          setCatalog(products);
        }
      })
      .catch(() => {
        if (!cancelled)
          setAiError(
            "Could not load your business and product catalog. Close this dialog and try again.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );
  useEffect(() => {
    let cancelled = false;
    integrationRequest("/chatgpt/models")
      .then((list) => {
        if (!cancelled) {
          setModels(list);
          setModel(list[0]?.id || "");
        }
      })
      .catch((e) => {
        if (!cancelled) setAiError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const runChatGPT = async () => {
    if (!file || !consent || !model || requestLock.current) return;
    if (!business.current) {
      setAiError(
        "Wait for the business and product catalog to load, or reopen this dialog.",
      );
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setAiError(
        "ChatGPT accepts images up to 3 MB here. Use a smaller image or enter the bill manually.",
      );
      return;
    }
    const version = ++generation.current;
    requestLock.current = true;
    resultAccount.current = undefined;
    setStatus("ocr");
    setParsed(null);
    setAiError("");
    setConsent(false);
    try {
      const [profile, integration, products] = await Promise.all([
        getProfile(),
        integrationRequest(),
        getAllProducts(),
      ]);
      if (version !== generation.current) return;
      if (
        profile?.id !== business.current ||
        JSON.stringify(products) !== JSON.stringify(catalog)
      )
        throw new Error(
          "Business or product catalog changed. Reopen the image to use current records.",
        );
      const image = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      if (version !== generation.current) return;
      const result = await integrationRequest("/chatgpt/ocr", {
        model,
        image,
        consent: true,
        businessId: business.current,
      });
      if (version !== generation.current) return;
      if (
        (await integrationRequest()).chatgpt?.active !==
        integration.chatgpt?.active
      )
        throw new Error(
          "ChatGPT account changed. Review the image and try again.",
        );
      if (version !== generation.current) return;
      resultAccount.current = integration.chatgpt?.active;
      if ((await getProfile())?.id !== business.current)
        throw new Error(
          "Business changed. Reopen the image in the correct business.",
        );
      if (version !== generation.current) return;
      result.items = result.items.map((it) => {
        const m = matchProduct(it.name, catalog);
        return m
          ? {
              ...it,
              _matchedProductId: m.product.id,
              _matchedName: m.product.name,
              _matchScore: m.score,
            }
          : it;
      });
      setParsed(result);
      setRawText(
        "ChatGPT extraction - compare every value with the original image.",
      );
      setStatus("done");
    } catch (e) {
      if (version === generation.current) {
        setAiError(
          e.message ||
            "Image extraction failed. Enter the bill manually or try again.",
        );
        setStatus("error");
      }
    } finally {
      requestLock.current = false;
    }
  };
  const pickFile = (f) => {
    if (!f || status === "ocr") return;
    generation.current++;
    setConsent(false);
    setAiError("");
    if (!["image/png", "image/jpeg", "image/webp"].includes(f.type)) {
      toast("Please upload an image (PNG, JPG, WebP).", "warning");
      return;
    }
    if (f.size > 3 * 1024 * 1024) {
      toast(
        "Image is over 3MB - please compress first (or take a smaller photo).",
        "warning",
      );
      return;
    }
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    setStatus("idle");
    setRawText("");
    setParsed(null);
  };

  const applyToForm = async () => {
    if (!parsed || requestLock.current) return;
    if (!validateGstin(parsed.supplierGstin).ok) {
      toast(validateGstin(parsed.supplierGstin).message, "warning");
      return;
    }
    const applying = parsed,
      version = generation.current;
    requestLock.current = true;
    try {
      const [profile, integration, products] = await Promise.all([
        getProfile(),
        integrationRequest(),
        getAllProducts(),
      ]);
      if (version !== generation.current) return;
      if (applying !== latestParsed.current)
        throw new Error(
          "Invoice fields changed during review. Review them and apply again.",
        );
      if (
        !business.current ||
        profile?.id !== business.current ||
        JSON.stringify(products) !== JSON.stringify(catalog)
      )
        throw new Error(
          "Business or product catalog changed. Reopen the image to use current records.",
        );
      if (integration.chatgpt?.active !== resultAccount.current)
        throw new Error(
          "ChatGPT account changed. Review the image and try again.",
        );
      const issue = ocrReviewIssue(parsed);
      if (issue) {
        toast(issue, "warning");
        return;
      }
      // v1.10.35 - Also ship line items + tax breakdown to the parent so
      // the purchase form is pre-filled top to bottom (was: header only,
      // items always blank).
      onExtracted({
        supplierName: parsed.supplierName,
        supplierGstin: parsed.supplierGstin,
        invoiceNumber: parsed.invoiceNumber,
        date: parsed.date,
        grandTotal: parsed.grandTotal,
        items: parsed.items || [],
        taxBreakdown: parsed.taxBreakdown || {},
      });
      onClose();
    } catch (e) {
      if (version === generation.current)
        toast(e.message || "Could not verify this review. Try again.", "error");
    } finally {
      requestLock.current = false;
    }
  };

  // v1.10.35 - Line-item editors: user can tweak / add / remove
  // before applying to the form. Each row is displayed with name,
  // HSN, qty, rate, tax%, amount + a match-badge if the row was
  // auto-linked to a saved product.
  const updateItem = (idx, patch) => {
    setParsed((p) => ({
      ...p,
      items: p.items.map((it, i) =>
        i === idx
          ? {
              ...it,
              ...patch,
              ...(Object.hasOwn(patch, "name")
                ? {
                    _matchedProductId: undefined,
                    _matchedName: undefined,
                    _matchScore: undefined,
                  }
                : {}),
            }
          : it,
      ),
    }));
  };
  const removeItem = (idx) => {
    setParsed((p) => ({ ...p, items: p.items.filter((_, i) => i !== idx) }));
  };
  const addItem = () => {
    setParsed((p) => ({
      ...p,
      items: [
        ...(p.items || []),
        { name: "", hsn: "", quantity: 1, rate: 0, amount: 0, taxPercent: 18 },
      ],
    }));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content bill-ocr"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "min(1080px, 96vw)",
          maxHeight: "92vh",
          overflow: "auto",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "0.75rem",
          }}
        >
          <h3
            className="section-title"
            style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}
          >
            <Wand2 size={18} /> Import from bill image (OCR)
          </h3>
          <button className="icon-btn" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>
        <p
          style={{
            fontSize: "0.8rem",
            color: "var(--text-muted)",
            marginTop: 0,
            marginBottom: "1rem",
          }}
        >
          Upload a supplier invoice and review its fields before creating a
          purchase. ChatGPT reads the selected image after your approval. Review
          the extracted fields before saving; product matching stays local.
        </p>

        {
          <div className="ocr-options">
            <label>
              Model{" "}
              <select
                aria-label="OCR model"
                disabled={status === "ocr"}
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
            <p>
              Requires your eligible ChatGPT account in Settings → Integrations
              and an image-capable model. The full image may include supplier,
              tax and bank details. Your catalog is not sent. Maximum 3 MB.
            </p>
            <label>
              <input
                type="checkbox"
                checked={consent}
                disabled={status === "ocr" || !file}
                onChange={(e) => setConsent(e.target.checked)}
              />{" "}
              Send this image to ChatGPT for extraction
            </label>
          </div>
        }
        {aiError && <p role="alert">{aiError}</p>}
        <div className={previewUrl ? "ocr-columns" : "ocr-columns ocr-single"}>
          {/* Left: file picker + preview */}
          <div>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                pickFile(e.dataTransfer.files?.[0]);
              }}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: "2px dashed var(--border-color)",
                borderRadius: 8,
                padding: "1.25rem",
                textAlign: "center",
                cursor: "pointer",
                background: "var(--bg-secondary)",
                minHeight: 120,
              }}
            >
              <Upload size={26} style={{ opacity: 0.6, marginBottom: 6 }} />
              <p style={{ margin: 0, fontSize: "0.85rem" }}>
                {file ? file.name : "Click or drag a bill image here"}
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => pickFile(e.target.files?.[0])}
              />
            </div>
            {previewUrl && (
              <img
                src={previewUrl}
                alt="Bill preview"
                style={{
                  marginTop: 10,
                  maxWidth: "100%",
                  maxHeight: 300,
                  border: "1px solid var(--border-color)",
                  borderRadius: 4,
                }}
              />
            )}
            {file && status !== "ocr" && (
              <button
                className="btn btn-primary"
                disabled={!consent || !model}
                onClick={runChatGPT}
                style={{ marginTop: 10, width: "100%" }}
              >
                <Wand2 size={16} /> Extract fields
              </button>
            )}
            {status === "ocr" && (
              <div
                style={{
                  marginTop: 10,
                  textAlign: "center",
                  fontSize: "0.85rem",
                }}
              >
                <Loader
                  size={16}
                  className="spin"
                  style={{ verticalAlign: "-3px", marginRight: 6 }}
                />
                Reading image with ChatGPT…
              </div>
            )}
          </div>

          {/* Right: extracted result */}
          {parsed && (
            <div
              style={{
                background: "var(--bg-secondary)",
                padding: "0.85rem",
                borderRadius: 6,
                maxHeight: "calc(88vh - 100px)",
                overflowY: "auto",
              }}
            >
              <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.9rem" }}>
                Extracted fields
              </h4>
              <FieldPreview
                label="Supplier"
                value={parsed.supplierName}
                onChange={(v) => setParsed((p) => ({ ...p, supplierName: v }))}
              />
              <FieldPreview
                label="GSTIN"
                value={parsed.supplierGstin}
                onChange={(v) => setParsed((p) => ({ ...p, supplierGstin: v.toUpperCase() }))}
              />
              {!validateGstin(parsed.supplierGstin).ok && (
                <small style={{ color: "#dc2626", fontSize: "0.7rem", display: "block", marginBottom: 6 }}>
                  {validateGstin(parsed.supplierGstin).message}
                </small>
              )}
              <FieldPreview
                label="Invoice No."
                value={parsed.invoiceNumber}
                onChange={(v) => setParsed((p) => ({ ...p, invoiceNumber: v }))}
              />
              <FieldPreview
                label="Date"
                value={parsed.date}
                onChange={(v) => setParsed((p) => ({ ...p, date: v }))}
                type="date"
              />
              <FieldPreview
                label="Grand total"
                value={parsed.grandTotal || ""}
                onChange={(v) =>
                  setParsed((p) => ({ ...p, grandTotal: Number(v) || 0 }))
                }
                type="number"
              />

              {/* v1.10.35 - Tax breakdown from OCR */}
              {parsed.taxBreakdown &&
                (parsed.taxBreakdown.taxableValue ||
                  parsed.taxBreakdown.cgst ||
                  parsed.taxBreakdown.igst ||
                  parsed.taxBreakdown.cess) > 0 && (
                  <div
                    style={{
                      marginTop: 10,
                      padding: "0.55rem 0.7rem",
                      background: "var(--bg-primary)",
                      borderRadius: 5,
                      border: "1px solid var(--border)",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "0.7rem",
                        fontWeight: 700,
                        color: "var(--text-muted)",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        marginBottom: 4,
                      }}
                    >
                      Tax breakdown
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "auto 1fr",
                        gap: "2px 8px",
                        fontSize: "0.75rem",
                      }}
                    >
                      {parsed.taxBreakdown.taxableValue > 0 && (
                        <>
                          <span style={{ color: "var(--text-muted)" }}>
                            Taxable
                          </span>
                          <span style={{ textAlign: "right", fontWeight: 600 }}>
                            ₹{parsed.taxBreakdown.taxableValue.toFixed(2)}
                          </span>
                        </>
                      )}
                      {parsed.taxBreakdown.cgst > 0 && (
                        <>
                          <span style={{ color: "var(--text-muted)" }}>
                            CGST
                          </span>
                          <span style={{ textAlign: "right" }}>
                            ₹{parsed.taxBreakdown.cgst.toFixed(2)}
                          </span>
                        </>
                      )}
                      {parsed.taxBreakdown.sgst > 0 && (
                        <>
                          <span style={{ color: "var(--text-muted)" }}>
                            SGST / UTGST
                          </span>
                          <span style={{ textAlign: "right" }}>
                            ₹{parsed.taxBreakdown.sgst.toFixed(2)}
                          </span>
                        </>
                      )}
                      {parsed.taxBreakdown.igst > 0 && (
                        <>
                          <span style={{ color: "var(--text-muted)" }}>
                            IGST
                          </span>
                          <span style={{ textAlign: "right" }}>
                            ₹{parsed.taxBreakdown.igst.toFixed(2)}
                          </span>
                        </>
                      )}
                      {parsed.taxBreakdown.cess > 0 && (
                        <>
                          <span style={{ color: "var(--text-muted)" }}>
                            Cess
                          </span>
                          <span style={{ textAlign: "right" }}>
                            ₹{parsed.taxBreakdown.cess.toFixed(2)}
                          </span>
                        </>
                      )}
                      {Math.abs(parsed.taxBreakdown.roundOff) > 0.005 && (
                        <>
                          <span style={{ color: "var(--text-muted)" }}>
                            Round-off
                          </span>
                          <span style={{ textAlign: "right" }}>
                            {parsed.taxBreakdown.roundOff >= 0 ? "+" : ""}₹
                            {parsed.taxBreakdown.roundOff.toFixed(2)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                )}

              {/* v1.10.35 - Line items with per-row editors */}
              <div style={{ marginTop: 12 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 5,
                  }}
                >
                  <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>
                    <Package
                      size={13}
                      style={{ verticalAlign: "-2px", marginRight: 4 }}
                    />
                    Line items ({parsed.items?.length || 0})
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={addItem}
                    style={{ fontSize: "0.7rem", padding: "0.2rem 0.5rem" }}
                  >
                    <Plus size={11} /> Add row
                  </button>
                </div>
                {!parsed.items || parsed.items.length === 0 ? (
                  <p
                    style={{
                      fontSize: "0.72rem",
                      color: "var(--text-muted)",
                      margin: 0,
                      padding: "0.5rem",
                      background: "var(--bg-primary)",
                      borderRadius: 4,
                      textAlign: "center",
                    }}
                  >
                    No line items detected. Add rows manually or use the
                    OCR-total single-line fallback.
                  </p>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      maxHeight: 320,
                      overflowY: "auto",
                    }}
                  >
                    {parsed.items.map((it, idx) => (
                      <div
                        key={idx}
                        style={{
                          background: "var(--bg-primary)",
                          padding: "0.5rem 0.6rem",
                          borderRadius: 4,
                          border: "1px solid var(--border)",
                        }}
                      >
                        {/* Row 1: name + match badge + remove */}
                        <div
                          style={{
                            display: "flex",
                            gap: 6,
                            alignItems: "center",
                            marginBottom: 4,
                          }}
                        >
                          <input
                            type="text"
                            className="form-input"
                            value={it.name || ""}
                            onChange={(e) =>
                              updateItem(idx, { name: e.target.value })
                            }
                            placeholder="Product / description"
                            style={{
                              flex: 1,
                              fontSize: "0.78rem",
                              padding: "0.25rem 0.4rem",
                            }}
                          />
                          <button
                            type="button"
                            className="icon-btn icon-btn-red"
                            onClick={() => removeItem(idx)}
                            title="Remove row"
                            aria-label="Remove row"
                            style={{ width: 24, height: 24 }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                        {it._matchedProductId && (
                          <div
                            style={{
                              fontSize: "0.68rem",
                              color: "var(--primary)",
                              marginBottom: 4,
                              display: "flex",
                              alignItems: "center",
                              gap: 3,
                            }}
                          >
                            <Sparkles size={10} /> Matched saved product:{" "}
                            <em>{it._matchedName}</em> (
                            {Math.round((it._matchScore || 0) * 100)}%)
                          </div>
                        )}
                        <label style={{ fontSize: "0.72rem" }}>
                          Linked product
                          <select
                            aria-label={`Linked product ${idx + 1}`}
                            value={it._matchedProductId || ""}
                            onChange={(e) => {
                              const p = catalog.find(
                                (p) => p.id === e.target.value,
                              );
                              updateItem(idx, {
                                _matchedProductId: p?.id,
                                _matchedName: p?.name,
                                _matchScore: p ? 1 : undefined,
                              });
                            }}
                          >
                            <option value="">No product link</option>
                            {catalog.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        {/* Row 2: hsn, qty, rate, tax%, amount */}
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(3,minmax(0,1fr))",
                            gap: 5,
                            fontSize: "0.72rem",
                          }}
                        >
                          <div>
                            <label
                              style={{
                                fontSize: "0.62rem",
                                color: "var(--text-muted)",
                                display: "block",
                              }}
                            >
                              HSN/SAC
                            </label>
                            <input
                              type="text"
                              className="form-input"
                              value={it.hsn || ""}
                              onChange={(e) =>
                                updateItem(idx, { hsn: e.target.value })
                              }
                              placeholder="e.g. 4802"
                              style={{
                                fontSize: "0.72rem",
                                padding: "0.2rem 0.35rem",
                                width: "100%",
                              }}
                            />
                          </div>
                          <div>
                            <label
                              style={{
                                fontSize: "0.62rem",
                                color: "var(--text-muted)",
                                display: "block",
                              }}
                            >
                              Qty
                            </label>
                            <input
                              type="number"
                              step="any"
                              className="form-input"
                              value={it.quantity ?? ""}
                              onChange={(e) =>
                                updateItem(idx, {
                                  quantity: Number(e.target.value) || 0,
                                })
                              }
                              style={{
                                fontSize: "0.72rem",
                                padding: "0.2rem 0.35rem",
                                width: "100%",
                              }}
                            />
                          </div>
                          <div>
                            <label
                              style={{
                                fontSize: "0.62rem",
                                color: "var(--text-muted)",
                                display: "block",
                              }}
                            >
                              Rate ₹
                            </label>
                            <input
                              type="number"
                              step="any"
                              className="form-input"
                              value={it.rate ?? ""}
                              onChange={(e) =>
                                updateItem(idx, {
                                  rate: Number(e.target.value) || 0,
                                })
                              }
                              style={{
                                fontSize: "0.72rem",
                                padding: "0.2rem 0.35rem",
                                width: "100%",
                              }}
                            />
                          </div>
                          <div>
                            <label
                              style={{
                                fontSize: "0.62rem",
                                color: "var(--text-muted)",
                                display: "block",
                              }}
                            >
                              GST%
                            </label>
                            <input
                              type="number"
                              step="any"
                              className="form-input"
                              value={it.taxPercent ?? ""}
                              onChange={(e) =>
                                updateItem(idx, {
                                  taxPercent: Number(e.target.value) || 0,
                                })
                              }
                              style={{
                                fontSize: "0.72rem",
                                padding: "0.2rem 0.35rem",
                                width: "100%",
                              }}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: "0.62rem" }}>
                              Cess %
                            </label>
                            <input
                              aria-label={`Cess percent ${idx + 1}`}
                              type="number"
                              min="0"
                              step="any"
                              className="form-input"
                              value={it.cessPercent ?? ""}
                              onChange={(e) =>
                                updateItem(idx, {
                                  cessPercent: Number(e.target.value),
                                })
                              }
                            />
                          </div>
                          <div>
                            <label
                              style={{
                                fontSize: "0.62rem",
                                color: "var(--text-muted)",
                                display: "block",
                              }}
                            >
                              Amount ₹
                            </label>
                            <input
                              type="number"
                              step="any"
                              className="form-input"
                              value={it.amount ?? ""}
                              onChange={(e) =>
                                updateItem(idx, {
                                  amount: Number(e.target.value) || 0,
                                })
                              }
                              style={{
                                fontSize: "0.72rem",
                                padding: "0.2rem 0.35rem",
                                width: "100%",
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <details
                style={{
                  marginTop: 10,
                  fontSize: "0.75rem",
                  color: "var(--text-muted)",
                }}
              >
                <summary style={{ cursor: "pointer" }}>
                  Extraction notes
                </summary>
                <pre
                  style={{
                    whiteSpace: "pre-wrap",
                    fontSize: "0.7rem",
                    maxHeight: 140,
                    overflow: "auto",
                    marginTop: 4,
                  }}
                >
                  {rawText}
                </pre>
              </details>
              {ocrReviewIssue(parsed) && (
                <p role="alert">{ocrReviewIssue(parsed)}</p>
              )}
              <p style={{ fontSize: "0.75rem" }}>
                Review product links, rates and cess against the image. Linked
                products will update stock only when you save the purchase.
              </p>
              <button
                disabled={!!ocrReviewIssue(parsed)}
                className="btn btn-primary"
                onClick={applyToForm}
                style={{ marginTop: 10, width: "100%" }}
              >
                Use these values ({parsed.items?.length || 0} line item
                {parsed.items?.length === 1 ? "" : "s"})
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FieldPreview({ label, value, onChange, type = "text" }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <label
        style={{
          fontSize: "0.7rem",
          color: "var(--text-muted)",
          display: "block",
          marginBottom: 2,
        }}
      >
        {label}
      </label>
      <input
        type={type}
        className="form-input"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        style={{ fontSize: "0.82rem", padding: "0.3rem 0.5rem" }}
      />
    </div>
  );
}
