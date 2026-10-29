import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  readRecord,
  durableWrite,
  commitJsonBatch,
  recoverJsonTransaction,
} from "../json-storage.mjs";

test("corrupt JSON never becomes an empty record; missing records retain fallback", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "knowgst-read-"));
  const file = path.join(dir, "meta.json");
  try {
    assert.deepEqual(readRecord(file, {}), {});
    for (const data of ["{", "null", "[]", "42"]) {
      fs.writeFileSync(file, data);
      assert.throws(
        () => readRecord(file, {}),
        (e) => e.code === "data-corrupt",
      );
    }
    durableWrite(file, '{"counter_INV":25}');
    assert.equal(readRecord(file).counter_INV, 25);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("JSON import transaction rolls back failure and recovers after process exit", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowgst-json-tx-"));
  const data = path.join(root, "data");
  fs.mkdirSync(data);
  const old = path.join(data, "old.json"),
    added = path.join(data, "added.json");
  try {
    durableWrite(old, '{"value":"old"}');
    const writes = new Map([
      [old, { value: "new" }],
      [added, { value: "added" }],
    ]);
    assert.throws(
      () =>
        commitJsonBatch(data, writes, {
          beforeInstall(i) {
            if (i === 1) throw new Error("disk failure");
          },
        }),
      /disk failure/,
    );
    assert.equal(readRecord(old).value, "old");
    assert.equal(fs.existsSync(added), false);
    const url = new URL("../json-storage.mjs", import.meta.url).href;
    const code = `import {commitJsonBatch} from ${JSON.stringify(url)};commitJsonBatch(${JSON.stringify(data)},new Map(${JSON.stringify([...writes])}),{beforeInstall(i){if(i===1)process.exit(99);}});`;
    assert.equal(
      spawnSync(process.execPath, ["--input-type=module", "-e", code]).status,
      99,
    );
    assert.equal(recoverJsonTransaction(data), true);
    assert.equal(readRecord(old).value, "old");
    assert.equal(fs.existsSync(added), false);
    commitJsonBatch(data, writes);
    assert.equal(readRecord(old).value, "new");
    assert.equal(readRecord(added).value, "added");
    assert.equal(recoverJsonTransaction(data), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("mixed CSV date conventions reject the whole plan", async () => {
  const { dateOrderNote } = await import("../src/utils/bulkCsv.js");
  assert.match(
    dateOrderNote(["25/10/2026", "10/25/2026"]).error,
    /month first/,
  );
  assert.match(dateOrderNote(["10/11/2026"]).warning, /day first/);
});
