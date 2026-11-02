import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { mkdir } from "node:fs/promises";
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL9kAAAAASUVORK5CYII=";
async function prepare(page: Page, request: APIRequestContext, name: string) {
  const profile = {
    id: `intake-${name}`,
    businessName: "Sahyadri demo business",
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
  await page.route("**/api/integrations/chatgpt/models", (route) =>
    route.fulfill({ json: [{ id: "test", name: "Test model" }] }),
  );
  await page.goto("/?view=ai");
  return profile;
}
test("guided import previews mappings, skips duplicates, backs up and creates an undoable batch", async ({
  page,
  request,
}) => {
  await prepare(page, request, "master");
  await page
    .getByRole("tab", { name: "Import assistant", exact: true })
    .click();
  const panel = page.getByRole("region", { name: "Guided master-data import" });
  await panel
    .getByLabel("Choose master-data CSV")
    .setInputFiles({
      name: "demo-clients.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "Name,Email\nAditi Office,aditi@example.test\nAditi Office,aditi@example.test\nRavi Trade,ravi@example.test",
      ),
    });
  await expect(panel.getByLabel("Map Name", { exact: true })).toHaveValue(
    "Name",
  );
  await panel
    .getByRole("button", { name: "Review import", exact: true })
    .click();
  await expect(panel).toContainText("2 new records");
  await expect(panel).toContainText("1 duplicates skipped");
  const save = panel.getByRole("button", {
    name: "Back up and import",
    exact: true,
  });
  await expect(save).toBeDisabled();
  expect((await (await request.get("/api/clients")).json()).length).toBe(0);
  await panel
    .getByLabel(
      "I checked this mapping, duplicate list and all new records. Create a verified backup and import.",
    )
    .check();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mkdir("apps/parity/public/docs/screenshots", { recursive: true });
  await page.evaluate(() => {
    for (const element of document.querySelectorAll("*"))
      if (element instanceof HTMLElement && element.scrollTop)
        element.scrollTop = 0;
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: "apps/parity/public/docs/screenshots/ai-import.png",
    fullPage: true,
  });
  await save.click();
  await expect(panel.getByRole("status")).toContainText("2 clients imported");
  expect((await (await request.get("/api/clients")).json()).length).toBe(2);
  page.once("dialog", (dialog) => dialog.accept());
  await panel.getByRole("button", { name: "Undo batch", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Import undone");
  expect((await (await request.get("/api/clients")).json()).length).toBe(0);
  await page.reload();
  await page
    .getByRole("tab", { name: "Import assistant", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Guided master-data import" }),
  ).toContainText("Undone");
});
test("document queue keeps originals, rejects duplicate files and opens reviewed expense without saving", async ({
  page,
  request,
}) => {
  const profile = await prepare(page, request, "expense");
  await page.getByRole("tab", { name: "Document inbox", exact: true }).click();
  const panel = page.getByRole("region", { name: "Document inbox" });
  const receiptImage = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 700;
    canvas.height = 820;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, 700, 820);
    context.fillStyle = "#252b25";
    context.font = "bold 27px Arial";
    context.fillText("METRO STATIONERY", 40, 65);
    context.font = "18px Arial";
    [
      "Fictional demo receipt",
      "Invoice EXP-DEMO-1",
      "Date: 02 November 2026",
      "Pune, Maharashtra",
      "",
      "Office stationery | HSN 4820",
      "1 x INR 100.00",
      "Taxable value: INR 100.00",
      "CGST: INR 9.00",
      "SGST: INR 9.00",
      "",
      "TOTAL PAID: INR 118.00",
    ].forEach((line, index) => context.fillText(line, 40, 110 + index * 45));
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  const file = {
    name: "receipt.png",
    mimeType: "image/png",
    buffer: Buffer.from(receiptImage, "base64"),
  };
  await panel.getByLabel("Add inbox images").setInputFiles(file);
  await panel.getByRole("button", { name: "receipt.png", exact: true }).click();
  await expect(
    panel.getByRole("img", { name: "Original receipt.png" }),
  ).toBeVisible();
  await panel.getByLabel("Add inbox images").setInputFiles(file);
  await expect(panel.getByRole("alert")).toContainText("already");
  const extraction = {
    supplierName: "Metro Stationery",
    supplierGstin: "",
    invoiceNumber: "EXP-DEMO-1",
    date: "2026-11-02",
    grandTotal: 118,
    taxBreakdown: {
      taxableValue: 100,
      cgst: 9,
      sgst: 9,
      igst: 0,
      cess: 0,
      roundOff: 0,
    },
    items: [
      {
        name: "Office stationery",
        hsn: "4820",
        quantity: 1,
        rate: 100,
        taxPercent: 18,
        cessPercent: 0,
      },
    ],
  };
  let documentId = "";
  await page.route("**/api/integrations/ai/documents/extract", (route) => {
    const body = route.request().postDataJSON();
    expect(body.consent).toBe(true);
    expect(body.businessId).toBe(profile.id);
    documentId = body.documentId;
    return route.fulfill({
      json: {
        revision: body.revision,
        document: {
          id: documentId,
          name: file.name,
          image: "data:image/png;base64," + receiptImage,
          extraction,
        },
      },
    });
  });
  await page.route("**/api/integrations/ai/documents/review", (route) => {
    const body = route.request().postDataJSON();
    expect(body.confirm).toBe(true);
    expect(body.currency).toBe("INR");
    expect(body.documentId).toBe(documentId);
    return route.fulfill({
      json: {
        kind: "expense",
        documentId,
        businessId: profile.id,
        draft: {
          date: extraction.date,
          description: "Office stationery",
          amount: 118,
          gstAmount: 18,
          gstPercent: "",
          category: "Other",
          vendorName: extraction.supplierName,
          vendorGstin: "",
          invoiceNo: extraction.invoiceNumber,
          interstate: false,
          currency: "INR",
          note: "Reviewed demo receipt",
        },
      },
    });
  });
  const scan = panel.getByRole("button", {
    name: "Scan with ChatGPT",
    exact: true,
  });
  await expect(scan).toBeDisabled();
  await panel
    .getByLabel(
      "Send this entire image to my selected ChatGPT account for extraction.",
    )
    .check();
  await scan.click();
  await expect(panel.getByLabel("Supplier", { exact: true })).toHaveValue(
    "Metro Stationery",
  );
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mkdir("apps/parity/public/docs/screenshots", { recursive: true });
  await page.evaluate(() => {
    for (const element of document.querySelectorAll("*"))
      if (element instanceof HTMLElement && element.scrollTop)
        element.scrollTop = 0;
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: "apps/parity/public/docs/screenshots/ai-inbox.png",
    fullPage: true,
  });
  await panel
    .getByLabel(
      "I checked these fields and the document type against the original.",
    )
    .check();
  await expect(
    panel.getByRole("button", { name: "Open expense draft", exact: true }),
  ).toBeDisabled();
  await panel.getByLabel("This document is in INR (Indian rupees).").check();
  await panel
    .getByLabel(
      "I checked these fields and the document type against the original.",
    )
    .check();
  await panel
    .getByRole("button", { name: "Open expense draft", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Add Expense", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("GST amount on receipt", { exact: true }),
  ).toHaveValue("18");
  expect(
    (await (await request.get("/api/expenses")).json()).filter(
      (r: { businessId: string }) => r.businessId === profile.id,
    ).length,
  ).toBe(0);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Add Expense", exact: true }),
  ).toHaveCount(0);
  const expenses = await (await request.get("/api/expenses")).json();
  const saved = expenses.find(
    (r: { invoiceNo: string }) => r.invoiceNo === "EXP-DEMO-1",
  );
  expect(saved.gstAmount).toBe(18);
  expect(saved.amount).toBe(118);
});
