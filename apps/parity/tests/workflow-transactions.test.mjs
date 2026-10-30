import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import {
  planReceipt,
  planPurchase,
  planInvoiceTrash,
  planRecurringTemplate,
  commitWorkflow,
} from "../workflow-transactions.mjs";
import {
  planInvoices,
  commitInvoices,
  versionedInvoice,
} from "../invoice-transactions.mjs";
import { readRecord, commitJsonBatch } from "../json-storage.mjs";
import {
  commitFileBatch,
  recoverFileTransaction,
} from "../file-transactions.mjs";
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowgst-workflows-")),
    data = path.join(root, "data");
  for (const dir of [
    "bills",
    "receipts",
    "purchases",
    "products",
    "recurring",
    "trash",
  ])
    fs.mkdirSync(path.join(data, dir), { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = (dir, id) => path.join(data, dir, `${id}.json`),
    read = (dir, id) => readRecord(file(dir, id)),
    write = (dir, r) => fs.writeFileSync(file(dir, r.id), JSON.stringify(r));
  const bill = (id) => ({
    id,
    invoiceNumber: id,
    invoiceType: "tax-invoice",
    status: "unpaid",
    clientName: "Client",
    totalAmount: 100,
    payments: [],
    paidAmount: 0,
    data: { profile: { businessName: "Business" }, items: [] },
  });
  write("bills", bill("A"));
  write("bills", bill("B"));
  write("products", {
    id: "P",
    name: "Widget",
    stock: 10,
    sellingPrice: 200,
    purchasePrice: 50,
  });
  return {
    root,
    data,
    file,
    read,
    write,
    bill,
    commit: (plan) => commitWorkflow(plan, data),
  };
}
test("receipt creation, editing, reassignment, unlink and deletion maintain invoice balances", (t) => {
  const f = fixture(t);
  let r = {
    id: "R",
    receiptNo: "R1",
    ownerName: "Business",
    clientName: "Client",
    againstInvoice: "A",
    amount: 40,
    paymentMode: "Cash",
  };
  r = f.commit(planReceipt(f.data, r)).receipt;
  assert.equal(f.read("bills", "A").paidAmount, 40);
  r = f.commit(
    planReceipt(f.data, { ...r, amount: 60, receiptNo: "R2" }),
  ).receipt;
  assert.equal(f.read("bills", "A").payments.length, 1);
  assert.equal(f.read("bills", "A").paidAmount, 60);
  r = f.commit(planReceipt(f.data, { ...r, againstInvoice: "B" })).receipt;
  assert.equal(f.read("bills", "A").paidAmount, 0);
  assert.equal(f.read("bills", "B").paidAmount, 60);
  r = f.commit(planReceipt(f.data, { ...r, againstInvoice: "" })).receipt;
  assert.equal(f.read("bills", "B").paidAmount, 0);
  assert.equal(r.billId, null);
  r = f.commit(
    planReceipt(f.data, { ...r, againstInvoice: "A", amount: 150 }),
  ).receipt;
  assert.equal(f.read("bills", "A").paidAmount, 150);
  assert.equal(f.read("bills", "A").status, "paid");
  f.commit(planReceipt(f.data, r, { remove: true }));
  assert.equal(f.read("receipts", "R"), null);
  assert.equal(f.read("bills", "A").paidAmount, 0);
});
test("stale receipt, ambiguous business, cross-currency and invalid amounts cannot alter balances", (t) => {
  const f = fixture(t),
    input = {
      id: "R",
      ownerName: "Business",
      clientName: "Client",
      againstInvoice: "A",
      amount: 40,
    };
  const old = f.commit(planReceipt(f.data, input)).receipt;
  f.commit(planReceipt(f.data, { ...old, amount: 50 }));
  assert.throws(
    () => planReceipt(f.data, { ...old, amount: 20 }),
    (e) => e.code === "stale-record",
  );
  assert.throws(
    () => planReceipt(f.data, { ...input, id: "R2", currency: "USD" }),
    /currencies/,
  );
  assert.throws(
    () => planReceipt(f.data, { ...input, id: "R2", amount: -1 }),
    /positive/,
  );
  assert.equal(f.read("bills", "A").paidAmount, 50);
});
test("receipt reassignment rolls back every write boundary", (t) => {
  const f = fixture(t),
    r = f.commit(
      planReceipt(f.data, {
        id: "R",
        ownerName: "Business",
        clientName: "Client",
        againstInvoice: "A",
        amount: 40,
      }),
    ).receipt;
  for (let fail = 0; fail < 3; fail++) {
    const plan = planReceipt(f.data, { ...r, againstInvoice: "B" });
    assert.throws(() =>
      commitWorkflow(plan, f.data, {
        beforeInstall(i) {
          if (i === fail) throw Error("disk full");
        },
      }),
    );
    assert.equal(f.read("bills", "A").paidAmount, 40);
    assert.equal(f.read("bills", "B").paidAmount, 0);
    assert.equal(f.read("receipts", "R").billId, "A");
  }
});
test("purchase duplicate product lines, quantity changes, removal, rename and delete use exact deltas", (t) => {
  const f = fixture(t);
  let p = f.commit(
    planPurchase(f.data, {
      id: "Q",
      items: [
        { name: "Widget", quantity: 2, rate: 60 },
        { name: "Widget", quantity: 3, rate: 70 },
      ],
    }),
  ).purchase;
  assert.equal(f.read("products", "P").stock, 15);
  assert.equal(f.read("products", "P").sellingPrice, 200);
  assert.equal(p.items[0].productId, "P");
  assert.equal(p.items[1].productId, "P");
  p = f.commit(
    planPurchase(f.data, {
      ...p,
      items: [{ ...p.items[0], name: "Renamed line", quantity: 4 }],
    }),
  ).purchase;
  assert.equal(f.read("products", "P").stock, 14);
  assert.equal(fs.readdirSync(path.join(f.data, "products")).length, 1);
  f.commit(planPurchase(f.data, p));
  assert.equal(f.read("products", "P").stock, 14);
  f.commit(planPurchase(f.data, p, { remove: true }));
  assert.equal(f.read("products", "P").stock, 10);
  assert.equal(f.read("purchases", "Q"), null);
});
test("new purchase products and bill roll back together; stale edits do not overwrite stock", (t) => {
  const f = fixture(t),
    input = { id: "Q", items: [{ name: "New", quantity: 2.125, rate: 10 }] };
  for (let fail = 0; fail < 2; fail++)
    assert.throws(() =>
      commitWorkflow(planPurchase(f.data, input), f.data, {
        beforeInstall(i) {
          if (i === fail) throw Error("disk full");
        },
      }),
    );
  assert.equal(fs.readdirSync(path.join(f.data, "products")).length, 1);
  assert.equal(f.read("purchases", "Q"), null);
  const p = f.commit(planPurchase(f.data, input)).purchase;
  f.commit(
    planPurchase(f.data, { ...p, items: [{ ...p.items[0], quantity: 3.125 }] }),
  );
  assert.throws(
    () => planPurchase(f.data, { ...p, items: [] }),
    (e) => e.code === "stale-record",
  );
  assert.equal(f.read("products", p.items[0].productId).stock, 3.125);
});
test("invoice trash and restore include stock and payment receipts", (t) => {
  const f = fixture(t);
  const bill = {
    ...f.bill("C"),
    payments: [{ id: "PAY", amount: 30, mode: "cash" }],
    paidAmount: 30,
    data: { items: [{ productId: "P", quantity: 2 }] },
  };
  commitInvoices(f.data, [{ bill }]);
  assert.equal(f.read("products", "P").stock, 8);
  f.commit(planInvoiceTrash(f.data, "C"));
  assert.equal(f.read("products", "P").stock, 10);
  assert.equal(f.read("receipts", "PAY"), null);
  assert.equal(f.read("bills", "C"), null);
  f.commit(planInvoiceTrash(f.data, "C", { restore: true }));
  assert.equal(f.read("products", "P").stock, 8);
  assert.equal(f.read("receipts", "PAY").amount, 30);
  assert.equal(f.read("bills", "C").payments.length, 1);
  assert.equal(f.read("trash", "C"), null);
});
test("legacy trash without a stock-return marker never deducts its stock again", (t) => {
  const f = fixture(t);
  f.write("trash", {
    ...f.bill("OLD"),
    data: { items: [{ productId: "P", quantity: 2 }] },
  });
  f.commit(planInvoiceTrash(f.data, "OLD", { restore: true }));
  assert.equal(f.read("products", "P").stock, 10);
});
test("recurring invoice, stock, counter and schedule are one commit", (t) => {
  const f = fixture(t);
  const tpl = { id: "T", nextDate: "2026-10-30", occurrencesCreated: 0 };
  f.write("recurring", tpl);
  fs.writeFileSync(
    path.join(f.data, "meta.json"),
    JSON.stringify({ counter_INV: 1 }),
  );
  const bill = {
    ...f.bill("GENERATED"),
    autoGenerated: true,
    data: { items: [{ productId: "P", quantity: 2 }] },
  };
  const plan = planInvoices(f.data, [{ bill }]);
  plan.writes.set(f.file("recurring", "T"), {
    ...tpl,
    nextDate: "2026-11-30",
    occurrencesCreated: 1,
  });
  plan.writes.set(path.join(f.data, "meta.json"), { counter_INV: 2 });
  for (let fail = 0; fail < plan.writes.size; fail++) {
    assert.throws(() =>
      commitWorkflow(plan, f.data, {
        beforeInstall(i) {
          if (i === fail) throw Error("disk full");
        },
      }),
    );
    assert.equal(f.read("bills", "GENERATED"), null);
    assert.equal(f.read("products", "P").stock, 10);
    assert.equal(f.read("recurring", "T").occurrencesCreated, 0);
    assert.equal(readRecord(path.join(f.data, "meta.json")).counter_INV, 1);
  }
  f.commit(plan);
  assert.equal(f.read("products", "P").stock, 8);
  assert.equal(f.read("recurring", "T").occurrencesCreated, 1);
  assert.throws(
    () =>
      planRecurringTemplate(f.data, {
        ...tpl,
        active: false,
        _revision: versionedInvoice(tpl)._revision,
      }),
    (e) => e.code === "stale-record",
  );
});
test("JSON and PDF file transaction rolls back and recovers a process exit", (t) => {
  const f = fixture(t),
    pdf = path.join(f.root, "Saved Invoices", "a.pdf"),
    trash = path.join(f.root, "Trash", "a.pdf");
  fs.mkdirSync(path.dirname(pdf), { recursive: true });
  fs.writeFileSync(pdf, "%PDF-original-bytes");
  const original = fs.readFileSync(f.file("bills", "A"));
  const writes = new Map([
    [f.file("bills", "A"), null],
    [f.file("trash", "A"), original],
    [trash, fs.readFileSync(pdf)],
    [pdf, null],
  ]);
  for (let fail = 0; fail < writes.size; fail++) {
    assert.throws(() =>
      commitFileBatch(f.root, writes, {
        beforeInstall(i) {
          if (i === fail) throw Error("disk full");
        },
      }),
    );
    assert.equal(fs.readFileSync(pdf, "utf8"), "%PDF-original-bytes");
    assert.ok(f.read("bills", "A"));
    assert.equal(fs.existsSync(trash), false);
  }
  const moduleUrl = new URL("../file-transactions.mjs", import.meta.url).href;
  const script = `import {commitFileBatch} from ${JSON.stringify(moduleUrl)};const entries=${JSON.stringify([...writes].map(([k, v]) => [k, v === null ? null : v.toString("base64")]))};commitFileBatch(${JSON.stringify(f.root)},new Map(entries.map(([k,v])=>[k,v===null?null:Buffer.from(v,'base64')])),{beforeInstall(i){if(i===3)process.exit(99);}});`;
  assert.equal(
    spawnSync(process.execPath, ["--input-type=module", "-e", script]).status,
    99,
  );
  assert.equal(recoverFileTransaction(f.root), true);
  assert.equal(fs.readFileSync(pdf, "utf8"), "%PDF-original-bytes");
  assert.ok(f.read("bills", "A"));
  assert.equal(fs.existsSync(trash), false);
  commitFileBatch(f.root, writes);
  assert.equal(fs.existsSync(pdf), false);
  assert.equal(fs.readFileSync(trash, "utf8"), "%PDF-original-bytes");
});

test("receipt cannot remove cash that funds a transferred client credit", (t) => {
  const f = fixture(t);
  const r = f.commit(
    planReceipt(f.data, { id: "R", againstInvoice: "A", amount: 150 }),
  ).receipt;
  const bill = f.read("bills", "A");
  bill.payments.push({
    id: "credit",
    mode: "credit-transferred-out",
    amount: -50,
    creditTargetBillId: "B",
  });
  bill.paidAmount = 100;
  f.write("bills", bill);
  assert.throws(
    () => planReceipt(f.data, { ...r, amount: 100 }),
    (e) => e.code === "client-credit-dependency",
  );
  assert.throws(
    () => planReceipt(f.data, r, { remove: true }),
    (e) => e.code === "client-credit-dependency",
  );
  assert.throws(
    () => planReceipt(f.data, { ...r, againstInvoice: "B" }),
    (e) => e.code === "client-credit-dependency",
  );
  assert.equal(f.read("receipts", "R").amount, 150);
  assert.equal(f.read("bills", "A").paidAmount, 100);
  f.commit(planReceipt(f.data, { ...r, amount: 175 }));
  assert.equal(f.read("bills", "A").paidAmount, 125);
});

test("workspace file transaction rejects symlinks and journal targets before mutation", (t) => {
  const f = fixture(t),
    link = path.join(f.root, "link.pdf"),
    missing = path.join(f.root, "missing.pdf");
  fs.symlinkSync(missing, link);
  assert.throws(
    () => commitFileBatch(f.root, new Map([[link, Buffer.from("unsafe")]])),
    /Symlink/,
  );
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
  assert.equal(fs.existsSync(missing), false);
  assert.throws(
    () =>
      commitFileBatch(
        f.root,
        new Map([[path.join(f.root, ".workspace-transaction"), null]]),
      ),
    /Invalid/,
  );
  assert.equal(f.read("products", "P").stock, 10);
});
