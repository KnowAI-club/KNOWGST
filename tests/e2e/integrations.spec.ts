import { test, expect } from "@playwright/test";
test.beforeEach(async ({ request }) => {
  await request.post("/api/local-prefs", {
    data: {
      set: {
        gst_printSettings: JSON.stringify({ onboardingComplete: true }),
        freegstbill_onboarded: "true",
      },
    },
  });
});
test("integration settings save write-only Resend credentials and fit narrow windows", async ({
  page,
  request,
}) => {
  await page.goto("/?view=settings");
  const section = page.locator("#section-integrations");
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("link", { name: "Integrations", exact: true })
    .click();
  await expect(
    page
      .getByRole("navigation", { name: "Settings sections" })
      .getByRole("link", { name: "Integrations", exact: true }),
  ).toHaveAttribute("aria-current", "location");
  await expect(
    section.getByRole("button", { name: "Continue with ChatGPT" }),
  ).toBeVisible();
  await section.getByLabel("Sender name", { exact: true }).fill("Demo Studio");
  await section
    .getByLabel("Sender email", { exact: true })
    .fill("billing@example.com");
  await section
    .getByLabel("Reply-to email (optional)", { exact: true })
    .fill("support@example.com");
  await section
    .getByLabel("Resend API key", { exact: true })
    .fill("re_fictional_test_only_123456");
  await section
    .getByRole("button", { name: "Save email settings", exact: true })
    .click();
  await expect(section.getByText("Key saved", { exact: true })).toBeVisible();
  await expect(
    section.getByLabel("Resend API key", { exact: true }),
  ).toHaveValue("");
  const status = await (await request.get("/api/integrations")).text();
  expect(status).not.toContain("re_fictional");
  expect(status).toContain("billing@example.com");
  expect(await (await request.get("/api/export")).text()).not.toContain(
    "re_fictional",
  );
  for (const width of [1440, 800, 390]) {
    await page.setViewportSize({ width, height: 950 });
    await section.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const input of await section.locator("input").all()) {
      const b = await input.boundingBox();
      expect(b!.x + b!.width).toBeLessThanOrEqual(width);
    }
  }
  await section
    .getByRole("button", { name: "Remove API key", exact: true })
    .click();
  await expect(
    section.getByText("Not configured", { exact: true }),
  ).toBeVisible();
});
test("invoice and receipt email drafts attach PDFs and send only after explicit review", async ({
  page,
  request,
}) => {
  await request.post("/api/integrations/resend", {
    data: {
      from: "billing@example.com",
      apiKey: "re_fictional_test_only_123456",
    },
  });
  const profile = {
    id: "mail-demo",
    businessName: "Email Demo",
    country: "India",
    state: "Maharashtra",
    address: "Fictional address",
  };
  await request.post("/api/profile", { data: profile });
  const invoice = {
    id: "EMAIL/001",
    invoiceNumber: "EMAIL/001",
    invoiceDate: "2026-11-01",
    clientName: "Demo Buyer",
    invoiceType: "tax-invoice",
    status: "unpaid",
    totalAmount: 118,
    totalTaxAmount: 18,
    currency: "INR",
    data: {
      profile,
      client: {
        name: "Demo Buyer",
        email: "buyer@example.com",
        country: "India",
        state: "Maharashtra",
      },
      details: { invoiceNumber: "EMAIL/001", invoiceDate: "2026-11-01" },
      items: [{ name: "Demo item", quantity: 1, rate: 100, taxPercent: 18 }],
      totals: {
        subtotal: 100,
        taxableAmount: 100,
        total: 118,
        cgst: 9,
        sgst: 9,
        totalTaxAmount: 18,
      },
      invoiceType: "tax-invoice",
    },
  };
  expect((await request.post("/api/bills", { data: invoice })).ok()).toBe(true);
  const receipt = {
    id: "email-receipt",
    receiptNo: "RCPT-EMAIL",
    date: "2026-11-01",
    clientName: "Demo Buyer",
    amount: 50,
    paymentMode: "Cash",
    profile,
    ownerName: profile.businessName,
  };
  expect((await request.post("/api/receipts", { data: receipt })).ok()).toBe(
    true,
  );
  const sent: any[] = [];
  await page.route("**/api/integrations/resend/send", async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ json: { id: "mock-resend-id", status: "accepted" } });
  });
  await page.goto("/?view=invoices");
  const row = page.getByRole("row").filter({ hasText: "EMAIL/001" });
  await row.getByRole("button", { name: /more|actions/i }).click();
  await page.getByText("Email PDF with Resend", { exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Email invoice" });
  await expect(dialog.getByRole("link", { name: /Review PDF/ })).toBeVisible({
    timeout: 30000,
  });
  expect(sent).toHaveLength(0);
  await expect(dialog.getByLabel("Recipient email")).toHaveValue(
    "buyer@example.com",
  );
  await dialog.getByRole("button", { name: "Send email", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("Accepted by Resend");
  expect(
    Buffer.from(sent[0].attachment.content, "base64").subarray(0, 5).toString(),
  ).toBe("%PDF-");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.goto("/?view=receipts");
  await page
    .getByRole("row")
    .filter({ hasText: "RCPT-EMAIL" })
    .getByTitle("Email receipt PDF")
    .click();
  dialog = page.getByRole("dialog", { name: "Email receipt" });
  await expect(dialog.getByRole("link", { name: /Review PDF/ })).toBeVisible({
    timeout: 30000,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await dialog.getByLabel("Recipient email").fill("receipt@example.com");
  await dialog.getByRole("button", { name: "Send email", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("Accepted by Resend");
  expect(sent).toHaveLength(2);
  expect(
    Buffer.from(sent[1].attachment.content, "base64").subarray(0, 5).toString(),
  ).toBe("%PDF-");
});
