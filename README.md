# KNOWGST

Open-source invoicing and bookkeeping. New KNOWGST code is GPL-3.0-only; reused Free GST code retains its MIT notices.

**Release candidate: use test data until your books and workflows have been reviewed.** Native macOS and Windows installer builds are available through the desktop pipeline. Publisher signing, Apple notarization and taxpayer-specific compliance approval remain release gates.

## Desktop builds

The [Desktop installers workflow](https://github.com/KnowAI-club/KNOWGST/actions/workflows/desktop.yml) builds native installers and tests installation, SQLite, PDF export, backup/restore and restart persistence. Download the artifact only from a successful run. Candidates are versioned `1.0.0-rc.1` and are not publisher-signed.

See [desktop installation, data migration and build instructions](docs/DESKTOP-RELEASE.md). Installed apps bundle their runtime and do not require Node or a development server. Upgrades preserve the separate data directory; import existing development data using a verified backup.

## Run from source

Node.js 22.22+ and pnpm 9.15.9, Python 3 and a C/C++ build toolchain (macOS Command Line Tools or Linux build-essential):

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open http://127.0.0.1:4173. Both interface and protected local service start together. OCR assets are prepared from locked dependencies. SQLite 3.54.1 is compiled from checksum-pinned official source on first startup. Records are stored in `.local/parity/data/knowgst.sqlite`; generated PDFs live under `.local/parity/Saved Invoices`. `KNOWGST_RUNTIME` selects another runtime directory. Keep this development service on loopback.

## Included modules

Dashboard, seven invoice/document types and PDF output, clients, inventory, purchases, expenses, receipts, recurring invoices, reports, GST returns, income-tax calculations, settings, print settings, backups, control panel, onboarding and local app lock. These reuse the audited upstream implementation; importing a module does not establish complete end-to-end parity or current tax compliance.

The approved minimal interface uses neutral surfaces, Inter, restrained neutral accents and light/dark themes. See [implementation status](docs/IMPLEMENTATION-STATUS.md) for test coverage and remaining boundaries.

The dashboard reads business-scoped records with month and currency filters, sales excluding GST/TCS, recorded money movement, current customer/supplier balances, an attention queue and a searchable activity inspector. The full document workflow remains under **Invoices**. Balances cover all dates; the money-movement chart excludes manual journals and untracked purchase payments and is not a bank balance.

## User guide

Open **User Guide** in the app, or visit http://127.0.0.1:4173/docs/. The guide includes 21 topics and actual screenshots of the implemented interface using sample records. [Guide maintenance](docs/USER-GUIDE.md) · [Complete backup and restore](docs/BACKUP-RESTORE.md) · [Tax-rule review](docs/TAX-RULE-REVIEW.md).

## Validate

```sh
pnpm check
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

Browser tests create a separate temporary runtime. Never point tests at real books.

## Architecture

- `apps/parity`: active React interface and protected Express compatibility service, preserving original financial helpers.
- `scripts/parity-dev.ts`: local lifecycle, server-only secret and same-origin proxy.
- `apps/api`, `apps/web`, `packages/domain`: earlier transactional SQLite prototype, retained for incremental architectural migration. Run separately with `pnpm dev:prototype`; its `.local/knowgst.sqlite` data is not shared with the compatibility app.
- `docs/UPSTREAM-MANIFEST.json`: original source hashes; financial helper drift is checked automatically.

The active application now uses SQLite 3.54.1 with WAL, full synchronous commits and a schema-versioned record store. Legacy JSON payloads are preserved during migration; the complete domain model is not yet normalized into separate relational tables. Self-hosted PostgreSQL, hosted authentication and Tauri packaging remain future stages. AI and expanded integrations follow feature parity. See [proposal](docs/TECHNICAL-PROPOSAL.md) and [provenance](THIRD-PARTY-NOTICES.md).

## Accounts and business stock

Reports → **Accounts & history** provides balanced INR journals, reversals, account balances, audit events and stock movements. Products are scoped to the active business; legacy stock requires explicit assignment. Purchases → **Payments** records partial payments, rejects overpayments and retains reversal history.

Accounting supports manual journals, supplier-payable/payment postings and automatic INR sales, credit notes, linked customer payments, standalone receipts and gross expenses. Source corrections append reversals. Historical records can be reviewed and posted through Reports → Accounts & history → Historical backfill; purchase/expense tax remains unclassified for input credit, and the existing P&L is unchanged. See [SQLite migration and accounting boundaries](docs/SQLITE-ACCOUNTING.md) before using real books.
