import { test, expect } from "@playwright/test";
for (const layout of [
  "modern",
  "minimalist",
  "classic",
  "minimal",
  "corporate",
  "boxed",
  "tally",
  "thermal58",
]) {
  test(`${layout}: credit note retains original invoice reference`, async ({
    page,
    request,
  }) => {
    const profile = {
      id: "credit-layout",
      businessName: "Sample Seller",
      address: "Sample Road",
      state: "Maharashtra",
      country: "India",
      gstin: "27AAAAA0000A1Z5",
    };
    const number = `CN/26/${layout}`;
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
            id: number,
            invoiceNumber: number,
            invoiceDate: "2026-11-01",
            invoiceType: "credit-note",
            clientName: "Sample Buyer",
            totalAmount: 118,
            status: "unpaid",
            data: {
              profile,
              client: {
                name: "Sample Buyer",
                address: "Sample Market",
                state: "Maharashtra",
              },
              details: {
                invoiceNumber: number,
                invoiceDate: "2026-11-01",
                originalInvoiceRef: "INV/26/001",
                placeOfSupply: "Maharashtra",
              },
              invoiceType: "credit-note",
              items: [
                {
                  name: "Returned supplies",
                  hsn: "820559",
                  unit: "Nos",
                  quantity: 1,
                  rate: 100,
                  taxPercent: 18,
                },
              ],
              totals: {
                subtotal: 100,
                total: 118,
                taxableAmount: 100,
                cgst: 9,
                sgst: 9,
                igst: 0,
                totalTaxAmount: 18,
              },
              invoiceOptions: {
                currency: "INR",
                pdfStyle: layout === "thermal58" ? "modern" : layout,
                paperSize: layout === "thermal58" ? "thermal58" : "a4",
              },
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
    await expect(
      page.locator(".invoice-preview-container").last(),
    ).toContainText("INV/26/001");
  });
}
