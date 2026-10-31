import { businessOf, assertStockOwner } from "./accounting.mjs";
import path from "node:path";
import { recordFs as fs } from "./sqlite-storage.mjs";
import crypto from "node:crypto";
import {
  readRecord,
  commitJsonBatch,
  validateObject,
  validateId,
  storageError,
} from "./json-storage.mjs";
import { appliedStock, stockDelta, stockEffect } from "./src/utils.js";

const clean = ({ _revision, ...record }) => record;
export const invoiceRevision = (record) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify(clean(record)))
    .digest("hex");
export const versionedInvoice = (record) => ({
  ...record,
  _revision: invoiceRevision(record),
});
const fail = (message, code = "conflict", status = 409) => {
  throw storageError(message, code, status);
};
const safe = (id) => id.replace(/[/\\:*?"<>|]/g, "_");

// One synchronous writer: validate and stage every affected record before publishing.
export function planInvoices(root, operations) {
  if (
    !Array.isArray(operations) ||
    !operations.length ||
    operations.length > 200
  )
    fail("Expected 1–200 invoice operations", "bad-request", 400);
  const writes = new Map(),
    stock = {},
    stockOwners = new Map(),
    results = [],
    seen = new Set();
  const recordPath = (dir, id) => {
    validateId(id);
    return path.join(root, dir, `${safe(id)}.json`);
  };
  for (const operation of operations) {
    validateObject(operation);
    validateObject(operation.bill);
    const bill = clean(operation.bill),
      file = recordPath("bills", bill.id);
    if (seen.has(file)) fail("Duplicate invoice in transaction");
    seen.add(file);
    const sourceFile = operation.renameFrom
      ? recordPath("bills", operation.renameFrom)
      : file;
    if (sourceFile !== file) {
      if (seen.has(sourceFile)) fail("Overlapping invoice operations");
      seen.add(sourceFile);
    }
    if (sourceFile !== file && readRecord(file))
      fail("Invoice number already exists", "duplicate-invoice");
    const old = readRecord(sourceFile);
    if (operation.renameFrom && (!old || old.id !== operation.renameFrom))
      fail("Original invoice is missing", "stale-invoice");
    if (operation.renameFrom) {
      for (const name of fs
        .readdirSync(path.join(root, "bills"))
        .filter((name) => name.endsWith(".json"))) {
        const other = readRecord(path.join(root, "bills", name));
        if (
          other.id !== old.id &&
          (other.payments || other.data?.payments || []).some(
            (p) =>
              p?.mode === "credit-applied" &&
              p.creditSourceBillIds?.includes(old.id),
          )
        )
          fail("This invoice supplies client credit and cannot be renumbered");
      }
    }
    if (old && !operation.renameFrom && old.id !== bill.id)
      fail("Invoice number collides with another record");
    if (operation.stock !== false)
      bill.data = {
        ...bill.data,
        stockApplied: bill.convertedTo
          ? {}
          : stockEffect(
              bill.data?.items,
              bill.invoiceType || bill.data?.invoiceType,
              bill.status,
            ),
      };
    // An exact retry after a lost response is a no-op, including its stock movement.
    if (old && invoiceRevision(old) === invoiceRevision(bill)) {
      results.push(versionedInvoice(old));
      continue;
    }
    if (old && !operation.overwrite && !operation.renameFrom)
      fail("Invoice number already exists", "duplicate-invoice");
    if (old && operation.bill._revision !== invoiceRevision(old))
      fail(
        "This invoice changed in another window. Reload before saving.",
        "stale-invoice",
      );
    if (!old && operation.bill._revision)
      fail("This invoice was removed. Reload before saving.", "stale-invoice");
    const businessId = businessOf(root, bill);
    for (const item of bill.data?.items || []) {
      if (item.productId)
        assertStockOwner(
          root,
          readRecord(recordPath("products", item.productId)),
          businessId,
        );
      if (item.productId && !Number.isFinite(Number(item.quantity)))
        fail("Invalid stock quantity", "bad-request", 400);
    }
    if (operation.stock !== false) {
      const next = bill.convertedTo
        ? {}
        : stockEffect(
            bill.data?.items,
            bill.invoiceType || bill.data?.invoiceType,
            bill.status,
          );
      bill.data = { ...bill.data, stockApplied: next };
      for (const [id, delta] of Object.entries(
        stockDelta(old ? appliedStock(old) : {}, next),
      )) {
        if (businessId) {
          if (stockOwners.has(id) && stockOwners.get(id) !== businessId)
            fail("Stock cannot be shared across businesses.");
          stockOwners.set(id, businessId);
        }
        stock[id] = (stock[id] || 0) + delta;
      }
    }
    if (bill.payments !== undefined && !Array.isArray(bill.payments))
      fail("Invalid payments", "bad-request", 400);
    const payments = bill.payments || [],
      paymentIds = new Set();
    for (const payment of payments) {
      if (!payment || !Number.isFinite(Number(payment.amount)))
        fail("Invalid payment amount", "bad-request", 400);
      if (!payment.id) continue; // Legacy payments without an ID remain readable.
      if (paymentIds.has(payment.id))
        fail("Duplicate payment ID", "bad-request", 400);
      paymentIds.add(payment.id);
      if (String(payment.mode).startsWith("credit-")) continue;
      const receiptFile = recordPath("receipts", payment.id),
        existing = readRecord(receiptFile);
      if (
        existing &&
        existing.billId !== bill.id &&
        (!operation.renameFrom || existing.billId !== operation.renameFrom)
      )
        fail("Payment ID belongs to another receipt");
      writes.set(receiptFile, {
        ...existing,
        id: payment.id,
        date: payment.date,
        receiptNo:
          existing?.receiptNo ||
          payment.receiptNo ||
          `RCPT-${payment.id.replace("pay_", "").toUpperCase().slice(0, 10)}`,
        clientName: bill.data?.client?.name || bill.clientName || "",
        clientAddress: bill.data?.client?.address || "",
        amount: Number(payment.amount),
        paymentMode: payment.mode,
        referenceNo: payment.note || "",
        againstInvoice: bill.invoiceNumber || bill.id,
        note: payment.note || "",
        currency: bill.currency || bill.data?.invoiceOptions?.currency || "INR",
        source: existing?.source || "auto-from-payment",
        billId: bill.id,
        ownerGstin: bill.data?.profile?.gstin || bill.ownerGstin || "",
        ownerName: bill.data?.profile?.businessName || bill.ownerName || "",
      });
    }
    for (const payment of old?.payments || []) {
      if (!payment.id || paymentIds.has(payment.id)) continue;
      const receiptFile = recordPath("receipts", payment.id),
        existing = readRecord(receiptFile);
      if (existing?.billId === bill.id) writes.set(receiptFile, null);
    }
    if (operation.renameFrom) {
      const trash = recordPath("trash", old.id);
      if (readRecord(trash)) fail("A trashed invoice already uses this number");
      writes.set(trash, {
        ...clean(old),
        data: { ...old.data, stockApplied: {} },
      });
      writes.set(sourceFile, null);
    }
    writes.set(file, bill);
    results.push(versionedInvoice(bill));
  }
  const products = [];
  for (const [id, delta] of Object.entries(stock)) {
    if (!delta) continue;
    const file = recordPath("products", id),
      product = readRecord(file);
    if (!product || product.id !== id)
      fail(
        "A stock item is missing. Restore it before saving.",
        "missing-product",
      );
    assertStockOwner(root, product, stockOwners.get(id));
    const quantity = Number(product.stock || 0) + delta;
    if (!Number.isFinite(quantity))
      fail("Invalid stock quantity", "bad-request", 400);
    const updated = { ...product, stock: Math.round(quantity * 1000) / 1000 };
    writes.set(file, updated);
    products.push(updated);
  }
  return { writes, result: { success: true, bills: results, products } };
}

export function commitInvoices(root, operations, options = {}) {
  const { writes, result } = planInvoices(root, operations);
  commitJsonBatch(root, writes, options);
  return result;
}
