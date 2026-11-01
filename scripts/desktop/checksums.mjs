import fs from "node:fs";
import crypto from "node:crypto";
const files = fs
  .readdirSync("release")
  .filter((name) => /\.(exe|dmg|zip)$/.test(name))
  .sort();
fs.writeFileSync(
  "release/SHA256SUMS",
  files
    .map(
      (name) =>
        `${crypto
          .createHash("sha256")
          .update(fs.readFileSync("release/" + name))
          .digest("hex")}  ${name}`,
    )
    .join("\n") + "\n",
);
