import path from "node:path";
import crypto from "node:crypto";
import { recordFs as fs } from "./sqlite-storage.mjs";
import { readRecord, commitJsonBatch, storageError } from "./json-storage.mjs";

const buckets = new Set([
  "documents",
  "imports",
  "matching",
  "catalog",
  "insights",
]);
const fail = (message, status = 400) => {
  throw storageError(
    message,
    status === 409 ? "conflict" : "bad-request",
    status,
  );
};

// Review state shares SQLite transactions and portable backups with the books.
// There is deliberately no public arbitrary-key storage endpoint.
export function workflowStore({ dataDir, readModule }) {
  const directory = path.join(dataDir, "ai-workspaces");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  function location({ businessId, bucket }) {
    if (
      typeof businessId !== "string" ||
      !businessId ||
      businessId.length > 240 ||
      !buckets.has(bucket)
    )
      fail("Select a valid business and review workspace.");
    readModule(businessId, "profile");
    const key = crypto.createHash("sha256").update(businessId).digest("hex");
    return path.join(directory, `${key}-${bucket}.json`);
  }
  function read(input) {
    const file = location(input),
      saved = readRecord(file);
    if (!saved) return { revision: 0, data: {} };
    if (
      saved.businessId !== input.businessId ||
      saved.bucket !== input.bucket ||
      saved.format !== 1 ||
      !Number.isSafeInteger(saved.revision) ||
      saved.revision < 1 ||
      !saved.data ||
      typeof saved.data !== "object" ||
      Array.isArray(saved.data)
    )
      throw storageError(
        "Review workspace cannot be read. Restore a verified backup.",
        "data-corrupt",
      );
    return { revision: saved.revision, data: saved.data };
  }
  function update(input) {
    const file = location(input),
      current = read(input);
    if (!Number.isSafeInteger(input.revision) || input.revision < 0)
      fail("A current review revision is required.");
    if (input.revision !== current.revision)
      fail("This review changed. Reload before saving.", 409);
    if (
      !input.data ||
      typeof input.data !== "object" ||
      Array.isArray(input.data)
    )
      fail("Invalid review data.");
    let text;
    try {
      text = JSON.stringify(input.data);
    } catch {
      fail("Review data must be serializable.");
    }
    const limit =
      input.bucket === "documents" ? 48 * 1024 * 1024 : 4 * 1024 * 1024;
    if (Buffer.byteLength(text) > limit)
      fail(
        "Review workspace is full. Remove completed items before adding more.",
        413,
      );
    const data = JSON.parse(text),
      revision = current.revision + 1;
    if (!Number.isSafeInteger(revision))
      fail("Review revision limit reached.", 409);
    commitJsonBatch(
      dataDir,
      new Map([
        [
          file,
          {
            format: 1,
            businessId: input.businessId,
            bucket: input.bucket,
            revision,
            data,
          },
        ],
      ]),
    );
    return { revision, data: structuredClone(data) };
  }
  return { read, update };
}
