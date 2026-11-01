import { recordFs as fs } from "./sqlite-storage.mjs";
import path from "node:path";
import crypto from "node:crypto";
import {
  readRecord,
  storageError,
  commitJsonBatch,
  validateObject,
} from "./json-storage.mjs";

const fail = (message, status = 409) => {
  throw storageError(message, "accounting-conflict", status);
};
const hash = (value) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const clean = (r) => {
  if (!r) return null;
  const { _revision, ...v } = r;
  return v;
};
const records = (root, dir) =>
  fs.existsSync(path.join(root, dir))
    ? fs
        .readdirSync(path.join(root, dir))
        .filter((n) => n.endsWith(".json"))
        .map((n) => readRecord(path.join(root, dir, n)))
    : [];
export const activeBusiness = (root) =>
  readRecord(path.join(root, "profile.json"));
export function businessOf(root, record) {
  if (record?.businessId) return record.businessId;
  if (record?.profileId) return record.profileId;
  const profile = record?.data?.profile || record?.profile;
  if (profile?.id) return profile.id;
  const gstin = record?.ownerGstin || profile?.gstin,
    name = record?.ownerName || profile?.businessName;
  const candidates = [
    ...records(root, "profiles"),
    activeBusiness(root),
  ].filter(Boolean);
  const matches = candidates.filter((p) =>
    gstin ? p.gstin === gstin : name && p.businessName === name,
  );
  const ids = [...new Set(matches.map((p) => p.id).filter(Boolean))];
  return ids.length === 1 ? ids[0] : null;
}
export function initializeAccounting(root) {
  fs.mkdirSync(path.join(root, "accounting"), { recursive: true });
  const writes = new Map(),
    profiles = records(root, "profiles");
  for (const p of profiles)
    if (!p.id)
      fail(
        "A saved business is missing its ID. Repair the profile before continuing.",
      );
  const file = path.join(root, "profile.json"),
    active = readRecord(file);
  if (active && !active.id) {
    const matches = profiles.filter((p) =>
      active.gstin
        ? p.gstin === active.gstin
        : p.businessName === active.businessName,
    );
    if (matches.length > 1) fail("Business profile identity is ambiguous.");
    writes.set(file, {
      ...active,
      id: matches[0]?.id || "biz_" + crypto.randomUUID(),
    });
  }
  if (writes.size) commitJsonBatch(root, writes);
}
const stateFile = (root, id) =>
  path.join(root, "accounting", hash(id) + ".json");
export function readAccounting(root, id) {
  if (!id) fail("Select a business first.", 400);
  return (
    readRecord(stateFile(root, id)) || {
      schema: 1,
      businessId: id,
      entries: [],
      audit: [],
      movements: [],
      supplierPayments: [],
    }
  );
}
export const ACCOUNTS = [
  ["1000", "Cash / bank", "asset"],
  ["1100", "Customer receivables", "asset"],
  ["1200", "Inventory", "asset"],
  ["1300", "Input tax pending review", "asset"],
  ["1400", "TDS receivable (pending reconciliation)", "asset"],
  ["2000", "Supplier payables", "liability"],
  ["2100", "Output tax", "liability"],
  ["2200", "TCS payable", "liability"],
  ["2300", "Unallocated customer receipts", "liability"],
  ["3000", "Opening equity", "equity"],
  ["4000", "Sales", "income"],
  ["5000", "Purchases (gross; tax unclassified)", "expense"],
  ["5100", "Expenses (gross; tax unclassified)", "expense"],
];
export function minor(value) {
  const text = String(value ?? "");
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(text))
    fail("Enter a non-negative amount with at most two decimal places.", 400);
  const [whole, fraction = ""] = text.split(".");
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (result > BigInt(Number.MAX_SAFE_INTEGER))
    fail("Amount is too large.", 400);
  return Number(result);
}
function date(value) {
  const parsed = new Date(value + "T00:00:00Z");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value || "") ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    fail("Enter a valid date.", 400);
  return value;
}
const currency = (value) => {
  if (value !== "INR")
    fail(
      "This first accounting increment supports INR only. Other-currency billing remains available.",
      400,
    );
  return value;
};
function entry(
  state,
  { id, date: day, memo, currency: unit, lines, source, reversalOf },
) {
  if (state.entries.some((e) => e.id === id))
    fail("Journal identifier already exists.");
  if (!Array.isArray(lines) || lines.length < 2 || lines.length > 100)
    fail("A journal needs 2–100 lines.", 400);
  let debit = 0,
    credit = 0;
  for (const l of lines) {
    if (
      !ACCOUNTS.some((a) => a[0] === l.account) ||
      !Number.isSafeInteger(l.debit) ||
      !Number.isSafeInteger(l.credit) ||
      l.debit < 0 ||
      l.credit < 0 ||
      (!l.debit && !l.credit) ||
      (l.debit && l.credit)
    )
      fail("Invalid journal line.", 400);
    debit += l.debit;
    credit += l.credit;
  }
  if (!Number.isSafeInteger(debit) || debit !== credit)
    fail("Journal debits and credits must balance.", 400);
  const e = {
    id,
    businessId: state.businessId,
    date: date(day),
    memo: String(memo || "").slice(0, 500),
    currency: currency(unit),
    lines,
    source,
    reversalOf,
    recordedAt: new Date().toISOString(),
  };
  state.entries.push(e);
  return e;
}
export function planJournal(root, businessId, input) {
  validateObject(input);
  const state = readAccounting(root, businessId),
    id = input.id;
  if (typeof id !== "string" || !/^[-\w]{8,100}$/.test(id))
    fail("A request identifier is required.", 400);
  const fingerprint = hash(input),
    previous = state.entries.find((e) => e.id === id);
  if (previous) {
    if (previous.requestHash !== fingerprint)
      fail("This request identifier was already used.");
    return { writes: new Map(), result: { entry: previous } };
  }
  let lines;
  if (input.reversalOf) {
    const original = state.entries.find((e) => e.id === input.reversalOf);
    if (!original || original.source)
      fail("Use the source document to reverse this entry.");
    if (state.entries.some((e) => e.reversalOf === original.id))
      fail("Entry already reversed.");
    lines = original.lines.map((l) => ({
      ...l,
      debit: l.credit,
      credit: l.debit,
    }));
    input = { ...input, currency: original.currency };
  } else {
    if (!Array.isArray(input.lines)) fail("Enter journal lines.", 400);
    lines = input.lines.map((l) => ({
      account: l.account,
      debit: minor(l.debit || "0"),
      credit: minor(l.credit || "0"),
    }));
  }
  if (!String(input.memo || "").trim()) fail("Add a journal description.", 400);
  const result = entry(state, { ...input, source: undefined, lines });
  result.requestHash = fingerprint;
  state.audit.push({
    id: crypto.randomUUID(),
    action: input.reversalOf ? "journal.reversed" : "journal.posted",
    entityId: id,
    entityLabel: result.memo,
    actor: "local-session",
    at: result.recordedAt,
  });
  return {
    writes: new Map([[stateFile(root, businessId), state]]),
    result: { entry: result },
  };
}
export function assertStockOwner(root, product, businessId) {
  if (!businessId) return; // Pure legacy fixtures have no selected business; live commands require one.
  if (!product?.businessId)
    fail(
      "Assign this legacy stock item to a business in Products before using it.",
    );
  if (product.businessId !== businessId)
    fail("This stock item belongs to another business.");
}
// Source snapshots are reconciled against active entries, never edited in place.
// A retry or a metadata-only change therefore cannot duplicate a posting.
function sourcePostings(collection, record, bills = []) {
  if (!record) return [];
  const unit =
    record.currency || record.data?.invoiceOptions?.currency || "INR";
  if (unit !== "INR") return []; // No invented exchange rate.
  const result = [];
  const add = (key, day, memo, lines) => {
    lines = lines.filter((l) => l.debit || l.credit);
    if (lines.length)
      result.push({ key, date: date(day), memo, currency: unit, lines });
  };
  const line = (account, debit, credit = 0) => ({ account, debit, credit });
  if (collection === "receipts") {
    // A linked receipt is represented by the invoice payment, never twice.
    if (
      record.billId ||
      record.againstInvoice ||
      bills.some((b) =>
        (b.payments || b.data?.payments || []).some(
          (p) =>
            p.id === record.id ||
            (record.receiptNo && p.receiptNo === record.receiptNo),
        ),
      )
    )
      return [];
    if (record.amount === undefined || !record.date) return [];
    const amount = minor(record.amount);
    add("receipt", record.date, `Receipt: ${record.receiptNo || record.id}`, [
      line("1000", amount),
      line("2300", 0, amount),
    ]);
    return result;
  }
  if (collection === "expenses") {
    if (record.amount === undefined || !record.date) return [];
    const amount = minor(record.amount);
    add("expense", record.date, `Expense: ${record.description || record.id}`, [
      line("5100", amount),
      line("1000", 0, amount),
    ]);
    return result;
  }
  const type = record.invoiceType || record.data?.invoiceType || "tax-invoice";
  if (
    !["tax-invoice", "bill-of-supply", "composition", "credit-note"].includes(
      type,
    ) ||
    record.status === "draft" ||
    record.convertedTo
  )
    return [];
  const day = record.invoiceDate || record.data?.details?.invoiceDate;
  if (record.totalAmount === undefined || !day) return []; // Incomplete legacy records need review.
  const total = minor(record.totalAmount),
    totals = record.data?.totals || {};
  const tax = minor(record.totalTaxAmount ?? totals.totalTaxAmount ?? 0);
  const tcs = minor(totals.tcsAmount ?? 0),
    tds = minor(totals.tdsAmount ?? 0);
  if (tax + tcs > total || tds > total)
    fail("Saved invoice tax/deduction exceeds its total.", 400);
  let lines = [
    line("1100", total - tds),
    line("1400", tds),
    line("4000", 0, total - tax - tcs),
    line("2100", 0, tax),
    line("2200", 0, tcs),
  ];
  if (type === "credit-note")
    lines = lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));
  if (record.status !== "cancelled")
    add(
      "sale",
      day,
      `${type === "credit-note" ? "Credit note" : "Sale"}: ${record.invoiceNumber || record.id}`,
      lines,
    );
  const payments = record.payments || record.data?.payments || [];
  if (!Array.isArray(payments)) fail("Invalid invoice payments.", 400);
  const seen = new Set();
  payments.forEach((p, index) => {
    // Credit allocations transfer an existing customer balance, not cash.
    if (String(p.mode).startsWith("credit-")) return;
    const key = "payment:" + (p.id || `legacy-${index}`);
    if (seen.has(key)) fail("Duplicate invoice payment identifier.", 400);
    seen.add(key);
    const negative = String(p.amount).startsWith("-");
    const amount = minor(negative ? String(p.amount).slice(1) : p.amount);
    add(
      key,
      p.date || day,
      `${negative ? "Customer refund" : "Customer payment"}: ${record.invoiceNumber || record.id}`,
      [
        line("1000", negative ? 0 : amount, negative ? amount : 0),
        line("1100", negative ? amount : 0, negative ? 0 : amount),
      ],
    );
  });
  return result;
}
const sourceOf = (collection, record) =>
  `${{ bills: "sale", expenses: "expense", receipts: "receipt" }[collection]}:${record.id}`;
function reconcileSource(state, collection, old, next, bills = []) {
  const source = sourceOf(collection, next || old);

  const reversed = new Set(
    state.entries.map((e) => e.reversalOf).filter(Boolean),
  );
  const active = state.entries.filter(
    (e) => e.source === source && !e.reversalOf && !reversed.has(e.id),
  );
  if (active.length && next) {
    const unit = next.currency || next.data?.invoiceOptions?.currency || "INR";
    if (unit !== "INR")
      fail(
        "Reverse the source document before changing its accounting currency.",
      );
    if (
      collection === "bills" &&
      (next.totalAmount === undefined ||
        !(next.invoiceDate || next.data?.details?.invoiceDate))
    )
      fail("A posted invoice must retain its amount and date.", 400);
    if (
      ["expenses", "receipts"].includes(collection) &&
      (next.amount === undefined || !next.date)
    )
      fail("A posted expense must retain its amount and date.", 400);
  }
  const desired = sourcePostings(collection, next, bills);
  const fingerprint = (p) =>
    hash({
      key: p.key || p.sourceKey,
      date: p.date,
      memo: p.memo,
      currency: p.currency,
      lines: p.lines,
    });
  for (const previous of active) {
    const match = desired.find((p) => p.key === previous.sourceKey);
    if (match && fingerprint(match) === fingerprint(previous)) continue;
    entry(state, {
      id: crypto.randomUUID(),
      date: previous.date,
      memo: `Reverse: ${previous.memo}`,
      currency: previous.currency,
      source,
      reversalOf: previous.id,
      lines: previous.lines.map((l) => ({
        ...l,
        debit: l.credit,
        credit: l.debit,
      })),
    });
  }
  for (const posting of desired) {
    if (active.some((e) => fingerprint(e) === fingerprint(posting))) continue;
    const saved = entry(state, { ...posting, id: crypto.randomUUID(), source });
    saved.sourceKey = posting.key;
  }
}

export function augmentAccounting(
  root,
  writes,
  { action = "record.changed", businessId, reason = "" } = {},
) {
  const states = new Map(),
    stateFor = (id) => {
      if (!states.has(id))
        states.set(
          id,
          writes.get(stateFile(root, id)) || readAccounting(root, id),
        );
      return states.get(id);
    };
  const recordedOwners = new Map();
  for (const book of records(root, "accounting"))
    for (const e of book.entries || [])
      if (e.source) recordedOwners.set(e.source, book.businessId);
  const bills = new Map(records(root, "bills").map((b) => [b.id, b]));
  for (const [file, next] of writes)
    if (path.basename(path.dirname(file)) === "bills") {
      const old = readRecord(file);
      if (old) bills.delete(old.id);
      if (next) bills.set(next.id, next);
    }
  for (const [file, next] of [...writes]) {
    const dir = path.basename(path.dirname(file));
    if (
      ![
        "bills",
        "receipts",
        "purchases",
        "products",
        "expenses",
        "clients",
        "recurring",
        "trash",
        "profiles",
      ].includes(dir)
    )
      continue;
    const old = readRecord(file);
    if (hash(clean(old)) === hash(clean(next))) continue;
    const id = businessOf(root, next) || businessOf(root, old) || businessId;
    if (!id) continue;
    if (["bills", "expenses", "receipts"].includes(dir)) {
      const recordedOwner = recordedOwners.get(sourceOf(dir, next || old));
      if (recordedOwner && recordedOwner !== id)
        fail(
          "This source already belongs to another business's accounting history.",
        );
    }
    if (old?.businessId && next && old.businessId !== next.businessId)
      fail("Records cannot be moved between businesses.");
    const state = stateFor(id),
      at = new Date().toISOString();
    state.audit.push({
      id: crypto.randomUUID(),
      action,
      collection: dir,
      entityId: (next || old).id,
      entityLabel:
        (next || old).name ||
        (next || old).invoiceNumber ||
        (next || old).receiptNo ||
        (next || old).clientName ||
        (next || old).id,
      actor: "local-session",
      at,
      reason: String(reason).slice(0, 500),
      before: old ? hash(clean(old)) : null,
      after: next ? hash(clean(next)) : null,
      fields: [
        ...new Set([...Object.keys(old || {}), ...Object.keys(next || {})]),
      ].filter((k) => hash(old?.[k] ?? null) !== hash(next?.[k] ?? null)),
    });
    if (["bills", "expenses", "receipts"].includes(dir)) {
      const previousOwner = businessOf(root, old),
        nextOwner = businessOf(root, next);
      if (previousOwner && next && previousOwner !== nextOwner)
        fail("Posted document business cannot change.");
      if (nextOwner || previousOwner)
        reconcileSource(state, dir, old, next, [...bills.values()]);
    }
    if (dir === "products") {
      if (old?.businessId && old.businessId !== id)
        fail("Stock business mismatch.");
      const delta =
        Math.round(
          (Number(next?.stock || 0) - Number(old?.stock || 0)) * 1000,
        ) / 1000;
      if (!Number.isFinite(delta)) fail("Invalid stock quantity.", 400);
      if (delta || (!old?.businessId && next?.businessId))
        state.movements.push({
          id: crypto.randomUUID(),
          businessId: id,
          productId: (next || old).id,
          productName: (next || old).name,
          quantity: !old?.businessId ? Number(next?.stock || 0) : delta,
          balance: Number(next?.stock || 0),
          action,
          reason,
          at,
        });
    }
    if (dir === "purchases" && old?.accountingManaged) {
      if (!next)
        fail(
          "Reverse supplier payments and retain the tracked purchase instead of deleting it.",
        );
      if (
        hash(old.items) !== hash(next.items) ||
        Number(old.totalAmount) !== Number(next.totalAmount) ||
        old.supplierName !== next.supplierName ||
        old.supplierGstin !== next.supplierGstin
      )
        fail(
          "This purchase has posted accounts. Use a correcting journal; its original amount and supplier are locked.",
        );
    }
  }
  // Invoice edits can adopt a pre-existing standalone receipt without changing
  // its payload (legacy/raw save path). Reconcile that dependent source too.
  const affectedPayments = [];
  for (const [file, next] of writes)
    if (path.basename(path.dirname(file)) === "bills") {
      for (const b of [readRecord(file), next])
        if (b) affectedPayments.push(...(b.payments || b.data?.payments || []));
    }
  for (const receipt of records(root, "receipts")) {
    if (
      !affectedPayments.some(
        (p) =>
          p.id === receipt.id ||
          (receipt.receiptNo && p.receiptNo === receipt.receiptNo),
      )
    )
      continue;
    const file = path.join(
      root,
      "receipts",
      receipt.id.replace(/[/\\:*?"<>|]/g, "_") + ".json",
    );
    if (writes.has(file)) continue;
    const owner = businessOf(root, receipt);
    if (!owner) continue;
    const linked = [...bills.values()].filter((b) =>
      (b.payments || b.data?.payments || []).some(
        (p) =>
          p.id === receipt.id ||
          (receipt.receiptNo && p.receiptNo === receipt.receiptNo),
      ),
    );
    if (linked.some((b) => businessOf(root, b) !== owner))
      fail("Receipt payment belongs to another business.");
    reconcileSource(stateFor(owner), "receipts", receipt, receipt, [
      ...bills.values(),
    ]);
  }
  for (const [id, state] of states) writes.set(stateFile(root, id), state);
  return writes;
}
export function planSupplierPayment(root, businessId, input) {
  validateObject(input);
  const state = readAccounting(root, businessId);
  if (typeof input.id !== "string" || !/^[-\w]{8,100}$/.test(input.id))
    fail("A request identifier is required.", 400);
  const fingerprint = hash(input),
    existing = state.supplierPayments.find((p) => p.id === input.id);
  if (existing) {
    if (existing.requestHash !== fingerprint)
      fail("This request identifier was already used.");
    return { writes: new Map(), result: { payment: existing } };
  }
  const purchase = records(root, "purchases").find(
    (p) => p.id === input.purchaseId,
  );
  if (!purchase || businessOf(root, purchase) !== businessId)
    fail("Purchase does not belong to this business.");
  if (input.revision !== hash(clean(purchase)))
    fail("Purchase changed. Reload before recording payment.");
  if (
    !purchase.accountingManaged &&
    purchase.paymentStatus &&
    purchase.paymentStatus !== "Unpaid"
  )
    fail(
      "Legacy paid or partial purchases need their opening payment history reconciled before tracking new payments.",
    );
  const amount = minor(input.amount),
    total = minor(purchase.totalAmount),
    unit = currency(purchase.currency || "INR");
  if (!amount) fail("Payment must be positive.", 400);
  if (!["1000"].includes(input.account || "1000"))
    fail("Choose a cash/bank account.", 400);
  const day = date(input.date),
    prior = state.supplierPayments.filter((p) => p.purchaseId === purchase.id),
    paid = prior.reduce((s, p) => s + (p.reversalOf ? -p.amount : p.amount), 0);
  let reversing;
  if (input.reversalOf) {
    reversing = prior.find((p) => p.id === input.reversalOf && !p.reversalOf);
    if (
      !reversing ||
      prior.some((p) => p.reversalOf === reversing.id) ||
      reversing.amount !== amount
    )
      fail("Payment cannot be reversed.");
  } else if (paid + amount > total)
    fail("Payment exceeds the outstanding purchase balance.");
  if (!purchase.accountingManaged)
    entry(state, {
      id: crypto.randomUUID(),
      date: purchase.date || day,
      currency: unit,
      memo: `Opening payable: ${purchase.invoiceNumber || purchase.id}`,
      source: "purchase:" + purchase.id,
      lines: [
        { account: "5000", debit: total, credit: 0 },
        { account: "2000", debit: 0, credit: total },
      ],
    });
  entry(state, {
    id: crypto.randomUUID(),
    date: day,
    currency: unit,
    memo: `${reversing ? "Reverse payment" : "Supplier payment"}: ${purchase.supplierName}`,
    source: "supplier-payment:" + input.id,
    lines: [
      {
        account: "2000",
        debit: reversing ? 0 : amount,
        credit: reversing ? amount : 0,
      },
      {
        account: "1000",
        debit: reversing ? amount : 0,
        credit: reversing ? 0 : amount,
      },
    ],
  });
  const payment = {
    id: input.id,
    businessId,
    purchaseId: purchase.id,
    supplierName: purchase.supplierName,
    amount,
    currency: unit,
    date: day,
    reference: String(input.reference || "").slice(0, 200),
    reversalOf: input.reversalOf || null,
    requestHash: fingerprint,
    at: new Date().toISOString(),
  };
  state.supplierPayments.push(payment);
  const nextPaid = paid + (reversing ? -amount : amount),
    updated = {
      ...purchase,
      businessId,
      accountingManaged: true,
      supplierPaidMinor: nextPaid,
      paymentStatus:
        nextPaid === total ? "Paid" : nextPaid ? "Partial" : "Unpaid",
    };
  const file = path.join(
    root,
    "purchases",
    purchase.id.replace(/[/\\:*?"<>|]/g, "_") + ".json",
  );
  return {
    writes: new Map([
      [file, updated],
      [stateFile(root, businessId), state],
    ]),
    result: { payment, purchase: updated },
  };
}

// Backfill is explicit and source-linked. It never rewrites source documents,
// replays stock, invents old cash receipts or reopens a source already in history.
export function previewBackfill(root, businessId) {
  const state = readAccounting(root, businessId),
    bills = records(root, "bills");
  const collections = {
    bills,
    expenses: records(root, "expenses"),
    receipts: records(root, "receipts"),
  };
  const rows = [];
  const history = new Set(state.entries.map((e) => e.source).filter(Boolean));
  const foreignHistory = new Set(
    records(root, "accounting")
      .filter((book) => book.businessId !== businessId)
      .flatMap((book) => (book.entries || []).map((e) => e.source))
      .filter(Boolean),
  );
  const paymentsFor = (id, receiptNo) =>
    bills.filter((b) =>
      (b.payments || b.data?.payments || []).some(
        (p) => (id && p.id === id) || (receiptNo && p.receiptNo === receiptNo),
      ),
    );
  for (const [collection, items] of Object.entries(collections))
    for (const record of items) {
      const owner = businessOf(root, record);
      if (owner && owner !== businessId) continue;
      const row = {
        collection,
        id: record.id,
        label:
          record.invoiceNumber ||
          record.description ||
          record.receiptNo ||
          record.id,
        status: "review",
        reason: "",
        postings: [],
      };
      rows.push(row);
      if (!owner) {
        row.reason = "Assign this record to a business first.";
        continue;
      }
      if (foreignHistory.has(sourceOf(collection, record))) {
        row.reason = "Source belongs to another business's accounting history.";
        continue;
      }
      if (history.has(sourceOf(collection, record))) {
        row.status = "posted";
        row.reason =
          "Source already has journal history; it will not be posted again.";
        continue;
      }
      try {
        const number =
          collection === "bills"
            ? record.invoiceNumber
            : collection === "receipts"
              ? record.receiptNo
              : record.invoiceNo;
        if (
          number &&
          items.filter(
            (r) =>
              businessOf(root, r) === businessId &&
              (collection === "bills"
                ? r.invoiceNumber
                : collection === "receipts"
                  ? r.receiptNo
                  : r.invoiceNo) === number &&
              (collection !== "expenses" ||
                (r.vendorGstin || r.vendorName) ===
                  (record.vendorGstin || record.vendorName)),
          ).length > 1
        )
          throw Error("Duplicate document reference needs review.");
        if (
          (record.currency ||
            record.data?.invoiceOptions?.currency ||
            "INR") !== "INR"
        )
          throw Error(
            "Foreign-currency accounting requires an exchange-rate policy.",
          );
        if (collection === "bills") {
          const type =
            record.invoiceType || record.data?.invoiceType || "tax-invoice";
          if (
            ![
              "tax-invoice",
              "bill-of-supply",
              "composition",
              "credit-note",
            ].includes(type) ||
            record.status === "draft" ||
            record.convertedTo
          ) {
            row.status = "excluded";
            row.reason = "Not a sales document.";
            continue;
          }
          if (
            record.totalAmount === undefined ||
            !(record.invoiceDate || record.data?.details?.invoiceDate)
          )
            throw Error("Missing invoice amount or date.");
          if (
            ["tax-invoice", "credit-note"].includes(type) &&
            record.totalTaxAmount === undefined &&
            record.data?.totals?.totalTaxAmount === undefined
          )
            throw Error(
              "Missing saved tax total; review rather than recalculate historical tax.",
            );
          const payments = record.payments || record.data?.payments || [];
          if (!Array.isArray(payments)) throw Error("Invalid payment history.");
          if (payments.some((p) => String(p.mode).startsWith("credit-")))
            throw Error(
              "Review legacy customer-credit allocations before backfill.",
            );
          const paid = payments.reduce(
            (n, p) => n + Math.round(Number(p.amount) * 100),
            0,
          );
          if (!Number.isSafeInteger(paid))
            throw Error("Invalid payment history.");
          if (
            record.paidAmount !== undefined &&
            Math.round(Number(record.paidAmount) * 100) !== paid
          )
            throw Error("Paid amount does not reconcile with payment history.");
          if (["paid", "partial"].includes(record.status) && !payments.length)
            throw Error("Paid status has no supporting payment history.");
          for (const p of payments) {
            if (!p.date)
              throw Error(
                "Payment date is missing; review the historical collection.",
              );
            if (paymentsFor(p.id, p.receiptNo).length > 1)
              throw Error("Payment identifier appears on multiple invoices.");
            const mirrors = collections.receipts.filter(
              (r) =>
                r.id === p.id || (p.receiptNo && r.receiptNo === p.receiptNo),
            );
            if (
              mirrors.length > 1 ||
              mirrors.some(
                (r) =>
                  businessOf(root, r) !== businessId ||
                  Number(r.amount) !== Number(p.amount) ||
                  (r.billId && r.billId !== record.id),
              )
            )
              throw Error("Receipt and invoice payment history disagree.");
          }
        } else {
          if (record.amount === undefined || !record.date)
            throw Error("Missing amount or date.");
          if (!minor(record.amount)) throw Error("Amount must be positive.");
          if (collection === "receipts") {
            const linked = paymentsFor(record.id, record.receiptNo);
            if (
              linked.length === 1 &&
              businessOf(root, linked[0]) === businessId
            ) {
              row.status = "excluded";
              row.reason =
                "Represented by the invoice payment; not posted separately.";
              continue;
            }
            if (record.billId || record.againstInvoice || linked.length)
              throw Error(
                "Invoice reference/payment link needs reconciliation.",
              );
          }
        }
        const postings = sourcePostings(collection, record, bills);
        // Validate every line and date before presenting an eligible candidate.
        const trial = { ...state, entries: [] };
        for (const p of postings)
          entry(trial, { ...p, id: crypto.randomUUID() });
        row.postings = postings;
        row.status = postings.length ? "ready" : "excluded";
        row.reason = postings.length
          ? "Ready for source-linked posting."
          : "No financial posting required.";
      } catch (error) {
        row.reason = error.message;
      }
    }
  rows.sort((a, b) =>
    (a.collection + ":" + a.id).localeCompare(b.collection + ":" + b.id),
  );
  return {
    businessId,
    token: hash({
      businessId,
      state,
      collections,
      books: records(root,"accounting"),
      profiles: records(root, "profiles"),
      active: activeBusiness(root),
    }),
    rows,
    ready: rows.filter((r) => r.status === "ready").length,
    review: rows.filter((r) => r.status === "review").length,
    manualEntries: state.entries.filter((e) => !e.source).length,
  };
}
export function planBackfill(root, businessId, input) {
  validateObject(input);
  const state = readAccounting(root, businessId);
  const completed = state.audit.find(
    (a) =>
      a.action === "accounting.backfilled" && a.previewToken === input.token,
  );
  if (completed)
    return {
      writes: new Map(),
      result: { ...completed.result, replayed: true },
    };
  const preview = previewBackfill(root, businessId);
  if (typeof input.token !== "string" || input.token !== preview.token)
    fail("Records changed since preview. Review a fresh backfill preview.");
  if (input.reviewedManualEntries !== true)
    fail("Review existing manual journals before applying backfill.", 400);
  const start = state.entries.length;
  for (const row of preview.rows.filter((r) => r.status === "ready")) {
    for (const p of row.postings) {
      const saved = entry(state, {
        ...p,
        id: crypto.randomUUID(),
        source: sourceOf(row.collection, row),
      });
      saved.sourceKey = p.key;
    }
  }
  const result = {
    postedRecords: preview.ready,
    postedEntries: state.entries.length - start,
    review: preview.review,
  };
  state.audit.push({
    id: crypto.randomUUID(),
    action: "accounting.backfilled",
    entityLabel: "Reviewed historical backfill",
    actor: "local-session",
    at: new Date().toISOString(),
    previewToken: input.token,
    result,
  });
  return { writes: new Map([[stateFile(root, businessId), state]]), result };
}
