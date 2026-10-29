# Implementation status — 29 October 2026

The primary app now integrates the original Free GST modules in KNOWGST's minimal interface. This replaces the limited prototype as the default development preview. The original checkout and its data were not modified.

## Evidence by module

| Module | Implementation and verification |
| --- | --- |
| Dashboard | Reused dashboard, browser load and saved invoice visibility |
| Invoices | All seven source document types retained; browser tax invoice creation, 118 total on 100 taxable value, PDF generation/storage and persistence verified |
| Clients | Browser create/reload; API create/edit/delete |
| Products | Browser price, stock and tax defaults; API create/edit/delete |
| Purchases | Browser supplier bill creation; API create/edit/delete |
| Expenses | Browser form persistence; API create/edit/delete |
| Receipts | Browser standalone payment; API create/edit/delete |
| Recurring | Original scheduling code retained; browser load and API record persistence; automatic generation workflow still needs dedicated coverage |
| Reports | Original reports retained; browser load; report-by-report reconciliation remains |
| GST returns | Original exports/calculations retained; browser load; no live government filing verification |
| Income tax | Original calculations and regression fixtures retained; browser load; source CURRENT_FY remains 2025-26 and is not certified current |
| Settings / print | Source controls retained; browser load, preference mirroring and profile persistence tested; not every printer/template tested |
| Backup / control panel | SHA256 manifests, verified staging, manual refresh and corruption rejection tested; control-panel load; API restore and corrupt-snapshot rejection verified |
| Onboarding / local lock | Source flows retained and renamed; preferences and lock-secret export restrictions tested; not hosted authentication |
| Mobile / theme | Navigation, dark mode and horizontal overflow browser checks |
| OCR / Drive / sharing | Source capabilities retained; OCR packaged locally; OCR extraction quality and external provider authorization/delivery not verified |

## Safety changes

The local API requires an ephemeral server-only key and binds to loopback. The development proxy rejects cross-origin requests. Health checks omit logs. Upstream self-update/installer execution is disabled. No upstream service worker caches private API data. Runtime files are outside source folders and ignored by Git.

Backup snapshots include application data and an integrity manifest. They do **not** include the separate Saved Invoices PDF directory. A missing or mismatched manifest blocks snapshot restore before live mutation. Legacy exports can still be imported through Settings. Hashes detect accidental corruption, not malicious tampering by someone with filesystem write access.

Six original financial/helper modules are hash-checked against the upstream commit. Tax, discount and CSV regression suites run unchanged. New service tests cover authorization, module persistence, invoice conflicts/trash/restore, concurrent numbering, selective import, preferences, restart persistence and backup corruption. Browser tests exercise 14 module entry points plus principal data-entry workflows and mobile behavior.

## Remaining release gates

This is a compatibility integration, not a completed architecture migration or an assertion of exhaustive 1:1 parity. JSON storage retains upstream transaction/validation limitations. Current GST and income-tax rules need independent review; historical tests only prove historical behavior. Remaining coverage includes all seven document variants, recurrence generation, report reconciliation, complete backup/restore including PDFs and simulated disk failure, OCR and external integrations, accessibility and performance. Hosted authentication, normalized migrations, PostgreSQL, audit/security hardening, dependency review, production deployment and packaged macOS builds remain unfinished.

The earlier transactional SQLite prototype remains available via `pnpm dev:prototype`, in a separate database. It is not silently combined with the compatibility data. AI, bank feeds and expanded messaging integrations remain deferred.

## Verification commands for this increment

`pnpm check`, `pnpm test`, `pnpm build` and `pnpm test:e2e` are the release checks. The browser suite has 21 cases; the compatibility service/backup suite has 18 Node test results including its parent suite, alongside the unchanged source regression scripts and 12 prototype tests. Desktop and mobile captures are in `docs/verification/parity-*.png`. Screenshots use synthetic test records.
