import { test, expect } from "@playwright/test";
const profile = {
  id: "ocr-ai",
  businessName: "OCR test",
  country: "India",
  state: "Maharashtra",
};
test.beforeEach(async ({ request }) => {
  await request.post("/api/profile", { data: profile });
  await request.post("/api/local-prefs", {
    data: {
      set: {
        gst_printSettings: JSON.stringify({ onboardingComplete: true }),
        freegstbill_onboarded: "true",
      },
    },
  });
});
test("ChatGPT extraction requires consent and preserves product stock link and cess through save", async ({
  page,
  request,
}) => {
  await request.post("/api/products", {
    data: {
      id: "ocr-water",
      name: "Mineral water",
      stock: 10,
      rate: 100,
      purchasePrice: 100,
      taxPercent: 18,
      cessPercent: 2,
    },
  });
  await page.route("**/api/integrations/chatgpt/models", (r) =>
    r.fulfill({ json: [{ id: "vision", name: "Vision test model" }] }),
  );
  let calls = 0;
  await page.route("**/api/integrations/chatgpt/ocr", (r) => {
    calls++;
    expect(r.request().postDataJSON().consent).toBe(true);
    expect(r.request().postDataJSON().businessId).toBe(profile.id);
    return r.fulfill({
      json: {
        supplierName: "Demo supplier",
        supplierGstin: "",
        invoiceNumber: "OCR-AI-1",
        date: "2026-11-01",
        grandTotal: 240,
        taxBreakdown: {
          taxableValue: 200,
          cgst: 18,
          sgst: 18,
          igst: 0,
          cess: 4,
          roundOff: 0,
        },
        items: [
          {
            name: "Mineral water",
            hsn: "2201",
            quantity: 2,
            rate: 100,
            amount: 200,
            taxPercent: 18,
            cessPercent: 2,
          },
        ],
      },
    });
  });
  await page.goto("/?view=purchases");
  await page
    .getByRole("button", { name: "Import from image (OCR)", exact: true })
    .click();
  await expect(page.getByLabel("OCR method")).toHaveCount(0);
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 900;
    c.height = 700;
    const x = c.getContext("2d")!;
    x.fillStyle = "white";
    x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = "#222";
    x.font = "26px Arial";
    [
      "DEMO SUPPLIER — FICTIONAL SAMPLE",
      "Invoice: OCR-AI-1     Date: 01/11/2026",
      "Mineral water | HSN 2201",
      "Quantity 2 | Rate 100.00 | Taxable 200.00",
      "CGST 18.00 | SGST 18.00 | Cess 4.00 (2%)",
      "Grand total: INR 240.00",
    ].forEach((t, i) => x.fillText(t, 40, 70 + i * 85));
    return c.toDataURL("image/png").split(",")[1];
  });
  await page.locator('input[type=file][accept="image/*"]').setInputFiles({
    name: "invoice.png",
    mimeType: "image/png",
    buffer: Buffer.from(png!, "base64"),
  });
  const extract = page.getByRole("button", {
    name: "Extract fields",
    exact: true,
  });
  await expect(extract).toBeDisabled();
  expect(calls).toBe(0);
  await page.getByLabel("Send this image to ChatGPT for extraction").check();
  await extract.click();
  await expect(page.getByLabel("Linked product 1")).toHaveValue("ocr-water");
  await expect(page.getByLabel("Cess percent 1")).toHaveValue("2");
  await page.getByLabel("Cess percent 1").fill("0");
  await expect(
    page.getByRole("button", { name: /Use these values/ }),
  ).toBeDisabled();
  await page.getByLabel("Cess percent 1").fill("2");
  for (const width of [1440, 800, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page
        .locator(".bill-ocr")
        .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.locator(".bill-ocr").evaluate((e) => {
    e.scrollTop = 0;
  });
  await page.screenshot({
    path: "apps/parity/public/docs/screenshots/ocr-chatgpt.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /Use these values/ }).click();
  await expect(page.locator(".bill-ocr")).toHaveCount(0);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".modal-overlay")).toHaveCount(0);
  const purchases = await (await request.get("/api/purchases")).json();
  const saved = purchases.find((p: any) => p.invoiceNumber === "OCR-AI-1");
  expect(saved.items[0]).toMatchObject({
    productId: "ocr-water",
    quantity: 2,
    cessPercent: 2,
  });
  expect(
    (await (await request.get("/api/products")).json()).find(
      (p: any) => p.id === "ocr-water",
    ).stock,
  ).toBe(12);
  expect(calls).toBe(1);
});

test("scan discards changed-account replies and blocks applying stale product matches", async ({
  page,
  request,
}) => {
  const before = await (await request.get("/api/purchases")).json();
  await request.post("/api/products", {
    data: {
      id: "ocr-guard-product",
      name: "Guard product",
      stock: 5,
      rate: 100,
      taxPercent: 18,
    },
  });
  let account = "a",
    changeAccount = true;
  await page.route("**/api/integrations", (r) =>
    r.fulfill({ json: { chatgpt: { active: account }, resend: {} } }),
  );
  await page.route("**/api/integrations/chatgpt/models", (r) =>
    r.fulfill({ json: [{ id: "vision", name: "Test model" }] }),
  );
  await page.route("**/api/integrations/chatgpt/ocr", (r) => {
    if (changeAccount) account = "b";
    return r.fulfill({
      json: {
        supplierName: "Fictional supplier",
        supplierGstin: "",
        invoiceNumber: "OCR-GUARD",
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
            name: "Guard product",
            hsn: "",
            quantity: 1,
            rate: 100,
            amount: 100,
            taxPercent: 18,
            cessPercent: 0,
          },
        ],
      },
    });
  });
  await page.goto("/?view=purchases");
  await page
    .getByRole("button", { name: "Import from image (OCR)", exact: true })
    .click();
  await page
    .locator('input[type=file][accept="image/*"]')
    .setInputFiles({
      name: "guard.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL9kAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  const extract = page.getByRole("button", {
    name: "Extract fields",
    exact: true,
  });
  await page.getByLabel("Send this image to ChatGPT for extraction").check();
  await extract.click();
  await expect(page.getByRole("alert")).toContainText(
    "ChatGPT account changed",
  );
  await expect(page.getByLabel("Linked product 1")).toHaveCount(0);
  changeAccount = false;
  await page.getByLabel("Send this image to ChatGPT for extraction").check();
  await extract.click();
  await expect(page.getByLabel("Linked product 1")).toHaveValue(
    "ocr-guard-product",
  );
  await request.post("/api/products", {
    data: {
      id: "ocr-new-product",
      name: "New catalog record",
      rate: 50,
      taxPercent: 18,
      stock: 0,
    },
  });
  await page.getByRole("button", { name: /Use these values/ }).click();
  await expect(
    page.getByText(
      "Business or product catalog changed. Reopen the image to use current records.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.locator(".bill-ocr")).toBeVisible();
  expect(await (await request.get("/api/purchases")).json()).toEqual(before);
});

test("provider rejection preserves manual entry and does not change records", async ({
  page,
  request,
}) => {
  const before = await (await request.get("/api/purchases")).json();
  await page.route("**/api/integrations/chatgpt/models", (r) =>
    r.fulfill({ json: [{ id: "text", name: "Test model" }] }),
  );
  await page.route("**/api/integrations/chatgpt/ocr", (r) =>
    r.fulfill({
      status: 400,
      json: {
        error:
          "This model cannot read images. Choose another model or enter the bill manually.",
      },
    }),
  );
  await page.goto("/?view=purchases");
  await page
    .getByRole("button", { name: "Import from image (OCR)", exact: true })
    .click();
  await page.locator('input[type=file][accept="image/*"]').setInputFiles({
    name: "bill.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL9kAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await page.getByLabel("Send this image to ChatGPT for extraction").check();
  await page
    .getByRole("button", { name: "Extract fields", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("cannot read images");
  await expect(
    page.getByLabel("Send this image to ChatGPT for extraction"),
  ).not.toBeChecked();
  await page.getByTitle("Close", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add Purchase", exact: true }),
  ).toBeVisible();
  expect(await (await request.get("/api/purchases")).json()).toEqual(before);
});
