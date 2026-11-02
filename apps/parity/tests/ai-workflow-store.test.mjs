import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { workflowStore } from "../ai-workflow-store.mjs";
import {
  openRecordDatabase,
  storeFor,
  withDatabaseClosed,
} from "../sqlite-storage.mjs";
import {
  createVerifiedBackup,
  restoreVerifiedBackup,
  verifyBackup,
} from "../verified-backup.mjs";

function fixture(t) {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "kg-ai-state-"));
  const dataDir = path.join(runtime, "data");
  let business = "A";
  openRecordDatabase(dataDir);
  const store = workflowStore({
    dataDir,
    readModule(id) {
      if (id !== business)
        throw Object.assign(new Error("Business changed"), { status: 409 });
      return [{ id: business }];
    },
  });
  t.after(() => {
    storeFor(dataDir)?.close();
    fs.rmSync(runtime, { recursive: true, force: true });
  });
  return {
    store,
    runtime,
    dataDir,
    select(id) {
      business = id;
    },
  };
}
test("review state uses SQLite, scopes every operation and rejects stale updates", (t) => {
  const f = fixture(t),
    input = { businessId: "A", bucket: "matching" };
  assert.deepEqual(f.store.read(input), { revision: 0, data: {} });
  f.store.update({
    ...input,
    revision: 0,
    data: { rules: [{ id: "r1", pattern: "Rent" }] },
  });
  assert.throws(
    () => f.store.update({ ...input, revision: 0, data: { rules: [] } }),
    /changed/,
  );
  const result = f.store.read(input);
  result.data.rules.length = 0;
  assert.equal(f.store.read(input).data.rules.length, 1);
  assert.equal(
    storeFor(f.dataDir).db.prepare("SELECT COUNT(*) n FROM records").get().n,
    1,
  );
  assert.equal(fs.readdirSync(path.join(f.dataDir, "ai-workspaces")).length, 0);
  f.select("B");
  assert.throws(() => f.store.read(input), /Business changed/);
  assert.throws(
    () => f.store.update({ ...input, revision: 1, data: {} }),
    /Business changed/,
  );
  assert.deepEqual(f.store.read({ ...input, businessId: "B" }), {
    revision: 0,
    data: {},
  });
});
test("review store survives restart and validates its closed storage contract", (t) => {
  const f = fixture(t),
    input = { businessId: "A", bucket: "insights" };
  f.store.update({ ...input, revision: 0, data: { dismissed: ["a"] } });
  storeFor(f.dataDir).close();
  openRecordDatabase(f.dataDir);
  assert.deepEqual(f.store.read(input).data, { dismissed: ["a"] });
  for (const bucket of ["../profile", "credentials", "__proto__"])
    assert.throws(() => f.store.read({ ...input, bucket }), /valid/);
  assert.throws(
    () => f.store.update({ ...input, revision: 1, data: [] }),
    /Invalid/,
  );
  assert.throws(
    () =>
      f.store.update({
        ...input,
        revision: 1,
        data: { large: "x".repeat(4 * 1024 * 1024) },
      }),
    /full/,
  );
  assert.equal(f.store.read(input).revision, 1);
});
test("full verified restore restores document originals and review decisions atomically", (t) => {
  const f = fixture(t),
    input = { businessId: "A", bucket: "documents" };
  const original = {
    documents: [
      {
        id: "document-1",
        image: Buffer.from("fictional image bytes").toString("base64"),
        status: "reviewed",
      },
    ],
  };
  f.store.update({ ...input, revision: 0, data: original });
  const pdfDir = path.join(f.runtime, "Saved Invoices"),
    trashDir = path.join(f.runtime, "Trash");
  fs.mkdirSync(pdfDir);
  fs.mkdirSync(trashDir);
  fs.writeFileSync(path.join(pdfDir, "test.pdf"), "fixture-pdf");
  const backup = path.join(f.runtime, "backup");
  createVerifiedBackup(f.dataDir, backup, { pdfDir, trashDir });
  assert.ok(
    Object.keys(verifyBackup(backup).files).some((name) =>
      name.startsWith("data/ai-workspaces/"),
    ),
  );
  f.store.update({ ...input, revision: 1, data: { documents: [] } });
  fs.writeFileSync(path.join(pdfDir, "test.pdf"), "changed");
  withDatabaseClosed(f.dataDir, () =>
    restoreVerifiedBackup(f.dataDir, backup, { pdfDir, trashDir }),
  );
  assert.deepEqual(f.store.read(input).data, original);
  assert.equal(
    fs.readFileSync(path.join(pdfDir, "test.pdf"), "utf8"),
    "fixture-pdf",
  );
  f.store.update({
    ...input,
    revision: 1,
    data: { documents: [{ id: "after" }] },
  });
  assert.throws(
    () =>
      withDatabaseClosed(f.dataDir, () =>
        restoreVerifiedBackup(f.dataDir, backup, {
          pdfDir,
          trashDir,
          beforeInstall(index) {
            if (index === 1) throw Error("Simulated disk failure");
          },
        }),
      ),
    /Simulated/,
  );
  assert.deepEqual(f.store.read(input).data, { documents: [{ id: "after" }] });
});
