import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { unzipSync } from "fflate";
import Database from "better-sqlite3";
const require = createRequire(import.meta.url),
  pkg = path.dirname(require.resolve("better-sqlite3/package.json"));
const nativeBinding = path.join(pkg, "build/Release/better_sqlite3.node");
const probe = spawnSync(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    `import Database from 'better-sqlite3';const d=new Database(':memory:',{nativeBinding:${JSON.stringify(nativeBinding)}});const v=d.prepare('select sqlite_version() version').get().version;d.close();process.exit(v==='3.54.1'?0:1);`,
  ],
  { stdio: "ignore" },
);
if (probe.status === 0) {
  console.log("SQLite 3.54.1 verified");
  process.exit(0);
}
const cache = path.resolve("node_modules/.cache/sqlite-3.54.1");
fs.mkdirSync(cache, { recursive: true });
const zipFile = path.join(cache, "amalgamation.zip");
if (!fs.existsSync(zipFile)) {
  const response = await fetch(
    "https://www.sqlite.org/2026/sqlite-amalgamation-3540100.zip",
  );
  if (!response.ok) throw Error("SQLite source download failed");
  fs.writeFileSync(zipFile, Buffer.from(await response.arrayBuffer()));
}
if (
  crypto.createHash("sha256").update(fs.readFileSync(zipFile)).digest("hex") !==
  "0a9c8e34352dad46006aa82836d5383bff9dc6bc9ce5a60553c05aa30e6ad1f9"
)
  throw Error("SQLite archive checksum mismatch");
const files = unzipSync(fs.readFileSync(zipFile)),
  source = files["sqlite-amalgamation-3540100/sqlite3.c"];
// Published SHA3-256: https://www.sqlite.org/releaselog/3_54_1.html
if (
  !source ||
  crypto.createHash("sha3-256").update(source).digest("hex") !==
    "e2b869d3003b33c942b7dd7063604fbc53553e1b66609570df39b9b7b558ee81"
)
  throw Error("SQLite source checksum mismatch");
for (const name of ["sqlite3.c", "sqlite3.h", "sqlite3ext.h"])
  fs.writeFileSync(
    path.join(cache, name),
    files["sqlite-amalgamation-3540100/" + name],
  );
const build = spawnSync(
  process.execPath,
  [
    require.resolve("node-gyp/bin/node-gyp.js"),
    "rebuild",
    "--force_build=1",
    "--sqlite3=" + cache,
  ],
  {
    cwd: pkg,
    stdio: "inherit",
    env: {
      ...process.env,
      CFLAGS: [process.env.CFLAGS, "-DSQLITE_THREADSAFE=2"]
        .filter(Boolean)
        .join(" "),
    },
  },
);
if (build.status !== 0) {
  if (process.platform !== "darwin") process.exit(build.status || 1);
  // CLT-only macOS can have a working compiler without pkgutil's Xcode receipt.
  const headers = path.join(
    os.homedir(),
    "Library/Caches/node-gyp",
    process.versions.node,
    "include/node",
  );
  const addonRequire = createRequire(path.join(pkg, "package.json"));
  const addon = path.dirname(
    addonRequire.resolve("node-addon-api/package.json"),
  );
  const sdk = spawnSync("xcrun", ["--show-sdk-path"], {
    encoding: "utf8",
  }).stdout.trim();
  if (!fs.existsSync(path.join(headers, "node_api.h")) || !sdk)
    throw Error(
      "Install Node headers and macOS Command Line Tools before building SQLite.",
    );
  fs.mkdirSync(path.dirname(nativeBinding), { recursive: true });
  const run = (cmd, args) => {
    const r = spawnSync(cmd, args, { stdio: "inherit" });
    if (r.status !== 0) throw Error(cmd + " build failed");
  };
  const object = path.join(cache, "sqlite3.o");
  run("clang", [
    "-O2",
    "-fPIC",
    "-DSQLITE_THREADSAFE=2",
    "-DSQLITE_ENABLE_COLUMN_METADATA",
    "-isysroot",
    sdk,
    "-c",
    path.join(cache, "sqlite3.c"),
    "-o",
    object,
  ]);
  run("clang++", [
    "-std=c++20",
    "-O2",
    "-fPIC",
    "-shared",
    "-undefined",
    "dynamic_lookup",
    "-isysroot",
    sdk,
    "-DNAPI_VERSION=10",
    "-DNAPI_DISABLE_CPP_EXCEPTIONS",
    "-DNODE_API_SWALLOW_UNTHROWABLE_EXCEPTIONS",
    "-I" + headers,
    "-I" + addon,
    "-I" + cache,
    path.join(pkg, "src/better_sqlite3.cpp"),
    object,
    "-o",
    nativeBinding,
  ]);
}
const result = spawnSync(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    `import Database from 'better-sqlite3'; const db=new Database(':memory:',{nativeBinding:${JSON.stringify(nativeBinding)}});if(db.prepare('select sqlite_version() version').get().version!=='3.54.1')throw Error('Unexpected SQLite runtime'); db.close();`,
  ],
  { stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status || 1);
console.log("SQLite 3.54.1 compiled and verified");
