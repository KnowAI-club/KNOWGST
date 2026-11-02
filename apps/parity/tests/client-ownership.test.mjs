import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { invoiceRevision } from "../invoice-transactions.mjs";

test("client ownership: scoped writes and explicit legacy assignment preserve business boundaries", async (t) => {
  const runtime = await mkdtemp(join(tmpdir(), "knowgst-client-scope-"));
  const secret = randomBytes(32).toString("hex");
  const profile = { id: "A", businessName: "Business A", country: "India" };
  const clients = [
    { id: "foreign", name: "Private B", businessId: "B" },
    { id: "profile-owner", name: "Profile B", profileId: "B" },
    { id: "legacy", name: "Legacy Client", email: "legacy@example.test", custom: { preserve: true } },
    { id: "legacy-same", name: "Same-business history" },
    { id: "legacy-id", name: "Renamed legacy client" },
    { id: "legacy-name", name: "Name Match" },
    { id: "legacy-unknown", name: "Unknown History" },
    { id: "legacy-trash", name: "Archived Client" },
    { id: "legacy-recurring", name: "Recurring Client" },
    { id: "legacy-receipt", name: "Receipt Client" },
    { id: "legacy-stale", name: "Stale legacy" },
  ];
  const fixtures = {
    clients,
    bills: [
      { id: "bill-a", businessId: "A", clientName: "Same-business history", totalAmount: 0 },
      { id: "bill-id", businessId: "B", clientId: "legacy-id", clientName: "Old name", totalAmount: 0 },
      { id: "bill-name", businessId: "B", clientName: "  NAME MATCH  ", totalAmount: 0 },
      { id: "bill-unknown", clientName: "Unknown History", totalAmount: 0 },
    ],
    trash: [{ id: "archived", bill: { id: "inner", businessId: "B", data: { client: { id: "legacy-trash", name: "Archived Client" } } } }],
    recurring: [{ id: "recurring-b", businessId: "B", clientName: "Recurring Client", active: false }],
    receipts: [{ id: "receipt-b", businessId: "B", receivedFrom: "Receipt Client", amount: 1 }],
  };
  for (const [directory, records] of Object.entries(fixtures)) {
    await mkdir(join(runtime, "data", directory), { recursive: true });
    for (const record of records) await writeFile(join(runtime, "data", directory, record.id + ".json"), JSON.stringify(record));
  }
  await writeFile(join(runtime, "data", "profile.json"), JSON.stringify(profile));
  const child = fork(fileURLToPath(new URL("../server.js", import.meta.url)), [], {
    env: { ...process.env, KNOWGST_RUNTIME: runtime, KNOWGST_PORT: "0", KNOWGST_LOCAL_SECRET: secret },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let errors = "";
  child.stderr.on("data", chunk => { errors = (errors + chunk).slice(-2000); });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once("exit", resolve));
      child.kill("SIGTERM");
      await exited;
    }
    await rm(runtime, { recursive: true, force: true });
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Client test server startup timed out: " + errors)), 10000);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", () => { clearTimeout(timer); reject(new Error("Client test server exited: " + errors)); });
    child.on("message", message => { if (message.type === "ready") { clearTimeout(timer); resolve(message.port); } });
  });
  async function call(path, method = "GET", body, headers = {}) {
    const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: { "x-knowgst-key": secret, "Content-Type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  }
  await t.test("known foreign and unassigned clients are absent from the active list and ledger", async () => {
    assert.deepEqual((await call("/clients")).body, []);
    const legacy = (await call("/clients?unassigned=1")).body;
    assert.equal(legacy.length, clients.length - 2);
    assert(!legacy.some(client => ["foreign", "profile-owner"].includes(client.id)));
    assert(legacy.every(client => typeof client._revision === "string"));
    assert.deepEqual((await call("/clients/invoices")).body.map(bill => bill.id), ["bill-a"]);
  });
  let saved;
  await t.test("new clients are stamped, updates preserve fields and revisions reject stale changes", async () => {
    const created = await call("/clients", "POST", { id: "new", name: "New client", custom: { keep: true } });
    assert.equal(created.status, 200);
    saved = created.body.client;
    assert.equal(saved.businessId, "A");
    assert.equal((await call("/clients")).body[0].businessId, "A");
    const update = await call("/clients", "POST", { id: saved.id, name: "Updated", _revision: saved._revision });
    assert.equal(update.status, 200);
    assert.deepEqual(update.body.client.custom, { keep: true });
    assert.notEqual(update.body.client._revision, saved._revision);
    assert.equal((await call("/clients", "POST", { ...saved, name: "Stale overwrite" })).status, 409);
    saved = update.body.client;
    assert.equal((await call("/clients", "POST", { name: "Wrong owner", businessId: "B" })).status, 409);
    assert.equal((await call("/clients", "POST", { ...saved, profileId: "B" })).status, 409);
    assert.equal((await call("/clients", "POST", { id: "foreign", name: "Take over", businessId: "A", _revision: invoiceRevision(clients[0]) })).status, 409);
    assert.equal((await call("/clients", "POST", { id: "legacy", name: "Silent assignment", businessId: "A", _revision: invoiceRevision(clients[2]) })).status, 409);
  });
  await t.test("legacy assignment preserves every field and validates the reviewed revision", async () => {
    const legacy = (await call("/clients?unassigned=1")).body.find(client => client.id === "legacy");
    assert.equal((await call("/clients/legacy/assign", "POST", { revision: "stale" })).status, 409);
    const assigned = await call("/clients/legacy/assign", "POST", { revision: legacy._revision });
    assert.equal(assigned.status, 200);
    const { _revision, businessId, ...record } = assigned.body.client;
    assert.equal(businessId, "A");
    assert.deepEqual(record, clients[2]);
    assert.equal((await call("/clients/legacy/assign", "POST", { revision: legacy._revision })).status, 409);
    assert((await call("/clients")).body.some(client => client.id === "legacy"));
    assert(!(await call("/clients?unassigned=1")).body.some(client => client.id === "legacy"));
    const same = (await call("/clients?unassigned=1")).body.find(client => client.id === "legacy-same");
    assert.equal((await call("/clients/legacy-same/assign", "POST", { revision: same._revision })).status, 200);
  });
  await t.test("foreign or unresolved invoice, archived, recurring and receipt history blocks assignment", async () => {
    const unassigned = (await call("/clients?unassigned=1")).body;
    for (const id of ["legacy-id", "legacy-name", "legacy-unknown", "legacy-trash", "legacy-recurring", "legacy-receipt"]) {
      const client = unassigned.find(client => client.id === id);
      const result = await call(`/clients/${id}/assign`, "POST", { revision: client._revision });
      assert.equal(result.status, 409, id + ": " + JSON.stringify(result.body));
      assert((await call("/clients?unassigned=1")).body.some(client => client.id === id));
    }
  });
  await t.test("foreign/unassigned deletion and stale recreation are rejected", async () => {
    assert.equal((await call("/clients/foreign", "DELETE", undefined, { "If-Match": invoiceRevision(clients[0]) })).status, 409);
    const legacy = (await call("/clients?unassigned=1")).body.find(client => client.id === "legacy-stale");
    assert.equal((await call("/clients/legacy-stale", "DELETE", undefined, { "If-Match": legacy._revision })).status, 409);
    assert.equal((await call("/clients/new", "DELETE")).status, 409);
    assert.equal((await call("/clients/new", "DELETE", undefined, { "If-Match": saved._revision })).status, 200);
    assert.equal((await call("/clients", "POST", saved)).status, 409);
    assert(!(await call("/clients")).body.some(client => client.id === "new"));
  });
  await t.test("switching business reveals only its clients and rejects stale window writes", async () => {
    assert.equal((await call("/profile", "POST", { id: "B", businessName: "Business B" })).status, 200);
    assert.deepEqual((await call("/clients")).body.map(client => client.id).sort(), ["foreign", "profile-owner"]);
    assert.deepEqual((await call("/clients/invoices")).body.map(bill => bill.id).sort(), ["bill-id", "bill-name"]);
    assert.equal((await call("/clients", "POST", { name: "Old window" }, { "x-knowgst-business": "A" })).status, 409);
    const legacy = (await call("/clients?unassigned=1")).body.find(client => client.id === "legacy-id");
    assert.equal((await call("/clients/legacy-id/assign", "POST", { revision: legacy._revision })).status, 200);
  });
});
