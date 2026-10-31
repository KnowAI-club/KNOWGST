import native from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const nativeBinding = path.join(
  path.dirname(require.resolve("better-sqlite3/package.json")),
  "build/Release/better_sqlite3.node",
);
const database = (file) => new Database(file, { nativeBinding });
const stores = new Map();
const collections = new Set([
  "bills",
  "clients",
  "templates",
  "products",
  "expenses",
  "recurring",
  "receipts",
  "profiles",
  "purchases",
  "trash",
  "accounting",
]);
const hidden = new Set([
  "knowgst.sqlite",
  "knowgst.sqlite-wal",
  "knowgst.sqlite-shm",
]);
function keyFor(root, file) {
  const rel = path.relative(root, path.resolve(file));
  const parts = rel.split(path.sep);
  return (parts.length === 1 && rel.endsWith(".json")) ||
    (parts.length === 2 &&
      collections.has(parts[0]) &&
      parts[1].endsWith(".json"))
    ? rel.split(path.sep).join("/")
    : null;
}
export function storeFor(file) {
  if (typeof file !== "string") return null;
  for (const [root, s] of stores)
    if (
      path.resolve(file) === root ||
      path.resolve(file).startsWith(root + path.sep)
    )
      return s;
  return null;
}
function managed(file) {
  const s = storeFor(file);
  const key = s && keyFor(s.root, file);
  return key ? { s, key } : null;
}
function enoent(file) {
  return Object.assign(new Error(`ENOENT: ${file}`), { code: "ENOENT" });
}
export function openRecordDatabase(root) {
  root = path.resolve(root);
  if (stores.has(root)) return stores.get(root);
  native.mkdirSync(root, { recursive: true, mode: 0o700 });
  const filename = path.join(root, "knowgst.sqlite");
  let fresh = true;
  if (native.existsSync(filename)) {
    const probe = database(filename);
    try {
      fresh = !(
        probe
          .prepare(
            "SELECT name FROM sqlite_master WHERE name='schema_migrations'",
          )
          .get() &&
        probe
          .prepare("SELECT version FROM schema_migrations WHERE version=1")
          .get()
      );
    } finally {
      probe.close();
    }
  }
  // Validate all legacy records before creating the authoritative database.
  const legacy = [];
  if (fresh) {
    for (const name of native.readdirSync(root)) {
      const absolute = path.join(root, name),
        stat = native.lstatSync(absolute);
      if (stat.isSymbolicLink())
        throw Error("Migration refuses symbolic links in application data.");
      const files =
        stat.isDirectory() && collections.has(name)
          ? native.readdirSync(absolute).map((n) => path.join(absolute, n))
          : [absolute];
      for (const file of files) {
        const key = keyFor(root, file);
        if (!key) continue;
        if (native.lstatSync(file).isSymbolicLink())
          throw Error("Migration refuses symbolic links.");
        const text = native.readFileSync(file, "utf8"),
          value = JSON.parse(text);
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw Error("Invalid legacy record: " + key);
        legacy.push({
          key,
          text,
          sha256: crypto.createHash("sha256").update(text).digest("hex"),
        });
      }
    }
    const archive = path.join(
      path.dirname(root),
      "pre-sqlite-" + Date.now() + "-" + crypto.randomUUID(),
    );
    native.mkdirSync(archive, { mode: 0o700 });
    for (const row of legacy) {
      const file = path.join(archive, row.key);
      native.mkdirSync(path.dirname(file), { recursive: true });
      native.writeFileSync(file, row.text, { mode: 0o600 });
    }
    native.writeFileSync(
      path.join(archive, "migration-manifest.json"),
      JSON.stringify(
        { records: legacy.map(({ key, sha256 }) => ({ key, sha256 })) },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  }
  const db = database(filename);
  if (
    db.prepare("SELECT sqlite_version() version").get().version !== "3.54.1"
  ) {
    db.close();
    throw Error(
      "Run pnpm --filter @know-gst/parity prepare:sqlite to build SQLite 3.54.1.",
    );
  }
  native.chmodSync(filename, 0o600);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = FULL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS records(path TEXT PRIMARY KEY,payload TEXT NOT NULL CHECK(json_valid(payload) AND json_type(payload)='object'),updated_at TEXT NOT NULL) STRICT;
 CREATE TABLE IF NOT EXISTS file_jobs(path TEXT PRIMARY KEY,content BLOB) STRICT;`);
  const put = db.prepare(
    "INSERT INTO records VALUES(?,?,?) ON CONFLICT(path) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at",
  );
  const s = {
    root,
    db,
    version: db.prepare("select sqlite_version() version").get().version,
    get: (key) =>
      db
        .prepare("SELECT payload,updated_at FROM records WHERE path=?")
        .get(key),
    put: (key, text) => {
      if (key.startsWith("accounting/")) {
        const next = JSON.parse(String(text)),
          prior = s.get(key);
        const old = prior ? JSON.parse(prior.payload) : null;
        for (const list of [
          "entries",
          "audit",
          "movements",
          "supplierPayments",
        ]) {
          if (!Array.isArray(next[list]))
            throw Error("Invalid accounting history");
          if (
            old &&
            JSON.stringify(next[list].slice(0, old[list].length)) !==
              JSON.stringify(old[list])
          )
            throw Error("Posted accounting history is immutable");
        }
        for (const e of next.entries) {
          let debit = 0,
            credit = 0;
          if (!Array.isArray(e.lines)) throw Error("Invalid journal lines");
          for (const l of e.lines) {
            if (
              !Number.isSafeInteger(l.debit) ||
              !Number.isSafeInteger(l.credit) ||
              l.debit < 0 ||
              l.credit < 0
            )
              throw Error("Invalid journal amount");
            debit += l.debit;
            credit += l.credit;
          }
          if (!debit || debit !== credit || !Number.isSafeInteger(debit))
            throw Error("Unbalanced journal");
        }
      }
      return put.run(key, String(text), new Date().toISOString());
    },
    remove: (key) => db.prepare("DELETE FROM records WHERE path=?").run(key),
    rows: () =>
      db
        .prepare("SELECT path,payload,updated_at FROM records ORDER BY path")
        .all(),
    transaction: (fn) => db.transaction(fn).immediate(),
    flushFiles: () => recoverFileJobs(s),
    close: () => {
      db.pragma("wal_checkpoint(TRUNCATE)");
      db.close();
      stores.delete(root);
    },
  };
  let migrationComplete = false;
  try {
    if (
      !db.prepare("SELECT version FROM schema_migrations WHERE version=1").get()
    )
      s.transaction(() => {
        for (const row of legacy) s.put(row.key, row.text);
        if (s.rows().length !== legacy.length)
          throw Error("Migration record count mismatch");
        for (const row of legacy)
          if (s.get(row.key).payload !== row.text)
            throw Error("Migration content mismatch");
        db.prepare("INSERT INTO schema_migrations VALUES(1,?)").run(
          new Date().toISOString(),
        );
      });
    migrationComplete = true;
    for (const dir of collections)
      native.mkdirSync(path.join(root, dir), { recursive: true, mode: 0o700 });
    if (db.pragma("integrity_check", { simple: true }) !== "ok")
      throw Error("SQLite integrity check failed");
    stores.set(root, s);
    recoverFileJobs(s);
    return s;
  } catch (error) {
    db.close();
    stores.delete(root);
    if (fresh && !migrationComplete)
      for (const suffix of ["", "-wal", "-shm"])
        native.rmSync(filename + suffix, { force: true });
    throw error;
  }
}
export function commitSqliteRecords(root, writes, { beforeInstall } = {}) {
  const s = stores.get(path.resolve(root));
  if (!s) return false;
  s.transaction(() => {
    let index = 0;
    for (const [file, value] of writes) {
      const key = keyFor(s.root, file);
      if (!key) throw Error("Not an application record");
      beforeInstall?.(index++);
      if (value === null) s.remove(key);
      else s.put(key, JSON.stringify(value, null, 2));
    }
  });
  return true;
}
export function commitSqliteFiles(
  runtime,
  writes,
  { beforeInstall, afterCommit } = {},
) {
  const s = stores.get(path.join(path.resolve(runtime), "data"));
  if (!s) return false;
  recoverFileJobs(s);
  s.transaction(() => {
    let index = 0;
    for (const [file, value] of writes) {
      beforeInstall?.(index++);
      const key = keyFor(s.root, file);
      if (key) {
        if (value === null) s.remove(key);
        else s.put(key, value.toString());
      } else {
        let ancestor = path.resolve(file);
        while (
          ancestor !== path.resolve(runtime) &&
          ancestor !== path.dirname(ancestor)
        ) {
          if (
            native
              .lstatSync(ancestor, { throwIfNoEntry: false })
              ?.isSymbolicLink()
          )
            throw Error("PDF target is a symbolic link");
          ancestor = path.dirname(ancestor);
        }
        const rel = path.relative(runtime, file);
        if (rel.startsWith("..") || path.isAbsolute(rel))
          throw Error("Invalid file job");
        s.db
          .prepare(
            "INSERT INTO file_jobs VALUES(?,?) ON CONFLICT(path) DO UPDATE SET content=excluded.content",
          )
          .run(rel, value);
      }
    }
  });
  afterCommit?.();
  recoverFileJobs(s);
  return true;
}
function recoverFileJobs(s) {
  const runtime = path.dirname(s.root);
  for (const row of s.db.prepare("SELECT path,content FROM file_jobs").all()) {
    const file = path.resolve(runtime, row.path);
    if (!file.startsWith(runtime + path.sep))
      throw Error("Invalid pending file target");
    let ancestor = file;
    while (ancestor !== runtime) {
      if (
        native.lstatSync(ancestor, { throwIfNoEntry: false })?.isSymbolicLink()
      )
        throw Error("Pending PDF target is a symbolic link");
      ancestor = path.dirname(ancestor);
    }
    if (row.content === null) native.rmSync(file, { force: true });
    else {
      native.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + ".sqlite-tmp";
      const fd = native.openSync(tmp, "w", 0o600);
      try {
        native.writeFileSync(fd, row.content);
        native.fsyncSync(fd);
      } finally {
        native.closeSync(fd);
      }
      native.renameSync(tmp, file);
    }
    s.db.prepare("DELETE FROM file_jobs WHERE path=?").run(row.path);
  }
}
export function withDatabaseClosed(root, fn) {
  const s = stores.get(path.resolve(root));
  if (!s) return fn();
  // The restore routine preserves local lock/folder metadata through these portable files.
  for (const key of ["meta.json", "profile.json"]) {
    const row = s.get(key);
    if (row)
      native.writeFileSync(path.join(root, key), row.payload, { mode: 0o600 });
  }
  s.close();
  try {
    return fn();
  } finally {
    openRecordDatabase(root);
  }
}
export const recordFs = new Proxy(native, {
  get(target, name) {
    if (name === "readFileSync")
      return (file, options) => {
        const m = managed(file);
        if (!m) return native.readFileSync(file, options);
        const row = m.s.get(m.key);
        if (!row) throw enoent(file);
        const encoding =
          typeof options === "string" ? options : options?.encoding;
        return encoding ? row.payload : Buffer.from(row.payload);
      };
    if (name === "existsSync")
      return (file) => {
        const m = managed(file);
        return m ? !!m.s.get(m.key) : native.existsSync(file);
      };
    if (name === "unlinkSync")
      return (file) => {
        const m = managed(file);
        if (!m) return native.unlinkSync(file);
        if (!m.s.get(m.key)) throw enoent(file);
        m.s.remove(m.key);
      };
    if (name === "statSync" || name === "lstatSync")
      return (file, options) => {
        const m = managed(file);
        if (!m) return native[name](file, options);
        const row = m.s.get(m.key);
        if (!row) {
          if (options?.throwIfNoEntry === false) return undefined;
          throw enoent(file);
        }
        return {
          isFile: () => true,
          isDirectory: () => false,
          isSymbolicLink: () => false,
          size: Buffer.byteLength(row.payload),
          mtime: new Date(row.updated_at),
          mtimeMs: new Date(row.updated_at).getTime(),
        };
      };
    if (name === "readdirSync")
      return (dir, options) => {
        const s = storeFor(dir);
        if (!s) return native.readdirSync(dir, options);
        const rel = path.relative(s.root, dir).split(path.sep).join("/");
        if (rel && !collections.has(rel))
          return native.readdirSync(dir, options);
        const names = new Map();
        for (const e of native.readdirSync(dir, { withFileTypes: true })) {
          if ((!rel && hidden.has(e.name)) || managed(path.join(dir, e.name)))
            continue;
          names.set(e.name, e);
        }
        for (const row of s.rows()) {
          const parent = path.posix.dirname(row.path);
          if ((rel || ".") !== parent) continue;
          const name = path.posix.basename(row.path);
          names.set(name, {
            name,
            isFile: () => true,
            isDirectory: () => false,
            isSymbolicLink: () => false,
          });
        }
        return options?.withFileTypes ? [...names.values()] : [...names.keys()];
      };
    if (name === "copyFileSync")
      return (from, to, ...args) => {
        const m = managed(from);
        if (!m) return native.copyFileSync(from, to, ...args);
        native.writeFileSync(to, recordFs.readFileSync(from), { mode: 0o600 });
      };
    if (name === "cpSync")
      return (from, to, options) => {
        if (!storeFor(from)) return native.cpSync(from, to, options);
        if (recordFs.lstatSync(from).isDirectory()) {
          native.mkdirSync(to, { recursive: true });
          for (const e of recordFs.readdirSync(from, { withFileTypes: true }))
            recordFs.cpSync(
              path.join(from, e.name),
              path.join(to, e.name),
              options,
            );
        } else recordFs.copyFileSync(from, to);
      };
    return target[name];
  },
});
export function writeSqliteRecord(file, contents) {
  const m = managed(file);
  if (!m) return false;
  m.s.put(m.key, contents);
  return true;
}
