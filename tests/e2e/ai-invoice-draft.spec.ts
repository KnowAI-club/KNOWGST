import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { mkdir } from "node:fs/promises";

async function prepare(page: Page, request: APIRequestContext, suffix: string) {
  const profile = {
    id: `ai-invoice-${suffix}`,
    businessName: "Sahyadri Office Supplies · Demo",
    country: "India",
    state: "Maharashtra",
    address: "Pune, Maharashtra",
  };
  const client = {
    id: `draft-client-${suffix}`,
    name: "Ananya Traders",
    country: "India",
    state: "Maharashtra",
    address: "24 Market Road",
    city: "Pune",
    pin: "411001",
    email: "ananya@example.com",
    phone: "",
    gstin: "",
    isSEZ: false,
    preferredCurrency: "INR",
    preferredPaperSize: "a5",
    preferredCustomPaperWidth: 90,
    preferredCustomPaperHeight: 200,
    autoPrint: false,
  };
  const product = {
    id: `draft-product-${suffix}`,
    name: "Office notebook",
    hsn: "4820",
    unit: "Nos",
    sellingPrice: 125,
    rate: 100,
    taxPercent: 18,
    cessPercent: 2,
    stock: 10,
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
  expect(
    (
      await request.post("/api/clients", {
        data: client,
      })
    ).ok(),
  ).toBe(true);
  expect((await request.post("/api/products", { data: product })).ok()).toBe(
    true,
  );
  await page.route("**/api/integrations/chatgpt/models", (route) =>
    route.fulfill({ json: [{ id: "test", name: "Test model" }] }),
  );
  let generated = 0,
    resolved = 0,
    suggestion: Record<string, unknown>;
  await page.route("**/api/integrations/ai/invoice-draft/generate", (route) => {
    const body = route.request().postDataJSON();
    expect(body.consent).toBe(true);
    expect(body.businessId).toBe(profile.id);
    generated++;
    suggestion = {
      id: body.snapshotId,
      client,
      items: [
        {
          productId: product.id,
          name: product.name,
          hsn: product.hsn,
          unit: product.unit,
          quantity: 2,
          rate: 125,
          taxPercent: 18,
          cessPercent: 2,
          discount: 0,
        },
      ],
      clarifications: [],
      canApply: true,
    };
    return route.fulfill({ json: suggestion });
  });
  await page.route("**/api/integrations/ai/invoice-draft/resolve", (route) => {
    resolved++;
    return route.fulfill({ json: suggestion });
  });
  return {
    profile,
    client,
    product,
    get generated() {
      return generated;
    },
    get resolved() {
      return resolved;
    },
    get suggestion() {
      return suggestion;
    },
  };
}

async function reviewDraft(page: Page) {
  await page.goto("/?view=new");
  await page.getByText("Draft an invoice with AI", { exact: true }).click();
  await page
    .getByLabel("AI invoice request")
    .fill("Create an invoice for Ananya Traders for 2 Office notebooks.");
  await expect(page.getByLabel("Invoice draft model")).toHaveValue("test");
  await page
    .getByRole("button", { name: "Preview draft context", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Invoice data to share" }),
  ).toContainText("Office notebook");
  await expect(
    page.getByRole("button", { name: "Generate invoice draft", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel(
      "Share the displayed request and catalog names with ChatGPT for this draft",
    )
    .check();
  await page
    .getByRole("button", { name: "Generate invoice draft", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Suggested invoice draft" }),
  ).toContainText("Ananya Traders");
}

test("reviewed invoice uses existing calculation and saves only after the separate Save action", async ({
  page,
  request,
}) => {
  const fixture = await prepare(page, request, "review");
  const beforeBills = await (await request.get("/api/bills")).json();
  const beforeClient = (await (await request.get("/api/clients")).json()).find(
    (value: { id: string }) => value.id === fixture.client.id,
  );
  const financialWrites: string[] = [];
  page.on("request", (req) => {
    if (
      req.method() === "POST" &&
      /\/api\/(invoice-transactions|bills|clients|products)(?:$|\?)/.test(
        req.url(),
      )
    )
      financialWrites.push(req.url());
  });
  await reviewDraft(page);
  expect(fixture.generated).toBe(1);
  const review = page.getByRole("region", { name: "Suggested invoice draft" });
  await expect(review).toContainText("2 Nos × ₹125.00");
  await expect(review).toContainText("GST 18% · Cess 2%");
  await expect(
    page.getByRole("button", {
      name: "Apply reviewed invoice draft",
      exact: true,
    }),
  ).toBeDisabled();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() =>
        page.locator(".ai-invoice-draft").evaluate((element) => ({
          fits: element.scrollWidth <= element.clientWidth + 1,
          right: element.getBoundingClientRect().right <= innerWidth + 1,
        })),
      )
      .toEqual({ fits: true, right: true });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await review.scrollIntoViewIfNeeded();
  await mkdir("docs/verification", { recursive: true });
  await page.screenshot({
    path: "docs/verification/ai-invoice-draft.png",
    fullPage: true,
  });
  await page
    .getByLabel("I reviewed the client, quantities, saved prices and tax rates")
    .check();
  await page
    .getByRole("button", { name: "Apply reviewed invoice draft", exact: true })
    .evaluate((node) => {
      (node as HTMLElement).click();
      (node as HTMLElement).click();
    });
  await expect(
    page.getByPlaceholder("Type client name to search or add new"),
  ).toHaveValue("Ananya Traders");
  await expect(page.getByPlaceholder("Item", { exact: true })).toHaveValue(
    "Office notebook",
  );
  expect(fixture.resolved).toBe(1);
  // Past the editor's two-second existing auto-save window, the new draft is still unposted.
  await page.waitForTimeout(2300);
  expect(financialWrites).toHaveLength(0);
  expect(await (await request.get("/api/bills")).json()).toEqual(beforeBills);
  expect(
    (await (await request.get("/api/clients")).json()).find(
      (value: { id: string }) => value.id === fixture.client.id,
    ),
  ).toEqual(beforeClient);
  expect(
    (await (await request.get("/api/products")).json()).find(
      (value: { id: string }) => value.id === fixture.product.id,
    ).stock,
  ).toBe(10);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/bills")).json()).filter(
          (value: { clientName: string }) =>
            value.clientName === fixture.client.name,
        ).length,
    )
    .toBe(1);
  const saved = (await (await request.get("/api/bills")).json()).find(
    (value: { clientName: string }) => value.clientName === fixture.client.name,
  );
  expect(saved.totalAmount).toBe(300);
  expect(saved.totalTaxAmount).toBe(50);
  expect(saved.data.items[0].productId).toBe(fixture.product.id);
  expect(saved.data.items[0].cessPercent).toBe(2);
  expect(
    (await (await request.get("/api/products")).json()).find(
      (value: { id: string }) => value.id === fixture.product.id,
    ).stock,
  ).toBe(8);
  const client = (await (await request.get("/api/clients")).json()).find(
    (value: { id: string }) => value.id === fixture.client.id,
  );
  expect(client.preferredPaperSize).toBe("a5");
  expect(client.preferredCustomPaperWidth).toBe(90);
  expect(client.preferredCustomPaperHeight).toBe(200);
});

test("manual fields changed during apply preserve the form and discard the stale result", async ({
  page,
  request,
}) => {
  const fixture = await prepare(page, request, "stale");
  await reviewDraft(page);
  let release!: () => void,
    pending = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "**/api/integrations/ai/invoice-draft/resolve",
    async (route) => {
      pending = true;
      await gate;
      return route.fulfill({ json: fixture.suggestion });
    },
  );
  await page
    .getByLabel("I reviewed the client, quantities, saved prices and tax rates")
    .check();
  await page
    .getByRole("button", { name: "Apply reviewed invoice draft", exact: true })
    .click();
  await expect.poll(() => pending).toBe(true);
  await page
    .getByPlaceholder("Street address, locality", { exact: true })
    .fill("Keep this manual address");
  release();
  await expect(
    page.getByPlaceholder("Street address, locality", { exact: true }),
  ).toHaveValue("Keep this manual address");
  await expect(
    page.getByPlaceholder("Type client name to search or add new"),
  ).toHaveValue("");
  await expect(page.getByPlaceholder("Item", { exact: true })).toHaveValue("");
  await expect(page.locator(".ai-invoice-draft")).toContainText(
    "Start with a blank",
  );
  expect(
    (await (await request.get("/api/bills")).json()).some(
      (value: { data?: { profile?: { id: string } } }) =>
        value.data?.profile?.id === fixture.profile.id,
    ),
  ).toBe(false);
});

test("typing while models load keeps the model list and partial unnamed rows block AI replacement", async ({
  page,
  request,
}) => {
  await prepare(page, request, "models");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/integrations/chatgpt/models", async (route) => {
    await gate;
    return route.fulfill({ json: [{ id: "test", name: "Test model" }] });
  });
  await page.goto("/?view=new");
  await page.getByText("Draft an invoice with AI", { exact: true }).click();
  await page
    .getByLabel("AI invoice request")
    .fill("Invoice Ananya Traders for 2 Office notebooks");
  release();
  await expect(page.getByLabel("Invoice draft model")).toHaveValue("test");
  await page
    .locator(".line-item-field")
    .filter({ has: page.locator("label").filter({ hasText: /^Rate$/ }) })
    .locator("input")
    .fill("99");
  await expect(page.locator(".ai-invoice-draft")).toContainText(
    "Start with a blank",
  );
  await expect(
    page.getByRole("button", { name: "Preview draft context", exact: true }),
  ).toHaveCount(0);
});

test("malformed JSON and invalid review data leave the invoice unchanged", async ({
  page,
  request,
}) => {
  const fixture = await prepare(page, request, "invalid");
  let calls = 0;
  await page.route("**/api/integrations/ai/invoice-draft/generate", (route) =>
    ++calls === 1
      ? route.fulfill({ contentType: "application/json", body: "{" })
      : route.fulfill({
          json: {
            id: route.request().postDataJSON().snapshotId,
            client: fixture.client,
            items: "bad",
            canApply: true,
            clarifications: [],
          },
        }),
  );
  await page.goto("/?view=new");
  await page.getByText("Draft an invoice with AI", { exact: true }).click();
  await page
    .getByLabel("AI invoice request")
    .fill("Invoice Ananya Traders for 2 Office notebooks");
  await expect(page.getByLabel("Invoice draft model")).toHaveValue("test");
  for (const message of [
    "Could not read the draft response",
    "could not be verified",
  ]) {
    await page
      .getByRole("button", { name: "Preview draft context", exact: true })
      .click();
    await page
      .getByLabel(
        "Share the displayed request and catalog names with ChatGPT for this draft",
      )
      .check();
    await page
      .getByRole("button", { name: "Generate invoice draft", exact: true })
      .click();
    await expect(
      page.locator(".ai-invoice-draft").getByRole("alert"),
    ).toContainText(message);
    await expect(
      page.getByPlaceholder("Type client name to search or add new"),
    ).toHaveValue("");
    await expect(page.getByPlaceholder("Item", { exact: true })).toHaveValue(
      "",
    );
    await expect(
      page.getByRole("region", { name: "Suggested invoice draft" }),
    ).toHaveCount(0);
  }
});
