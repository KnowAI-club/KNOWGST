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

Five original financial/helper modules match upstream hashes; the sixth retains its arithmetic with an explicit unsupported-year guard recorded in FINANCIAL-CHANGES.json. Tax, discount and CSV regression suites run unchanged. New service tests cover authorization, module persistence, invoice conflicts/trash/restore, concurrent numbering, selective import, preferences, restart persistence and backup corruption. Browser tests exercise 14 module entry points plus principal data-entry workflows and mobile behavior.

## Remaining release gates

This is a compatibility integration, not a completed architecture migration or an assertion of exhaustive 1:1 parity. JSON storage retains upstream transaction/validation limitations. Current rules have a bounded, sourced review in TAX-RULE-REVIEW.md; exhaustive classification and filing certification remain open. Remaining coverage includes broader financial edge cases across reports/document variants, hardware power-loss and remote disaster-recovery drills, real-world OCR accuracy, live external integrations, accessibility and performance. Hosted authentication, normalized migrations, PostgreSQL, audit/security hardening, dependency review, production deployment and packaged macOS builds remain unfinished.

The earlier transactional SQLite prototype remains available via `pnpm dev:prototype`, in a separate database. It is not silently combined with the compatibility data. AI, bank feeds and expanded messaging integrations remain deferred.

## Verification commands for this increment

`pnpm check`, `pnpm test`, `pnpm build` and `pnpm test:e2e` are the release checks. The normal browser suite has 38 active cases plus one opt-in documentation capture; the compatibility suites have 34 Node test results including their parent suite, alongside the unchanged source regression scripts and 12 prototype tests. Desktop and mobile captures are in `docs/verification/parity-*.png`. Screenshots use synthetic test records.

Detailed evidence, fixed defects and external-service boundaries: [Parity verification](PARITY-VERIFICATION.md).

## User documentation

The app now links to `/docs/`: 20 topics with search, mobile navigation, light/dark themes and 14 actual app screenshots using fictional records. Purchase register and entry-form images are included. See [guide maintenance](USER-GUIDE.md), [complete backups](BACKUP-RESTORE.md) and [tax-rule review](TAX-RULE-REVIEW.md).
