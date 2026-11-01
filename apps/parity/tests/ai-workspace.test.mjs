import test from "node:test";
import assert from "node:assert/strict";
import { aiWorkspace, summaryContext } from "../ai-workspace.mjs";
const base = () => ({
  businessId: "one",
  month: "2026-11",
  currency: "INR",
  sales: 100,
  previousSales: 0,
  invoiceTax: 18,
  received: 0,
  spent: 0,
  outstanding: 118,
  overdueAmount: 118,
  payable: 0,
  overdue: ["private-id"],
  unallocated: [],
  lowStock: [],
  untrackedPurchases: 0,
  warnings: [],
  activity: [{ party: "Secret Customer", gstin: "Secret GSTIN" }],
});
function setup() {
  let data = base(),
    account = "a",
    time = 0,
    calls = 0;
  const api = aiWorkspace({
    readSummary: () => data,
    now: () => time,
    chat: {
      status: () => ({ active: account }),
      ask: async () => {
        calls++;
        return { text: "Review" };
      },
    },
  });
  const options = {
    businessId: "one",
    task: "monthly",
    month: "2026-11",
    currency: "INR",
  };
  return {
    api,
    options,
    get calls() {
      return calls;
    },
    setData: (v) => {
      data = v;
    },
    setAccount: (v) => {
      account = v;
    },
    setTime: (v) => {
      time = v;
    },
  };
}
test("context allowlist excludes identities and raw records", () => {
  const value = JSON.stringify(summaryContext(base()));
  assert(!value.includes("Secret"));
  assert(!value.includes("private-id"));
  assert.equal(JSON.parse(value).amounts.sales, 100);
});
test("explicit consent and one-use snapshots protect provider calls", async () => {
  const s = setup(),
    p = s.api.preview(s.options);
  await assert.rejects(
    s.api.analyze({ snapshotId: p.id, model: "m" }),
    /approve/,
  );
  assert.equal(s.calls, 0);
  assert.deepEqual(
    await s.api.analyze({ snapshotId: p.id, model: "m", consent: true }),
    { text: "Review" },
  );
  await assert.rejects(
    s.api.analyze({ snapshotId: p.id, model: "m", consent: true }),
    /expired/,
  );
  assert.equal(s.calls, 1);
});
test("changed records, account, business and expired consent are rejected", async () => {
  for (const mutate of [
    (s) => s.setData({ ...base(), sales: 200 }),
    (s) => s.setAccount("b"),
    (s) => s.setData({ ...base(), businessId: "two" }),
    (s) => s.setTime(300001),
  ]) {
    const s = setup(),
      p = s.api.preview(s.options);
    mutate(s);
    await assert.rejects(
      s.api.analyze({ snapshotId: p.id, consent: true, model: "m" }),
    );
    assert.equal(s.calls, 0);
  }
});
test("cross-business preview and invalid amounts are rejected", () => {
  const s = setup();
  assert.throws(
    () => s.api.preview({ ...s.options, businessId: "other" }),
    /Business changed/,
  );
  assert.throws(
    () => summaryContext({ ...base(), sales: NaN }),
    /invalid amount/,
  );
  assert.throws(
    () => s.api.preview({ ...s.options, task: "delete" }),
    /Choose/,
  );
});
test("draft prompt forbids inserting aggregate debt in individual reminders", () => {
  const s = setup();
  assert.match(
    s.api.preview({ ...s.options, task: "collections" }).prompt,
    /Do not insert aggregate balances/,
  );
});

test("rejects results when the business changes during inference", async () => {
  let data = base();
  const api = aiWorkspace({
    readSummary: () => data,
    chat: {
      status: () => ({ active: "a" }),
      ask: async () => {
        data = { ...base(), businessId: "two" };
        return { text: "Must not be shown" };
      },
    },
  });
  const snapshot = api.preview({
    businessId: "one",
    task: "review",
    month: "2026-11",
    currency: "INR",
  });
  await assert.rejects(
    api.analyze({ snapshotId: snapshot.id, consent: true, model: "m" }),
    /Business changed/,
  );
});

test("provider failure consumes consent and cannot silently retry", async () => {
  let calls = 0;
  const api = aiWorkspace({
    readSummary: base,
    chat: {
      status: () => ({ active: "a" }),
      ask: async () => {
        calls++;
        throw new Error("Interrupted response");
      },
    },
  });
  const snapshot = api.preview({
    businessId: "one",
    task: "review",
    month: "2026-11",
    currency: "INR",
  });
  const input = { snapshotId: snapshot.id, consent: true, model: "m" };
  await assert.rejects(api.analyze(input), /Interrupted/);
  await assert.rejects(api.analyze(input), /expired/);
  assert.equal(calls, 1);
});
