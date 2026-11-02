import test from "node:test";
import assert from "node:assert/strict";
import native from "node:fs";
import path from "node:path";
import os from "node:os";
import { importReview, strictImportCsv } from "../ai-import-review.mjs";
import {
  commitMasterImport,
  undoMasterImport,
  importBatches,
} from "../ai-import-transactions.mjs";
import { workflowStore } from "../ai-workflow-store.mjs";
import {
  openRecordDatabase,
  recordFs as fs,
  storeFor,
  withDatabaseClosed,
} from "../sqlite-storage.mjs";
import { readRecord, commitJsonBatch } from "../json-storage.mjs";
import { readAccounting } from "../accounting.mjs";
import {
  createVerifiedBackup,
  verifyBackup,
  restoreVerifiedBackup,
} from "../verified-backup.mjs";
function fixture(t) {
  const runtime = native.mkdtempSync(
      path.join(os.tmpdir(), "kg-master-import-"),
    ),
    dataDir = path.join(runtime, "data");
  for (const dir of [
    "bills",
    "clients",
    "products",
    "profiles",
    "purchases",
    "expenses",
    "receipts",
    "recurring",
    "trash",
    "accounting",
  ])
    native.mkdirSync(path.join(dataDir, dir), { recursive: true });
  native.writeFileSync(
    path.join(dataDir, "profile.json"),
    JSON.stringify({ id: "A", businessName: "Demo" }),
  );
  openRecordDatabase(dataDir);
  const readModule = (id, kind) => {
    if (readRecord(path.join(dataDir, "profile.json")).id !== id)
      throw Error("Business changed");
    return kind === "profile"
      ? [readRecord(path.join(dataDir, "profile.json"))]
      : fs
          .readdirSync(path.join(dataDir, kind))
          .filter((f) => f.endsWith(".json"))
          .map((f) => readRecord(path.join(dataDir, kind, f)))
          .filter((r) => r.businessId === id);
  };
  const store = workflowStore({ dataDir, readModule }),
    pdfDir = path.join(runtime, "pdf"),
    trashDir = path.join(runtime, "pdf-trash");
  native.mkdirSync(pdfDir);
  native.mkdirSync(trashDir);
  let backups = 0,
    blocked = false;
  const createBackup = () => {
    const name = "import-" + ++backups;
    createVerifiedBackup(dataDir, path.join(runtime, name), {
      pdfDir,
      trashDir,
    });
    return { name };
  };
  const assistant = importReview({
    dataDir,
    store,
    readModule,
    createBackup,
    beforeWrite() {
      if (blocked) throw Error("Another mutation in progress");
    },
  });
  t.after(() => {
    storeFor(dataDir)?.close();
    native.rmSync(runtime, { recursive: true, force: true });
  });
  const write = (dir, record) =>
    commitJsonBatch(
      dataDir,
      new Map([[path.join(dataDir, dir, record.id + ".json"), record]]),
    );
  const preview = (
    text = "Name,Email\nNew Client,client@example.test",
    kind = "clients",
    mapping = { name: "Name", email: "Email" },
  ) =>
    assistant.preview({
      businessId: "A",
      kind,
      text,
      mapping,
      name: "masters.csv",
    });
  return {
    runtime,
    dataDir,
    readModule,
    store,
    assistant,
    write,
    preview,
    block: () => (blocked = true),
    backups: () => backups,
    pdfDir,
    trashDir,
  };
}
test("strict CSV rejects malformed quoting, inconsistent columns, excessive rows and repeated headers", () => {
  assert.deepEqual(strictImportCsv('Name,Note\r\n"A, B","hello\nworld"').rows, [
    ["A, B", "hello\nworld"],
  ]);
  for (const text of [
    "Name,Name\nA,B",
    'Name,Email\n"A,B',
    'Name,Email\n"A"oops,B',
    "Name,Email\nA",
    "Name\n" + Array(301).fill("A").join("\n"),
    "Name\n" + "x".repeat(250001),
  ])
    assert.throws(() => strictImportCsv(text));
});
test("reviewed import creates only new master records with verified backup, audit, idempotent retry and safe undo", (t) => {
  const f = fixture(t);
  f.write("clients", {
    id: "existing",
    businessId: "A",
    name: "Existing",
    email: "e@example.test",
  });
  const plan = f.preview(
    "Name,Email\nExisting,e@example.test\nNew Client,n@example.test\nNew Client,n@example.test",
  );
  assert.equal(plan.summary.ready, 1);
  assert.equal(plan.summary.skipped, 2);
  assert.equal(plan.summary.openingBalance, 0);
  assert.throws(
    () => f.assistant.commit({ businessId: "A", planId: plan.id }),
    /Confirm/,
  );
  const result = f.assistant.commit({
    businessId: "A",
    planId: plan.id,
    confirm: true,
  });
  assert.equal(f.backups(), 1);
  assert.equal(f.readModule("A", "clients").length, 2);
  assert.equal(
    readAccounting(f.dataDir, "A").audit.filter(
      (a) => a.action === "masters.imported",
    ).length,
    1,
  );
  assert.ok(
    verifyBackup(path.join(f.runtime, result.batch.backup)).files[
      "data/clients/existing.json"
    ],
  );
  const retry = f.assistant.commit({
    businessId: "A",
    planId: plan.id,
    confirm: true,
  });
  assert.equal(retry.repeated, true);
  assert.equal(f.backups(), 1);
  f.assistant.undo({ businessId: "A", batchId: plan.id, confirm: true });
  assert.equal(f.readModule("A", "clients").length, 1);
  assert.equal(importBatches(f.dataDir, "A")[0].status, "undone");
  assert.equal(
    f.assistant.undo({ businessId: "A", batchId: plan.id, confirm: true }).batch
      .repeated,
    true,
  );
  assert.throws(
    () =>
      f.assistant.commit({ businessId: "A", planId: plan.id, confirm: true }),
    /undone/,
  );
});
test("invalid rows stop whole import; defaults explicitly create zero stock without opening balances", (t) => {
  const f = fixture(t),
    invalid = f.preview(
      "Name,Price,GST\nDesk,200,18\nChair,nope,18",
      "products",
      { name: "Name", sellingPrice: "Price", taxPercent: "GST" },
    );
  assert.equal(invalid.errors.length, 1);
  assert.throws(
    () =>
      f.assistant.commit({
        businessId: "A",
        planId: invalid.id,
        confirm: true,
      }),
    /Fix all/,
  );
  assert.equal(f.readModule("A", "products").length, 0);
  const plan = f.preview("Name,Price,GST\nDesk,200.25,18", "products", {
    name: "Name",
    sellingPrice: "Price",
    taxPercent: "GST",
  });
  f.assistant.commit({ businessId: "A", planId: plan.id, confirm: true });
  const product = f.readModule("A", "products")[0];
  assert.equal(product.stock, 0);
  assert.equal(product.rate, 200.25);
  assert.equal(product.taxPercent, 18);
  assert.equal(readAccounting(f.dataDir, "A").entries.length, 0);
});
test("import fails safely if source changes, backup fails, scope changes or other mutation is running", (t) => {
  const f = fixture(t),
    plan = f.preview();
  f.write("clients", { id: "other", businessId: "A", name: "Changed" });
  assert.throws(
    () =>
      f.assistant.commit({ businessId: "A", planId: plan.id, confirm: true }),
    /changed/,
  );
  assert.equal(f.backups(), 0);
  const fresh = f.preview();
  f.block();
  assert.throws(
    () =>
      f.assistant.commit({ businessId: "A", planId: fresh.id, confirm: true }),
    /mutation/,
  );
  assert.equal(f.backups(), 0);
  const missing = importReview({
    dataDir: f.dataDir,
    store: f.store,
    readModule: f.readModule,
    createBackup: () => {
      throw Error("Disk full");
    },
  });
  assert.throws(
    () => missing.commit({ businessId: "A", planId: fresh.id, confirm: true }),
    /Disk full/,
  );
  assert.equal(f.readModule("A", "clients").length, 1);
  assert.throws(() => f.assistant.history({ businessId: "B" }), /changed/);
});
test("atomic import failure rolls back all records, audit and batch history", (t) => {
  const f = fixture(t),
    records = [
      { id: "c1", name: "One", businessId: "A" },
      { id: "c2", name: "Two", businessId: "A" },
    ];
  assert.throws(
    () =>
      commitMasterImport(
        f.dataDir,
        {
          businessId: "A",
          batchId: "fail",
          kind: "clients",
          records,
          sourceName: "test.csv",
          backup: "verified",
        },
        {
          beforeInstall(index) {
            if (index === 1) throw Error("Simulated write failure");
          },
        },
      ),
    /Simulated/,
  );
  assert.equal(f.readModule("A", "clients").length, 0);
  assert.equal(readAccounting(f.dataDir, "A").audit.length, 0);
  assert.equal(importBatches(f.dataDir, "A").length, 0);
});
test("undo refuses changed, referenced and aliased records without deleting unaffected batch members", (t) => {
  const f = fixture(t),
    plan = f.preview("Name,Email\nOne,o@example.test\nTwo,t@example.test");
  f.assistant.commit({ businessId: "A", planId: plan.id, confirm: true });
  const [one, two] = f.readModule("A", "clients");
  f.write("clients", { ...one, phone: "12345" });
  assert.throws(
    () =>
      f.assistant.undo({ businessId: "A", batchId: plan.id, confirm: true }),
    /changed/,
  );
  assert.equal(f.readModule("A", "clients").length, 2);
  f.write("clients", one);
  f.write("bills", {
    id: "bill1",
    businessId: "A",
    data: { client: { id: one.id, name: one.name } },
  });
  assert.throws(
    () => undoMasterImport(f.dataDir, { businessId: "A", batchId: plan.id }),
    /history/,
  );
  assert.equal(f.readModule("A", "clients").length, 2);
  commitJsonBatch(
    f.dataDir,
    new Map([[path.join(f.dataDir, "bills/bill1.json"), null]]),
  );
  f.store.update({
    businessId: "A",
    bucket: "catalog",
    revision: 0,
    data: { aliases: [{ targetId: two.id }] },
  });
  assert.throws(
    () =>
      f.assistant.undo({ businessId: "A", batchId: plan.id, confirm: true }),
    /alias/,
  );
  f.store.update({
    businessId: "A",
    bucket: "catalog",
    revision: 1,
    data: { aliases: [] },
  });
  f.store.update({
    businessId: "A",
    bucket: "matching",
    revision: 0,
    data: { rules: [{ partyId: "client:" + two.id }] },
  });
  assert.throws(
    () =>
      f.assistant.undo({ businessId: "A", batchId: plan.id, confirm: true }),
    /bank matching/,
  );
  f.store.update({
    businessId: "A",
    bucket: "matching",
    revision: 1,
    data: {
      rules: [],
      statements: [
        { rows: [{ classification: { partyId: "client:" + one.id } }] },
      ],
    },
  });
  assert.throws(
    () =>
      f.assistant.undo({ businessId: "A", batchId: plan.id, confirm: true }),
    /bank matching/,
  );
});
test("verified restore includes import records, review plans and batch history coherently", (t) => {
  const f = fixture(t),
    plan = f.preview();
  f.assistant.commit({ businessId: "A", planId: plan.id, confirm: true });
  const saved = path.join(f.runtime, "after-import");
  createVerifiedBackup(f.dataDir, saved, {
    pdfDir: f.pdfDir,
    trashDir: f.trashDir,
  });
  f.assistant.undo({ businessId: "A", batchId: plan.id, confirm: true });
  assert.equal(f.readModule("A", "clients").length, 0);
  withDatabaseClosed(f.dataDir, () =>
    restoreVerifiedBackup(f.dataDir, saved, {
      pdfDir: f.pdfDir,
      trashDir: f.trashDir,
    }),
  );
  assert.equal(f.readModule("A", "clients").length, 1);
  assert.equal(importBatches(f.dataDir, "A")[0].status, "imported");
  assert.equal(
    f.assistant.commit({ businessId: "A", planId: plan.id, confirm: true })
      .repeated,
    true,
  );
});
