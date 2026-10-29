import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
const profile = {
  id: "production-fixture",
  businessName: "Production fixture",
  state: "Maharashtra",
  country: "India",
  gstin: "",
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
test("purchase register exports exact tax heads including an odd paisa", async ({
  page,
}) => {
  const today = new Date().toISOString().slice(0, 10);
  await page.route("**/api/purchases", (r) =>
    r.fulfill({
      json: [
        {
          id: "odd",
          date: today,
          supplierName: "Odd-paisa supplier",
          invoiceNumber: "ODD-1",
          ownerName: profile.businessName,
          interstate: false,
          items: [{ name: "Item", quantity: 1, rate: 100.1, taxPercent: 10 }],
        },
      ],
    }),
  );
  await page.goto("/?view=purchases");
  await expect(page.locator(".main-content")).toContainText("ODD-1");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV", exact: true }).first().click();
  const csv = await readFile((await (await download).path())!, "utf8");
  expect(csv).toContain("CGST");
  expect(csv).toContain("SGST");
  expect(csv).toContain("IGST");
  const values = csv.split("\n")[1]!.split(",");
  expect(values.slice(5, 8).map(Number)).toEqual([5.01, 5, 0]);
  expect(Math.round((Number(values[5]) + Number(values[6])) * 100)).toBe(1001);
});
test("action menu keyboard navigation returns focus and WhatsApp uses the saved client", async ({
  page,
}) => {
  const today = new Date().toISOString().slice(0, 10);
  const bill = {
    id: "SHARE-1",
    invoiceNumber: "SHARE-1",
    invoiceDate: today,
    clientName: "Share client",
    invoiceType: "tax-invoice",
    totalAmount: 118,
    totalTaxAmount: 18,
    status: "unpaid",
    data: {
      profile,
      client: { name: "Share client", state: "Maharashtra" },
      invoiceType: "tax-invoice",
      details: { invoiceNumber: "SHARE-1", invoiceDate: today },
      items: [{ name: "Service", quantity: 1, rate: 100, taxPercent: 18 }],
      totals: {
        total: 118,
        totalTaxAmount: 18,
        subtotal: 100,
        taxableAmount: 100,
        cgst: 9,
        sgst: 9,
        igst: 0,
      },
    },
  };
  await page.route("**/api/bills", (r) => r.fulfill({ json: [bill] }));
  await page.route("**/api/clients", (r) =>
    r.fulfill({
      json: [
        { id: "share-client", name: "Share client", phone: "919876543210" },
      ],
    }),
  );
  // Trap the draft link locally; no WhatsApp request or message leaves the test.
  await page.addInitScript(() => {
    (window as any).__drafts = [];
    window.open = ((url: any) => {
      (window as any).__drafts.push(String(url));
      return null;
    }) as any;
  });
  await page.goto("/?view=dashboard");
  const button = page.getByRole("button", {
    name: "More actions for SHARE-1",
    exact: true,
  });
  await button.click();
  const items = page.getByRole("menuitem");
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("End");
  await expect(items.last()).toBeFocused();
  await page.keyboard.press("Home");
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(button).toBeFocused();
  await button.click();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "WhatsApp", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("SHARE-1.pdf");
  expect(await page.evaluate(() => (window as any).__drafts[0])).toContain(
    "919876543210",
  );
});
test("signature layouts persist and render in invoice preview", async ({
  page,
  request,
}) => {
  const img =
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="30"><rect width="90" height="30" fill="navy"/></svg>',
    );
  await request.post("/api/profile", {
    data: { ...profile, signature: img, stamp: img, signLayout: "side" },
  });
  await page.goto("/?view=settings");
  const select = page.getByLabel("Signature and stamp layout");
  await expect(select).toBeVisible();
  await select.selectOption("stack");
  await page
    .getByRole("button", { name: /Save.*Profile|Save Settings|Save Changes/ })
    .first()
    .click();
  await expect
    .poll(
      async () => (await (await request.get("/api/profile")).json()).signLayout,
    )
    .toBe("stack");
  await page.goto("/?view=new");
  const preview = page.locator(".preview-pane");
  await expect(preview.getByAltText("Signature").first()).toBeVisible();
  await expect(preview.getByAltText("Stamp").first()).toBeVisible();
  const stamp = await preview.getByAltText("Stamp").first().boundingBox(),
    signature = await preview.getByAltText("Signature").first().boundingBox();
  expect(stamp!.y).toBeLessThan(signature!.y);
});
test("release notes are local and identify KNOWGST", async ({ page }) => {
  await page.goto("/?view=support");
  await expect(page.getByRole("heading", { name: "What's new" })).toBeVisible();
  await expect(page.locator("details")).toContainText("KNOWGST 0.1.0");
  await expect(page.locator("details")).toContainText("transactional writes");
});

test("a stopped purchase CSV import applies stock only for the bills already saved", async ({
  page,
  request,
}) => {
  const name = "CSV interrupted stock";
  await request.post("/api/products", {
    data: { id: "csv-stock", name, stock: 10, unit: "Nos", sellingPrice: 100 },
  });
  let saves = 0;
  await page.route("**/api/purchases", async (route) => {
    if (route.request().method() === "POST" && ++saves === 2)
      return route.fulfill({
        status: 500,
        json: { error: "Injected second-bill failure" },
      });
    return route.continue();
  });
  await page.goto("/?view=purchases");
  await page
    .getByRole("button", { name: "CSV import / export", exact: true })
    .click();
  const csv = `Invoice Number,Invoice Date,Supplier Name,Item Name,Quantity,Rate,GST %\nCSV-OK,2026-10-29,CSV Supplier,${name},2,100,18\nCSV-FAIL,2026-10-29,CSV Supplier,${name},3,100,18`;
  await page.locator('input[type=file][accept=".csv,text/csv"]').setInputFiles({
    name: "partial.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await expect(page.locator(".modal-content")).toContainText("2 bills ready");
  await page.getByRole("button", { name: /Import 2/ }).click();
  await expect(page.getByText(/Import stopped after 1:/)).toBeVisible();
  const products = await (await request.get("/api/products")).json();
  expect(products.find((p: any) => p.id === "csv-stock").stock).toBe(12);
  const purchases = await (await request.get("/api/purchases")).json();
  expect(purchases.some((p: any) => p.invoiceNumber === "CSV-OK")).toBe(true);
  expect(purchases.some((p: any) => p.invoiceNumber === "CSV-FAIL")).toBe(
    false,
  );
});

test("dashboard payment commits its receipt without moving stock again", async ({
  page,
  request,
}) => {
  const product = {
    id: "atomic-product",
    name: "Atomic product",
    stock: 10,
    sellingPrice: 100,
  };
  await request.post("/api/products", { data: product });
  const bill = {
    id: "ATOMIC-1",
    invoiceNumber: "ATOMIC-1",
    invoiceDate: new Date().toISOString().slice(0, 10),
    invoiceType: "tax-invoice",
    clientName: "Atomic client",
    totalAmount: 200,
    paidAmount: 0,
    payments: [],
    status: "unpaid",
    data: {
      profile,
      client: { name: "Atomic client" },
      items: [
        {
          productId: product.id,
          name: product.name,
          quantity: 2,
          rate: 100,
          taxPercent: 0,
        },
      ],
      totals: { total: 200 },
    },
  };
  const created = await request.post("/api/invoice-transactions", {
    data: { operations: [{ bill }] },
  });
  expect(created.ok()).toBeTruthy();
  await page.goto("/");
  const row = page.getByRole("row").filter({ hasText: "ATOMIC-1" });
  await row.getByTitle("Payment", { exact: true }).click();
  const modal = page
    .locator(".modal-content")
    .filter({ has: page.getByRole("heading", { name: "Record Payment" }) });
  await modal.locator('input[type="number"]').fill("50");
  await modal
    .getByRole("button", { name: "Record Payment", exact: true })
    .click();
  await expect(
    page.getByText("Payment of ₹50.00 recorded", { exact: true }),
  ).toBeVisible();
  const saved = (await (await request.get("/api/bills")).json()).find(
    (b: any) => b.id === bill.id,
  );
  const receipt = (await (await request.get("/api/receipts")).json()).find(
    (r: any) => r.billId === bill.id,
  );
  expect(saved.paidAmount).toBe(50);
  expect(saved.payments).toHaveLength(1);
  expect(receipt.amount).toBe(50);
  expect(receipt.id).toBe(saved.payments[0].id);
  expect(
    (await (await request.get("/api/products")).json()).find(
      (p: any) => p.id === product.id,
    ).stock,
  ).toBe(8);
});

test("stale payment window shows a conflict and preserves the newer payment", async ({
  page,
  request,
}) => {
  const bill = {
    id: "STALE-1",
    invoiceNumber: "STALE-1",
    invoiceDate: new Date().toISOString().slice(0, 10),
    invoiceType: "tax-invoice",
    clientName: "Stale client",
    totalAmount: 200,
    status: "unpaid",
    paidAmount: 0,
    payments: [],
    data: {
      profile,
      client: { name: "Stale client" },
      items: [],
      totals: { total: 200 },
    },
  };
  const created = await (
    await request.post("/api/invoice-transactions", {
      data: { operations: [{ bill }] },
    })
  ).json();
  await page.goto("/");
  await page
    .getByRole("row")
    .filter({ hasText: "STALE-1" })
    .getByTitle("Payment", { exact: true })
    .click();
  const fresh = {
    ...created.bills[0],
    payments: [{ id: "pay_other", amount: 75, mode: "cash" }],
    paidAmount: 75,
    status: "partial",
  };
  expect(
    (
      await request.post("/api/invoice-transactions", {
        data: { operations: [{ bill: fresh, overwrite: true }] },
      })
    ).ok(),
  ).toBeTruthy();
  const modal = page
    .locator(".modal-content")
    .filter({ has: page.getByRole("heading", { name: "Record Payment" }) });
  await modal.locator('input[type="number"]').fill("25");
  await modal
    .getByRole("button", { name: "Record Payment", exact: true })
    .click();
  await expect(
    page.getByText(
      "This invoice changed in another window. Reload before saving.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(
    (await (await request.get("/api/bills")).json()).find(
      (b: any) => b.id === bill.id,
    ).paidAmount,
  ).toBe(75);
});
