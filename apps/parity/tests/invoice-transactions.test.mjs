import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { commitInvoices, versionedInvoice } from "../invoice-transactions.mjs";
import { readRecord, recoverJsonTransaction } from "../json-storage.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowgst-invoices-"));
  const data = path.join(root, "data");
  for (const dir of ["bills", "products", "receipts", "trash"])
    fs.mkdirSync(path.join(data, dir), { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = (dir, id) => path.join(data, dir, `${id}.json`);
  fs.writeFileSync(
    file("products", "p1"),
    JSON.stringify({ id: "p1", stock: 20 }),
  );
  const bill = {
    id: "I1",
    invoiceNumber: "I1",
    invoiceType: "tax-invoice",
    status: "unpaid",
    totalAmount: 200,
    payments: [],
    data: {
      items: [{ productId: "p1", quantity: 2 }],
      profile: { businessName: "Test" },
    },
  };
  const save = (b, extra = {}, options) =>
    commitInvoices(data, [{ bill: b, ...extra }], options);
  return {
    data,
    file,
    bill,
    save,
    read: (dir, id) => readRecord(file(dir, id)),
  };
}
test("invoice stock, payment receipts and replay stay consistent", (t) => {
  const f = fixture(t);
  let saved = f.save(f.bill).bills[0];
  assert.equal(f.read("products", "p1").stock, 18);
  const payment = {
    id: "pay_1",
    amount: 100,
    date: "2026-10-29",
    mode: "cash",
  };
  saved = f.save(
    { ...saved, payments: [payment], paidAmount: 100, status: "partial" },
    { overwrite: true },
  ).bills[0];
  assert.equal(f.read("receipts", "pay_1").amount, 100);
  assert.equal(f.read("products", "p1").stock, 18);
  f.save(saved, { overwrite: true });
  assert.equal(f.read("products", "p1").stock, 18);
  saved = f.save(
    { ...saved, payments: [{ ...payment, amount: 150 }], paidAmount: 150 },
    { overwrite: true },
  ).bills[0];
  assert.equal(f.read("receipts", "pay_1").amount, 150);
  saved = f.save(
    { ...saved, payments: [], paidAmount: 0, status: "unpaid" },
    { overwrite: true },
  ).bills[0];
  assert.equal(f.read("receipts", "pay_1"), null);
  saved = f.save({ ...saved, status: "cancelled" }, { overwrite: true })
    .bills[0];
  assert.equal(f.read("products", "p1").stock, 20);
  f.save({ ...saved, status: "unpaid" }, { overwrite: true });
  assert.equal(f.read("products", "p1").stock, 18);
});
test("stale tab cannot erase a payment or move stock twice", (t) => {
  const f = fixture(t),
    first = f.save(f.bill).bills[0];
  f.save(
    { ...first, payments: [{ id: "pay_a", amount: 10, mode: "cash" }] },
    { overwrite: true },
  );
  assert.throws(
    () => f.save({ ...first, status: "cancelled" }, { overwrite: true }),
    (e) => e.code === "stale-invoice",
  );
  assert.equal(f.read("bills", "I1").payments.length, 1);
  assert.equal(f.read("products", "p1").stock, 18);
});
test("failure at each install boundary restores invoice, receipts and stock bytes", (t) => {
  const f = fixture(t),
    first = f.save(f.bill).bills[0];
  const changed = {
    ...first,
    payments: [{ id: "pay_a", amount: 20, mode: "cash" }],
    data: { ...first.data, items: [{ productId: "p1", quantity: 5 }] },
  };
  const original = fs.readFileSync(f.file("bills", "I1"), "utf8");
  for (let failure = 0; failure < 3; failure++) {
    assert.throws(
      () =>
        f.save(
          changed,
          { overwrite: true },
          {
            beforeInstall(i) {
              if (i === failure) throw Error("disk full");
            },
          },
        ),
      /disk full/,
    );
    assert.equal(fs.readFileSync(f.file("bills", "I1"), "utf8"), original);
    assert.equal(f.read("products", "p1").stock, 18);
    assert.equal(f.read("receipts", "pay_a"), null);
  }
});
test("failed payment deletion restores its receipt", (t) => {
  const f = fixture(t);
  const saved = f.save({
    ...f.bill,
    payments: [{ id: "pay_a", amount: 20, mode: "cash" }],
  }).bills[0];
  assert.throws(() =>
    f.save(
      { ...saved, payments: [] },
      { overwrite: true },
      {
        beforeInstall(i) {
          if (i === 1) throw Error("disk full");
        },
      },
    ),
  );
  assert.equal(f.read("receipts", "pay_a").amount, 20);
  assert.equal(f.read("bills", "I1").payments.length, 1);
});
test("multi-invoice credit patches reject stale sources without creating target", (t) => {
  const f = fixture(t),
    source = f.save(f.bill).bills[0];
  f.save({ ...source, note: "changed" }, { overwrite: true });
  assert.throws(
    () =>
      commitInvoices(f.data, [
        { bill: { ...f.bill, id: "I2" } },
        { bill: { ...source, note: "stale" }, overwrite: true, stock: false },
      ]),
    (e) => e.code === "stale-invoice",
  );
  assert.equal(f.read("bills", "I2"), null);
  assert.equal(f.read("products", "p1").stock, 18);
});
test("missing stock product and unrelated receipt collision cannot leave an invoice", (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      f.save({
        ...f.bill,
        data: { items: [{ productId: "missing", quantity: 1 }] },
      }),
    (e) => e.code === "missing-product",
  );
  assert.equal(f.read("bills", "I1"), null);
  fs.writeFileSync(
    f.file("receipts", "pay_a"),
    JSON.stringify({ id: "pay_a", billId: "OTHER", amount: 5 }),
  );
  assert.throws(
    () => f.save({ ...f.bill, payments: [{ id: "pay_a", amount: 10 }] }),
    /another receipt/,
  );
  assert.equal(f.read("bills", "I1"), null);
  assert.equal(f.read("receipts", "pay_a").amount, 5);
});
test("document stock direction preserves original rules", (t) => {
  for (const [type, expected] of [
    ["quotation", 20],
    ["proforma", 20],
    ["credit-note", 22],
    ["delivery-challan", 18],
    ["bill-of-supply", 18],
    ["composition", 18],
    ["tax-invoice", 18],
  ]) {
    const f = fixture(t);
    f.save({ ...f.bill, invoiceType: type });
    assert.equal(f.read("products", "p1").stock, expected, type);
  }
});
test("renumbering atomically moves stock ownership and receipt links", (t) => {
  const f = fixture(t),
    old = f.save({
      ...f.bill,
      payments: [{ id: "pay_a", amount: 10, mode: "cash" }],
    }).bills[0];
  const renamed = { ...old, id: "I2", invoiceNumber: "I2" };
  f.save(renamed, { renameFrom: "I1" });
  assert.equal(f.read("bills", "I1"), null);
  assert.equal(f.read("bills", "I2").id, "I2");
  assert.equal(f.read("receipts", "pay_a").billId, "I2");
  assert.equal(f.read("products", "p1").stock, 18);
  assert.deepEqual(f.read("trash", "I1").data.stockApplied, {});
});
test("challan conversion transfers stock ownership without deducting twice", (t) => {
  const f = fixture(t),
    source = f.save({ ...f.bill, invoiceType: "delivery-challan" }).bills[0];
  commitInvoices(f.data, [
    { bill: { ...f.bill, id: "I2" } },
    { bill: { ...source, convertedTo: "I2" }, overwrite: true },
  ]);
  assert.equal(f.read("products", "p1").stock, 18);
  assert.deepEqual(f.read("bills", "I1").data.stockApplied, {});
  assert.deepEqual(f.read("bills", "I2").data.stockApplied, { p1: -2 });
});
test("replaying a create after a lost response does not deduct stock twice", (t) => {
  const f = fixture(t);
  f.save(f.bill);
  f.save(f.bill);
  assert.equal(f.read("products", "p1").stock, 18);
  assert.equal(fs.readdirSync(path.join(f.data, "bills")).length, 1);
});

test("process interruption recovers deleted receipt and invoice together", (t) => {
  const f = fixture(t),
    saved = f.save({
      ...f.bill,
      payments: [{ id: "pay_crash", amount: 10, mode: "cash" }],
    }).bills[0];
  const operations = [{ bill: { ...saved, payments: [] }, overwrite: true }];
  const moduleUrl = new URL("../invoice-transactions.mjs", import.meta.url)
    .href;
  const script = `import {commitInvoices} from ${JSON.stringify(moduleUrl)}; commitInvoices(${JSON.stringify(f.data)},${JSON.stringify(operations)},{beforeInstall(i){if(i===1)process.exit(99)}});`;
  assert.equal(
    spawnSync(process.execPath, ["--input-type=module", "-e", script]).status,
    99,
  );
  assert.equal(recoverJsonTransaction(f.data), true);
  assert.equal(f.read("receipts", "pay_crash").amount, 10);
  assert.equal(f.read("bills", "I1").payments.length, 1);
  assert.equal(f.read("products", "p1").stock, 18);
});
