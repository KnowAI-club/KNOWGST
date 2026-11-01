import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../../apps/parity/package.json", import.meta.url),
);
const { PDFDocument } = require("pdf-lib");
for (const [paper, width] of [
  ["thermal58", 48],
  ["thermal80", 72],
] as const) {
  test(`${paper}: buyer particulars survive compact PDF export`, async ({
    page,
    request,
  }, info) => {
    await request.post("/api/profile", {
      data: {
        id: paper,
        businessName: "Sample Retail (Demo)",
        address: "12 Sample Road",
        state: "Maharashtra",
        country: "India",
        gstin: "27AAAAA0000A1Z5",
      },
    });
    await request.post("/api/local-prefs", {
      data: {
        set: {
          gst_printSettings: JSON.stringify({
            onboardingComplete: true,
            showHSN: true,
          }),
          freegstbill_onboarded: "true",
        },
      },
    });
    await page.goto("/?view=new");
    await page
      .getByPlaceholder("Type client name to search or add new")
      .fill("Sample Buyer");
    await page
      .getByPlaceholder("Street address, locality", { exact: true })
      .fill("22 Sample Market Road");
    await page
      .locator(".form-group")
      .filter({ has: page.locator("label").filter({ hasText: /^State$/ }) })
      .locator("select")
      .selectOption({ label: "Maharashtra" });
    await page
      .getByPlaceholder("Item", { exact: true })
      .fill("Workshop supplies");
    await page
      .locator(".line-item-field")
      .filter({ has: page.locator("label").filter({ hasText: /^HSN\/SAC$/ }) })
      .locator("input")
      .fill("820559");
    await page
      .locator(".line-item-field")
      .filter({ has: page.locator("label").filter({ hasText: /^Rate$/ }) })
      .locator("input")
      .fill("100");
    await page.getByRole("button", { name: "Customize", exact: true }).click();
    await page
      .locator("select")
      .filter({ has: page.locator('option[value="thermal58"]') })
      .selectOption(paper);
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save & Download", exact: true })
      .click();
    const path = info.outputPath(`${paper}.pdf`);
    await (await download).saveAs(path);
    const doc = await PDFDocument.load(await readFile(path));
    expect(doc.getPage(0).getWidth()).toBeCloseTo((width * 72) / 25.4, 0);
    const preview = page
      .locator(".invoice-preview-container.paper-thermal")
      .first();
    await expect(preview).toContainText("22 Sample Market Road");
    await expect(preview).toContainText("Place of supply:");
    await expect(preview).toContainText("Code: 27");
    await expect(preview).toContainText("820559");
    expect(
      await preview.evaluate((el) => el.scrollWidth <= el.clientWidth + 2),
    ).toBe(true);
  });
}
