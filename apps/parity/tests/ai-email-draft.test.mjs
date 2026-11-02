import test from "node:test";
import assert from "node:assert/strict";
import {
  emailDraftAssistant,
  emailDraftContext,
  parseEmailDraft,
  assertEmailDestinations,
} from "../ai-email-draft.mjs";
const input = () => ({
  kind: "invoice",
  reference: "INV-1",
  senderName: "Demo",
  purpose: "document",
  subject: "Invoice INV-1",
  message: "Hello Sam, your invoice INV-1 is attached.",
  consent: true,
  model: "test",
});
test("email suggestions cannot introduce a new link, email address or UPI destination", () => {
  for (const message of [
    "Pay at attacker.example/collect",
    "Pay https://billing.example/invoicea",
    "Pay https://billing.example/InvoiceA?ref=changed",
  ])
    assert.throws(
      () =>
        assertEmailDestinations(
          { subject: "Invoice", message },
          {
            subject: "Invoice",
            message: "Pay https://billing.example/InvoiceA",
          },
        ),
      /destination/,
    );
  for (const message of [
    "Pay https://new.example/pay",
    "Contact attacker@example.com",
    "Pay owner@bank",
    "Use upi://pay?pa=owner@bank",
    "Visit www.new.example",
  ])
    assert.throws(
      () => assertEmailDestinations({ subject: "Invoice", message }, input()),
      /destination/,
    );
  assert.doesNotThrow(() =>
    assertEmailDestinations(
      { subject: "Invoice", message: "Use https://billing.example/pay." },
      { subject: "Invoice", message: "Pay at https://billing.example/pay" },
    ),
  );
});

test("email drafting redacts credential patterns and checks account at the send boundary", async () => {
  let active = "a",
    sent = false;
  const run = emailDraftAssistant({
    chat: {
      status: () => ({ active }),
      ask: async (request, { beforeSend }) => {
        assert(!request.prompt.includes("fixture-password"));
        active = "b";
        beforeSend();
        sent = true;
        return { text: '{"subject":"One","message":"Two"}' };
      },
    },
  });
  await assert.rejects(
    run({ ...input(), message: "Reference password=fixture-password" }),
    /account changed/,
  );
  assert.equal(sent, false);
});
test("email context requires consent and allowlists only reviewed text", () => {
  assert.throws(
    () => emailDraftContext({ ...input(), consent: false }),
    /approve/,
  );
  const c = emailDraftContext({
    ...input(),
    to: "private@example.com",
    attachment: "private PDF",
    apiKey: "secret",
  });
  assert.deepEqual(Object.keys(c), [
    "kind",
    "reference",
    "senderName",
    "purpose",
    "subject",
    "message",
  ]);
  assert(!JSON.stringify(c).includes("private"));
  assert(!JSON.stringify(c).includes("secret"));
});
test("invalid context is rejected before any provider request", async () => {
  let calls = 0;
  const run = emailDraftAssistant({
    chat: {
      status: () => ({ active: "a" }),
      ask: async () => {
        calls++;
        return { text: "{}" };
      },
    },
  });
  for (const patch of [
    { kind: "other" },
    { purpose: "send" },
    { subject: "a\nb" },
    { message: "x".repeat(4001) },
    { message: "" },
    { senderName: "a".repeat(151) },
    { consent: "true" },
    { model: "" },
  ])
    await assert.rejects(run({ ...input(), ...patch }));
  assert.equal(calls, 0);
});
test("returns a suggestion only, preserving plain text without recipients or actions", async () => {
  let request;
  const run = emailDraftAssistant({
    chat: {
      status: () => ({ active: "a" }),
      ask: async (r) => {
        request = r;
        return {
          text: JSON.stringify({
            subject: "Your invoice INV-1",
            message: "Hello Sam,\nPlease find your invoice attached.",
            to: "attacker@example.com",
            send: true,
          }),
        };
      },
    },
  });
  const result = await run(input());
  assert.deepEqual(result, {
    subject: "Your invoice INV-1",
    message: "Hello Sam,\nPlease find your invoice attached.",
  });
  assert.match(request.prompt, /Do not invent amounts/);
  assert.match(request.prompt, /untrusted data/);
  assert.equal(request.model, "test");
});
test("output validation rejects malformed, oversized and header injection values", () => {
  for (const text of [
    "not json",
    "null",
    "[]",
    "{}",
    JSON.stringify({ subject: "a\r\nBcc: other", message: "Hi" }),
    JSON.stringify({ subject: "okay", message: "x".repeat(6001) }),
  ])
    assert.throws(() => parseEmailDraft(text));
  assert.deepEqual(
    parseEmailDraft(
      '```json\n{"subject":"Receipt","message":"Thank you."}\n```',
    ),
    { subject: "Receipt", message: "Thank you." },
  );
});
test("account changes and provider failures preserve the caller draft", async () => {
  let active = "a";
  const run = emailDraftAssistant({
    chat: {
      status: () => ({ active }),
      ask: async () => {
        active = "b";
        return { text: '{"subject":"One","message":"Two"}' };
      },
    },
  });
  await assert.rejects(run(input()), /account changed/);
  const broken = emailDraftAssistant({
    chat: {
      status: () => ({ active: "a" }),
      ask: async () => {
        throw new Error("Rate limit");
      },
    },
  });
  await assert.rejects(broken(input()), /Rate limit/);
});
