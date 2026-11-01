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

test("business record questions require consent and show source coverage", async ({
  page,
  request,
}) => {
  await request.post("/api/profile", {
    data: {
      id: "records-ai",
      businessName: "Records AI",
      country: "India",
      state: "Maharashtra",
    },
  });
  await request.post("/api/local-prefs", {
    data: {
      set: {
        gst_printSettings: JSON.stringify({ onboardingComplete: true }),
        freegstbill_onboarded: "true",
      },
    },
  });
  expect(
    (
      await request.post("/api/integrations/ai/records", {
        data: {
          businessId: "another-business",
          question: "Show invoices",
          model: "m",
          consent: true,
        },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await request.post("/api/integrations/ai/records", {
        data: {
          businessId: "records-ai",
          question: "Show invoices",
          model: "m",
          consent: false,
        },
      })
    ).status(),
  ).toBe(400);
  await page.route("**/api/integrations/chatgpt/models", (r) =>
    r.fulfill({ json: [{ id: "m", name: "Test model" }] }),
  );
  await page.route("**/api/integrations/ai/records", (r) => {
    expect(r.request().postDataJSON().consent).toBe(true);
    return r.fulfill({
      json: {
        text: "Invoice TEST-1 needs review.",
        sources: [{ id: "one", module: "bills", reference: "TEST-1" }],
        coverage: { module: "bills", total: 8, returned: 1, more: true },
      },
    });
  });
  await page.goto("/?view=ai");
  await page.getByLabel("Business records question").fill("Find TEST-1");
  const ask = page.getByRole("button", {
    name: "Ask about records",
    exact: true,
  });
  await expect(ask).toBeDisabled();
  await page
    .getByLabel(
      "Allow ChatGPT to search and read relevant records in this business for this question",
    )
    .check();
  await ask.click();
  await expect(page.locator(".ai-answer")).toContainText("TEST-1");
  await expect(page.getByText(/Source coverage: 1 of 8/)).toBeVisible();
  await page.getByRole("button", { name: "Open source register" }).click();
  await expect(
    page.getByRole("heading", { name: "Invoices", exact: true, level: 1 }),
  ).toBeVisible();
});
