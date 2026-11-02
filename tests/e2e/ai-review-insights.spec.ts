import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

const month = "2026-11",
  asOf = "2026-11-15";
async function prepare(request: APIRequestContext, suffix: string) {
  const profile = {
    id: `insights-${suffix}`,
    businessName: "Sahyadri Stationery · Demo",
    country: "India",
    state: "Maharashtra",
  };
  expect((await request.post("/api/profile", { data: profile })).ok()).toBe(
    true,
  );
  await request.post("/api/local-prefs", {
    data: {
      set: {
        gst_printSettings: JSON.stringify({ onboardingComplete: true }),
        freegstbill_onboarded: "true",
        freegstbill_theme: "light",
      },
    },
  });
  for (const index of [1, 2])
    expect(
      (
        await request.post("/api/expenses", {
          data: {
            id: `insight-expense-${suffix}-${index}`,
            date: `${month}-03`,
            amount: 20,
            description: "Office broadband",
            category: "Utilities",
            vendorName: "Example Provider",
          },
        })
      ).ok(),
    ).toBe(true);
  const bill = {
    id: `insight-bill-${suffix}`,
    invoiceNumber: `INS-${suffix}`,
    invoiceDate: `${month}-01`,
    invoiceType: "tax-invoice",
    clientName: "Ananya Traders",
    totalAmount: 118,
    totalTaxAmount: 18,
    paidAmount: 0,
    data: {
      profile,
      client: { name: "Ananya Traders" },
      items: [],
      details: { dueDate: `${month}-10` },
      totals: { totalTaxAmount: 18 },
    },
  };
  expect(
    (
      await request.post("/api/invoice-transactions", {
        data: { operations: [{ bill }] },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await request.post("/api/receipts", {
        data: {
          id: `insight-receipt-${suffix}`,
          receiptNo: `RC-${suffix}`,
          date: `${month}-02`,
          amount: 50,
          ownerName: profile.businessName,
          paymentMode: "Cash",
        },
      })
    ).ok(),
  ).toBe(true);
  const purchaseId = `insight-purchase-${suffix}`;
  expect(
    (
      await request.post("/api/purchases", {
        data: {
          id: purchaseId,
          supplierName: "Example Paper Supplier",
          ownerName: profile.businessName,
          invoiceNumber: `SUP-${suffix}`,
          date: `${month}-01`,
          totalAmount: 118,
          paymentStatus: "Unpaid",
          items: [{ name: "Notebook", quantity: 1, rate: 100, taxPercent: 18 }],
        },
      })
    ).ok(),
  ).toBe(true);
  const purchase = (await (await request.get("/api/purchases")).json()).find(
    (record: { id: string }) => record.id === purchaseId,
  );
  expect(
    (
      await request.post("/api/accounting/supplier-payments", {
        data: {
          id: `insight-payment-${suffix}`,
          purchaseId,
          revision: purchase._revision,
          date: `${month}-04`,
          amount: "40",
          account: "1000",
          reference: "Test payment",
        },
      })
    ).ok(),
  ).toBe(true);
  const options = { businessId: profile.id, month, currency: "INR", asOf };
  return { profile, options, bill, purchaseId };
}

async function open(page: Page) {
  await page.goto("/?view=ai");
  await page
    .getByRole("tab", { name: "Books & payments", exact: true })
    .click();
  const region = page.getByRole("region", {
    name: "Business reviews and plans",
  });
  await region.getByLabel("Month", { exact: true }).fill(month);
  await region.getByLabel("Review date", { exact: true }).fill(asOf);
  await region
    .getByRole("button", { name: "Review records", exact: true })
    .click();
  return region;
}

test("books review, source contributions, collection holds and supplier plans use real saved data", async ({
  page,
  request,
}) => {
  const fixture = await prepare(request, "ui");
  const before = await (await request.get("/api/accounting")).json();
  const region = await open(page);
  const duplicate = region.locator("article").filter({
    has: page.getByRole("heading", {
      name: "Possible duplicate expenses",
      exact: true,
    }),
  });
  await expect(duplicate).toBeVisible();
  await duplicate
    .getByRole("button", { name: "Add review note", exact: true })
    .click();
  await duplicate
    .getByLabel("Review note", { exact: true })
    .fill("Checked originals: two separate broadband connections.");
  await duplicate
    .getByRole("button", { name: "Mark reviewed", exact: true })
    .click();
  await expect(duplicate).toContainText("Reviewed");
  await expect(
    duplicate.getByRole("button", { name: "Reopen", exact: true }),
  ).toBeVisible();
  const review = await (
    await request.post("/api/integrations/ai/insights/review", {
      data: fixture.options,
    })
  ).json();
  expect(
    review.findings.find(
      (finding: { kind: string }) => finding.kind === "duplicate-expenses",
    ).status,
  ).toBe("dismissed");

  await region
    .getByRole("tab", { name: "Report details", exact: true })
    .click();
  await region
    .getByRole("button", { name: "Review records", exact: true })
    .click();
  await expect(
    region.getByRole("heading", {
      name: "Balance sheet · 2026-11-30",
      exact: true,
    }),
  ).toBeVisible();
  const report = await (
    await request.post("/api/integrations/ai/insights/reports", {
      data: fixture.options,
    })
  ).json();
  expect(report.profitLoss.income).toBe(10000);
  expect(report.profitLoss.expenses).toBe(15800);
  expect(report.profitLoss.profit).toBe(-5800);
  expect(report.balanceSheet.difference).toBe(0);
  await region.locator("summary").filter({ hasText: "4000 · Sales" }).click();
  await expect(
    region.getByRole("button", { name: "INS-ui", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => {
    for (const element of document.querySelectorAll("*"))
      if (element instanceof HTMLElement && element.scrollTop)
        element.scrollTop = 0;
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: "apps/parity/public/docs/screenshots/ai-books-review.png",
    fullPage: true,
  });

  await region.getByRole("tab", { name: "Collections", exact: true }).click();
  await region
    .getByRole("button", { name: "Review records", exact: true })
    .click();
  const invoice = region.locator("tbody tr").filter({ hasText: "INS-ui" });
  await expect(invoice).toContainText("₹118.00");
  await expect(invoice).toContainText("5 days overdue");
  await invoice
    .getByRole("button", { name: "Place on hold", exact: true })
    .click();
  await invoice
    .getByLabel("Note", { exact: true })
    .fill("Customer asked to check the invoice first.");
  await invoice.getByRole("button", { name: "Save hold", exact: true }).click();
  await expect(
    region.getByRole("heading", { name: "0 invoices to review", exact: true }),
  ).toBeVisible();
  const collections = await (
    await request.post("/api/integrations/ai/insights/collections", {
      data: fixture.options,
    })
  ).json();
  expect(collections.rows).toHaveLength(0);
  expect(collections.excluded[0].reason).toBe("Disputed · review hold");

  await region.getByRole("tab", { name: "Supplier plan", exact: true }).click();
  await region.getByLabel("Planning budget", { exact: true }).fill("90");
  await region
    .getByRole("button", { name: "Review records", exact: true })
    .click();
  const supplier = region.locator("tbody tr").filter({ hasText: "SUP-ui" });
  await expect(supplier).toContainText("Due date unknown");
  await expect(supplier).toContainText("₹78.00");
  await supplier
    .getByRole("button", { name: "Set planning date", exact: true })
    .click();
  await supplier
    .getByLabel("Planning due date", { exact: true })
    .fill("2026-11-10");
  await supplier
    .getByRole("button", { name: "Save planning date", exact: true })
    .click();
  await expect(supplier).toContainText("Planning date · 5 days overdue");
  await expect(region).toContainText("Proposed ₹78.00");
  const savedPurchase = (
    await (await request.get("/api/purchases")).json()
  ).find((record: { id: string }) => record.id === fixture.purchaseId);
  expect(savedPurchase.dueDate).toBeUndefined();
  const after = await (await request.get("/api/accounting")).json();
  expect(after.entries).toEqual(before.entries);
  expect(after.supplierPayments).toEqual(before.supplierPayments);
  for (const width of [1440, 800, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await expect(
      region.getByRole("button", { name: "Open Purchases", exact: true }),
    ).toBeVisible();
  }
  await page.evaluate(() => {
    for (const element of document.querySelectorAll("*"))
      if (element instanceof HTMLElement && element.scrollTop)
        element.scrollTop = 0;
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: "test-results/ai-supplier-plan-mobile.png",
    fullPage: true,
  });
});

test("review state rejects stale source changes and AI explanation requires an explicit data preview", async ({
  page,
  request,
}) => {
  const fixture = await prepare(request, "consent");
  await page.route("**/api/integrations/chatgpt/models", (route) =>
    route.fulfill({ json: [{ id: "test", name: "Test model" }] }),
  );
  let explainCalls = 0;
  // Only provider narration is simulated. Review data, preview contents, scope,
  // persistence and financial commands continue through the real local server.
  await page.route("**/api/integrations/ai/insights/explain", (route) => {
    const body = route.request().postDataJSON();
    expect(body.businessId).toBe(fixture.profile.id);
    expect(body.consent).toBe(true);
    explainCalls++;
    return route.fulfill({
      json: {
        text: "Example explanation: review the unallocated receipt before posting changes.",
      },
    });
  });
  const region = await open(page);
  await region
    .getByRole("button", { name: "Preview for ChatGPT", exact: true })
    .click();
  const ask = region.getByRole("button", { name: "Ask ChatGPT", exact: true });
  await expect(ask).toBeDisabled();
  expect(explainCalls).toBe(0);
  await expect(region.locator("pre")).toContainText(
    '"amountUnit": "integer minor currency units"',
  );
  await region
    .getByLabel("Send this preview to my selected ChatGPT account.", {
      exact: true,
    })
    .check();
  await ask.click();
  await expect(region.getByRole("status")).toContainText("Example explanation");
  expect(explainCalls).toBe(1);
  const review = await (
    await request.post("/api/integrations/ai/insights/review", {
      data: fixture.options,
    })
  ).json();
  expect(
    (
      await request.post("/api/expenses", {
        data: {
          id: "insight-changed-source",
          date: "2026-11-14",
          amount: 5,
          description: "Additional expense",
        },
      })
    ).ok(),
  ).toBe(true);
  const stale = await request.post("/api/integrations/ai/insights/resolve", {
    data: {
      ...fixture.options,
      findingId: review.findings[0].id,
      revision: review.revision,
      fingerprint: review.fingerprint,
      status: "dismissed",
      note: "Stale review",
    },
  });
  expect(stale.status()).toBe(409);
  expect(
    (
      await request.post("/api/integrations/ai/insights/reports", {
        data: { ...fixture.options, businessId: "another-business" },
      })
    ).status(),
  ).toBe(409);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
});
