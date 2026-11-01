import { test, expect } from "@playwright/test";
test("AI preview uses actual scoped totals, consent gates inference and layout fits", async ({
  page,
  request,
}) => {
  const profile = {
    id: "ai-demo",
    businessName: "AI demo business",
    country: "India",
    state: "Maharashtra",
  };
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
  const month = new Date().toISOString().slice(0, 7);
  const bill = {
    id: "AI-SOURCE",
    invoiceNumber: "PRIVATE-REF",
    invoiceDate: month + "-01",
    invoiceType: "tax-invoice",
    clientName: "Private Customer",
    totalAmount: 118,
    totalTaxAmount: 18,
    paidAmount: 0,
    data: { profile, items: [], details: { dueDate: "2020-01-01" } },
  };
  expect(
    (
      await request.post("/api/invoice-transactions", {
        data: { operations: [{ bill }] },
      })
    ).ok(),
  ).toBe(true);
  const preview = await request.post("/api/integrations/ai/preview", {
    data: { businessId: profile.id, month, currency: "INR", task: "monthly" },
  });
  expect(preview.ok()).toBe(true);
  const snapshot = await preview.json();
  expect(snapshot.context.amounts.sales).toBe(10000);
  expect(snapshot.prompt).not.toContain("Private Customer");
  expect(snapshot.prompt).not.toContain("PRIVATE-REF");
  expect(
    (
      await request.post("/api/integrations/ai/analyze", {
        data: { snapshotId: snapshot.id, consent: false, model: "test" },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await request.post("/api/integrations/ai/preview", {
        data: {
          businessId: "another",
          month,
          currency: "INR",
          task: "monthly",
        },
      })
    ).status(),
  ).toBe(409);
  await page.route("**/api/integrations/chatgpt/models", (r) =>
    r.fulfill({ json: [{ id: "test", name: "Test model" }] }),
  );
  let calls = 0;
  await page.route("**/api/integrations/ai/analyze", (r) => {
    calls++;
    return r.fulfill({
      json: {
        text: "Example review response. <script>not executable</script>",
      },
    });
  });
  await page.goto("/?view=ai");
  await expect(
    page.getByRole("heading", { name: "AI assistant", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Preview data to share" }).click();
  const generate = page.getByRole("button", { name: "Generate review" });
  await expect(generate).toBeDisabled();
  expect(calls).toBe(0);
  for (const width of [1440, 800, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "apps/parity/public/docs/screenshots/ai-assistant.png",
    fullPage: true,
  });
  await page
    .getByLabel("Send this summary to ChatGPT for this request")
    .check();
  await generate.click();
  await expect(page.locator(".ai-answer")).toContainText(
    "<script>not executable</script>",
  );
  expect(calls).toBe(1);
  await page.getByLabel("Month", { exact: true }).fill("2026-10");
  await expect(page.locator(".ai-answer")).toHaveCount(0);
});
