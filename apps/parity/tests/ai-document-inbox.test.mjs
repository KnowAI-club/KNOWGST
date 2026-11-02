import test from "node:test";
import assert from "node:assert/strict";
import { documentInbox } from "../ai-document-inbox.mjs";
const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL9kAAAAASUVORK5CYII=";
const fields = () => ({
  supplierName: "Supplier",
  supplierGstin: "",
  invoiceNumber: "S-1",
  date: "2026-11-02",
  grandTotal: 118,
  taxBreakdown: {
    taxableValue: 100,
    cgst: 9,
    sgst: 9,
    igst: 0,
    cess: 0,
    roundOff: 0,
  },
  items: [
    {
      name: "Widget",
      hsn: "1234",
      quantity: 1,
      rate: 100,
      taxPercent: 18,
      cessPercent: 0,
    },
  ],
});
function setup() {
  let business = "A",
    account = "account",
    beforeSendHook = () => {},
    calls = 0;
  const states = new Map(),
    modules = {
      profile: [{ id: "A" }],
      products: [],
      expenses: [],
      purchases: [],
    };
  const readModule = (id, module) => {
    if (id !== business) throw Error("Business changed");
    return modules[module] || [];
  };
  const store = {
    read({ businessId, bucket }) {
      readModule(businessId, "profile");
      return structuredClone(
        states.get(businessId + bucket) || { revision: 0, data: {} },
      );
    },
    update({ businessId, bucket, revision, data }) {
      const current = this.read({ businessId, bucket });
      if (current.revision !== revision) throw Error("Revision changed");
      const next = { revision: revision + 1, data: structuredClone(data) };
      states.set(businessId + bucket, next);
      return structuredClone(next);
    },
  };
  const chat = {
    status: () => ({ active: account }),
    ask: async (_request, { beforeSend }) => {
      beforeSendHook();
      beforeSend();
      calls++;
      return { text: JSON.stringify(fields()) };
    },
  };
  const inbox = documentInbox({ chat, readModule, store });
  const add = () =>
    inbox.add({ businessId: "A", revision: 0, image, name: "Receipt.png" });
  return {
    inbox,
    store,
    modules,
    add,
    select: (id) => (business = id),
    account: (id) => (account = id),
    before: (fn) => (beforeSendHook = fn),
    calls: () => calls,
  };
}
test("document originals persist with hashes, revisions and duplicate scope checks", () => {
  const f = setup(),
    result = f.add(),
    id = result.documents[0].id;
  assert.equal(result.revision, 1);
  assert.equal(result.documents[0].image, undefined);
  assert.equal(
    f.inbox.get({ businessId: "A", documentId: id }).document.image,
    image,
  );
  assert.match(result.documents[0].sha256, /^[a-f0-9]{64}$/);
  assert.throws(
    () =>
      f.inbox.add({ businessId: "A", revision: 1, image, name: "other.png" }),
    /already/,
  );
  assert.throws(
    () =>
      f.inbox.remove({
        businessId: "A",
        revision: 0,
        documentId: id,
        confirm: true,
      }),
    /changed/,
  );
  f.select("B");
  assert.throws(() => f.inbox.list({ businessId: "A" }), /changed/);
  assert.equal(f.inbox.list({ businessId: "B" }).documents.length, 0);
});
test("scan requires consent and guards business/account/source revision before and after provider work", async () => {
  for (const mode of ["consent", "business", "account", "revision"]) {
    const f = setup(),
      doc = f.add().documents[0];
    if (mode === "business") f.before(() => f.select("B"));
    if (mode === "account") f.before(() => f.account("different"));
    if (mode === "revision")
      f.before(() =>
        f.inbox.remove({
          businessId: "A",
          documentId: doc.id,
          revision: 1,
          confirm: true,
        }),
      );
    await assert.rejects(
      f.inbox.extract({
        businessId: "A",
        documentId: doc.id,
        revision: 1,
        model: "test",
        consent: mode !== "consent",
      }),
    );
    if (["consent", "business", "account"].includes(mode))
      assert.equal(f.calls(), 0);
  }
});
test("receipt review opens an unsaved expense and never changes financial records", async () => {
  const f = setup(),
    doc = f.add().documents[0];
  const scanned = await f.inbox.extract({
    businessId: "A",
    documentId: doc.id,
    revision: 1,
    model: "test",
    consent: true,
  });
  const request = {
    businessId: "A",
    documentId: doc.id,
    revision: scanned.revision,
    kind: "expense",
    currency: "INR",
    confirm: true,
    extraction: fields(),
  };
  assert.throws(() => f.inbox.review({ ...request, confirm: false }), /Review/);
  const result = f.inbox.review(request);
  assert.equal(result.kind, "expense");
  assert.equal(result.draft.amount, 118);
  assert.equal(result.draft.gstAmount, 18);
  assert.equal(result.draft.gstPercent, "");
  assert.deepEqual(f.modules.expenses, []);
  assert.equal(
    f.inbox.get({ businessId: "A", documentId: doc.id }).document.status,
    "draft-opened",
  );
});
test("purchase review preserves exact unique product link, taxes and cess; ambiguous names stay unlinked", async () => {
  const f = setup();
  f.modules.products = [{ id: "p", name: "Widget", stock: 3 }];
  const doc = f.add().documents[0];
  await f.inbox.extract({
    businessId: "A",
    documentId: doc.id,
    revision: 1,
    model: "test",
    consent: true,
  });
  const value = fields();
  value.grandTotal = 120;
  value.taxBreakdown.cess = 2;
  value.items[0].cessPercent = 2;
  assert.throws(
    () =>
      f.inbox.review({
        businessId: "A",
        documentId: doc.id,
        revision: 2,
        kind: "expense",
        currency: "INR",
        confirm: true,
        extraction: value,
      }),
    /cess/,
  );
  const result = f.inbox.review({
    businessId: "A",
    documentId: doc.id,
    revision: 2,
    kind: "purchase",
    currency: "INR",
    confirm: true,
    extraction: value,
  });
  assert.equal(result.draft.items[0]._matchedProductId, "p");
  assert.equal(result.draft.items[0].cessPercent, 2);
  assert.equal(f.modules.products[0].stock, 3);
  f.modules.products.push({ id: "p2", name: "Widget", stock: 4 });
  const ambiguous = f.inbox.review({
    businessId: "A",
    documentId: doc.id,
    revision: 3,
    kind: "purchase",
    currency: "INR",
    confirm: true,
    extraction: value,
  });
  assert.equal(ambiguous.draft.items[0]._matchedProductId, undefined);
});
test("review rejects duplicate saved documents, mixed taxes, imbalanced totals and stale account", async () => {
  const f = setup(),
    doc = f.add().documents[0];
  await f.inbox.extract({
    businessId: "A",
    documentId: doc.id,
    revision: 1,
    model: "test",
    consent: true,
  });
  const request = {
    businessId: "A",
    documentId: doc.id,
    revision: 2,
    kind: "purchase",
    currency: "INR",
    confirm: true,
    extraction: fields(),
  };
  assert.throws(
    () =>
      f.inbox.review({
        ...request,
        extraction: { ...fields(), grandTotal: 119 },
      }),
    /totals/,
  );
  assert.throws(
    () =>
      f.inbox.review({
        ...request,
        extraction: {
          ...fields(),
          taxBreakdown: { ...fields().taxBreakdown, igst: 1 },
        },
      }),
    /mixes/,
  );
  f.modules.expenses.push({ invoiceNo: "S-1", vendorName: "Supplier" });
  assert.throws(() => f.inbox.review(request), /already saved/);
  f.modules.expenses = [];
  f.account("new");
  assert.throws(() => f.inbox.review(request), /current ChatGPT/);
});

test("document handoff requires INR, paise precision and tax components the destination can preserve", async () => {
  const f = setup(),
    doc = f.add().documents[0];
  await f.inbox.extract({
    businessId: "A",
    documentId: doc.id,
    revision: 1,
    model: "test",
    consent: true,
  });
  const request = {
    businessId: "A",
    documentId: doc.id,
    revision: 2,
    kind: "purchase",
    currency: "INR",
    confirm: true,
    extraction: fields(),
  };
  assert.throws(
    () => f.inbox.review({ ...request, currency: undefined }),
    /INR/,
  );
  assert.throws(() => f.inbox.review({ ...request, currency: "USD" }), /INR/);
  assert.throws(
    () =>
      f.inbox.review({
        ...request,
        extraction: { ...fields(), grandTotal: 118.01 },
      }),
    /totals/,
  );
  assert.throws(
    () =>
      f.inbox.review({
        ...request,
        extraction: {
          ...fields(),
          grandTotal: 118,
          taxBreakdown: { ...fields().taxBreakdown, cgst: 9.01, sgst: 9.01 },
        },
      }),
    /Item GST/,
  );
  assert.throws(
    () =>
      f.inbox.review({
        ...request,
        extraction: {
          ...fields(),
          taxBreakdown: { ...fields().taxBreakdown, cgst: 9.001, sgst: 8.999 },
        },
      }),
    /two decimal/,
  );
  assert.throws(
    () =>
      f.inbox.review({
        ...request,
        extraction: {
          ...fields(),
          taxBreakdown: { ...fields().taxBreakdown, cgst: 8, sgst: 10 },
        },
      }),
    /equal CGST/,
  );
  assert.throws(
    () =>
      f.inbox.review({
        ...request,
        extraction: {
          ...fields(),
          taxBreakdown: { ...fields().taxBreakdown, taxableValue: 99 },
        },
      }),
    /taxable value/,
  );
  const cess = fields();
  cess.items[0].cessPercent = 2;
  cess.grandTotal = 120;
  assert.throws(
    () => f.inbox.review({ ...request, extraction: cess }),
    /Item cess/,
  );
  assert.throws(
    () =>
      f.inbox.review({
        ...request,
        kind: "expense",
        extraction: {
          ...fields(),
          taxBreakdown: { ...fields().taxBreakdown, taxableValue: 99 },
        },
      }),
    /receipt total/,
  );
  assert.deepEqual(f.modules.purchases, []);
  assert.deepEqual(f.modules.expenses, []);
});
