import crypto from "node:crypto";
import {
  importBatches,
  commitMasterImport,
  undoMasterImport,
} from "./ai-import-transactions.mjs";
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const fingerprint = (value) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const normalize = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();
export const IMPORT_FIELDS = {
  clients: [
    "name",
    "gstin",
    "email",
    "phone",
    "address",
    "city",
    "state",
    "pin",
  ],
  products: [
    "name",
    "hsn",
    "unit",
    "sellingPrice",
    "purchasePrice",
    "taxPercent",
    "cessPercent",
    "description",
  ],
};
export function strictImportCsv(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 250000)
    fail("Choose a CSV file up to 250 KB.");
  text = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [],
    cell = "",
    quoted = false,
    closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else cell += c;
    } else if (c === '"') {
      if (cell || closed)
        fail(
          "CSV has an unexpected quote. Export a standard comma-separated CSV.",
        );
      quoted = true;
    } else if (c === "," || c === "\n" || c === "\r") {
      row.push(cell);
      cell = "";
      closed = false;
      if (c !== ",") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        if (row.some((v) => v.trim())) rows.push(row);
        row = [];
      }
    } else {
      if (closed) fail("CSV has text after a closing quote.");
      cell += c;
    }
    if (cell.length > 2000 || row.length > 40 || rows.length > 301)
      fail("Use up to 300 rows, 40 columns and 2,000 characters per cell.");
  }
  if (quoted) fail("CSV has an unclosed quote.");
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  if (rows.length < 2 || rows.length > 301 || rows[0].length > 40)
    fail("Use a header row and between 1 and 300 data rows.");
  const headers = rows[0].map((v) => v.trim());
  if (
    headers.some((v) => !v || v.length > 100) ||
    new Set(headers.map(normalize)).size !== headers.length
  )
    fail(
      "Every column needs a unique, nonempty header of up to 100 characters.",
    );
  if (rows.slice(1).some((r) => r.length !== headers.length))
    fail("CSV rows must have the same number of columns as the header.");
  return { headers, rows: rows.slice(1) };
}
function mappedRecord(kind, row, headers, mapping) {
  const result = {};
  for (const field of IMPORT_FIELDS[kind]) {
    const column = mapping[field];
    if (column !== undefined && column !== "")
      result[field] = row[headers.indexOf(column)].trim();
  }
  if (!result.name || result.name.length > 500)
    fail("Name is required and must be at most 500 characters.");
  for (const value of Object.values(result))
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))
      fail("Control characters are not allowed.");
  if (kind === "clients") {
    if (
      result.gstin &&
      !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(result.gstin)
    )
      fail("GSTIN format is invalid.");
    if (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email))
      fail("Email format is invalid.");
    if (result.pin && !/^\d{6}$/.test(result.pin))
      fail("PIN code must contain six digits.");
  } else {
    if (result.hsn && !/^\d{4,8}$/.test(result.hsn))
      fail("HSN/SAC must contain 4 to 8 digits.");
    for (const field of [
      "sellingPrice",
      "purchasePrice",
      "taxPercent",
      "cessPercent",
    ]) {
      const raw = result[field] || "0";
      if (!/^\d+(?:\.\d{1,2})?$/.test(raw))
        fail(
          `${field} must be a nonnegative number with at most two decimals.`,
        );
      const value = Number(raw),
        maximum =
          field === "taxPercent" ? 100 : field === "cessPercent" ? 1000 : 1e9;
      if (!Number.isFinite(value) || value > maximum)
        fail(`${field} is outside the allowed range.`);
      result[field] = value;
    }
    result.rate = result.sellingPrice;
    result.stock = 0;
    result.unit ||= "Pcs";
  }
  return result;
}
export function importReview({
  readModule,
  store,
  dataDir,
  beforeWrite = () => {},
  createBackup,
  invalidate = () => {},
}) {
  const scope = (input) => {
    if (
      !input ||
      typeof input.businessId !== "string" ||
      !input.businessId ||
      input.businessId.length > 120
    )
      fail("Select the active business.");
    return readModule(input.businessId, "profile");
  };
  const source = (businessId, kind) => ({
    profile: readModule(businessId, "profile"),
    records: readModule(businessId, kind),
  });
  const state = (input) => {
    scope(input);
    return store.read({ businessId: input.businessId, bucket: "imports" });
  };
  const currentPlan = (input) => {
    const saved = state(input),
      plan = (saved.data.plans || []).find((p) => p.id === input.planId);
    if (!plan || Date.parse(plan.expiresAt) < Date.now())
      fail("Import preview expired. Preview the file again.", 409);
    if (plan.fingerprint !== fingerprint(source(input.businessId, plan.kind)))
      fail("Your business or catalog changed. Preview the import again.", 409);
    return { saved, plan };
  };
  return {
    inspect: (input) => {
      scope(input);
      const parsed = strictImportCsv(input.text);
      return {
        headers: parsed.headers,
        sample: parsed.rows.slice(0, 3),
        rowCount: parsed.rows.length,
        fields: IMPORT_FIELDS,
      };
    },
    history: (input) => {
      scope(input);
      return { batches: importBatches(dataDir, input.businessId) };
    },
    preview: (input) => {
      const saved = state(input);
      if (!IMPORT_FIELDS[input.kind]) fail("Choose clients or products.");
      if (
        typeof input.name !== "string" ||
        !input.name.trim() ||
        input.name.length > 200
      )
        fail("Choose a named CSV file.");
      const { headers, rows } = strictImportCsv(input.text),
        mapping = input.mapping;
      if (
        !mapping ||
        typeof mapping !== "object" ||
        Array.isArray(mapping) ||
        !mapping.name ||
        Object.keys(mapping).some(
          (k) => !IMPORT_FIELDS[input.kind].includes(k),
        ) ||
        Object.values(mapping).some(
          (v) => typeof v !== "string" || (v && !headers.includes(v)),
        )
      )
        fail("Review the column mapping. Name is required.");
      const used = Object.values(mapping).filter(Boolean);
      if (new Set(used).size !== used.length)
        fail("Map each source column to one field only.");
      const snapshot = source(input.businessId, input.kind),
        names = new Set(snapshot.records.map((r) => normalize(r.name))),
        gstins = new Set(snapshot.records.map((r) => r.gstin).filter(Boolean));
      const records = [],
        skipped = [],
        errors = [];
      for (const [index, row] of rows.entries()) {
        try {
          const record = mappedRecord(input.kind, row, headers, mapping);
          if (
            names.has(normalize(record.name)) ||
            (input.kind === "clients" &&
              record.gstin &&
              gstins.has(record.gstin))
          ) {
            skipped.push({
              row: index + 2,
              name: record.name,
              reason: "Name or GSTIN already present in this business or file.",
            });
            continue;
          }
          names.add(normalize(record.name));
          if (record.gstin) gstins.add(record.gstin);
          records.push({
            ...record,
            id:
              (input.kind === "clients" ? "cli_" : "prod_") +
              crypto.randomUUID(),
            businessId: input.businessId,
          });
        } catch (error) {
          errors.push({ row: index + 2, message: error.message });
        }
      }
      const plan = {
        id: crypto.randomUUID(),
        kind: input.kind,
        name: input.name,
        mapping,
        rowCount: rows.length,
        records,
        skipped,
        errors,
        fingerprint: fingerprint(snapshot),
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 10 * 60e3).toISOString(),
        summary: {
          ready: records.length,
          skipped: skipped.length,
          errors: errors.length,
          openingStock: 0,
          openingBalance: 0,
        },
      };
      store.update({
        businessId: input.businessId,
        bucket: "imports",
        revision: saved.revision,
        data: {
          plans: [
            ...(saved.data.plans || [])
              .filter((p) => Date.parse(p.expiresAt) > Date.now())
              .slice(-4),
            plan,
          ],
        },
      });
      return plan;
    },
    commit: (input) => {
      scope(input);
      const prior = importBatches(dataDir, input.businessId).find(
        (b) => b.id === input.planId,
      );
      if (prior) {
        if (prior.status !== "imported")
          fail("This batch was undone. Make a new preview.", 409);
        return { batch: prior, repeated: true };
      }
      const { plan } = currentPlan(input);
      if (input.confirm !== true) fail("Confirm the preview before importing.");
      if (plan.errors.length || !plan.records.length)
        fail("Fix all row errors and include at least one new record.");
      beforeWrite();
      if (typeof createBackup !== "function")
        fail(
          "Verified backups are unavailable. No records were imported.",
          503,
        );
      const backup = createBackup();
      if (!backup?.name)
        fail(
          "Verified backup could not be created. No records were imported.",
          503,
        );
      beforeWrite();
      currentPlan(input);
      const batch = commitMasterImport(dataDir, {
        businessId: input.businessId,
        batchId: plan.id,
        kind: plan.kind,
        records: plan.records,
        sourceName: plan.name,
        backup: backup.name,
      });
      invalidate(plan.kind);
      return { batch };
    },
    undo: (input) => {
      scope(input);
      if (input.confirm !== true) fail("Confirm undoing this import batch.");
      const ids = new Set(
        (
          importBatches(dataDir, input.businessId).find(
            (b) => b.id === input.batchId,
          )?.records || []
        ).map((r) => r.id),
      );
      const catalog = store.read({
        businessId: input.businessId,
        bucket: "catalog",
      }).data;
      if ((catalog.aliases || []).some((a) => ids.has(a.targetId)))
        fail(
          "An imported record has a catalog alias. Remove that alias before undoing.",
          409,
        );
      const matching = store.read({
        businessId: input.businessId,
        bucket: "matching",
      }).data;
      const linkedParty = (partyId) =>
        typeof partyId === "string" &&
        partyId.startsWith("client:") &&
        ids.has(partyId.slice(7));
      if (
        (matching.rules || []).some((rule) => linkedParty(rule.partyId)) ||
        (matching.statements || []).some((statement) =>
          (statement.rows || []).some((row) =>
            linkedParty(row.classification?.partyId),
          ),
        )
      )
        fail(
          "An imported client is used in bank matching. Remove its matching decisions before undoing.",
          409,
        );
      beforeWrite();
      const batch = undoMasterImport(dataDir, {
        businessId: input.businessId,
        batchId: input.batchId,
      });
      invalidate(batch.kind);
      return { batch };
    },
  };
}
