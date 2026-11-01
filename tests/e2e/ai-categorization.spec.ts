import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page, request }) => {
  await request.post("/api/profile", {
    data: {
      id: "category-demo",
      businessName: "Category demo",
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
  await page.route("**/api/integrations/chatgpt/models", (route) =>
    route.fulfill({ json: [{ id: "test", name: "Test model" }] }),
  );
  await page.route("**/api/integrations", (route) =>
    route.fulfill({
      json: { chatgpt: { active: "test-account", accounts: [] }, resend: {} },
    }),
  );
});

test("expense AI requires selected-data consent and applies only a draft category", async ({
  page,
  request,
}) => {
  let calls = 0,
    statusChecks = 0;
  await page.route("**/api/integrations", (route) => {
    statusChecks++;
    return route.fulfill({
      json: { chatgpt: { active: "test-account", accounts: [] }, resend: {} },
    });
  });
  const before = await (await request.get("/api/expenses")).json();
  await page.route("**/api/integrations/ai/categorize", (route) => {
    calls++;
    const body = route.request().postDataJSON();
    expect(body.consent).toBe(true);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].description).toBe("Monthly cloud hosting");
    expect(body.rows[0]).not.toHaveProperty("vendorGstin");
    return route.fulfill({
      json: {
        suggestions: [
          {
            id: body.rows[0].id,
            category: "Software & Tools",
            reason: "A software service subscription.",
          },
        ],
      },
    });
  });
  await page.goto("/?view=expenses");
  await page
    .getByRole("button", { name: "Add Expense", exact: true })
    .first()
    .click();
  await page
    .getByPlaceholder("e.g. AWS Hosting - March")
    .fill("Monthly cloud hosting");
  await page.getByPlaceholder("0.00").fill("1200");
  await page
    .getByText("Suggest categories with ChatGPT", { exact: true })
    .click();
  const generate = page.getByRole("button", {
    name: "Suggest selected categories",
    exact: true,
  });
  await expect(generate).toBeDisabled();
  expect(calls).toBe(0);
  await page
    .getByLabel(
      "Share these selected rows with ChatGPT for one category suggestion",
    )
    .check();
  await generate.click();
  await expect(
    page.getByRole("region", { name: "Category suggestion" }),
  ).toContainText("Software & Tools");
  const category = page.locator(".modal-content select").first();
  await expect(category).toHaveValue("Other");
  await page
    .getByRole("button", { name: "Apply category", exact: true })
    .evaluate((node) => {
      (node as HTMLElement).click();
      (node as HTMLElement).click();
    });
  await expect(category).toHaveValue("Software & Tools");
  expect(statusChecks).toBe(2);
  expect(await (await request.get("/api/expenses")).json()).toEqual(before);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("bank import sends only selected rows, keeps manual review and discards stale suggestions", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/integrations/ai/categorize", (route) => {
    calls++;
    const body = route.request().postDataJSON();
    expect(body.kind).toBe("bank");
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].description).toBe("Monthly service plan");
    return route.fulfill({
      json: {
        suggestions: [
          {
            id: body.rows[0].id,
            category: "business_out",
            reason: "Review this as a business service.",
          },
        ],
      },
    });
  });
  await page.goto("/?view=incometax");
  await page
    .getByRole("button", { name: "Bank Statement Import", exact: true })
    .click();
  await page.locator("#bank-csv-input").setInputFiles({
    name: "demo.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Date,Description,Debit,Credit,Balance\n01/11/2026,Monthly service plan,1200,0,5000\n02/11/2026,Private other transaction,90,0,4910",
    ),
  });
  await page.getByLabel("Select bank row 1 for AI").check();
  await page
    .getByText("Suggest categories with ChatGPT", { exact: true })
    .click();
  const generate = page.getByRole("button", {
    name: "Suggest selected categories",
    exact: true,
  });
  await expect(generate).toBeDisabled();
  expect(calls).toBe(0);
  await page
    .getByLabel(
      "Share these selected rows with ChatGPT for one category suggestion",
    )
    .check();
  await generate.click();
  const firstCategory = page
    .locator(".data-table tbody tr")
    .first()
    .locator("select");
  await expect(firstCategory).toHaveValue("transfer");
  await page
    .getByRole("button", { name: "Apply category", exact: true })
    .click();
  await expect(firstCategory).toHaveValue("business_out");
  await expect(
    page.getByRole("button", { name: "Push to Calculator", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel(
      "Share these selected rows with ChatGPT for one category suggestion",
    )
    .check();
  await generate.click();
  await expect(
    page.getByRole("region", { name: "Category suggestion" }),
  ).toBeVisible();
  let releaseStatus!: () => void;
  let checkingStatus = false;
  const statusGate = new Promise<void>((resolve) => {
    releaseStatus = resolve;
  });
  await page.route("**/api/integrations", async (route) => {
    checkingStatus = true;
    await statusGate;
    return route.fulfill({
      json: { chatgpt: { active: "test-account", accounts: [] }, resend: {} },
    });
  });
  await page
    .getByRole("button", { name: "Apply category", exact: true })
    .click();
  await expect.poll(() => checkingStatus).toBe(true);
  await firstCategory.selectOption("personal");
  releaseStatus();
  await expect(
    page.locator(".ai-category-suggestions").getByRole("alert"),
  ).toContainText("This row changed");
  await expect(firstCategory).toHaveValue("personal");
  await page.getByLabel("Select bank row 2 for AI").check();
  await expect(
    page.getByRole("region", { name: "Category suggestion" }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel(
      "Share these selected rows with ChatGPT for one category suggestion",
    ),
  ).not.toBeChecked();
});
