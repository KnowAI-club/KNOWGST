import { computeInvoiceTotals } from "../utils.js";

const object = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);
const string = (value, max = 2000) =>
  typeof value === "string" && value.length <= max;
const keys = (value, allowed) =>
  object(value) && Object.keys(value).every((key) => allowed.includes(key));
const id = (value) => string(value, 120) && !!value.trim();
const bounded = (value, max) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= max;
const invalid = () =>
  new Error(
    "The invoice draft response could not be verified. Your invoice is unchanged.",
  );

export function invoiceContextResponse(value) {
  if (
    !keys(value, ["id", "context", "canGenerate", "message"]) ||
    !id(value.id) ||
    typeof value.canGenerate !== "boolean" ||
    !string(value.message) ||
    !keys(value.context, ["instruction", "clients", "products"]) ||
    !string(value.context.instruction)
  )
    throw invalid();
  for (const [field, limit] of [
    ["clients", 15],
    ["products", 30],
  ]) {
    const rows = value.context[field];
    if (
      !Array.isArray(rows) ||
      rows.length > limit ||
      rows.some(
        (row) =>
          !keys(row, ["id", "name"]) || !id(row.id) || !string(row.name, 500),
      )
    )
      throw invalid();
  }
  if (
    value.canGenerate &&
    (!value.context.clients.length || !value.context.products.length)
  )
    throw invalid();
  return value;
}

export function invoiceReviewResponse(value) {
  if (
    !keys(value, ["id", "client", "items", "clarifications", "canApply"]) ||
    !id(value.id) ||
    typeof value.canApply !== "boolean" ||
    !Array.isArray(value.clarifications) ||
    value.clarifications.length > 32 ||
    value.clarifications.some((item) => !string(item, 1000)) ||
    !Array.isArray(value.items) ||
    value.items.length > 20
  )
    throw invalid();
  if (value.client !== null) {
    const fields = [
      "id",
      "name",
      "address",
      "city",
      "pin",
      "state",
      "gstin",
      "country",
      "email",
      "phone",
    ];
    if (
      !keys(value.client, [
        ...fields,
        "isSEZ",
        "preferredPaperSize",
        "preferredCurrency",
        "preferredCustomPaperWidth",
        "preferredCustomPaperHeight",
        "autoPrint",
      ]) ||
      fields.some((field) => !string(value.client[field])) ||
      !id(value.client.id) ||
      !value.client.name.trim() ||
      typeof value.client.isSEZ !== "boolean"
    )
      throw invalid();
    for (const field of ["preferredPaperSize", "preferredCurrency"])
      if (
        value.client[field] !== undefined &&
        !string(value.client[field], 100)
      )
        throw invalid();
    for (const field of [
      "preferredCustomPaperWidth",
      "preferredCustomPaperHeight",
    ])
      if (
        value.client[field] !== undefined &&
        !bounded(value.client[field], 10000)
      )
        throw invalid();
    if (
      value.client.autoPrint !== undefined &&
      typeof value.client.autoPrint !== "boolean"
    )
      throw invalid();
  }
  const seen = new Set();
  for (const item of value.items) {
    if (
      !keys(item, [
        "productId",
        "name",
        "hsn",
        "unit",
        "quantity",
        "rate",
        "taxPercent",
        "cessPercent",
        "discount",
      ]) ||
      !id(item.productId) ||
      seen.has(item.productId) ||
      !string(item.name, 160) ||
      !string(item.hsn) ||
      !string(item.unit) ||
      !bounded(item.quantity, 1e6) ||
      item.quantity <= 0 ||
      !bounded(item.rate, 1e12) ||
      !bounded(item.taxPercent, 100) ||
      !bounded(item.cessPercent, 500) ||
      item.discount !== 0
    )
      throw invalid();
    seen.add(item.productId);
  }
  if (
    value.canApply &&
    (!value.client || !value.items.length || value.clarifications.length)
  )
    throw invalid();
  return value;
}

export function isEmptyInvoiceDraft(client, items, defaultTaxRate = 18) {
  if (
    Object.values(client || {}).some((value) =>
      typeof value === "string" ? value.trim() : !!value,
    )
  )
    return false;
  if (!Array.isArray(items) || items.length !== 1) return false;
  const item = items[0];
  return (
    !item.name?.trim() &&
    !item.description?.trim() &&
    !item.hsn?.trim() &&
    !item.productId &&
    !item.isCharge &&
    Number(item.quantity) === 1 &&
    Number(item.rate) === 0 &&
    Number(item.discount) === 0 &&
    Number(item.cessPercent || 0) === 0 &&
    Number(item.taxPercent) === defaultTaxRate &&
    item.unit === "Nos"
  );
}

export function assertSafeInvoiceDraft(options) {
  const safeAmount = (value) =>
    Number.isFinite(value) && Number.isSafeInteger(Math.round(value * 100));
  if (!options.items.every((item) => safeAmount(item.quantity * item.rate)))
    throw new Error(
      "Invoice amounts exceed safe calculation limits. Reduce the quantities or saved rates.",
    );
  const totals = computeInvoiceTotals(options);
  if (
    Object.values(totals).some(
      (value) => typeof value === "number" && !safeAmount(value),
    )
  )
    throw new Error(
      "Invoice amounts exceed safe calculation limits. Reduce the quantities or saved rates.",
    );
  return totals;
}
