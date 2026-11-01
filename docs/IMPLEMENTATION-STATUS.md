# Shared compact desktop system — 1 November 2026

The dashboard and all workspace pages now use one light/dark palette in `apps/parity/src/knowgst.css`. The dashboard-specific theme overrides were removed. Neutral surfaces and one action accent are shared by navigation, buttons, fields, tables, settings and dialogs; paid/overdue/error and destructive-action colours retain their meanings. KnowAI branding and user-selected invoice-template colours remain separate.

Desktop controls use a 36px baseline; narrow layouts retain 44px controls. Tables share 10px/14px cell padding and tabular numbers, neutral hover/selection states, and local horizontal scrolling. Buttons share radius, hover, disabled and focus treatments. Forms share surfaces, borders, placeholders, focus and invalid states. Reduced-motion preferences disable component transitions. Cross-page browser checks verify palette and primary-button foreground/background tokens in both themes alongside the existing six-width layout and workflow tests.

# Workspace spacing and navigation — 1 November 2026

All 15 main pages share aligned gutters, heading spacing and section gaps. Form controls and actions fit their panels; wide tables retain local scrolling. Settings and Print Settings grids adapt to narrow windows, and the GST summary wraps instead of widening the page. Screen-only rules preserve printed invoice geometry and the KnowAI logo.

The sidebar groups existing destinations under Overview, Sales, Purchases & stock, Accounting & tax, and Workspace. Groups now collapse independently and start closed except for the active page’s group, which remains open. Workspace utilities collapse with Workspace. Opening a group does not dismiss the mobile menu. Module visibility, keyboard navigation and auto-hide remain supported. Layout coverage includes 320, 390, 768, 1280, 1440 and 1920 pixel widths, dark mode, report/tax subpages and six entry dialogs. Tests explicitly reset the theme to avoid inheriting state from earlier tests.

# Dashboard increment — 1 November 2026

The new single-user dashboard is implemented with the KnowAI logo, minimal neutral styling, light/dark themes and responsive layouts. A read-only, business-scoped endpoint supplies month/currency-filtered sales and recorded cash movement, current receivables/payables, stock alerts, historical posting review counts and recent activity. Linked receipts are not double-counted. Saved invoice tax and TCS are excluded from sales without recalculating protected financial helpers.

Current balances cover all dates, not historical month-end snapshots. Supplier balances include accounting-managed purchases only. Recorded money movement excludes manual journals and untracked purchase payments; it is not bank balance or profit. Backup presence is not an integrity certification. Unassigned data and invalid values are disclosed.

The complete existing document workflows remain on the separate **Invoices** page. Activity rows open a contextual inspector and source register. Accounting review links open the existing historical backfill page.

Verification: 89 service/storage tests and the existing financial regression scripts passed, along with 12 prototype tests. The full browser suite passed 63 active tests (one opt-in documentation capture skipped). The documentation capture passed separately; the final two dashboard tests passed again after correcting mobile screenshot timing. Source checks and the production build passed. These are local browser/service checks, not packaged Mac/Windows acceptance tests. The sections below record earlier increments and retain their original dates and scope.

# Implementation status — 29 October 2026

The primary app now integrates the original Free GST modules in KNOWGST's minimal interface. This replaces the limited prototype as the default development preview. The original checkout and its data were not modified.

## Evidence by module

| Module | Implementation and verification |
| --- | --- |
| Dashboard | Reused dashboard, browser load and saved invoice visibility |
| Invoices | All seven source document types retained; browser creation, calculated total, valid downloadable PDF, archive storage and persisted particulars verified for every type |
| Clients | Browser create/reload; API create/edit/delete |
| Products | Browser price, stock and tax defaults; API create/edit/delete |
| Purchases | Browser supplier bill creation; API create/edit/delete |
| Expenses | Browser form persistence; API create/edit/delete |
| Receipts | Browser standalone payment; API create/edit/delete |
| Recurring | Generation tested for seven types, month-end anchors, occurrence limits, paused/ended schedules and restart deduplication; UI create/pause/generate covered |
| Reports | P&L fixture reconciliation, client/product totals, stock value, aging/party CSV exports and Excel archive verified |
| GST returns | GSTR-1/3B exported totals reconciled on fixtures; GSTR-2B matched/mismatch/books-only/portal-only states tested; no live government filing verification |
| Income tax | Historical FY 2025–26 filing workspace preserved; unsupported years rejected; separately scoped TY 2026–27 ordinary-income estimator with regression coverage; see TAX-RULE-REVIEW.md |
| Settings / print | Source controls retained; browser load, preference mirroring and profile persistence tested; not every printer/template tested |
| Backup / control panel | Complete data/PDF/trash snapshots, verified staging, corruption rejection, injected copy/install failures and process-interruption recovery tested; API PDF bytes and UI restore verified |
| Onboarding / local lock | Source flows retained and renamed; preferences and lock-secret export restrictions tested; not hosted authentication |
| Mobile / theme | Navigation, dark mode and horizontal overflow browser checks |
| OCR / Drive / sharing | Actual local OCR extraction tested on a synthetic invoice with external requests blocked; Drive request/error contracts and WhatsApp draft links tested; live authorization/delivery not verified |

## Safety changes

The local API requires an ephemeral server-only key and binds to loopback. The development proxy rejects cross-origin requests. Health checks omit logs. Upstream self-update/installer execution is disabled. No upstream service worker caches private API data. Runtime files are outside source folders and ignored by Git.

Backup snapshots include application data and an integrity manifest. New format-2 snapshots include Saved Invoices and PDF trash; format-1 snapshots remain data-only. A missing or mismatched manifest blocks snapshot restore before live mutation. Legacy exports can still be imported through Settings. Hashes detect accidental corruption, not malicious tampering by someone with filesystem write access.

Three protected helper modules match the original upstream hashes. Three have explicit reviewed records: filing-year rejection, purchase tax splitting, and CSV date-order safeguards. Existing invoice arithmetic is preserved. Tax, discount and CSV regression suites run unchanged. New service tests cover authorization, module persistence, invoice conflicts/trash/restore, concurrent numbering, selective import, preferences, restart persistence and backup corruption. Browser tests exercise 14 module entry points plus principal data-entry workflows and mobile behavior.

## Remaining release gates

This is a compatibility integration, not a completed architecture migration or an assertion of exhaustive 1:1 parity. JSON storage retains upstream transaction/validation limitations. Current rules have a bounded, sourced review in TAX-RULE-REVIEW.md; exhaustive classification and filing certification remain open. Remaining coverage includes broader financial edge cases across reports/document variants, hardware power-loss and remote disaster-recovery drills, real-world OCR accuracy, live external integrations, accessibility and performance. Hosted authentication, normalized migrations, PostgreSQL, audit/security hardening, dependency review, production deployment and packaged macOS builds remain unfinished.

The earlier transactional SQLite prototype remains available via `pnpm dev:prototype`, in a separate database. It is not silently combined with the compatibility data. AI, bank feeds and expanded messaging integrations remain deferred.

## Verification commands for this increment

`pnpm check`, `pnpm test`, `pnpm build` and `pnpm test:e2e` are the release checks. The normal browser suite has 43 active cases plus one opt-in documentation capture; the compatibility suites have 40 Node test results including their parent suite, alongside the unchanged source regression scripts and 12 prototype tests. Desktop and mobile captures are in `docs/verification/parity-*.png`. Screenshots use synthetic test records.

Detailed evidence, fixed defects and external-service boundaries: [Parity verification](PARITY-VERIFICATION.md).

## User documentation

The app now links to `/docs/`: 20 topics with search, mobile navigation, light/dark themes and 14 actual app screenshots using fictional records. Purchase register and entry-form images are included. See [guide maintenance](USER-GUIDE.md), [complete backups](BACKUP-RESTORE.md) and [tax-rule review](TAX-RULE-REVIEW.md).

## Current upstream gap pass

Compared current main at `f2cf339` (package 1.10.82 plus explicitly unreleased 1.10.83 changes), covering 66 source files and 48 API declarations. Ported functional fixes while preserving KNOWGST UI and identity. JSON imports now validate before mutation and use recoverable transactions; corrupt data and storage-ID collisions fail visibly. See [feature matrix](FEATURE-PARITY.md), [production review](PRODUCTION-GAP-REVIEW.md) and [source surface audit](UPSTREAM-SURFACE-AUDIT.md).
