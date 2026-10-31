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
function sourcePostings(collection, record) {
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
function reconcileSource(state, collection, old, next) {
  const source = `${collection === "bills" ? "sale" : "expense"}:${(next || old).id}`;

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
    if (collection === "expenses" && (next.amount === undefined || !next.date))
      fail("A posted expense must retain its amount and date.", 400);
  }
  const desired = sourcePostings(collection, next);
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
    if (dir === "bills" || dir === "expenses") {
      const previousOwner = businessOf(root, old),
        nextOwner = businessOf(root, next);
      if (previousOwner && next && previousOwner !== nextOwner)
        fail("Posted document business cannot change.");
      if (nextOwner || previousOwner) reconcileSource(state, dir, old, next);
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
