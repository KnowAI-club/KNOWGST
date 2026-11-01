# Invoice layout review — 1 November 2026

This is invoice-layout release evidence, not certification of all GST obligations or a packaged desktop release.

## Coverage

- Six existing business presets: retail, wholesale, manufacturing, freelancer, services and restaurant.
- Seven A4 designs: Modern, Minimalist, Classic, Minimal, Corporate, Boxed and Tally.
- Realistic fictional seller/customer/item data, three lines per invoice, discounts, HSN/SAC summaries, bank details, terms and signature space.
- Intrastate mixed-rate fixtures and interstate IGST fixtures. Fixture rates and GSTINs are illustrative, not classification advice or valid filing credentials.
- Automated assertions cover seller/buyer identity, invoice references, GST labels, table overflow, single-page short exports and A4 dimensions.
- Supplementary tests cover long invoices and 58/80mm thermal PDF output. Existing document tests cover tax invoices, quotations, proformas, bills of supply, composition documents, credit notes and delivery challans.
- Actual PDF pages are rasterized for visual review; DOM presence alone cannot detect white text on a white background.

## Changes

Modern now uses aligned seller identity and labelled invoice metadata, a shared print grid, understated table headings, compact totals, aligned tax summaries and a restrained footer. Corporate uses dark text on white paper. Minimal avoids doubled header margins. Grid designs avoid doubled page padding; Tally suppresses unused dispatch/reference placeholders and excessive blank line space. The total is labelled “Invoice total”, independently of payment status.

Thermal output retains the buyer address, state code, place of supply, separate delivery address and original credit-note reference. Narrow receipts no longer suppress populated HSN/SAC codes. Boxed delivery/place-of-supply state names include codes. Tally retains the original-invoice reference on credit notes. Closing totals, tax summaries and signatures stay together when the group fits on one page. No tax engine, stored amounts or user business records were changed.

## Standards and limits

Reviewed against [CBIC CGST Rule 46](https://taxinformation.cbic.gov.in/content-page/explore-rules/1000136/1000001): seller/recipient particulars, serial/date, supply details, tax particulars and conditional declarations must be represented when applicable. Business presets are presentation defaults; they do not determine registration, composition eligibility, tax rates or e-invoicing applicability.

IRP-issued IRN/signed QR integration, taxpayer-specific applicability, special-sector obligations and signed macOS/Windows release packaging are not established by these layout tests. A UPI payment QR is not an IRP signed QR. Physical printer output still needs device-specific verification.

## Validation results

- Full browser suite: 117 passed, 1 optional guide-capture test skipped.
- After closing-block pagination changes: 62 invoice/document/report checks passed; the new 80mm overflow assertion exposed a fixed-width total column. After correcting that column, all 10 compact-format and cross-layout credit-reference checks passed.
- All 42 business/layout A4 exports passed their final matrix run; long bulk and individual invoice downloads passed.
- Workspace unit suites passed, including 95 parity tests; `pnpm check` and production build passed after final code changes.
- Rendered all 42 A4 matrix PDFs; inspected layout contact sheets plus full-size modern, corporate, long and thermal PDF pages. Corrected Corporate contrast and the orphaned signature found during visual inspection.
