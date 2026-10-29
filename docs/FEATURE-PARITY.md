# Feature parity — 29 October 2026

Baseline integration: upstream `07502f3` (1.10.80). Current comparison: `f2cf33939842db5d9e8206e922f2c8552da4cc38`, package 1.10.82, also containing changes under **1.10.83 unreleased**. Published-release and current-main functionality must not be conflated.

The source surface audit covers every file under upstream `src/` plus server.js (66 files), and 48 explicit API route declarations. The original manifest remains intact. Identical source is evidence of retention, not independent behavioral proof. Every financial/helper change requiring a hash exception is recorded separately in FINANCIAL-CHANGES.json.

| Feature/workflow | KNOWGST disposition | Evidence and remaining limits |
| --- | --- | --- |
| Business onboarding and profile switching | Retained | Profile API round trips, onboarding preferences, module entry coverage; every wizard branch not tested |
| Module visibility and local preferences | Retained | Preference mirror and reload tests; original settings controls preserved |
| Dashboard, search, filters and invoice actions | Retained; keyboard action-menu fix ported | Saved-document visibility, cancellation/report fixtures; Arrow/Home/End/Escape/focus tested |
| Seven invoice/document types | Retained | Each type created, persisted, downloaded and reopened; valid PDF structure and totals asserted |
| Discounts, inclusive tax, GST/UTGST, cess, RCM, TDS/TCS, round-off | Calculation source retained with regression coverage | Upstream financial suites run; tests establish arithmetic, not legal applicability |
| Number series and per-business counters | Retained; corrupt metadata now fails closed | Concurrent increments, import reconciliation, duplicates; corrupt counter file cannot reset numbering |
| Invoice templates, print layouts, multi-copy, paper sizes | Retained | Source comparison and all document PDFs; not every printer or layout combination |
| Signature/stamp layout | Ported from current-main unreleased change | Side-by-side, stacked, overlaid component shared by templates; Settings persistence and stacked preview tested |
| Clients and credit/outstanding helpers | Retained | CRUD, reload, report fixtures; corrupt credit dependency reads now stop deletion |
| Products, units and stock | Retained | CRUD/defaults, stock export value and upstream stock arithmetic regressions; separate sales/stock writes still need transaction migration |
| Sales and purchase CSV import/export | Retained; date-order and partial-import stock fixes ported | Upstream CSV suite, mixed-date rejection; stock-provider write failure is not fully atomic |
| Purchases | Retained; explicit tax-head display/export ported | Form persistence, interstate arithmetic fixtures, CSV CGST/SGST/IGST, odd-paisa sum |
| Expenses | Retained | Browser persistence, API CRUD and ex-GST report fixture |
| Receipts/payments | Retained | Standalone receipt persistence, source allocation controls; exhaustive allocation reversals pending |
| Recurring documents | Retained | Seven types, start/end/count/month-end, paused state, startup/restart deduplication |
| P&L, aging, party/client/product/stock reports | Retained | Fixtures reconcile signed documents, cancellation exclusions, currencies, CSV and Excel outputs |
| GSTR-1 and GSTR-3B | Retained | JSON fixture reconciliation; no live submission or acceptance certification |
| GSTR-2B | Retained | Matched, mismatch, books-only, portal-only imports |
| TDS/TCS reports and e-way-bill export | Retained | Source and upstream helper regressions; no live portal acceptance test |
| Income-tax filing workspace | Historical years preserved | FY guard/current-year estimate have tests; current legal scope and exclusions in TAX-RULE-REVIEW.md |
| Local OCR | Retained with bundled assets | Real Tesseract synthetic-image extraction without external requests; arbitrary scans not certified |
| WhatsApp sharing/reminders and email drafts | Retained; desktop saved-phone/PDF fallback fixed | Browser traps draft URL without contacting WhatsApp and verifies downloaded PDF; no message sent or delivery verified |
| Google Drive | Retained with prior error-handling fixes | Provider contract tests only; live authorization/delivery unverified |
| Local lock | Retained | PIN-secret export restrictions and lock routes tested; not hosted user authentication |
| JSON export/import | Hardened | Validation before writes, collision protection, overwrite semantics, counter reconciliation, rollback/crash recovery |
| Complete backup/restore and PDF trash | KNOWGST implementation retained | Byte hashes, copy/install failures, process interruption, legacy mode; secondary-folder ownership now enforced |
| Control Panel and updater | Product-specific replacement | Working local backups/folder actions; source-product updater/installer intentionally disabled |
| Help/documentation | Product-specific replacement | 20-topic local guide, actual screenshots, contextual links, mobile/theme tests |
| About/What's new | Product-specific replacement | Local KNOWGST changelog; original donor promotions replaced by attribution and existing onboarding |
| Mobile, themes, logo | Approved UI preserved | Navigation/overflow/dark-mode tests; official KnowAI symbol and refreshed guide screenshots |
| Platform packaging | Pending | Source Mac launcher fix relates to the source distribution; KNOWGST does not ship that launcher or claim signed macOS readiness |

No exhaustive production-parity claim is made. Remaining release gates: hosted authentication, transactional accounting/storage migration, external integration acceptance, government-schema acceptance, full accessibility/performance review, signed macOS builds and operational deployment/restore drills.
