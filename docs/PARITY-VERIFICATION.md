# Parity verification — 29 October 2026

Scope: compare the integrated Free GST implementation at upstream commit `07502f3cad1634a5e7b47a631968152e0bc7e34f` against exercised source workflows. All records are synthetic and test services use isolated runtime directories. The initial parity pass did not update tax rules; the subsequent bounded review is documented in TAX-RULE-REVIEW.md. Statutory exports are not certified.

## Document and scheduling evidence

Browser tests create and download tax invoices, quotations, proformas, bills of supply, composition bills of supply, credit notes and delivery challans. They check saved type, line description, totals, credit-note reference, PDF page count, archived PDF response and dashboard persistence. At a base value of 100 with 18% selected, taxable types retain 118; supply/composition/challan types retain 100. These are fixtures for existing behavior, not legal applicability decisions.

Service tests generate all seven types from recurring templates with the same expected totals. A 31 January 2028 schedule advances to 29 February and then 31 March. Two-occurrence limits block a third generation. Startup processes a due template, skips paused/ended templates and does not duplicate the due invoice after restart. Browser coverage creates a template, pauses it and explicitly generates an invoice while preserving the paused state.

## Reports and imports

A controlled sales fixture includes a 1,180 invoice, a 118 credit note, a 236 expense containing 36 GST, plus non-sale, cancelled and foreign-currency records. INR P&L must show revenue excluding tax 900, expenses excluding GST 200 and profit 700. Client revenue is 1,062; product revenue excluding tax is 900. These values and exclusions are asserted in UI/export tests. A ten-unit product at purchase price 50 exports stock value 500. Aging and party reports export fixture clients without NaN values. CSV content and Excel ZIP signatures are checked; native print dialogs and every spreadsheet application are not tested.

GSTR-1 and GSTR-3B fixture exports both report taxable sales 1,000 and CGST/SGST 90 each, excluding quotations, estimates and cancelled invoices. GSTR-2B imports exercise matched, amount mismatch, books-only and portal-only states. This validates application arithmetic/serialization, not acceptance by the GST portal or current statutory schema completeness.

## Integration defects fixed

- Drive folder names containing apostrophes/backslashes now escape the query literal.
- Failed folder searches stop immediately rather than falling through to folder creation.
- Folder creation errors and missing IDs now fail visibly.
- OAuth popup failures settle the connection promise; malformed token responses are rejected.
- Expired tokens and HTTP 401 responses invalidate connection state.
- Non-JSON upload errors retain a useful HTTP-status error instead of failing during error parsing.

The changes follow Google's [file-query escaping guidance](https://developers.google.com/workspace/drive/api/guides/search-files) and [OAuth error handling guidance](https://developers.google.com/identity/oauth2/web/guides/error). Contract tests use mocked Google responses, synthetic tokens and PDF bytes. No user credentials are read or committed. Actual authorization, account permissions and cloud delivery require a separately authorized live account test.

WhatsApp tests verify recipient sanitization, message encoding, separate-tab behavior and no-recipient sharing. This is the source product's draft-link integration, not a WhatsApp messaging API or delivery receipt. No message is sent.

OCR runs the real Tesseract worker/core/language bundle in Chromium against a generated invoice image, with all external requests blocked. Invoice number TEST-123 and total 1,180 are asserted. This proves local execution for that fixture; noisy photos, handwriting and arbitrary invoice layouts still need an accuracy corpus.

## Boundaries preserved

Minimal UI is retained. Three protected helpers still match the original hashes; filing-year rejection, purchase tax splitting and CSV date-order safeguards have separately reviewed change records. Historical invoice arithmetic is preserved. New provider tests cover adapters; they do not certify external services. Full production parity still requires broader edge cases, print-device coverage, hosted controls and exhaustive current-rule/filing validation. New AI, email-provider and messaging-API features remain outside this parity pass.

## Complete backups, tax safety and user guide

New snapshots include data, Saved Invoices and PDF trash. Restore verifies byte hashes, stages replacements, retains a pre-restore copy and rolls back interrupted transactions at startup. Tests exercise data added after backup, damaged PDF bytes, partial-copy failure, install failure and process exit. Settings no longer refreshes a selected same-day snapshot before restoring it. Control Panel invokes the working backup service. See BACKUP-RESTORE.md for the power-loss and encryption boundaries.

Current-year ordinary-income estimates, historical filing-year separation and HSN rate preservation have regression tests. TAX-RULE-REVIEW.md records official sources, scope and remaining statutory review.

The local `/docs/` guide covers 20 topics. Fourteen actual app captures use isolated fictional records. Browser checks cover guide links, image availability, TOC targets, contextual help, mobile layout and persistent theme; capture regeneration is an explicit opt-in test.

The subsequent current-main review, transactional import hardening and expanded coverage are documented in [FEATURE-PARITY.md](FEATURE-PARITY.md) and [PRODUCTION-GAP-REVIEW.md](PRODUCTION-GAP-REVIEW.md).
