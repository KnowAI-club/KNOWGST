import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
// @ts-expect-error Legacy JavaScript calculation module.
import { computeInvoiceTotals } from "../../apps/parity/src/utils.js";
// @ts-expect-error Legacy JavaScript preset module.
import { applyBusinessPreset } from "../../apps/parity/src/utils/printSettings.js";
const require = createRequire(
  new URL("../../apps/parity/package.json", import.meta.url),
);
const { PDFDocument } = require("pdf-lib");
const layouts = [
  "modern",
  "minimalist",
  "classic",
  "minimal",
  "corporate",
  "boxed",
  "tally",
];
const businesses = [
  {
    key: "retail_shop",
    name: "Prakash Stationery",
    items: [
      ["A4 writing pads", "482010", 5, 100, 12, "Nos"],
      ["Desk organiser", "392610", 2, 450, 18, "Nos"],
      ["Document folder", "392610", 4, 180, 18, "Nos"],
    ],
  },
  {
    key: "wholesale",
    name: "Western Electrical Distributors",
    items: [
      ["LED panel 18W", "940511", 12, 650, 18, "Nos"],
      ["Copper cable 1.5 sq.mm", "854449", 100, 32, 18, "Mtr"],
      ["Switch plate 6 module", "853890", 20, 110, 18, "Nos"],
    ],
  },
  {
    key: "manufacturer",
    name: "Precision Engineering Works",
    items: [
      ["Machined steel bracket", "732690", 24, 325, 18, "Nos"],
      ["Mounting assembly", "732690", 10, 650, 18, "Nos"],
      ["Finishing and inspection", "998873", 1, 1200, 18, "Job"],
    ],
  },
  {
    key: "freelancer",
    name: "Northstar Design Studio",
    items: [
      ["Website interface design", "998314", 16, 1250, 18, "Hrs"],
      ["Usability review", "998314", 4, 1500, 18, "Hrs"],
      ["Monthly design support", "998314", 1, 5000, 18, "Month"],
    ],
  },
  {
    key: "service",
    name: "Reliable Equipment Services",
    items: [
      ["Preventive maintenance labour", "998719", 4, 750, 18, "Hrs"],
      ["Replacement bearing", "848210", 2, 850, 18, "Nos"],
      ["On-site inspection", "998719", 1, 600, 18, "Job"],
    ],
  },
  {
    key: "restaurant",
    name: "Green Leaf Kitchen",
    items: [
      ["Vegetarian meal", "996331", 4, 280, 5, "Nos"],
      ["Breakfast platter", "996331", 2, 180, 5, "Nos"],
      ["Tea service", "996331", 6, 40, 5, "Nos"],
    ],
  },
];
for (const [bi, business] of businesses.entries())
  for (const [li, layout] of layouts.entries()) {
    test(`${business.key} / ${layout}: GST fields, neutral layout and PDF`, async ({
      page,
      request,
    }, info) => {
      const id = `M${bi}-${li}`,
        number = `DEMO/26/${bi}${li}`;
      const profile = {
        id,
        businessName: business.name + " (Demo)",
        address: "Unit 12, Sample Business Park, Baner Road",
        city: "Pune",
        pin: "411045",
        country: "India",
        state: "Maharashtra",
        gstin: "27AAAAA0000A1Z5",
        email: "accounts@example.com",
        bankName: "Demonstration Bank",
        accountNumber: "000000000000",
        ifsc: "DEMO0000000",
      };
      const interstate = business.key === "wholesale",
        state = interstate ? "Karnataka" : "Maharashtra";
      const client = {
        name:
          business.key === "restaurant"
            ? "Walk-in customer (Demo)"
            : "Aster Enterprises (Demo)",
        address: "22 Sample Commercial Road",
        city: interstate ? "Bengaluru" : "Mumbai",
        pin: interstate ? "560001" : "400001",
        state,
        country: "India",
        gstin:
          business.key === "restaurant"
            ? ""
            : interstate
              ? "29BBBBB1111B1Z1"
              : "27BBBBB1111B1Z1",
      };
      const items = business.items.map(
        ([name, hsn, quantity, rate, taxPercent, unit], i) => ({
          id: `item-${i}`,
          name,
          hsn,
          quantity,
          rate,
          taxPercent,
          unit,
          discount: i === 0 ? 50 : 0,
        }),
      );
      const details = {
        invoiceNumber: number,
        invoiceDate: "2026-11-01",
        dueDate: "2026-11-15",
        placeOfSupply: state,
      };
      const options = {
        currency: "INR",
        paperSize: "a4",
        pdfStyle: layout,
        showGST: true,
        showHSN: true,
        showHsnSummary: true,
        showDiscount: true,
        showBankDetails: true,
        showSignature: true,
      };
      const totals = computeInvoiceTotals({
        profile,
        client,
        details,
        items,
        invoiceOptions: options,
        showGST: true,
      });
      await request.post("/api/profile", { data: profile });
      const settings = {
        ...applyBusinessPreset({}, business.key),
        onboardingComplete: true,
        pdfTemplate: layout,
      };
      await request.post("/api/local-prefs", {
        data: {
          set: {
            gst_printSettings: JSON.stringify(settings),
            freegstbill_onboarded: "true",
          },
        },
      });
      expect(
        (
          await request.post("/api/bills", {
            data: {
              id: number,
              invoiceNumber: number,
              invoiceDate: details.invoiceDate,
              invoiceType: "tax-invoice",
              clientName: client.name,
              totalAmount: totals.total,
              totalTaxAmount: totals.totalTaxAmount,
              status: "unpaid",
              data: {
                profile,
                client,
                details,
                items,
                totals,
                invoiceType: "tax-invoice",
                invoiceOptions: options,
                customTerms:
                  "Payment within 14 days. Please quote the invoice number in your payment reference.",
                customNotes:
                  "FICTIONAL DEMO. Rates and identifiers are illustrative; not valid for tax filing or payment.",
              },
            },
          })
        ).ok(),
      ).toBe(true);
      await page.goto("/?view=invoices");
      await page.getByPlaceholder("Search client or invoice...").fill(number);
      await page
        .getByRole("button", { name: `View ${number}`, exact: true })
        .click();
      const invoice = page.locator(".invoice-preview-container").last();
      for (const value of [
        profile.businessName,
        profile.gstin,
        client.name,
        number,
        interstate ? "IGST" : "CGST",
        "HSN",
      ])
        await expect(invoice).toContainText(value);
      await expect(invoice).not.toContainText("NaN");
      if (layout === "corporate") {
        const color = await invoice
          .locator(".inv-business-name")
          .evaluate((el) => getComputedStyle(el).color);
        expect(color).toBe("rgb(32, 37, 32)");
      }
      await expect(invoice).not.toContainText("No signature");
      const overflow = await invoice.evaluate(
        (root) =>
          Array.from(root.querySelectorAll("table")).filter(
            (el) => el.scrollWidth > el.clientWidth + 2,
          ).length,
      );
      expect(overflow).toBe(0);
      await invoice.screenshot({ path: info.outputPath("invoice.png") });
      await page.getByRole("button", { name: "Close", exact: true }).click();
      const downloading = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "All shown (1)", exact: true })
        .click();
      const file = await downloading,
        output = info.outputPath("invoice.pdf");
      await file.saveAs(output);
      const pdf = await PDFDocument.load(await readFile(output));
      expect(pdf.getPageCount()).toBe(1);
      expect(pdf.getPage(0).getWidth()).toBeCloseTo(595.28, 0);
    });
  }

test("long invoice keeps all lines and totals across PDF pages", async ({
  page,
  request,
}, info) => {
  const profile = {
    id: "long-sheet",
    businessName: "Sample Industrial Supplies (Demo)",
    address: "Sample Industrial Road",
    state: "Maharashtra",
    country: "India",
    gstin: "27AAAAA0000A1Z5",
  };
  const client = {
    name: "Sample Buyer",
    address: "Sample Market",
    state: "Maharashtra",
  };
  const details = {
    invoiceNumber: "LONG/26/01",
    invoiceDate: "2026-11-01",
    placeOfSupply: "Maharashtra",
  };
  const items = Array.from({ length: 45 }, (_, i) => ({
    id: `long-${i}`,
    name: `Workshop component ${i + 1}`,
    hsn: "820559",
    quantity: 2,
    rate: 100,
    taxPercent: 18,
    unit: "Nos",
  }));
  const options = {
    paperSize: "a4",
    pdfStyle: "modern",
    showGST: true,
    showHsnSummary: true,
    currency: "INR",
  };
  const totals = computeInvoiceTotals({
    profile,
    client,
    details,
    items,
    invoiceOptions: options,
    showGST: true,
  });
  expect(totals.total).toBe(10620);
  await request.post("/api/profile", { data: profile });
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
      await request.post("/api/bills", {
        data: {
          id: details.invoiceNumber,
          invoiceNumber: details.invoiceNumber,
          invoiceDate: details.invoiceDate,
          clientName: client.name,
          invoiceType: "tax-invoice",
          totalAmount: totals.total,
          status: "unpaid",
          data: {
            profile,
            client,
            details,
            items,
            totals,
            invoiceOptions: options,
            invoiceType: "tax-invoice",
          },
        },
      })
    ).ok(),
  ).toBe(true);
  await page.goto("/?view=invoices");
  await page
    .getByPlaceholder("Search client or invoice...")
    .fill(details.invoiceNumber);
  await page
    .getByRole("button", { name: `View ${details.invoiceNumber}`, exact: true })
    .click();
  const preview = page.locator(".invoice-preview-container").last();
  await expect(preview).toContainText("Workshop component 45");
  await expect(preview).toContainText("10,620.00");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "All shown (1)", exact: true })
    .click();
  const path = info.outputPath("long-invoice.pdf");
  await (await download).saveAs(path);
  const pdf = await PDFDocument.load(await readFile(path));
  expect(pdf.getPageCount()).toBeGreaterThan(1);
  expect(pdf.getPageCount()).toBeLessThanOrEqual(4);
  await page
    .locator("tr")
    .filter({
      has: page.getByRole("button", {
        name: `View ${details.invoiceNumber}`,
        exact: true,
      }),
    })
    .getByTitle("Edit", { exact: true })
    .click();
  const individual = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Save & Download", exact: true })
    .click();
  const individualPath = info.outputPath("long-individual.pdf");
  await (await individual).saveAs(individualPath);
  const saved = await PDFDocument.load(await readFile(individualPath));
  expect(saved.getPageCount()).toBeGreaterThan(1);
  expect(saved.getPageCount()).toBeLessThanOrEqual(4);
});
