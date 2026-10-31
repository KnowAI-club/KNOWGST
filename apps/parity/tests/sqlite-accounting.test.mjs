import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import {
  openRecordDatabase,
  recordFs,
  commitSqliteFiles,
  withDatabaseClosed,
} from "../sqlite-storage.mjs";
import { readRecord, commitJsonBatch } from "../json-storage.mjs";
import {
  planJournal,
  planSupplierPayment,
  readAccounting,
  augmentAccounting,
  initializeAccounting,
} from "../accounting.mjs";
import { planPurchase } from "../workflow-transactions.mjs";
import { planInvoices, invoiceRevision } from "../invoice-transactions.mjs";
import {
  createVerifiedBackup,
  restoreVerifiedBackup,
} from "../verified-backup.mjs";
function setup(t) {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "kg-sqlite-")),
    root = path.join(runtime, "data");
  for (const dir of [
    "bills",
    "products",
    "purchases",
    "receipts",
    "profiles",
    "trash",
    "recurring",
    "accounting",
  ])
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  const file = (dir, id) => path.join(root, dir, id + ".json");
  fs.writeFileSync(
    path.join(root, "profile.json"),
    JSON.stringify({ id: "A", businessName: "A" }),
  );
  let db = openRecordDatabase(root);
  initializeAccounting(root);
  t.after(() => {
    try {
      db.close();
    } catch {}
    fs.rmSync(runtime, { recursive: true, force: true });
  });
  const commit = (plan) => {
    augmentAccounting(root, plan.writes, { businessId: "A" });
    commitJsonBatch(root, plan.writes);
    return plan.result;
  };
  return {
    root,
    runtime,
    file,
    get db() {
      return db;
    },
    commit,
    read: (dir, id) => readRecord(file(dir, id)),
    write: (dir, id, v) => commitJsonBatch(root, new Map([[file(dir, id), v]])),
    reopen: () => (db = openRecordDatabase(root)),
  };
}
test("SQLite 3.54.1 migrates exact records and ignores stale legacy JSON after restart", (t) => {
  const f = setup(t);
  assert.equal(f.db.version, "3.54.1");
  assert.equal(f.db.db.pragma("journal_mode", { simple: true }), "wal");
  assert.equal(f.db.db.pragma("foreign_keys", { simple: true }), 1);
  f.write("products", "p", { id: "p", stock: 4 });
  fs.writeFileSync(f.file("products", "p"), "corrupt legacy");
  assert.equal(f.read("products", "p").stock, 4);
  f.db.close();
  f.reopen();
  assert.equal(f.read("products", "p").stock, 4);
  assert.equal(f.db.db.pragma("integrity_check", { simple: true }), "ok");
  assert.ok(fs.readdirSync(f.runtime).some((n) => n.startsWith("pre-sqlite-")));
});
test("database transaction rollback and process exit cannot publish partial records", (t) => {
  const f = setup(t);
  f.write("products", "p", { id: "p", stock: 4 });
  assert.throws(() =>
    commitJsonBatch(
      f.root,
      new Map([
        [f.file("products", "p"), { id: "p", stock: 2 }],
        [f.file("bills", "b"), { id: "b" }],
      ]),
      {
        beforeInstall(i) {
          if (i === 1) throw Error("failure");
        },
      },
    ),
  );
  assert.equal(f.read("products", "p").stock, 4);
  assert.equal(f.read("bills", "b"), null);
  const script = `import {openRecordDatabase} from ${JSON.stringify(new URL("../sqlite-storage.mjs", import.meta.url).href)};const s=openRecordDatabase(${JSON.stringify(f.root)});s.db.exec('BEGIN IMMEDIATE');s.put('products/p.json','{"id":"p","stock":0}');process.exit(9);`;
  assert.equal(
    spawnSync(process.execPath, ["--input-type=module", "-e", script]).status,
    9,
  );
  assert.equal(f.read("products", "p").stock, 4);
});
test("balanced journal, idempotency, reversal and immutable history", (t) => {
  const f = setup(t),
    input = {
      id: "journal-first",
      date: "2026-10-30",
      currency: "INR",
      memo: "Opening cash",
      lines: [
        { account: "1000", debit: "100.01" },
        { account: "3000", credit: "100.01" },
      ],
    };
  f.commit(planJournal(f.root, "A", input));
  f.commit(planJournal(f.root, "A", input));
  assert.equal(readAccounting(f.root, "A").entries.length, 1);
  assert.throws(
    () =>
      planJournal(f.root, "A", {
        ...input,
        id: "journal-bad",
        lines: [
          { account: "1000", debit: "100" },
          { account: "3000", credit: "99" },
        ],
      }),
    /balance/,
  );
  assert.throws(
    () =>
      planJournal(f.root, "A", {
        ...input,
        id: "journal-bad",
        date: "2026-99-01",
      }),
    /valid date/,
  );
  assert.throws(
    () => planJournal(f.root, "A", { ...input, memo: "changed" }),
    /already used/,
  );
  f.commit(
    planJournal(f.root, "A", {
      id: "journal-reverse",
      date: "2026-10-30",
      memo: "Correct opening",
      reversalOf: input.id,
    }),
  );
  const state = readAccounting(f.root, "A");
  assert.equal(state.entries.length, 2);
  assert.equal(state.entries[1].lines[0].credit, 10001);
  const row = f.db.rows().find((r) => r.path.startsWith("accounting/"));
  const tampered = JSON.parse(row.payload);
  tampered.entries[0].memo = "hidden correction";
  assert.throws(
    () => f.db.put(row.path, JSON.stringify(tampered)),
    /immutable/,
  );
  assert.equal(readAccounting(f.root, "B").entries.length, 0);
});
test("supplier payment, payable, reversal and audit commit together", (t) => {
  const f = setup(t),
    purchase = {
      id: "purchase",
      businessId: "A",
      supplierName: "Supplier",
      invoiceNumber: "S1",
      date: "2026-10-30",
      totalAmount: 118,
      items: [],
      paymentStatus: "Unpaid",
    };
  f.write("purchases", "purchase", purchase);
  const input = {
    id: "payment-first",
    purchaseId: "purchase",
    revision: invoiceRevision(purchase),
    amount: "40",
    date: "2026-10-30",
  };
  const plan = planSupplierPayment(f.root, "A", input);
  augmentAccounting(f.root, plan.writes, { businessId: "A" });
  assert.throws(() =>
    commitJsonBatch(f.root, plan.writes, {
      beforeInstall(i) {
        if (i === 1) throw Error("rollback");
      },
    }),
  );
  assert.equal(f.read("purchases", "purchase").accountingManaged, undefined);
  assert.equal(readAccounting(f.root, "A").entries.length, 0);
  f.commit(planSupplierPayment(f.root, "A", input));
  f.commit(planSupplierPayment(f.root, "A", input));
  let updated = f.read("purchases", "purchase");
  assert.equal(updated.paymentStatus, "Partial");
  assert.equal(updated.supplierPaidMinor, 4000);
  const state = readAccounting(f.root, "A");
  assert.equal(state.entries.length, 2);
  assert.equal(state.supplierPayments.length, 1);
  assert.ok(state.audit.length);
  assert.throws(
    () => planSupplierPayment(f.root, "A", { ...input, id: "payment-stale" }),
    /changed/,
  );
  assert.throws(
    () => planSupplierPayment(f.root, "B", { ...input, id: "payment-other" }),
    /business/,
  );
  assert.throws(
    () =>
      planSupplierPayment(f.root, "A", {
        ...input,
        id: "payment-excess",
        revision: invoiceRevision(updated),
        amount: "100",
      }),
    /exceeds/,
  );
  f.commit(
    planSupplierPayment(f.root, "A", {
      id: "payment-reverse",
      purchaseId: "purchase",
      revision: invoiceRevision(updated),
      reversalOf: input.id,
      amount: "40",
      date: "2026-10-30",
    }),
  );
  assert.equal(f.read("purchases", "purchase").supplierPaidMinor, 0);
  assert.equal(readAccounting(f.root, "A").entries.length, 3);
  assert.throws(
    () =>
      f.commit(
        planPurchase(f.root, {
          ...f.read("purchases", "purchase"),
          _revision: invoiceRevision(f.read("purchases", "purchase")),
          totalAmount: 120,
        }),
      ),
    /posted accounts/,
  );
});
test("business inventory rejects cross-business items and tracks same-name products separately", (t) => {
  const f = setup(t);
  for (const id of ["A", "B"])
    f.write("products", id, {
      id,
      name: "Same name",
      businessId: id,
      stock: 10,
    });
  f.commit(
    planPurchase(f.root, {
      id: "p",
      businessId: "A",
      items: [{ name: "Same name", quantity: 2, rate: 10 }],
    }),
  );
  assert.equal(f.read("products", "A").stock, 12);
  assert.equal(f.read("products", "B").stock, 10);
  assert.throws(
    () =>
      planInvoices(f.root, [
        {
          bill: {
            id: "b",
            businessId: "A",
            data: { items: [{ productId: "B", quantity: 1 }] },
          },
        },
      ]),
    /another business/,
  );
  assert.throws(
    () =>
      planPurchase(f.root, {
        id: "bad",
        businessId: "A",
        items: [{ productId: "B", name: "Same name", quantity: 1, rate: 10 }],
      }),
    /missing/,
  );
  assert.ok(
    readAccounting(f.root, "A").movements.some(
      (m) => m.productId === "A" && m.quantity === 2,
    ),
  );
});
test("SQLite records, journals and PDF bytes survive verified portable restore", (t) => {
  const f = setup(t);
  f.commit(
    planJournal(f.root, "A", {
      id: "journal-backup",
      date: "2026-10-30",
      currency: "INR",
      memo: "Opening",
      lines: [
        { account: "1000", debit: "5" },
        { account: "3000", credit: "5" },
      ],
    }),
  );
  const sale = saleFixture();
  f.commit({ writes: new Map([[f.file("bills", sale.id), sale]]) });
  const journalBefore = readAccounting(f.root, "A");
  const pdf = path.join(f.runtime, "Saved Invoices"),
    trash = path.join(f.runtime, "Trash");
  fs.mkdirSync(pdf);
  fs.mkdirSync(trash);
  fs.writeFileSync(path.join(pdf, "one.pdf"), "original");
  const backup = path.join(f.runtime, "backup");
  createVerifiedBackup(f.root, backup, { pdfDir: pdf, trashDir: trash });
  assert.equal(
    fs.existsSync(path.join(backup, "data", "knowgst.sqlite")),
    false,
  );
  f.write("products", "later", { id: "later" });
  fs.writeFileSync(path.join(pdf, "one.pdf"), "changed");
  withDatabaseClosed(f.root, () =>
    restoreVerifiedBackup(f.root, backup, { pdfDir: pdf, trashDir: trash }),
  );
  f.reopen();
  assert.equal(f.read("products", "later"), null);
  assert.deepEqual(readAccounting(f.root, "A"), journalBefore);
  assert.equal(fs.readFileSync(path.join(pdf, "one.pdf"), "utf8"), "original");
});

test("committed PDF jobs recover forward after process exit without losing database changes", (t) => {
  const f = setup(t),
    pdf = path.join(f.runtime, "Saved Invoices", "recover.pdf");
  fs.mkdirSync(path.dirname(pdf));
  fs.writeFileSync(pdf, "old");
  const script = `import {openRecordDatabase,commitSqliteFiles} from ${JSON.stringify(new URL("../sqlite-storage.mjs", import.meta.url).href)};openRecordDatabase(${JSON.stringify(f.root)});commitSqliteFiles(${JSON.stringify(f.runtime)},new Map([[${JSON.stringify(f.file("bills", "recovered"))},Buffer.from('{"id":"recovered"}')],[${JSON.stringify(pdf)},Buffer.from('new')]]),{afterCommit(){process.exit(9);}});`;
  assert.equal(
    spawnSync(process.execPath, ["--input-type=module", "-e", script]).status,
    9,
  );
  assert.equal(fs.readFileSync(pdf, "utf8"), "old");
  assert.equal(f.read("bills", "recovered").id, "recovered");
  f.db.close();
  f.reopen();
  assert.equal(fs.readFileSync(pdf, "utf8"), "new");
  assert.equal(f.db.db.prepare("SELECT count(*) n FROM file_jobs").get().n, 0);
});
test("incomplete migration is retried; malformed source cannot become authoritative", (t) => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "kg-migration-")),
    root = path.join(runtime, "data");
  fs.mkdirSync(path.join(root, "products"), { recursive: true });
  t.after(() => fs.rmSync(runtime, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "products", "bad.json"), "{bad");
  assert.throws(() => openRecordDatabase(root));
  assert.equal(fs.existsSync(path.join(root, "knowgst.sqlite")), false);
  fs.writeFileSync(
    path.join(root, "products", "bad.json"),
    '{"id":"bad","stock":2}',
  );
  fs.writeFileSync(path.join(root, "knowgst.sqlite"), "");
  const s = openRecordDatabase(root);
  assert.equal(JSON.parse(s.get("products/bad.json").payload).stock, 2);
  s.close();
});

const saleFixture = (extra = {}) => ({
  id: "sale-auto",
  businessId: "A",
  invoiceNumber: "INV-AUTO",
  invoiceDate: "2026-10-30",
  invoiceType: "tax-invoice",
  totalAmount: 118,
  totalTaxAmount: 18,
  status: "unpaid",
  payments: [],
  data: { totals: { total: 118, totalTaxAmount: 18 }, items: [] },
  ...extra,
});
const accountBalance = (state, account) =>
  state.entries
    .flatMap((e) => e.lines)
    .filter((l) => l.account === account)
    .reduce((n, l) => n + l.debit - l.credit, 0);
const balanced = (state) => {
  for (const e of state.entries)
    assert.equal(
      e.lines.reduce((n, l) => n + l.debit - l.credit, 0),
      0,
    );
};
test("automatic sale journal follows saved totals, retries, edits, cancellation and uncancellation", (t) => {
  const f = setup(t),
    save = (b) => f.commit({ writes: new Map([[f.file("bills", b.id), b]]) });
  const b = saleFixture();
  save(b);
  let s = readAccounting(f.root, "A");
  assert.equal(s.entries.length, 1);
  assert.equal(accountBalance(s, "1100"), 11800);
  assert.equal(accountBalance(s, "4000"), -10000);
  assert.equal(accountBalance(s, "2100"), -1800);
  save({ ...b, note: "metadata only" });
  assert.equal(readAccounting(f.root, "A").entries.length, 1);
  save({ ...b, totalAmount: 236, totalTaxAmount: 36 });
  s = readAccounting(f.root, "A");
  assert.equal(s.entries.length, 3);
  assert.equal(s.entries[1].reversalOf, s.entries[0].id);
  assert.equal(accountBalance(s, "4000"), -20000);
  save({ ...b, status: "cancelled" });
  s = readAccounting(f.root, "A");
  assert.equal(accountBalance(s, "1100"), 0);
  save(b);
  s = readAccounting(f.root, "A");
  assert.equal(accountBalance(s, "1100"), 11800);
  assert.throws(
    () =>
      planJournal(f.root, "A", {
        id: "manual-reverse-auto",
        reversalOf: s.entries.at(-1).id,
        date: "2026-10-31",
        memo: "Invalid override",
      }),
    /source document/,
  );
  balanced(s);
});
test("all document types, TDS, TCS, tax snapshots and unsupported currencies have explicit posting behavior", (t) => {
  const f = setup(t);
  for (const type of [
    "tax-invoice",
    "bill-of-supply",
    "composition",
    "credit-note",
    "quotation",
    "proforma",
    "delivery-challan",
  ]) {
    const b = saleFixture({ id: type, invoiceType: type });
    f.commit({ writes: new Map([[f.file("bills", type), b]]) });
  }
  let s = readAccounting(f.root, "A");
  assert.equal(s.entries.length, 4);
  assert.equal(accountBalance(s, "1100"), 23600);
  const b = saleFixture({
    id: "withholding",
    totalAmount: 119,
    data: { totals: { tdsAmount: 10, tcsAmount: 1 } },
  });
  f.commit({ writes: new Map([[f.file("bills", b.id), b]]) });
  s = readAccounting(f.root, "A");
  assert.equal(accountBalance(s, "1400"), 1000);
  assert.equal(accountBalance(s, "2200"), -100);
  assert.equal(
    s.entries.at(-1).lines.find((l) => l.account === "4000").credit,
    10000,
  );
  const count = s.entries.length;
  for (const b of [
    saleFixture({ id: "usd", currency: "USD" }),
    saleFixture({ id: "draft", status: "draft" }),
    saleFixture({ id: "converted", convertedTo: "new" }),
  ])
    f.commit({ writes: new Map([[f.file("bills", b.id), b]]) });
  assert.equal(readAccounting(f.root, "A").entries.length, count);
  assert.throws(
    () =>
      f.commit({
        writes: new Map([
          [
            f.file("bills", "bad"),
            saleFixture({ id: "bad", totalTaxAmount: 119 }),
          ],
        ]),
      }),
    /exceeds/,
  );
  assert.equal(f.read("bills", "bad"), null);
  balanced(s);
});
test("customer collections, refunds and receipt removal reconcile without treating cancellation as a refund", (t) => {
  const f = setup(t),
    save = (b) => f.commit({ writes: new Map([[f.file("bills", b.id), b]]) });
  let b = saleFixture({
    payments: [{ id: "pay-1", amount: 50, date: "2026-10-30", mode: "cash" }],
  });
  save(b);
  let s = readAccounting(f.root, "A");
  assert.equal(accountBalance(s, "1000"), 5000);
  assert.equal(accountBalance(s, "1100"), 6800);
  b = { ...b, status: "cancelled" };
  save(b);
  s = readAccounting(f.root, "A");
  assert.equal(accountBalance(s, "1000"), 5000);
  assert.equal(accountBalance(s, "1100"), -5000);
  b = {
    ...b,
    payments: [
      ...b.payments,
      { id: "refund", amount: -20, date: "2026-10-31", mode: "cash" },
    ],
  };
  save(b);
  s = readAccounting(f.root, "A");
  assert.equal(accountBalance(s, "1000"), 3000);
  b = {
    ...b,
    payments: [
      ...b.payments,
      { id: "allocation", amount: 10, mode: "credit-applied" },
    ],
  };
  save(b);
  assert.equal(accountBalance(readAccounting(f.root, "A"), "1000"), 3000);
  save({ ...b, payments: [] });
  s = readAccounting(f.root, "A");
  assert.equal(accountBalance(s, "1000"), 0);
  balanced(s);
});
test("expense revisions and deletion append balanced reversals and preserve journal history", (t) => {
  const f = setup(t),
    file = f.file("expenses", "e");
  const e = {
    id: "e",
    businessId: "A",
    date: "2026-10-30",
    description: "Office",
    amount: 118,
    gstAmount: 18,
  };
  const save = (value) => f.commit({ writes: new Map([[file, value]]) });
  save(e);
  let s = readAccounting(f.root, "A");
  assert.equal(accountBalance(s, "5100"), 11800);
  assert.equal(accountBalance(s, "1300"), 0);
  save({ ...e, amount: 236 });
  s = readAccounting(f.root, "A");
  assert.equal(s.entries.length, 3);
  assert.equal(accountBalance(s, "1000"), -23600);
  save(null);
  s = readAccounting(f.root, "A");
  assert.equal(s.entries.length, 4);
  assert.equal(accountBalance(s, "5100"), 0);
  save(e);
  s = readAccounting(f.root, "A");
  assert.equal(s.entries.length, 5);
  balanced(s);
  assert.throws(() => save({ ...e, amount: -1 }), /non-negative/);
  assert.deepEqual(f.read("expenses", "e"), e);
});
test("automatic journal, document and audit roll back together and survive restart", (t) => {
  const f = setup(t),
    b = saleFixture();
  let writes = new Map([[f.file("bills", b.id), b]]);
  augmentAccounting(f.root, writes, { businessId: "A" });
  assert.throws(
    () =>
      commitJsonBatch(f.root, writes, {
        beforeInstall() {
          throw Error("injected");
        },
      }),
    /injected/,
  );
  assert.equal(f.read("bills", b.id), null);
  assert.equal(readAccounting(f.root, "A").entries.length, 0);
  f.commit({ writes: new Map([[f.file("bills", b.id), b]]) });
  const before = readAccounting(f.root, "A");
  f.db.close();
  f.reopen();
  assert.deepEqual(readAccounting(f.root, "A"), before);
  // Deleting a posted invoice reverses its recognition, restoring it posts a new linked source entry.
  f.commit({ writes: new Map([[f.file("bills", b.id), null]]) });
  f.commit({ writes: new Map([[f.file("bills", b.id), b]]) });
  assert.equal(accountBalance(readAccounting(f.root, "A"), "1100"), 11800);
});
test("automatic postings stay business-scoped and cannot be manually relocated", (t) => {
  const f = setup(t),
    b = saleFixture();
  f.commit({ writes: new Map([[f.file("bills", b.id), b]]) });
  f.commit({
    writes: new Map([
      [
        f.file("expenses", "b-exp"),
        { id: "b-exp", businessId: "B", date: "2026-10-30", amount: 20 },
      ],
    ]),
  });
  assert.equal(accountBalance(readAccounting(f.root, "A"), "5100"), 0);
  assert.equal(accountBalance(readAccounting(f.root, "B"), "5100"), 2000);
  assert.throws(
    () =>
      f.commit({
        writes: new Map([[f.file("bills", b.id), { ...b, businessId: "B" }]]),
      }),
    /moved between/,
  );
});
