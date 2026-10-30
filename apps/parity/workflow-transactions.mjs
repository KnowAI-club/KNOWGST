import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  readRecord,
  validateId,
  validateObject,
  storageError,
  commitJsonBatch,
} from "./json-storage.mjs";
import { invoiceRevision, versionedInvoice } from "./invoice-transactions.mjs";
import {
  appliedStock,
  stockDelta,
  paymentStatusFor,
  amountDue,
  isCancelledBill,
  SALES_INVOICE_TYPES,
} from "./src/utils.js";
export const cleanRecord = ({ _revision, ...record }) => record;
export const recordPath = (root, dir, id) => {
  validateId(id);
  return path.join(root, dir, `${id.replace(/[/\\:*?"<>|]/g, "_")}.json`);
};
const fail = (message, code = "conflict", status = 409) => {
  throw storageError(message, code, status);
};
const all = (root, dir) =>
  fs
    .readdirSync(path.join(root, dir))
    .filter((n) => n.endsWith(".json"))
    .map((n) => readRecord(path.join(root, dir, n)));
function current(root, dir, id) {
  const record = readRecord(recordPath(root, dir, id));
  if (record && record.id !== id)
    fail("Record ID collides with another record");
  return record;
}
function checkRevision(old, incoming) {
  if (old && incoming._revision !== invoiceRevision(old))
    fail(
      "This record changed in another window. Reload before saving.",
      "stale-record",
    );
  if (!old && incoming._revision)
    fail("This record was removed. Reload before saving.", "stale-record");
}
const norm = (v) =>
  String(v || "")
    .trim()
    .toLowerCase();
const owner = (r) =>
  norm(r.ownerGstin || r.data?.profile?.gstin || r.profile?.gstin) ||
  norm(r.ownerName || r.data?.profile?.businessName || r.profile?.businessName);
const currency = (r) => r.currency || r.data?.invoiceOptions?.currency || "INR";
const round = (n) => Math.round(n * 1000) / 1000;
function addStock(root, writes, deltas) {
  for (const [id, delta] of Object.entries(deltas)) {
    if (!delta) continue;
    const file = recordPath(root, "products", id),
      product = writes.get(file) || current(root, "products", id);
    if (!product)
      fail(
        "A stock item is missing. Restore it before continuing.",
        "missing-product",
      );
    const stock = Number(product.stock || 0) + delta;
    if (!Number.isFinite(stock))
      fail("Invalid stock quantity", "bad-request", 400);
    writes.set(file, { ...product, stock: round(stock) });
  }
}

export function planReceipt(root, input, { remove = false } = {}) {
  validateObject(input);
  validateId(input.id);
  const old = current(root, "receipts", input.id),
    receipt = cleanRecord(input),
    writes = new Map();
  if (remove && !old) return { writes, result: { success: true } };
  if (old && !remove && invoiceRevision(old) === invoiceRevision(receipt))
    return {
      writes,
      result: { success: true, id: old.id, receipt: versionedInvoice(old) },
    };
  checkRevision(old, input);
  if (
    !remove &&
    (!Number.isFinite(Number(receipt.amount)) || Number(receipt.amount) <= 0)
  )
    fail("Enter a positive receipt amount", "bad-request", 400);
  const bills = all(root, "bills");
  const resolve = (r) => {
    const ref = String(r?.againstInvoice || "").trim();
    if (!ref) return null;
    const matches = bills.filter(
      (b) =>
        (b.id === ref || b.invoiceNumber === ref) &&
        (!owner(r) || owner(r) === owner(b)),
    );
    if (matches.length > 1)
      fail("Invoice reference is ambiguous. Choose a business and invoice.");
    return matches[0] || null;
  };
  const target = remove ? null : resolve(receipt);
  if (target && currency(target) !== currency(receipt))
    fail("Receipt and invoice currencies must match");
  if (
    target &&
    receipt.clientName &&
    norm(target.clientName || target.data?.client?.name) !==
      norm(receipt.clientName)
  )
    fail("Receipt client does not match the invoice");
  const modeMap = {
    "Bank Transfer": "bank-transfer",
    UPI: "upi",
    Cash: "cash",
    Cheque: "cheque",
    Card: "card",
    Other: "other",
  };
  for (const bill of bills) {
    const original = bill.payments || [];
    const previous = original.find(
      (p) =>
        p.id === receipt.id ||
        (!p.id &&
          old?.receiptNo &&
          p.receiptNo === old.receiptNo &&
          resolve(old)?.id === bill.id),
    );
    const kept = original.filter((p) => p !== previous);
    if (target?.id === bill.id) {
      kept.push({
        id: receipt.id,
        amount: Number(receipt.amount),
        date: receipt.date,
        mode: modeMap[receipt.paymentMode] || receipt.paymentMode || "other",
        note:
          receipt.note ||
          `Receipt ${receipt.receiptNo || receipt.id}${receipt.referenceNo ? " · ref " + receipt.referenceNo : ""}`,
        recordedAt: previous?.recordedAt || new Date().toISOString(),
        receiptNo: receipt.receiptNo,
      });
    }
    if (!previous && target?.id !== bill.id) continue;
    // A receipt cannot withdraw cash already allocated to another invoice.
    if (kept.some((p) => p.mode === "credit-transferred-out")) {
      const owed =
        isCancelledBill(bill) ||
        (!SALES_INVOICE_TYPES.includes(bill.invoiceType || "tax-invoice") &&
          bill.invoiceType !== "credit-note")
          ? 0
          : amountDue(bill);
      const available =
        kept
          .filter((p) => p.mode !== "credit-applied")
          .reduce((sum, p) => sum + (Number(p.amount) || 0), 0) - owed;
      if (available < -0.005)
        fail(
          "This receipt funds credit used on another invoice. Reverse that credit allocation before changing the receipt.",
          "client-credit-dependency",
        );
    }
    const paidAmount = kept.reduce(
      (sum, p) => sum + (Number(p.amount) || 0),
      0,
    );
    writes.set(recordPath(root, "bills", bill.id), {
      ...cleanRecord(bill),
      payments: kept,
      paidAmount,
      status:
        bill.status === "cancelled"
          ? "cancelled"
          : paymentStatusFor(bill, paidAmount),
    });
  }
  const saved = {
    ...receipt,
    ...(target ? { billId: target.id } : { billId: null }),
  };
  writes.set(recordPath(root, "receipts", receipt.id), remove ? null : saved);
  return {
    writes,
    result: {
      success: true,
      id: receipt.id,
      ...(!remove
        ? {
            receipt: versionedInvoice(saved),
            unmatchedRef: !target ? receipt.againstInvoice || "" : "",
          }
        : {}),
    },
  };
}

export function planPurchase(root, input, { remove = false } = {}) {
  validateObject(input);
  validateId(input.id);
  const old = current(root, "purchases", input.id),
    purchase = cleanRecord(input),
    writes = new Map();
  if (remove && !old) return { writes, result: { success: true } };
  const products = all(root, "products"),
    byId = new Map(products.map((p) => [p.id, p])),
    byName = new Map();
  for (const product of products) {
    const key = norm(product.name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(product);
  }
  function find(item) {
    if (item.productId) {
      const product = byId.get(item.productId);
      if (!product)
        fail(
          "A stock item is missing. Restore it before continuing.",
          "missing-product",
        );
      return product;
    }
    const matches = byName.get(norm(item.name)) || [];
    if (matches.length > 1)
      fail("More than one product has this name. Select its product ID.");
    return matches[0];
  }
  const prior = {};
  if (old?.stockApplied) Object.assign(prior, old.stockApplied);
  else
    for (const item of old?.items || []) {
      if (!norm(item.name)) continue;
      const product = find(item);
      if (!product)
        fail(
          "A previously purchased product is missing. Restore it before continuing.",
          "missing-product",
        );
      prior[product.id] = round(
        (prior[product.id] || 0) + (Number(item.quantity) || 0),
      );
    }
  const next = {};
  if (!remove) {
    if (purchase.items !== undefined && !Array.isArray(purchase.items))
      fail("Invalid purchase items", "bad-request", 400);
    purchase.items = (purchase.items || []).map((item) => {
      validateObject(item);
      if (!norm(item.name)) return item;
      const quantity = Number(item.quantity),
        rate = Number(item.rate || 0);
      if (
        !Number.isFinite(quantity) ||
        quantity < 0 ||
        !Number.isFinite(rate) ||
        rate < 0
      )
        fail("Invalid purchase quantity or rate", "bad-request", 400);
      let product = find(item);
      if (!product) {
        product = {
          id: "prod_" + crypto.randomUUID(),
          name: item.name.trim(),
          stock: 0,
          hsn: item.hsn || "",
          purchasePrice: rate,
          sellingPrice: rate,
          rate,
          taxPercent: item.taxPercent || 0,
          cessPercent: item.cessPercent || 0,
          unit: item.unit || "Nos",
          description: "",
        };
        byId.set(product.id, product);
        byName.set(norm(item.name), [product]);
      }
      const updated = {
        ...product,
        purchasePrice: rate,
        hsn: product.hsn || item.hsn || "",
        taxPercent: product.taxPercent || item.taxPercent || 0,
        cessPercent: product.cessPercent || item.cessPercent || 0,
      };
      writes.set(recordPath(root, "products", product.id), updated);
      next[product.id] = round((next[product.id] || 0) + quantity);
      return { ...item, productId: product.id };
    });
    purchase.stockApplied = next;
    if (old && invoiceRevision(old) === invoiceRevision(purchase))
      return {
        writes: new Map(),
        result: { success: true, id: old.id, purchase: versionedInvoice(old) },
      };
  }
  checkRevision(old, input);
  addStock(root, writes, stockDelta(prior, next));
  writes.set(
    recordPath(root, "purchases", purchase.id),
    remove ? null : purchase,
  );
  return {
    writes,
    result: {
      success: true,
      id: purchase.id,
      ...(!remove ? { purchase: versionedInvoice(purchase) } : {}),
    },
  };
}

export function planInvoiceTrash(root, id, { restore = false, revision } = {}) {
  const from = restore ? "trash" : "bills",
    to = restore ? "bills" : "trash",
    bill = current(root, from, id),
    writes = new Map();
  if (!bill) {
    if (restore) fail("Invoice is not in Trash", "not-found", 404);
    return { writes, result: { success: true } };
  }
  if (revision && revision !== invoiceRevision(bill))
    fail("This invoice changed. Reload before continuing.", "stale-record");
  if (current(root, to, id))
    fail(
      restore
        ? "An invoice with this number already exists"
        : "A trashed invoice already uses this number",
    );
  const payments = bill.payments || bill.data?.payments || [];
  if (
    !restore &&
    (payments.some((p) => String(p.mode).startsWith("credit-")) ||
      all(root, "bills").some(
        (b) =>
          b.id !== id &&
          (b.payments || []).some((p) => p.creditSourceBillIds?.includes(id)),
      ))
  )
    fail(
      "This invoice has client-credit links. Cancel it instead of deleting it.",
      "client-credit-dependency",
    );
  let saved;
  if (restore) {
    const { stockReturnedOnDelete, ...data } = bill.data || {};
    const { _archivedReceipts, ...record } = cleanRecord(bill);
    saved = {
      ...record,
      data: {
        ...data,
        ...(stockReturnedOnDelete
          ? { stockApplied: stockReturnedOnDelete }
          : {}),
      },
    };
    addStock(root, writes, stockDelta({}, stockReturnedOnDelete || {}));
    for (const receipt of _archivedReceipts || []) {
      if (current(root, "receipts", receipt.id))
        fail("A receipt with this ID already exists");
      writes.set(recordPath(root, "receipts", receipt.id), receipt);
    }
    for (const payment of payments) {
      if (!payment.id) continue;
      const existing = current(root, "receipts", payment.id);
      if (existing && existing.billId !== id)
        fail("A payment belongs to another invoice");
    }
  } else {
    const returned = appliedStock(bill);
    addStock(root, writes, stockDelta(returned, {}));
    const receipts = all(root, "receipts").filter(
      (r) => r.billId === id || payments.some((p) => p.id === r.id),
    );
    for (const receipt of receipts)
      writes.set(recordPath(root, "receipts", receipt.id), null);
    saved = {
      ...cleanRecord(bill),
      data: { ...bill.data, stockApplied: {}, stockReturnedOnDelete: returned },
      _archivedReceipts: receipts,
    };
  }
  writes.set(recordPath(root, from, id), null);
  writes.set(recordPath(root, to, id), saved);
  return {
    writes,
    result: {
      success: true,
      ...(restore ? { restored: true } : { trashed: true }),
    },
    bill: saved,
  };
}
export function commitWorkflow(plan, root, options) {
  commitJsonBatch(root, plan.writes, options);
  return plan.result;
}

export function planRecurringTemplate(root, input, { remove = false } = {}) {
  validateObject(input);
  validateId(input.id);
  const old = current(root, "recurring", input.id),
    item = cleanRecord(input),
    writes = new Map();
  if (remove && !old) return { writes, result: { success: true } };
  if (old && !remove && invoiceRevision(old) === invoiceRevision(item))
    return {
      writes,
      result: { success: true, id: item.id, item: versionedInvoice(old) },
    };
  checkRevision(old, input);
  // Generation history belongs to the server, not a stale form snapshot.
  if (old)
    for (const key of [
      "occurrencesCreated",
      "lastGenerated",
      "lastGenerationRequest",
    ]) {
      if (old[key] !== undefined) item[key] = old[key];
      else delete item[key];
    }
  writes.set(recordPath(root, "recurring", item.id), remove ? null : item);
  return {
    writes,
    result: {
      success: true,
      id: item.id,
      ...(!remove ? { item: versionedInvoice(item) } : {}),
    },
  };
}
