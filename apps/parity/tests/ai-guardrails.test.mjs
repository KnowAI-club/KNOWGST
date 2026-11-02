import test from "node:test";
import assert from "node:assert/strict";
import {
  AI_MAX_OUTPUT,
  createAiRequestLimiter,
  redactSensitiveText,
  validatedAiText,
} from "../ai-guardrails.mjs";
import { chatgptOAuth } from "../chatgpt-oauth.mjs";

test("credential patterns are removed from ordinary descriptions without removing financial evidence", () => {
  const secret = "this_is_a_fixture_not_a_real_key";
  for (const text of [
    `Description: sk-proj-${secret}`,
    `Paid by re_${secret}`,
    `Header Bearer ${secret}`,
    `api_key=${secret}`,
    `{"password":"${secret}"}`,
    `{"clientSecret":"${secret}"}`,
    `https://test.invalid/auth?code=${secret}&state=public`,
    `https://user:${secret}@test.invalid/`,
    `-----BEGIN PRIVATE KEY-----\n${secret}\n-----END PRIVATE KEY-----`,
  ]) {
    assert(!redactSensitiveText(text).includes(secret));
    assert.equal(
      redactSensitiveText(redactSensitiveText(text)),
      redactSensitiveText(text),
    );
  }
  const record =
    "Invoice GST/26-27/001, ₹1,234.50, GSTIN 27ABCDE1234F1Z5, customer@example.test";
  assert.equal(redactSensitiveText(record), record);
  assert.equal(
    redactSensitiveText(
      "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.fixture_signature",
    ),
    "[credential omitted]",
  );
});

test("provider outputs are bounded, explicit refusals fail closed and controls are rejected", () => {
  assert.throws(
    () => validatedAiText({ text: "Bearer x" }, { maxLength: 8 }),
    /limit/,
  );
  for (const response of [
    null,
    {},
    { text: " " },
    { text: 123 },
    { text: "a".repeat(AI_MAX_OUTPUT + 1) },
    { text: "hello\u0000" },
    { text: "unsafe partial", refusal: "Cannot comply" },
  ])
    assert.throws(() => validatedAiText(response));
  assert.throws(() => validatedAiText({ text: "12345" }, { maxLength: 4 }));
  assert.equal(validatedAiText({ text: "Review\n₹100" }), "Review\n₹100");
});

test("shared request budget bounds concurrent and repeated calls and always releases slots", () => {
  let time = 1000;
  const limiter = createAiRequestLimiter({
    now: () => time,
    concurrent: 2,
    limit: 3,
    windowMs: 100,
  });
  const a = limiter.enter(),
    b = limiter.enter();
  assert.throws(
    () => limiter.enter(),
    (error) => error.status === 429,
  );
  a();
  a();
  const c = limiter.enter();
  b();
  c();
  assert.throws(() => limiter.enter(), /request limit/);
  time += 101;
  limiter.enter()();
});

function sdkFixture({ onModels = () => {}, events = [] } = {}) {
  const state = {
    active: "fixture-client",
    accounts: [
      {
        clientId: "fixture-client",
        accessToken: "fixture-access",
        expires: Date.now() + 3600000,
        scopes: ["chatgpt.tokens.use.direct", "resource.invoke"],
      },
    ],
  };
  const sent = [];
  const chat = chatgptOAuth(
    { get: () => state },
    {
      fetcher: async (url, options) => {
        if (String(url).endsWith("/models")) {
          await onModels();
          return Response.json({
            models: [{ slug: "fixture-model", visibility: "list" }],
          });
        }
        assert(String(url).endsWith("/responses"));
        sent.push(JSON.parse(options.body));
        return new Response(
          events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    },
  );
  return { chat, sent };
}
const ask = { model: "fixture-model", prompt: "Summarize this invoice" };

test("SDK rechecks business scope after async preflight before transmitting data", async () => {
  let business = "first";
  const { chat, sent } = sdkFixture({
    onModels: () => {
      business = "second";
    },
  });
  await assert.rejects(
    chat.ask(ask, {
      beforeSend: () => {
        if (business !== "first")
          throw Object.assign(new Error("Business changed"), { status: 409 });
      },
    }),
    /Business changed/,
  );
  assert.equal(sent.length, 0);
});

test("SDK uses no tools, redacts input, and rejects streamed refusal, incomplete or oversized replies", async () => {
  const completed = { type: "response.completed" };
  for (const events of [
    [
      { type: "response.output_text.delta", delta: "partial" },
      { type: "response.refusal.delta", delta: "refusal" },
      completed,
    ],
    [
      { type: "response.output_text.delta", delta: "partial" },
      { type: "response.incomplete" },
    ],
    [
      {
        type: "response.output_text.delta",
        delta: "x".repeat(AI_MAX_OUTPUT + 1),
      },
      completed,
    ],
    [{ type: "response.output_text.delta", delta: "partial" }],
    [
      { type: "response.output_text.delta", delta: "partial" },
      {
        type: "response.completed",
        response: { output: [{ content: [{ type: "refusal" }] }] },
      },
    ],
  ]) {
    const { chat, sent } = sdkFixture({ events });
    await assert.rejects(
      chat.ask({
        ...ask,
        prompt: "Invoice description: password=fixture-secret",
      }),
    );
    assert.equal(sent.length, 1);
    assert(!JSON.stringify(sent).includes("fixture-secret"));
    assert.equal(sent[0].tools, undefined);
    assert.equal(sent[0].store, false);
    assert.equal(sent[0].stream, true);
    assert.equal(sent[0].max_output_tokens, undefined);
  }
});

test("SDK checks scope again on completion and preserves clean supported replies", async () => {
  let checked = 0;
  const { chat } = sdkFixture({
    events: [
      { type: "response.output_text.delta", delta: "Reviewed answer" },
      { type: "response.completed" },
    ],
  });
  assert.deepEqual(
    await chat.ask(ask, {
      beforeSend: () => {
        checked++;
      },
    }),
    { text: "Reviewed answer" },
  );
  assert.equal(checked, 3);
  await assert.rejects(
    chat.ask(ask, {
      beforeSend: () => {
        if (++checked === 6)
          throw Object.assign(new Error("Data changed"), { status: 409 });
      },
    }),
    /Data changed/,
  );
});
