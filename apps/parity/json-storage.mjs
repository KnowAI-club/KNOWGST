import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
export function storageError(message, code = "data-corrupt", status = 503) {
  return Object.assign(new Error(message), { code, status });
}
export function readRecord(file, fallback = null) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Expected object");
    return value;
  } catch (error) {
    throw storageError(`Unreadable record: ${file}`, "data-corrupt");
  }
}
export function durableWrite(file, contents) {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temp, "wx", 0o600);
    fs.writeFileSync(fd, contents);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temp, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(temp, { force: true });
  }
}
const transaction = (root) =>
  path.join(path.dirname(root), ".json-transaction");
function targetPath(root, relative) {
  const target = path.resolve(root, relative);
  if (
    !target.startsWith(path.resolve(root) + path.sep) ||
    !target.endsWith(".json")
  )
    throw storageError("Invalid transaction target");
  return target;
}
export function recoverJsonTransaction(root) {
  const dir = transaction(root),
    journal = path.join(dir, "journal.json");
  if (!fs.existsSync(journal)) {
    fs.rmSync(dir, { recursive: true, force: true });
    return false;
  }
  const state = readRecord(journal);
  if (!state.committed)
    for (const [index, entry] of [...state.entries.entries()].reverse()) {
      const target = targetPath(root, entry.relative),
        old = path.join(dir, `old-${index}`);
      if (entry.existed) {
        if (!fs.existsSync(old)) throw storageError("Incomplete recovery data");
        durableWrite(target, fs.readFileSync(old));
      } else fs.rmSync(target, { force: true });
    }
  fs.rmSync(dir, { recursive: true, force: true });
  return !state.committed;
}
// Stage all bytes and old versions before publishing a journal or changing live records.
export function commitJsonBatch(root, writes, { beforeInstall } = {}) {
  if (!writes.size) return;
  recoverJsonTransaction(root);
  const dir = transaction(root);
  fs.mkdirSync(dir, { mode: 0o700 });
  const entries = [];
  try {
    for (const [file, value] of writes) {
      const relative = path.relative(root, file),
        target = targetPath(root, relative),
        index = entries.length;
      const existed = fs.existsSync(target);
      entries.push({ relative, existed });
      if (existed)
        durableWrite(path.join(dir, `old-${index}`), fs.readFileSync(target));
      durableWrite(
        path.join(dir, `new-${index}`),
        JSON.stringify(value, null, 2),
      );
    }
    durableWrite(
      path.join(dir, "journal.json"),
      JSON.stringify({ entries, committed: false }),
    );
    for (const [index, entry] of entries.entries()) {
      beforeInstall?.(index);
      const target = targetPath(root, entry.relative);
      fs.renameSync(path.join(dir, `new-${index}`), target);
    }
    durableWrite(
      path.join(dir, "journal.json"),
      JSON.stringify({ entries, committed: true }),
    );
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    recoverJsonTransaction(root);
    throw error;
  }
}
export function validateObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw storageError("Expected an object", "bad-request", 400);
  const stack = [value];
  while (stack.length) {
    const item = stack.pop();
    for (const [key, v] of Object.entries(item)) {
      if (["__proto__", "prototype", "constructor"].includes(key))
        throw storageError("Reserved property", "bad-request", 400);
      if (v && typeof v === "object") stack.push(v);
    }
  }
}
export function validateId(id) {
  if (
    typeof id !== "string" ||
    !id.trim() ||
    id.length > 180 ||
    /[\x00-\x1f\x7f]/.test(id)
  )
    throw storageError("Invalid record ID", "bad-request", 400);
}
