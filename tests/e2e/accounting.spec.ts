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

test("sales posting, linked receipts, cancellation, restore and credit notes reconcile", async ({
  page,
  request,
}) => {
  const day = new Date().toISOString().slice(0, 10);
  const bill = {
    id: "auto-sale-ui",
    invoiceNumber: "AUTO-SALE",
    invoiceDate: day,
    invoiceType: "tax-invoice",
    totalAmount: 118,
    totalTaxAmount: 18,
    status: "unpaid",
    payments: [],
    data: { profile, items: [], totals: { total: 118, totalTaxAmount: 18 } },
  };
  const create = await request.post("/api/invoice-transactions", {
    data: { operations: [{ bill }] },
  });
  expect(create.ok()).toBe(true);
  let saved = (await create.json()).bills[0];
  const journal = async () =>
    (await (await request.get("/api/accounting")).json()).entries.filter(
      (e: any) => e.source === "sale:auto-sale-ui",
    );
  expect(await journal()).toHaveLength(1);
  const retry = await request.post("/api/invoice-transactions", {
    data: { operations: [{ bill: saved, overwrite: true }] },
  });
  expect(retry.ok()).toBe(true);
  expect(await journal()).toHaveLength(1);
  let receipt = (
    await (
      await request.post("/api/receipts", {
        data: {
          id: "auto-receipt-ui",
          date: day,
          amount: 40,
          billId: bill.id,
          againstInvoice: bill.id,
          ownerName: profile.businessName,
          paymentMode: "Cash",
        },
      })
    ).json()
  ).receipt;
  expect(receipt).toBeTruthy();
  expect(await journal()).toHaveLength(2);
  const edit = await request.post("/api/receipts", {
    data: { ...receipt, amount: 60 },
  });
  expect(edit.ok()).toBe(true);
  receipt = (await edit.json()).receipt;
  expect(await journal()).toHaveLength(4);
  const removed = await request.delete("/api/receipts/auto-receipt-ui", {
    headers: { "If-Match": receipt._revision },
  });
  expect(removed.ok()).toBe(true);
  const balance = (entries: any[], account: string) =>
    entries
      .flatMap((e) => e.lines)
      .filter((l) => l.account === account)
      .reduce((n, l) => n + l.debit - l.credit, 0);
  expect(balance(await journal(), "1000")).toBe(0);
  saved = (await (await request.get("/api/bills")).json()).find(
    (b: any) => b.id === bill.id,
  );
  expect(
    (
      await request.post("/api/invoice-transactions", {
        data: {
          operations: [
            { bill: { ...saved, status: "cancelled" }, overwrite: true },
          ],
        },
      })
    ).ok(),
  ).toBe(true);
  expect(balance(await journal(), "1100")).toBe(0);
  expect((await request.delete("/api/bills/auto-sale-ui")).ok()).toBe(true);
  expect(
    (await request.post("/api/trash/auto-sale-ui/restore", { data: {} })).ok(),
  ).toBe(true);
  expect(balance(await journal(), "1100")).toBe(0); // A restored cancelled invoice remains cancelled.
  saved = (await (await request.get("/api/bills")).json()).find(
    (b: any) => b.id === bill.id,
  );
  expect(
    (
      await request.post("/api/invoice-transactions", {
        data: {
          operations: [
            { bill: { ...saved, status: "unpaid" }, overwrite: true },
          ],
        },
      })
    ).ok(),
  ).toBe(true);
  expect(balance(await journal(), "1100")).toBe(11800);
  const credit = {
    ...bill,
    id: "auto-credit-ui",
    invoiceNumber: "AUTO-CREDIT",
    invoiceType: "credit-note",
  };
  expect(
    (
      await request.post("/api/invoice-transactions", {
        data: { operations: [{ bill: credit }] },
      })
    ).ok(),
  ).toBe(true);
  const all = (
    await (await request.get("/api/accounting")).json()
  ).entries.filter((e: any) =>
    ["sale:auto-sale-ui", "sale:auto-credit-ui"].includes(e.source),
  );
  expect(balance(all, "4000")).toBe(0);
  expect(balance(all, "2100")).toBe(0);
  await page.goto("/?view=reports");
  await page
    .getByRole("button", { name: "Accounts & history", exact: true })
    .click();
  await expect(
    page.locator("tr").filter({ hasText: "Sale: AUTO-SALE" }).first(),
  ).toBeVisible();
  await expect(
    page
      .locator("tr")
      .filter({ hasText: "Sale: AUTO-SALE" })
      .first()
      .getByRole("button", { name: "Reverse", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "test-results/automatic-sales-journal.png",
    fullPage: true,
  });
});

test("expense form edits and deletes reverse postings; stale and cross-business edits fail", async ({
  page,
  request,
}) => {
  await page.goto("/?view=expenses");
  await page
    .getByRole("button", { name: "Add Expense", exact: true })
    .first()
    .click();
  await page
    .getByPlaceholder("e.g. AWS Hosting - March")
    .fill("Automatic ledger expense");
  await page.getByPlaceholder("0.00").fill("118");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const row = page
    .locator("tr")
    .filter({ hasText: "Automatic ledger expense" });
  await expect(row).toBeVisible();
  let expense = (await (await request.get("/api/expenses")).json()).find(
    (e: any) => e.description === "Automatic ledger expense",
  );
  const journal = async () =>
    (await (await request.get("/api/accounting")).json()).entries.filter(
      (e: any) => e.source === `expense:${expense.id}`,
    );
  expect(await journal()).toHaveLength(1);
  await row.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByPlaceholder("0.00").fill("236");
  await page.getByRole("button", { name: "Update", exact: true }).click();
  await expect(row).toContainText("236");
  expect(await journal()).toHaveLength(3);
  expect(
    (
      await request.post("/api/expenses", { data: { ...expense, amount: 90 } })
    ).status(),
  ).toBe(409);
  expect(
    (
      await request.delete(`/api/expenses/${expense.id}`, {
        headers: { "If-Match": expense._revision },
      })
    ).status(),
  ).toBe(409);
  expense = (await (await request.get("/api/expenses")).json()).find(
    (e: any) => e.id === expense.id,
  );
  expect(
    (
      await request.post("/api/expenses", {
        data: { ...expense, businessId: "another-business" },
      })
    ).status(),
  ).toBe(409);
  await row.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(row).toHaveCount(0);
  const entries = await journal();
  expect(entries).toHaveLength(4);
  expect(
    entries
      .flatMap((e: any) => e.lines)
      .filter((l: any) => l.account === "5100")
      .reduce((n: number, l: any) => n + l.debit - l.credit, 0),
  ).toBe(0);
});
