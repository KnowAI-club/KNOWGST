import { test, expect } from "@playwright/test";
const profile = {
  id: "dashboard-real",
  businessName: "Dashboard business",
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
        freegstbill_theme: "light",
      },
    },
  });
});
test("dashboard reads real records, scopes business and currency, and opens source register", async ({
  page,
  request,
}, testInfo) => {
  const day = new Date().toISOString().slice(0, 10),
    month = day.slice(0, 7);
  const bill = {
    id: "OVERVIEW-INVOICE",
    invoiceNumber: "OVERVIEW-INVOICE",
    invoiceDate: day,
    invoiceType: "tax-invoice",
    clientName: "Overview client",
    totalAmount: 118,
    totalTaxAmount: 18,
    paidAmount: 40,
    payments: [{ id: "overview-paid", amount: 40, date: day, mode: "cash" }],
    data: { profile, items: [], details: { dueDate: "2020-01-01" } },
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
          id: "overview-standalone",
          date: day,
          amount: 20,
          clientName: "Standalone client",
        },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await request.post("/api/expenses", {
        data: {
          id: "overview-expense",
          date: day,
          amount: 15,
          description: "Overview office",
        },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await request.post("/api/products", {
        data: { id: "overview-stock", name: "Overview paper", stock: 2 },
      })
    ).ok(),
  ).toBe(true);
  await request.post("/api/bills", {
    data: {
      ...bill,
      id: "OVERVIEW-USD",
      invoiceNumber: "OVERVIEW-USD",
      currency: "USD",
      payments: [],
      paidAmount: 0,
    },
  });
  const summary = await (
    await request.get(`/api/dashboard?month=${month}&currency=INR`)
  ).json();
  expect(summary.sales).toBe(10000);
  expect(summary.received).toBe(6000);
  expect(summary.spent).toBe(1500);
  expect(summary.outstanding).toBe(7800);
  expect(summary.unallocated).toHaveLength(1);
  await page.goto("/?view=dashboard");
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".overview-metric")
      .filter({ hasText: "Sales · excluding GST" }),
  ).toContainText("100.00");
  await expect(
    page.locator(".overview-metric").filter({ hasText: "Money received" }),
  ).toContainText("60.00");
  await page
    .getByRole("button", { name: "Receipts", exact: true })
    .last()
    .click();
  await expect(page.locator(".overview-table tbody tr")).toHaveCount(2);
  await page.getByLabel("Search recent activity").fill("Standalone");
  await expect(page.locator(".overview-table tbody tr")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Inspect overview-standalone", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("20.00");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("Search recent activity").fill("");
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.screenshot({
    path: testInfo.outputPath("dashboard-desktop.png"),
    fullPage: true,
  });
  await page.getByLabel("Dashboard currency").selectOption("USD");
  await expect(
    page
      .locator(".overview-metric")
      .filter({ hasText: "Sales · excluding GST" }),
  ).toContainText("100.00");
  await expect(
    page.locator(".overview-metric").filter({ hasText: "Money received" }),
  ).toContainText("0.00");
  await page.getByLabel("Dashboard currency").selectOption("INR");
  await page.getByLabel("Dashboard month").fill("2001-01");
  await expect(
    page.getByRole("heading", { name: "No activity this month" }),
  ).toBeVisible();
  await expect(
    page.locator(".overview-metric").filter({ hasText: "Customers owe you" }),
  ).toContainText("78.00");
  await page.getByLabel("Dashboard month").fill(month);
  await page
    .getByRole("button", { name: "Inspect OVERVIEW-INVOICE", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open invoice register", exact: true })
    .click();
  await expect(page.locator(".main-content")).toHaveAttribute(
    "data-view",
    "invoices",
  );
  await expect(
    page.locator("tr").filter({ hasText: "OVERVIEW-INVOICE" }),
  ).toBeVisible();
  await request.post("/api/profile", {
    data: { id: "dashboard-other", businessName: "Other business" },
  });
  const other = await (
    await request.get(`/api/dashboard?month=${month}&currency=INR`)
  ).json();
  expect(other.sales).toBe(0);
  expect(other.activity).toHaveLength(0);
  expect(other.lowStock).toHaveLength(0);
  expect((await request.get("/api/dashboard?month=invalid")).status()).toBe(
    400,
  );
});
test("dashboard mobile and dark mode, attention navigation, errors and retry", async ({
  page,
  request,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?view=dashboard");
  await expect(
    page.getByRole("heading", { name: "Recent activity", exact: true }),
  ).toBeVisible();
  expect(
    await page
      .locator(".main-content")
      .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
  ).toBe(true);
  await page
    .getByRole("button", {
      name: "Review older records need review",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Historical backfill", exact: true }),
  ).toBeVisible();
  await page.goto("/?view=dashboard");
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  await page.getByRole("button", { name: "Dark Mode", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".sidebar-backdrop")).toHaveCount(0);
  await expect.poll(() => page.locator(".sidebar").evaluate(el => el.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
  await page.screenshot({
    path: testInfo.outputPath("dashboard-mobile-dark.png"),
    fullPage: true,
  });
  await page.route("**/api/dashboard?*", (r) =>
    r.fulfill({
      status: 500,
      json: { error: "Dashboard temporarily unavailable" },
    }),
  );
  await page.getByRole("button", { name: "Refresh dashboard" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Dashboard could not load",
  );
  await page.unroute("**/api/dashboard?*");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Recent activity", exact: true }),
  ).toBeVisible();
});
