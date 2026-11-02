import test from "node:test";
import assert from "node:assert/strict";
import {
  invoiceDraftAssistant,
  parseInvoiceDraft,
} from "../ai-invoice-draft.mjs";
import { computeInvoiceTotals } from "../src/utils.js";
import {
  assertSafeInvoiceDraft,
  isEmptyInvoiceDraft,
  invoiceContextResponse,
  invoiceReviewResponse,
} from "../src/utils/ai-invoice-draft.mjs";

const chosen = () => ({
  clientId: "c1",
  items: [{ productId: "p1", quantity: 2 }],
  clarifications: [],
});
function setup() {
  let time = 0,
    active = "business",
    account = "account",
    response = { text: JSON.stringify(chosen()) },
    calls = 0,
    preflight = () => {};
  const data = {
    profile: [
      {
        id: "business",
        businessName: "Demo business",
        country: "India",
        state: "Maharashtra",
        apiKey: "sk-secret-should-not-leave",
      },
    ],
    clients: [
      {
        id: "real-client",
        name: "Ananya Traders",
        state: "Maharashtra",
        country: "India",
        email: "private@example.com",
        gstin: "27ABCDE1234F1Z5",
        accountNumber: "PRIVATE-ACCOUNT",
      },
    ],
    products: [
      {
        id: "real-product",
        name: "Office notebook",
        sellingPrice: 125,
        rate: 100,
        taxPercent: 18,
        cessPercent: 2,
        hsn: "4820",
        unit: "Nos",
        stock: 10,
        apiKey: "PRIVATE-KEY",
      },
    ],
  };
  const prompts = [];
  const api = invoiceDraftAssistant({
    now: () => time,
    readModule: (id, module) => {
      if (id !== active) throw new Error("Business changed");
      return data[module];
    },
    chat: {
      status: () => ({ active: account }),
      ask: async (input, { beforeSend }) => {
        preflight();
        beforeSend();
        calls++;
        prompts.push(input.prompt);
        return response;
      },
    },
  });
  return {
    api,
    data,
    prompts,
    get calls() {
      return calls;
    },
    preview: (instruction = "Invoice Ananya Traders for 2 Office notebooks") =>
      api.preview({ businessId: "business", instruction }),
    generate: (id) =>
      api.generate({
        businessId: "business",
        snapshotId: id,
        model: "test",
        consent: true,
      }),
    setResponse: (value) => {
      response = value;
    },
    setTime: (value) => {
      time = value;
    },
    setActive: (value) => {
      active = value;
    },
    setAccount: (value) => {
      account = value;
    },
    setPreflight: (fn) => {
      preflight = fn;
    },
  };
}

test("local preview requires a bounded request and sends only names, aliases and redacted instructions", async () => {
  const s = setup();
  for (const instruction of ["", " ", "x".repeat(1201), [], null])
    assert.throws(() => s.api.preview({ businessId: "business", instruction }));
  const p = s.preview(
    "Invoice Ananya Traders for 2 Office notebooks. api_key=should-never-leave",
  );
  assert.equal(s.calls, 0);
  assert.equal(p.canGenerate, true);
  const context = JSON.stringify(p.context);
  for (const value of [
    "private@example.com",
    "27ABCDE",
    "PRIVATE",
    "real-client",
    "real-product",
    "should-never-leave",
    "125",
  ])
    assert.equal(context.includes(value), false);
  assert.match(context, /credential omitted/);
  await assert.rejects(
    s.api.generate({ businessId: "business", snapshotId: p.id, model: "test" }),
    /approve/,
  );
  assert.equal(s.calls, 0);
  await s.generate(p.id);
  assert.equal(s.calls, 1);
  for (const value of [
    "private@example.com",
    "PRIVATE",
    "real-client",
    "real-product",
    "should-never-leave",
  ])
    assert.equal(s.prompts[0].includes(value), false);
});

test("valid draft resolves authoritative client, product price, GST and cess; totals use existing engine", async () => {
  const s = setup(),
    before = JSON.stringify(s.data),
    p = s.preview();
  const result = await s.generate(p.id);
  assert.equal(result.client.id, "real-client");
  assert.equal(result.client.email, "private@example.com");
  assert.equal(result.items[0].productId, "real-product");
  assert.equal(result.items[0].rate, 125);
  assert.equal(result.items[0].taxPercent, 18);
  assert.equal(result.items[0].cessPercent, 2);
  assert.equal(result.canApply, true);
  assert.equal("total" in result, false);
  const totals = computeInvoiceTotals({
    profile: s.data.profile[0],
    client: result.client,
    items: result.items,
    showGST: true,
  });
  assert.equal(totals.total, 300);
  assert.equal(totals.cgst, 22.5);
  assert.equal(totals.sgst, 22.5);
  assert.equal(totals.cess, 5);
  assert.deepEqual(
    s.api.resolve({ businessId: "business", draftId: result.id }),
    result,
  );
  assert.throws(
    () => s.api.resolve({ businessId: "business", draftId: result.id }),
    /already applied/,
  );
  await assert.rejects(s.generate(p.id), /Preview/);
  assert.equal(JSON.stringify(s.data), before);
});

test("unknown IDs, invented prices or totals, duplicate products and invalid quantities are rejected", () => {
  const context = { clients: [{ id: "c1" }], products: [{ id: "p1" }] };
  for (const result of [
    { ...chosen(), clientId: "other-business-client" },
    { ...chosen(), total: 999 },
    { ...chosen(), action: "save" },
    { ...chosen(), items: [{ productId: "invented", quantity: 2 }] },
    { ...chosen(), items: [{ productId: "p1", quantity: 2, rate: 1 }] },
    { ...chosen(), items: [{ productId: "p1", quantity: 2, taxPercent: 0 }] },
    { ...chosen(), items: [chosen().items[0], chosen().items[0]] },
    ...[0, -1, "2", 1.2345, 1000001, null].map((quantity) => ({
      ...chosen(),
      items: [{ productId: "p1", quantity }],
    })),
    { ...chosen(), clarifications: [false] },
  ])
    assert.throws(() =>
      parseInvoiceDraft({ text: JSON.stringify(result) }, context),
    );
  assert.throws(() => parseInvoiceDraft({ text: "not json" }, context));
  assert.throws(
    () =>
      parseInvoiceDraft(
        { text: JSON.stringify(chosen()), refusal: true },
        context,
      ),
    /could not help/,
  );
});

test("ambiguous or incomplete drafts require clarification and cannot resolve", async () => {
  const s = setup();
  s.setResponse({
    text: JSON.stringify({
      clientId: null,
      items: [],
      clarifications: ["Which client and products?"],
    }),
  });
  const result = await s.generate(s.preview().id);
  assert.equal(result.canApply, false);
  assert.match(result.clarifications.join(" "), /client/);
  assert.throws(
    () => s.api.resolve({ businessId: "business", draftId: result.id }),
    /Resolve/,
  );
  const duplicate = setup();
  duplicate.data.clients.push({
    ...duplicate.data.clients[0],
    id: "another-client",
  });
  const ambiguous = await duplicate.generate(duplicate.preview().id);
  assert.equal(ambiguous.canApply, false);
  assert.match(ambiguous.clarifications.join(" "), /Multiple/);
});

test("catalog or account changes, including during SDK preflight, stop provider transmission", async () => {
  for (const change of ["business", "account", "catalog"]) {
    const s = setup(),
      p = s.preview();
    s.setPreflight(() => {
      if (change === "business") s.setActive("other");
      else if (change === "account") s.setAccount("other");
      else s.data.products[0].sellingPrice = 500;
    });
    await assert.rejects(s.generate(p.id), /changed/);
    assert.equal(s.calls, 0);
  }
  const s = setup(),
    p = s.preview();
  s.data.products.push({ id: "new", name: "New product" });
  await assert.rejects(s.generate(p.id), /catalog changed/);
  assert.equal(s.calls, 0);
});

test("expired previews and changed catalogs after generation cannot be applied", async () => {
  const s = setup(),
    p = s.preview();
  s.setTime(600001);
  await assert.rejects(s.generate(p.id), /expired/);
  assert.equal(s.calls, 0);
  const current = setup(),
    result = await current.generate(current.preview().id);
  current.data.products[0].taxPercent = 5;
  assert.throws(
    () => current.api.resolve({ businessId: "business", draftId: result.id }),
    /catalog changed/,
  );
  assert.throws(
    () => current.api.resolve({ businessId: "other", draftId: result.id }),
    /unavailable/,
  );
});

test("incomplete saved product tax and price information is never guessed", async () => {
  for (const patch of [
    { sellingPrice: undefined, rate: undefined },
    { taxPercent: undefined },
    { taxPercent: 101 },
    { cessPercent: -1 },
  ]) {
    const s = setup();
    Object.assign(s.data.products[0], patch);
    await assert.rejects(
      s.generate(s.preview().id),
      /saved price, GST and cess/,
    );
  }
});

test("missing or overly broad catalogs block generating until the request is specific", () => {
  const s = setup();
  s.data.clients.length = 0;
  assert.equal(s.preview().canGenerate, false);
  const broad = setup();
  broad.data.products = Array.from({ length: 31 }, (_, index) => ({
    ...broad.data.products[0],
    id: String(index),
    name: `Notebook ${index}`,
  }));
  assert.equal(
    broad.preview("Invoice Ananya Traders for 2 notebooks").canGenerate,
    false,
  );
});

test("partial unnamed client and item edits cannot be replaced as a blank invoice", () => {
  const item = {
    name: "",
    hsn: "",
    quantity: 1,
    rate: 0,
    discount: 0,
    taxPercent: 18,
    cessPercent: 0,
    unit: "Nos",
  };
  assert.equal(isEmptyInvoiceDraft({ name: "", isSEZ: false }, [item]), true);
  for (const client of [
    { name: "", address: "Already entered" },
    { name: "", gstin: "27ABCDE1234F1Z5" },
    { name: "", isSEZ: true },
  ])
    assert.equal(isEmptyInvoiceDraft(client, [item]), false);
  for (const patch of [
    { quantity: 2 },
    { rate: 1 },
    { hsn: "1234" },
    { taxPercent: 5 },
    { cessPercent: 2 },
    { description: "Manual details" },
    { unit: "Pcs" },
  ])
    assert.equal(isEmptyInvoiceDraft({}, [{ ...item, ...patch }]), false);
});

test("unsafe calculated invoice amounts are rejected without clamping working financial math", async () => {
  const s = setup();
  s.data.products[0].sellingPrice = 1e12;
  s.setResponse({
    text: JSON.stringify({
      ...chosen(),
      items: [{ productId: "p1", quantity: 1e6 }],
    }),
  });
  await assert.rejects(s.generate(s.preview().id), /safe calculation limits/);
  assert.throws(
    () =>
      assertSafeInvoiceDraft({
        items: [{ rate: 1e12, quantity: 70, taxPercent: 100, cessPercent: 0 }],
        profile: s.data.profile[0],
        client: s.data.clients[0],
        showGST: true,
      }),
    /safe calculation limits/,
  );
});

test("the reviewed client retains saved print preferences for normal local selection", async () => {
  const s = setup();
  Object.assign(s.data.clients[0], {
    preferredCurrency: "INR",
    preferredPaperSize: "a5",
    preferredCustomPaperWidth: 90,
    preferredCustomPaperHeight: 200,
    autoPrint: false,
  });
  const result = await s.generate(s.preview().id);
  assert.equal(result.client.preferredPaperSize, "a5");
  assert.equal(result.client.preferredCustomPaperWidth, 90);
  assert.equal(result.client.preferredCustomPaperHeight, 200);
  assert.equal(result.client.preferredCurrency, "INR");
});

test("UI response contracts reject malformed or unexpected data before any partial form application", async () => {
  const s = setup(),
    context = s.preview(),
    result = await s.generate(context.id);
  assert.deepEqual(invoiceContextResponse(context), context);
  assert.deepEqual(invoiceReviewResponse(result), result);
  for (const value of [
    null,
    {},
    { ...context, context: { ...context.context, apiKey: "unexpected" } },
    { ...context, canGenerate: "yes" },
  ])
    assert.throws(() => invoiceContextResponse(value), /could not be verified/);
  for (const value of [
    null,
    {},
    { ...result, items: null },
    { ...result, total: 100 },
    { ...result, client: { ...result.client, state: {} } },
    { ...result, items: [{ ...result.items[0], rate: "125" }] },
    { ...result, canApply: true, clarifications: ["Need review"] },
  ])
    assert.throws(() => invoiceReviewResponse(value), /could not be verified/);
});
