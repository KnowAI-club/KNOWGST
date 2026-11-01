import test from "node:test";
import assert from "node:assert/strict";
import {
  safeRecord,
  searchBusinessRecords,
  recordAssistant,
  RECORD_MODULES,
} from "../ai-records.mjs";
test("records remove nested credentials and binaries but retain accounting details", () => {
  assert.deepEqual(
    safeRecord({
      id: "one",
      data: {
        apiKey: "secret",
        customer: "Demo",
        accessToken: "secret",
        logo: "image",
      },
      amount: 42,
    }),
    { id: "one", data: { customer: "Demo" }, amount: 42 },
  );
  assert.equal(
    safeRecord("data:image/png;base64,secret"),
    "[binary or credential omitted]",
  );
});
test("every supported module is searchable and partial coverage is explicit", () => {
  const read = () =>
    Array.from({ length: 12 }, (_, i) => ({ id: String(i), name: "Water" }));
  for (const module of RECORD_MODULES) {
    const r = searchBusinessRecords(read, "a", { module, query: "water" });
    assert.equal(r.total, 12);
    assert.equal(r.returned, 5);
    assert.equal(r.more, true);
  }
  assert.equal(
    searchBusinessRecords(read, "a", { module: "bills", id: "11" }).records[0]
      .id,
    "11",
  );
  for (const selection of [
    { module: "../credentials" },
    { module: "bills", offset: -1 },
    { module: "bills", query: [] },
    { module: "bills", offset: 0.5 },
  ])
    assert.throws(() => searchBusinessRecords(read, "a", selection));
});
test("assistant requires consent, isolates business and detects changed source data", async () => {
  let active = "a",
    value = 42,
    calls = 0;
  const reads = [];
  const readModule = (id, module) => {
    if (id !== active) throw new Error("Business changed");
    reads.push(module);
    return [{ id: "invoice-1", amount: value }];
  };
  const chat = {
    status: () => ({ active: "account" }),
    ask: async () => {
      calls++;
      return {
        text:
          calls % 2
            ? JSON.stringify({ module: "bills", query: "invoice-1" })
            : "Invoice review",
      };
    },
  };
  const run = recordAssistant({ chat, readModule });
  const input = {
    businessId: "a",
    question: "Find invoice-1",
    model: "m",
    consent: true,
  };
  await assert.rejects(run({ ...input, consent: false }));
  await assert.rejects(run({ ...input, businessId: "b" }));
  assert.equal(calls, 0);
  const result = await run(input);
  assert.equal(result.sources[0].id, "invoice-1");
  assert.equal(result.coverage.returned, 1);
  const changed = recordAssistant({
    readModule,
    chat: {
      ...chat,
      ask: async () => {
        calls++;
        if (calls % 2 === 0) value++;
        return {
          text:
            calls % 2
              ? JSON.stringify({ module: "bills", query: "" })
              : "Changed review",
        };
      },
    },
  });
  await assert.rejects(changed(input), /changed during/);
});
test("malicious model search plans cannot read arbitrary modules", async () => {
  let calls = 0;
  const run = recordAssistant({
    readModule: () => [],
    chat: {
      status: () => ({ active: "a" }),
      ask: async () => {
        calls++;
        return { text: '{"module":"credentials"}' };
      },
    },
  });
  await assert.rejects(
    run({ businessId: "a", question: "show data", model: "m", consent: true }),
    /Invalid record search/,
  );
  assert.equal(calls, 1);
});
