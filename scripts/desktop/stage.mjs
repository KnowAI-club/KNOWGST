import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
const root = path.resolve(import.meta.dirname, "../..");
const out = path.join(root, ".local/desktop/runtime"),
  icons = path.join(root, ".local/desktop/icons");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(icons, { recursive: true });
const source = path.join(root, "apps/parity");
for (const name of fs.readdirSync(source))
  if (name.endsWith(".mjs") || name === "server.js")
    fs.copyFileSync(path.join(source, name), path.join(out, name));
fs.mkdirSync(path.join(out, "src"), { recursive: true });
fs.copyFileSync(
  path.join(source, "src/utils.js"),
  path.join(out, "src/utils.js"),
);
fs.cpSync(path.join(source, "src/utils"), path.join(out, "src/utils"), {
  recursive: true,
});
fs.cpSync(path.join(source, "dist"), path.join(out, "public"), {
  recursive: true,
});
for (const name of ["package.json", "package-lock.json"])
  fs.copyFileSync(
    path.join(root, "apps/desktop/runtime", name),
    path.join(out, name),
  );
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const install = spawnSync(
  npm,
  ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
  { cwd: out, stdio: "inherit", shell: process.platform === "win32" },
);
if (install.status !== 0) throw Error("Service dependency installation failed");
const req = createRequire(path.join(source, "package.json"));
const binding = path.join(
  path.dirname(req.resolve("better-sqlite3/package.json")),
  "build/Release/better_sqlite3.node",
);
const dest = path.join(out, "node_modules/better-sqlite3/build/Release");
fs.mkdirSync(dest, { recursive: true });
fs.copyFileSync(binding, path.join(dest, "better_sqlite3.node"));
const nodePath = path.join(
  out,
  process.platform === "win32" ? "node.exe" : "node",
);
fs.copyFileSync(process.execPath, nodePath);
fs.chmodSync(nodePath, 0o755);
// Preserve runtime attribution with the exact embedded Node version.
const license = await fetch(
  `https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`,
);
if (!license.ok) throw Error("Could not retrieve embedded Node license");
fs.writeFileSync(path.join(out, "NODE-LICENSE"), await license.text());
fs.writeFileSync(
  path.join(out, "runtime-manifest.json"),
  JSON.stringify(
    {
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      sqlite: "3.54.1",
    },
    null,
    2,
  ),
);
const probe = spawnSync(
  nodePath,
  [
    "--input-type=module",
    "-e",
    "import Database from 'better-sqlite3';const db=new Database(':memory:',{nativeBinding:'./node_modules/better-sqlite3/build/Release/better_sqlite3.node'});const v=db.prepare('select sqlite_version() v').get().v;db.close();if(v!=='3.54.1')throw Error(v);console.log('Packaged SQLite',v)",
  ],
  { cwd: out, stdio: "inherit" },
);
if (probe.status !== 0)
  throw Error("Packaged SQLite runtime verification failed");
const brand = fs
  .readFileSync(path.join(source, "public/brand/knowai-icon.svg"), "utf8")
  .replace(/<style>[\s\S]*?<\/style>/, "")
  .replace(
    "<svg ",
    '<svg fill="#09090d" x="192" y="192" width="640" height="640" ',
  );
const svg = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" rx="210" fill="#fafbf8"/>${brand}</svg>`,
);
await sharp(svg).png().toFile(path.join(icons, "icon.png"));
const png = await sharp(svg).resize(256, 256).png().toBuffer();
const ico = Buffer.alloc(22);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(1, 4);
ico.writeUInt16LE(1, 10);
ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png.length, 14);
ico.writeUInt32LE(22, 18);
fs.writeFileSync(path.join(icons, "icon.ico"), Buffer.concat([ico, png]));
if (process.platform === "darwin") {
  const set = path.join(icons, "icon.iconset");
  fs.mkdirSync(set, { recursive: true });
  for (const size of [16, 32, 128, 256, 512])
    for (const scale of [1, 2])
      await sharp(svg)
        .resize(size * scale, size * scale)
        .png()
        .toFile(
          path.join(set, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`),
        );
  const result = spawnSync(
    "iconutil",
    ["-c", "icns", set, "-o", path.join(icons, "icon.icns")],
    { stdio: "inherit" },
  );
  if (result.status !== 0) throw Error("macOS icon conversion failed");
}
console.log("Desktop runtime staged:", out);
