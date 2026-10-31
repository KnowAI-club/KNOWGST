import { test, expect } from "@playwright/test";
const profile = {
  id: "accounting-ui",
  businessName: "Accounting UI",
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
test("post and reverse a journal through the current report UI", async ({
  page,
  request,
}) => {
  await page.goto("/?view=reports");
  await page
    .getByRole("button", { name: "Accounts & history", exact: true })
    .click();
  await page.getByRole("button", { name: "New journal", exact: true }).click();
  await page.getByLabel("Description / reason").fill("UI opening balance");
  await page.getByLabel("Debit 1", { exact: true }).fill("125.50");
  await page.getByLabel("Credit 2", { exact: true }).fill("125.50");
  await page.getByRole("button", { name: "Post journal", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const row = page.locator("tr").filter({ hasText: "UI opening balance" });
  await expect(row).toContainText("125.50");
  await row.getByRole("button", { name: "Reverse", exact: true }).click();
  await page.getByRole("button", { name: "Post journal", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const state = await (await request.get("/api/accounting")).json();
  expect(
    state.entries.filter((e: { memo: string }) =>
      e.memo.includes("UI opening balance"),
    ),
  ).toHaveLength(2);
  await page.getByRole("button", { name: "Audit trail", exact: true }).click();
  await expect(page.locator(".main-content")).toContainText("journal reversed");
  await page.screenshot({
    path: "test-results/accounting-journal.png",
    fullPage: true,
  });
});
test("supplier partial payment, overpayment rejection and reversal", async ({
  page,
  request,
}) => {
  const created = await request.post("/api/purchases", {
    data: {
      id: "supplier-ui",
      supplierName: "Ledger supplier",
      ownerName: profile.businessName,
      date: new Date().toISOString().slice(0, 10),
      invoiceNumber: "SUP-LEDGER",
      totalAmount: 118,
      paymentStatus: "Unpaid",
      items: [{ name: "Ledger item", quantity: 1, rate: 100, taxPercent: 18 }],
    },
  });
  expect(created.ok()).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?view=purchases");
  await page
    .locator("tr")
    .filter({ hasText: "SUP-LEDGER" })
    .getByRole("button", { name: "Payments", exact: true })
    .click();
  await page.getByLabel("Payment amount", { exact: true }).fill("40");
  await page
    .getByRole("button", { name: "Record payment", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Outstanding: INR 78.00",
  );
  await page.getByLabel("Payment amount", { exact: true }).fill("100");
  await page
    .getByRole("button", { name: "Record payment", exact: true })
    .click();
  await expect(
    page.getByText("Payment exceeds the outstanding purchase balance.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reverse payment", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Outstanding: INR 118.00",
  );
  const state = await (await request.get("/api/accounting")).json();
  expect(
    state.supplierPayments.filter(
      (p: { purchaseId: string }) => p.purchaseId === "supplier-ui",
    ),
  ).toHaveLength(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await expect(page.locator(".toast-item")).toHaveCount(0, { timeout: 12000 });
  await page.locator(".accounting-dialog .table-scroll").evaluate((el) => {
    el.scrollLeft = 0;
  });
  await page.screenshot({
    path: "test-results/supplier-payment-mobile.png",
    fullPage: true,
  });
});
test("business stock cannot be read or consumed through another profile", async ({
  request,
}) => {
  const product = await (
    await request.post("/api/products", {
      data: { id: "isolated-stock", name: "Scoped item", stock: 5 },
    })
  ).json();
  expect(product.product.businessId).toBe(profile.id);
  await request.post("/api/profile", {
    data: { id: "other-business", businessName: "Other business" },
  });
  expect(
    (await (await request.get("/api/products")).json()).some(
      (p: { id: string }) => p.id === "isolated-stock",
    ),
  ).toBe(false);
  const result = await request.post("/api/invoice-transactions", {
    data: {
      operations: [
        {
          bill: {
            id: "cross-stock",
            totalAmount: 100,
            data: {
              profile: { id: "other-business" },
              items: [{ productId: "isolated-stock", quantity: 1, rate: 100 }],
            },
          },
        },
      ],
    },
  });
  expect(result.status()).toBe(409);
  const missingOwner = await request.post("/api/invoice-transactions", {
    data: {
      operations: [
        {
          bill: {
            id: "missing-owner",
            totalAmount: 100,
            data: {
              items: [{ productId: "isolated-stock", quantity: 1, rate: 100 }],
            },
          },
        },
      ],
    },
  });
  expect(missingOwner.status()).toBe(409);

  const stale = await request.post("/api/products", {
    headers: { "x-knowgst-business": profile.id },
    data: { id: "wrong-context", name: "Wrong" },
  });
  expect(stale.status()).toBe(409);
  await request.post("/api/profile", { data: profile });
  expect(
    (await (await request.get("/api/products")).json()).find(
      (p: { id: string }) => p.id === "isolated-stock",
    ).stock,
  ).toBe(5);
});
