import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
// Device-local credentials deliberately live outside data/ and portable backups.
export function credentialStore(runtime) {
  const dir = path.join(runtime, ".credentials");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "integrations.json");
  let value = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : {
        hostId: `urn:uuid:${randomUUID()}`,
        accounts: [],
        active: null,
        resend: {},
        outbox: {},
      };
  if (
    !value ||
    typeof value.hostId !== "string" ||
    !Array.isArray(value.accounts) ||
    !value.resend ||
    typeof value.resend !== "object" ||
    !value.outbox ||
    typeof value.outbox !== "object"
  )
    throw new Error("Invalid integration credential file");
  function save() {
    const tmp = file + "." + randomUUID();
    try {
      fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600, flag: "wx" });
      const fd = fs.openSync(tmp, "r");
      try {
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tmp, file);
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
  }
  if (!fs.existsSync(file)) save();
  return {
    get: () => structuredClone(value),
    update(fn) {
      const next = structuredClone(value);
      fn(next);
      const prior = value;
      value = next;
      try {
        save();
      } catch (e) {
        value = prior;
        throw e;
      }
      return structuredClone(value);
    },
  };
}
