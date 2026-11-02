import test from "node:test";
import assert from "node:assert/strict";
import {
  parseBillResponse,
  validateBillImage,
  extractBill,
} from "../ocr-extraction.mjs";
import {
  purchaseOCRItems,
  matchProduct,
  ocrReviewIssue,
} from "../src/utils/ocr-purchase.mjs";
const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL9kAAAAASUVORK5CYII=";
const draft = () => ({
  supplierName: "Supplier",
  invoiceNumber: "INV-1",
  date: "2026-11-01",
  grandTotal: 120,
  items: [
    {
      name: "Mineral water",
      hsn: "2201",
      quantity: 1,
      rate: 100,
      taxPercent: 18,
      cessPercent: 2,
    },
  ],
  taxBreakdown: { cess: 2 },
});
test("OCR refuses oversized output and blocks stale business or account before image transmission", async () => {
  assert.throws(() => parseBillResponse(" ".repeat(32001) + "{}"), /limit/);
  for (const change of ["business", "account"]) {
    let business = "active",
      account = "a",
      sent = false;
    const chat = {
      status: () => ({ active: account }),
      ask: async (_request, { beforeSend }) => {
        if (change === "business") business = "other";
        else account = "b";
        beforeSend();
        sent = true;
        return { text: JSON.stringify(draft()) };
      },
    };
    await assert.rejects(
      extractBill(
        chat,
        { model: "test", image, consent: true, businessId: "active" },
        {
          readModule: (id) => {
            if (id !== business) throw new Error("Business changed");
            return [];
          },
        },
      ),
      /changed/,
    );
    assert.equal(sent, false);
  }
});
test("OCR response is allowlisted and rejects malformed or unsafe amounts", () => {
  const result = parseBillResponse(
    JSON.stringify({
      ...draft(),
      productId: "injected",
      items: [{ ...draft().items[0], _matchedProductId: "injected" }],
    }),
  );
  assert.equal(result.items[0]._matchedProductId, undefined);
  assert.equal(result.items[0].cessPercent, 2);
  for (const value of [
    "not json",
    JSON.stringify({ ...draft(), date: "2026-02-30" }),
    JSON.stringify({ ...draft(), items: [{ rate: -1 }] }),
    JSON.stringify({ ...draft(), items: Array(101).fill({}) }),
  ])
    assert.throws(() => parseBillResponse(value));
});
test("images require bounded inline supported format and explicit consent", async () => {
  assert.equal(validateBillImage(image), image);
  for (const value of [
    "https://example.com/image.png",
    "data:image/svg+xml;base64,AAAA",
    "data:image/png;base64,YWJj",
    "x".repeat(4200001),
  ])
    assert.throws(() => validateBillImage(value));
  let calls = 0;
  const chat = {
    ask: async (a, b) => {
      calls++;
      assert.equal(b.image, image);
      assert.match(a.prompt, /Do not supply product IDs/);
      return { text: JSON.stringify(draft()) };
    },
  };
  await assert.rejects(
    extractBill(chat, { model: "test", image, consent: false }),
  );
  assert.equal(calls, 0);
  assert.equal(
    (await extractBill(chat, { model: "test", image, consent: true })).items
      .length,
    1,
  );
  assert.equal(calls, 1);
});
test("reviewed product IDs and cess survive purchase conversion; invalid and unresolved cess blocks apply", () => {
  const parsed = draft();
  parsed.items[0]._matchedProductId = "water";
  assert.equal(ocrReviewIssue(parsed), "");
  assert.deepEqual(purchaseOCRItems(parsed)[0], {
    name: "Mineral water",
    hsn: "2201",
    quantity: 1,
    rate: 100,
    taxPercent: 18,
    cessPercent: 2,
    productId: "water",
  });
  assert.match(
    ocrReviewIssue({ ...parsed, taxBreakdown: { cess: 3 } }),
    /cess/,
  );
  assert.match(
    ocrReviewIssue({ ...draft(), items: [], taxBreakdown: { cess: 10 } }),
    /allocate/,
  );
  assert.match(
    ocrReviewIssue({ ...parsed, items: [{ ...parsed.items[0], quantity: 0 }] }),
    /positive/,
  );
});
test("ambiguous catalog matches are left unlinked", () => {
  assert.equal(
    matchProduct("Mineral water", [
      { id: "a", name: "Mineral water" },
      { id: "b", name: "Mineral water" },
    ]),
    null,
  );
  assert.equal(
    matchProduct("Mineral water", [{ id: "a", name: "Mineral water" }]).product
      .id,
    "a",
  );
});
