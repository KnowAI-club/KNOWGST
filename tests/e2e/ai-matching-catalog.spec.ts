import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

async function setup(page: Page, request: APIRequestContext, suffix: string) {
  const businessId = `matching-catalog-${suffix}`;
  expect(
    (
      await request.post("/api/profile", {
        data: {
          id: businessId,
          businessName: "Sahyadri Demo Supplies",
          country: "India",
          state: "Maharashtra",
        },
      })
    ).ok(),
  ).toBe(true);
  await request.post("/api/local-prefs", {
    data: {
      set: {
        freegstbill_onboarded: "true",
        freegstbill_theme: "light",
        gst_printSettings: JSON.stringify({ onboardingComplete: true }),
      },
    },
  });
  expect(
    (
      await request.post("/api/clients", {
        data: {
          id: `client-${suffix}`,
          name: "Ananya Traders",
          country: "India",
          state: "Maharashtra",
        },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await request.post("/api/products", {
        data: {
          id: `product-${suffix}`,
          name: "Office notebook",
          sellingPrice: 45,
          rate: 45,
          purchasePrice: 30,
          taxPercent: 18,
          stock: 80,
          unit: "Pcs",
        },
      })
    ).ok(),
  ).toBe(true);
  await page.route("**/api/integrations/chatgpt/models", (route) =>
    route.fulfill({ json: [{ id: "test", name: "Test model" }] }),
  );
  await page.goto("/?view=ai");
  return businessId;
}

test("bank review imports real rows, confirms known-party rules and persists without posting books", async ({
  page,
  request,
}) => {
  const businessId = await setup(page, request, "bank");
  const before = await (await request.get("/api/export")).json();
  await page.getByRole("tab", { name: "Bank matching", exact: true }).click();
  await page
    .getByLabel("Account nickname", { exact: true })
    .fill("Business current account");
  await page.getByLabel("Statement CSV", { exact: true }).setInputFiles({
    name: "bank.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "date,description,amount,direction,reference\n2026-10-15,NEFT Ananya Traders,1250.50,credit,REF1",
    ),
  });
  await page
    .getByRole("button", { name: "Preview import", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Import review rows", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("I checked the dates, totals and duplicate handling")
    .check();
  await page
    .getByRole("button", { name: "Import review rows", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Statement classifications" }),
  ).toContainText("NEFT Ananya Traders");
  await page.getByLabel("Description contains", { exact: true }).fill("Ananya");
  await page.getByLabel("Direction", { exact: true }).selectOption("credit");
  await page
    .getByLabel("Category", { exact: true })
    .selectOption("business_in");
  await page
    .getByLabel("Ledger account (optional)", { exact: true })
    .selectOption("1100");
  await page
    .getByLabel("Party (optional)", { exact: true })
    .selectOption("client:client-bank");
  await page
    .getByRole("button", { name: "Confirm new rule", exact: true })
    .click();
  await page
    .getByLabel("Select NEFT Ananya Traders 2026-10-15", { exact: true })
    .check();
  await page
    .getByRole("button", { name: "Confirm matching rules", exact: true })
    .click();
  const result = await (
    await request.post("/api/integrations/ai/matching/list", {
      data: { businessId },
    })
  ).json();
  expect(result.data.statements[0].rows[0].classification).toMatchObject({
    partyId: "client:client-bank",
    account: "1100",
    category: "business_in",
    source: "rule",
  });
  await page.reload();
  await page.getByRole("tab", { name: "Bank matching", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Statement classifications" }),
  ).toContainText("Business receipts");
  await page.screenshot({
    path: "apps/parity/public/docs/screenshots/ai-bank-matching.png",
    fullPage: true,
  });
  const after = await (await request.get("/api/export")).json();
  expect(after.accounting).toEqual(before.accounting);
  expect(after.bills).toEqual(before.bills);
  expect(after.purchases).toEqual(before.purchases);
  const duplicate = await request.post(
    "/api/integrations/ai/matching/previewImport",
    {
      data: {
        businessId,
        accountLabel: "Business current account",
        currency: "INR",
        rows: [
          {
            date: "2026-10-15",
            description: "NEFT Ananya Traders",
            amount: 1250.5,
            direction: "credit",
            reference: "REF1",
          },
        ],
      },
    },
  );
  expect(duplicate.status()).toBe(409);
});

test("catalog alternate names persist and can be removed without changing products", async ({
  page,
  request,
}) => {
  const businessId = await setup(page, request, "catalog");
  await page.getByRole("tab", { name: "Catalog review", exact: true }).click();
  await page.getByLabel("Catalog", { exact: true }).selectOption("products");
  await page
    .getByLabel("Alternate name", { exact: true })
    .fill("A5 ruled book");
  await page
    .getByLabel("Existing record", { exact: true })
    .selectOption("product-catalog");
  await page
    .getByRole("button", { name: "Confirm alternate name", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Alternate catalog names" }),
  ).toContainText("A5 ruled book");
  const saved = await (
    await request.post("/api/integrations/ai/catalog/list", {
      data: { businessId, kind: "products" },
    })
  ).json();
  expect(saved.aliases).toHaveLength(1);
  expect(saved.aliases[0].stale).toBe(false);
  await page.screenshot({
    path: "apps/parity/public/docs/screenshots/ai-catalog.png",
    fullPage: true,
  });
  const products = await (await request.get("/api/products")).json();
  expect(
    products.find(
      (product: { id: string }) => product.id === "product-catalog",
    ),
  ).toMatchObject({ name: "Office notebook", stock: 80, taxPercent: 18 });
  await page
    .getByRole("button", { name: "Remove alternate name", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Remove alternate name", exact: true }),
  ).toHaveCount(0);
  const removed = await (
    await request.post("/api/integrations/ai/catalog/list", {
      data: { businessId, kind: "products" },
    })
  ).json();
  expect(removed.aliases).toHaveLength(0);
});

test("reviewed catalog proposal opens the normal client form without saving until the user acts", async ({
  page,
  request,
}) => {
  const businessId = await setup(page, request, "draft");
  let generated = 0;
  // Provider responses are controlled; source preview and final client save use the real backend.
  await page.route("**/api/integrations/ai/catalog/generate", (route) => {
    expect(route.request().postDataJSON().consent).toBe(true);
    generated++;
    return route.fulfill({
      json: {
        ticketId: "reviewed-provider-fixture",
        kind: "clients",
        draft: { name: "New Demo Client", city: "Pune" },
        clarifications: [],
        duplicates: [],
      },
    });
  });
  await page.route("**/api/integrations/ai/catalog/resolve", (route) => {
    expect(route.request().postDataJSON().confirm).toBe(true);
    return route.fulfill({
      json: {
        kind: "clients",
        businessId,
        draft: { name: "New Demo Client", city: "Pune" },
        reviewId: "reviewed-demo-client",
      },
    });
  });
  await page.getByRole("tab", { name: "Catalog review", exact: true }).click();
  await page
    .getByLabel("Description", { exact: true })
    .fill("Create New Demo Client in Pune");
  await page
    .getByRole("button", { name: "Preview description", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Prepare draft", exact: true }),
  ).toBeDisabled();
  expect(generated).toBe(0);
  await page
    .getByLabel("Send this description to the selected ChatGPT model")
    .check();
  await page
    .getByRole("button", { name: "Prepare draft", exact: true })
    .click();
  await page
    .getByLabel("I reviewed these details. Open an unsaved form.")
    .check();
  await page
    .getByRole("button", { name: "Open draft form", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Add New Client", exact: true }),
  ).toBeVisible();
  const modal = page
    .locator(".modal-content")
    .filter({ has: page.getByRole("heading", { name: "Add New Client" }) });
  await expect(modal.locator("input").first()).toHaveValue("New Demo Client");
  expect(
    (await (await request.get("/api/clients")).json()).some(
      (client: { name: string }) => client.name === "New Demo Client",
    ),
  ).toBe(false);
  await modal.getByRole("button", { name: /Save|Add Client/ }).click();
  await expect
    .poll(async () =>
      (await (await request.get("/api/clients")).json()).some(
        (client: { name: string }) => client.name === "New Demo Client",
      ),
    )
    .toBe(true);
});
