import test from "node:test";
import assert from "node:assert/strict";
import {
  categoryContext,
  categoryAssistant,
  parseCategorySuggestions,
} from "../ai-categorization.mjs";
const row = {
  id: "1",
  description: "Monthly cloud hosting",
  amount: 1200,
  currency: "INR",
  direction: "debit",
  category: "Other",
};
const request = () => ({
  kind: "expense",
  businessId: "active",
  model: "test",
  consent: true,
  rows: [{ ...row }],
});
const response = () => ({
  suggestions: [
    {
      id: "1",
      category: "Software & Tools",
      reason: "Hosting appears related to software services.",
    },
  ],
});

test("explicit consent and bounded selected data are required; private fields are omitted", () => {
  for (const patch of [
    { consent: false },
    { consent: "true" },
    { rows: [] },
    { rows: Array(11).fill(row) },
    { rows: [row, row] },
    { kind: "credentials" },
    { businessId: {} },
  ])
    assert.throws(() => categoryContext({ ...request(), ...patch }));
  for (const patch of [
    { description: "" },
    { description: "a".repeat(401) },
    { amount: "12" },
    { amount: NaN },
    { amount: -1 },
    { amount: Infinity },
    { category: "invented" },
    { category: ["Other"] },
    { currency: "USDD" },
    { direction: "invalid" },
  ])
    assert.throws(() =>
      categoryContext({ ...request(), rows: [{ ...row, ...patch }] }),
    );
  assert.deepEqual(
    categoryContext({
      ...request(),
      apiKey: "secret",
      rows: [{ ...row, accountNumber: "secret", apiKey: "secret" }],
    }),
    { kind: "expense", rows: [row] },
  );
});

test("provider output must match selected IDs and existing category names; no HTML is interpreted", () => {
  const context = categoryContext(request());
  assert.deepEqual(
    parseCategorySuggestions(JSON.stringify(response()), context),
    response(),
  );
  assert.equal(
    parseCategorySuggestions(
      JSON.stringify({
        suggestions: [
          { id: "1", category: null, reason: "Insufficient information." },
        ],
      }),
      context,
    ).suggestions[0].category,
    null,
  );
  for (const value of [
    "bad json",
    "{}",
    '{"suggestions":[]}',
    JSON.stringify({
      suggestions: [{ id: "other", category: "Other", reason: "unknown row" }],
    }),
    JSON.stringify({
      suggestions: [
        { id: "1", category: "Made up category", reason: "new category" },
      ],
    }),
    JSON.stringify({
      suggestions: [{ id: "1", category: "Other", reason: "x".repeat(501) }],
    }),
  ])
    assert.throws(() => parseCategorySuggestions(value, context));
  const two = { ...context, rows: [row, { ...row, id: "2" }] };
  assert.throws(() =>
    parseCategorySuggestions(
      JSON.stringify({
        suggestions: [response().suggestions[0], response().suggestions[0]],
      }),
      two,
    ),
  );
});

test("bank categories are the same allowlist used in the existing import UI", () => {
  const context = categoryContext({
    ...request(),
    kind: "bank",
    rows: [{ ...row, category: "transfer" }],
  });
  assert.equal(
    parseCategorySuggestions(
      JSON.stringify({
        suggestions: [
          {
            id: "1",
            category: "business_out",
            reason: "A business service payment.",
          },
        ],
      }),
      context,
    ).suggestions[0].category,
    "business_out",
  );
  assert.throws(() =>
    parseCategorySuggestions(JSON.stringify(response()), context),
  );
});

test("assistant guards active business before and after inference and only sends chosen data", async () => {
  let active = "active",
    calls = 0,
    prompt = "";
  const reads = [];
  const chat = {
    status: () => ({ active: "account" }),
    ask: async (input) => {
      calls++;
      prompt = input.prompt;
      return { text: JSON.stringify(response()) };
    },
  };
  const assistant = categoryAssistant({
    chat,
    readModule: (id, module) => {
      reads.push(module);
      if (id !== active) throw new Error("Business changed");
      return [];
    },
  });
  await assert.rejects(assistant({ ...request(), consent: false }));
  await assert.rejects(assistant({ ...request(), businessId: "another" }));
  assert.equal(calls, 0);
  assert.deepEqual(
    await assistant({
      ...request(),
      apiKey: "secret-field",
      rows: [{ ...row, vendorGstin: "secret-field" }],
    }),
    response(),
  );
  assert.equal(calls, 1);
  assert.equal(prompt.includes("secret-field"), false);
  assert.match(prompt, /Monthly cloud hosting/);
  assert.match(prompt, /untrusted data/);
  assert.ok(reads.every((m) => m === "profile"));
  chat.ask = async () => {
    active = "new-business";
    return { text: JSON.stringify(response()) };
  };
  await assert.rejects(assistant(request()), /Business changed/);
});

test("account changes and provider failures never return suggestions or mutate records", async () => {
  let account = "a";
  const chat = {
    status: () => ({ active: account }),
    ask: async () => {
      account = "b";
      return { text: JSON.stringify(response()) };
    },
  };
  const assistant = categoryAssistant({ chat, readModule: () => [] });
  await assert.rejects(assistant(request()), /account changed/);
  chat.ask = async () => {
    throw new Error("Connection interrupted");
  };
  await assert.rejects(assistant(request()), /Connection interrupted/);
  await assert.rejects(assistant({ ...request(), model: "" }), /model/);
});
