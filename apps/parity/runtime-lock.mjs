import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
// Serialize planners as well as SQLite commits: one application writer per runtime.
export function acquireRuntimeLock(root) {
  const file = path.join(root, ".knowgst-server.lock"),
    owner = {
      pid: process.pid,
      host: os.hostname(),
      token: crypto.randomUUID(),
    };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, JSON.stringify(owner), {
        flag: "wx",
        mode: 0o600,
      });
      const release = () => {
        try {
          if (JSON.parse(fs.readFileSync(file, "utf8")).token === owner.token)
            fs.unlinkSync(file);
        } catch {}
      };
      process.once("exit", release);
      return release;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const previous = JSON.parse(fs.readFileSync(file, "utf8"));
      if (previous.host !== owner.host || !Number.isInteger(previous.pid))
        throw Error(
          "The workspace is locked by another host or needs lock recovery.",
        );
      let alive = true;
      try {
        process.kill(previous.pid, 0);
      } catch (e) {
        if (e.code === "ESRCH") alive = false;
      }
      if (alive)
        throw Error(
          "KNOWGST is already running for this workspace. Close it before starting another server.",
        );
      if (JSON.parse(fs.readFileSync(file, "utf8")).token === previous.token)
        fs.unlinkSync(file);
    }
  }
  throw Error("Unable to acquire the workspace writer lock.");
}
