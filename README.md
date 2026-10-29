# KNOWGST

Open-source invoicing and bookkeeping. New KNOWGST code is GPL-3.0-only; reused Free GST code retains its MIT notices.

**Local development preview: use test data.** The original product modules are integrated. This is not yet a certified GST, hosted, or packaged macOS release.

## Run

Node.js 22.22+ and pnpm 9.15.9:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open http://127.0.0.1:4173. Both interface and protected local service start together. OCR assets are prepared from locked dependencies. Records are isolated in `.local/parity/data`; generated PDFs live under `.local/parity/Saved Invoices`. `KNOWGST_RUNTIME` selects another runtime directory. Keep this development service on loopback.

## Included modules

Dashboard, seven invoice/document types and PDF output, clients, inventory, purchases, expenses, receipts, recurring invoices, reports, GST returns, income-tax calculations, settings, print settings, backups, control panel, onboarding and local app lock. These reuse the audited upstream implementation; importing a module does not establish complete end-to-end parity or current tax compliance.

The approved minimal interface uses neutral surfaces, Inter, restrained blue accents and light/dark themes. See [implementation status](docs/IMPLEMENTATION-STATUS.md) for test coverage and remaining boundaries.

## User guide

Open **User Guide** in the app, or visit http://127.0.0.1:4173/docs/. The guide includes 20 topics and actual screenshots of the implemented interface using sample records. [Guide maintenance](docs/USER-GUIDE.md) · [Complete backup and restore](docs/BACKUP-RESTORE.md) · [Tax-rule review](docs/TAX-RULE-REVIEW.md).

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

Compatibility storage remains JSON. Self-hosted PostgreSQL, normalized migrations, hosted authentication and Tauri packaging remain future stages. AI and expanded integrations follow feature parity. See [proposal](docs/TECHNICAL-PROPOSAL.md) and [provenance](THIRD-PARTY-NOTICES.md).
