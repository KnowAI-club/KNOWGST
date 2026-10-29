import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(
  fs.readFileSync(
    path.join(root, "docs/UPSTREAM-CURRENT-MANIFEST.json"),
    "utf8",
  ),
);
const productSpecific = {
  "src/components/WelcomeCard.jsx":
    "Source donation welcome card; KNOWGST keeps its existing onboarding checklist.",
  "src/components/SupportersList.jsx":
    "Source donor list; upstream acknowledgments retained in KNOWGST About.",
  "src/components/WhatsNew.jsx":
    "Replaced by KNOWGST ReleaseNotes and local CHANGELOG.md; no upstream update promises.",
};
const rows = [];
for (const [file, sha256] of Object.entries(manifest.files)) {
  const local = path.join(root, "apps/parity", file);
  if (!fs.existsSync(local)) {
    assert.ok(
      productSpecific[file],
      `Missing upstream surface without disposition: ${file}`,
    );
    rows.push({
      file,
      status: "product-specific replacement",
      note: productSpecific[file],
    });
    continue;
  }
  const actual = crypto
    .createHash("sha256")
    .update(fs.readFileSync(local))
    .digest("hex");
  rows.push({
    file,
    status: actual === sha256 ? "identical" : "adapted",
    note: "",
  });
}
const server = fs.readFileSync(
  path.join(root, "apps/parity/server.js"),
  "utf8",
);
for (const route of manifest.routes)
  assert.ok(server.includes(route), `Missing upstream API route: ${route}`);
console.log(
  `Compared ${rows.length} source files and ${manifest.routes.length} explicit API route declarations at ${manifest.commit}. File presence is not behavioral certification.`,
);
if (process.argv.includes("--write"))
  fs.writeFileSync(
    path.join(root, "docs/UPSTREAM-SURFACE-AUDIT.md"),
    `# Upstream surface audit\n\nSource: ${manifest.repository}, commit \`${manifest.commit}\`, package ${manifest.version}. Reviewed 29 October 2026. This commit also contains changes labelled **1.10.83 unreleased**; it is not just the published 1.10.82 release.\n\nAll ${manifest.routes.length} explicit API declarations are present. Some deliberately return disabled responses (upstream updater/launcher). A matching file or route does not prove its behavior. See FEATURE-PARITY.md and PRODUCTION-GAP-REVIEW.md.\n\n| Source file | Disposition | Note |\n| --- | --- | --- |\n${rows.map((r) => `| ${r.file} | ${r.status} | ${r.note} |`).join("\n")}\n`,
  );
