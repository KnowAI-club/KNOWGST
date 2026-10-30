import fs from "node:fs";
import path from "node:path";
import { durableWrite, readRecord, storageError } from "./json-storage.mjs";
const journalDir = (root) => path.join(root, ".workspace-transaction");
function target(root, relative) {
  const file = path.resolve(root, relative);
  if (
    !file.startsWith(path.resolve(root) + path.sep) ||
    file === path.resolve(journalDir(root)) ||
    file.startsWith(path.resolve(journalDir(root)) + path.sep)
  )
    throw storageError("Invalid workspace transaction target");
  // Reject symlink ancestors: PDF folders can be user-managed.
  let parent = file;
  while (parent !== path.resolve(root)) {
    if (fs.lstatSync(parent, { throwIfNoEntry: false })?.isSymbolicLink())
      throw storageError("Symlink transaction target is not supported");
    parent = path.dirname(parent);
  }
  return file;
}
export function recoverFileTransaction(root) {
  const dir = journalDir(root),
    journal = path.join(dir, "journal.json");
  if (!fs.existsSync(journal)) {
    fs.rmSync(dir, { recursive: true, force: true });
    return false;
  }
  const state = readRecord(journal);
  if (!state.committed)
    for (const [index, entry] of [...state.entries.entries()].reverse()) {
      const file = target(root, entry.relative);
      if (entry.existed) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        durableWrite(file, fs.readFileSync(path.join(dir, `old-${index}`)));
      } else fs.rmSync(file, { force: true });
    }
  fs.rmSync(dir, { recursive: true, force: true });
  return !state.committed;
}
// Used for invoice trash/restore: JSON and PDF bytes share one recovery journal.
export function commitFileBatch(root, writes, { beforeInstall } = {}) {
  if (!writes.size) return;
  recoverFileTransaction(root);
  const dir = journalDir(root);
  fs.mkdirSync(dir, { mode: 0o700 });
  const entries = [];
  try {
    for (const [file, value] of writes) {
      const relative = path.relative(root, file),
        resolved = target(root, relative),
        index = entries.length,
        existed = fs.existsSync(resolved);
      entries.push({ relative, existed, deleted: value === null });
      if (existed)
        durableWrite(path.join(dir, `old-${index}`), fs.readFileSync(resolved));
      if (value !== null) durableWrite(path.join(dir, `new-${index}`), value);
    }
    durableWrite(
      path.join(dir, "journal.json"),
      JSON.stringify({ entries, committed: false }),
    );
    for (const [index, entry] of entries.entries()) {
      beforeInstall?.(index);
      const file = target(root, entry.relative);
      if (entry.deleted) fs.rmSync(file, { force: true });
      else {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.renameSync(path.join(dir, `new-${index}`), file);
      }
    }
    durableWrite(
      path.join(dir, "journal.json"),
      JSON.stringify({ entries, committed: true }),
    );
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    recoverFileTransaction(root);
    throw error;
  }
}
