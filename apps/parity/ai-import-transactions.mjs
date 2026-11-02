import path from "node:path";
import { recordFs as fs } from "./sqlite-storage.mjs";
import {
  readRecord,
  commitJsonBatch,
  validateObject,
  storageError,
} from "./json-storage.mjs";
import {
  activeBusiness,
  augmentAccounting,
  businessOf,
  readAccounting,
} from "./accounting.mjs";
import { recordPath } from "./workflow-transactions.mjs";
import { invoiceRevision } from "./invoice-transactions.mjs";
const fail = (message) => {
  throw storageError(message, "import-conflict", 409);
};
const all = (root, dir) =>
  fs.existsSync(path.join(root, dir))
    ? fs
        .readdirSync(path.join(root, dir))
        .filter((f) => f.endsWith(".json"))
        .map((f) => readRecord(path.join(root, dir, f)))
    : [];
const ledgerFile = (root) => path.join(root, "ai-import-batches.json");
export function importBatches(root, businessId) {
  if (activeBusiness(root)?.id !== businessId)
    fail("The active business changed.");
  return (
    readRecord(ledgerFile(root), { schema: 1, batches: [] }).batches || []
  ).filter((b) => b.businessId === businessId);
}
export function commitMasterImport(
  root,
  { businessId, batchId, kind, records, sourceName, backup },
  options = {},
) {
  if (activeBusiness(root)?.id !== businessId)
    fail("The active business changed.");
  if (
    !["clients", "products"].includes(kind) ||
    !Array.isArray(records) ||
    !records.length ||
    records.length > 300
  )
    fail("Invalid master-data import.");
  const ledger = readRecord(ledgerFile(root), { schema: 1, batches: [] });
  const prior = ledger.batches.find((b) => b.id === batchId);
  if (prior) {
    if (
      prior.businessId !== businessId ||
      prior.kind !== kind ||
      prior.status !== "imported"
    )
      fail("This import batch cannot be repeated.");
    return { ...prior, repeated: true };
  }
  if (ledger.batches.length >= 200)
    fail("Import history limit reached. Use the individual record screens.");
  const writes = new Map(),
    revisions = [];
  for (const record of records) {
    validateObject(record);
    if (
      record.businessId !== businessId ||
      !record.name?.trim() ||
      (kind === "products" && Number(record.stock || 0) !== 0)
    )
      fail(
        "Imports must belong to the active business and start with zero stock.",
      );
    const file = recordPath(root, kind, record.id);
    if (readRecord(file) || writes.has(file))
      fail("An import record already exists. Preview again.");
    writes.set(file, record);
    revisions.push({
      id: record.id,
      name: record.name,
      revision: invoiceRevision(record),
    });
  }
  const batch = {
    id: batchId,
    businessId,
    kind,
    sourceName,
    backup,
    status: "imported",
    createdAt: new Date().toISOString(),
    records: revisions,
  };
  augmentAccounting(root, writes, {
    businessId,
    action: "masters.imported",
    reason: `Reviewed import ${batchId}`,
  });
  writes.set(ledgerFile(root), {
    schema: 1,
    batches: [...ledger.batches, batch],
  });
  commitJsonBatch(root, writes, options);
  return batch;
}
function hasReference(value, ids, names, depth = 0) {
  if (depth > 30) return true;
  if (!value || typeof value !== "object") return false;
  for (const [key, item] of Object.entries(value)) {
    if (
      typeof item === "string" &&
      (ids.has(item) ||
        (["name", "clientName", "receivedFrom", "productName"].includes(key) &&
          names.has(item.trim().toLowerCase())))
    )
      return true;
    if (
      item &&
      typeof item === "object" &&
      hasReference(item, ids, names, depth + 1)
    )
      return true;
  }
  return false;
}
export function undoMasterImport(root, { businessId, batchId }, options = {}) {
  if (activeBusiness(root)?.id !== businessId)
    fail("The active business changed.");
  const ledger = readRecord(ledgerFile(root), { schema: 1, batches: [] });
  const batch = ledger.batches.find(
    (b) => b.id === batchId && b.businessId === businessId,
  );
  if (!batch) fail("Import batch not found.");
  if (batch.status === "undone") return { ...batch, repeated: true };
  const writes = new Map(),
    ids = new Set(batch.records.map((r) => r.id)),
    names = new Set(batch.records.map((r) => r.name.trim().toLowerCase()));
  for (const record of batch.records) {
    const file = recordPath(root, batch.kind, record.id),
      current = readRecord(file);
    if (
      !current ||
      businessOf(root, current) !== businessId ||
      invoiceRevision(current) !== record.revision
    )
      fail(
        "An imported record changed or was removed. This batch cannot be undone.",
      );
    writes.set(file, null);
  }
  for (const dir of [
    "bills",
    "trash",
    "purchases",
    "recurring",
    "receipts",
    "expenses",
  ]) {
    if (all(root, dir).some((r) => hasReference(r, ids, names)))
      fail(
        "An imported record has document history. Keep the record and correct it individually.",
      );
  }
  const books = readAccounting(root, businessId);
  if (
    books.audit.some(
      (event) =>
        event.collection === batch.kind &&
        ids.has(event.entityId) &&
        event.action !== "masters.imported",
    )
  )
    fail(
      "An imported record has later audit history and cannot be removed as an unused import.",
    );
  if (
    batch.kind === "products" &&
    books.movements.some(
      (m) => ids.has(m.productId) && m.action !== "masters.imported",
    )
  )
    fail("An imported product has stock history and cannot be removed.");
  const updated = {
    ...batch,
    status: "undone",
    undoneAt: new Date().toISOString(),
  };
  augmentAccounting(root, writes, {
    businessId,
    action: "masters.import-undone",
    reason: `Undo reviewed import ${batchId}`,
  });
  writes.set(ledgerFile(root), {
    schema: 1,
    batches: ledger.batches.map((b) => (b.id === batchId ? updated : b)),
  });
  commitJsonBatch(root, writes, options);
  return updated;
}
