# SQLite and accounting increment — 30 October 2026

## Active runtime

The compatibility app now uses SQLite **3.54.1**, verified with `sqlite_version()` at startup. Official release: https://www.sqlite.org/releaselog/3_54_1.html. `better-sqlite3` 13.0.3 supplies the binding, but its bundled engine is older; `prepare:sqlite` builds against the pinned 3.54.1 amalgamation and verifies both the archive SHA-256 and the official sqlite3.c SHA3-256. Node's built-in SQLite is not used by this runtime. Source builds need Python and a C/C++ compiler; macOS CLT-only systems have an explicit compiler fallback. No native binary is committed.

Database: `<KNOWGST_RUNTIME>/data/knowgst.sqlite`. WAL, `synchronous=FULL`, foreign keys and a busy timeout are enabled. A runtime writer lease prevents two application servers planning changes against the same workspace. This remains a local application, not multi-user SaaS or a network-filesystem deployment.

Schema version 1 contains:

- `records(path PRIMARY KEY, payload, updated_at)`: JSON-object constraints retain the existing document shape and calculation snapshots without a financial rewrite.
- `schema_migrations(version PRIMARY KEY, applied_at)`: completed migration checkpoint.
- `file_jobs(path PRIMARY KEY, content BLOB)`: durable PDF write/delete work committed with linked record changes.

The record store includes an accounting state per business: entries, audit events, stock movements and supplier payments. This is deliberately a compatibility migration, **not** a claim that every domain entity is already normalized into relational tables. Existing posted history is prefix-immutable through the storage adapter; it is not tamper-proof against an administrator editing SQLite directly.

## Migration and recovery

1. Recover any pre-existing JSON/PDF/restore journals before opening SQLite.
2. Validate legacy JSON objects and reject symbolic links before migration.
3. Preserve original records in a separate `pre-sqlite-<timestamp>-<uuid>` directory with per-record hashes. Original JSON files are not overwritten by ongoing database writes.
4. Import all managed collections and root JSON metadata in one SQLite transaction. Compare exact payload bytes and record counts, then mark schema version 1 complete. This preserves stored amounts and tax snapshots without recalculation.
5. Once migrated, SQLite is authoritative. Editing obsolete JSON files does not edit the books. Startup checks database integrity and refuses an unexpected engine version.

An interrupted database transaction rolls back through SQLite. An interrupted mixed record/PDF change recovers **forward**: records and durable file jobs commit together, and pending PDF operations are reapplied before further service requests. PDF files remain on disk. A filesystem failure after database commit may require repairing the path/permissions and retrying; the job is retained rather than silently losing the PDF operation.

Verified backups export a consistent portable JSON snapshot from SQLite plus saved/trash PDFs, not a live copy of a WAL database. Restore closes/checkpoints the connection, uses the existing staged restore journal, preserves local lock/location metadata, and migrates the restored snapshot into SQLite. Tests cover database rollback/process exit, mixed PDF recovery and complete journal/PDF restore.

For accounting history, use **complete verified backups**. Selective JSON merging is refused when it would replace posted books or omit their journal/payment history. JSON exports remain useful for inspection; do not mistake them for a complete PDF-inclusive backup.

## Business-wise inventory

New products and purchase stock carry a business ID. Catalog reads, product writes and stock-consuming invoice/purchase commands enforce ownership. Identical names can exist in different businesses without sharing quantities. The selected-business request header rejects stale browser context after a profile switch.

Legacy products remain unassigned. Products → Assign legacy stock requires a deliberate choice. The service checks linked invoice/purchase references (including old name-only lines) and refuses assignment when history belongs to another or unresolved business. It does not split mixed historical stock automatically. Existing sales/purchase records and totals remain intact.

Product opening quantities, assignments, adjustments and transactional stock deltas produce movement history. Referenced products cannot be deleted. This is quantity history, not FIFO/weighted-average costing, COGS, lots or warehouses. Earlier unexplained quantity drift still requires reconciliation.

## Journal and audit trail

Reports → Accounts & history:

- A fixed initial chart: cash/bank, receivables, inventory, input-tax pending review, payables, output tax, opening equity, sales, gross purchases and expenses.
- INR amounts are parsed into integer paise. Every line has a debit or credit, and total debits equal total credits. Unsupported currencies fail explicitly; other-currency invoice functionality remains unchanged.
- Manual posting uses a stable request ID. Replays return the original entry; reuse with changed input fails.
- Corrections use a linked reversal; posted entries cannot be edited through the application. Supplier-generated entries must be reversed through their payment source.
- Account balances are calculated from posted entries only, with drill-down lines. They are not the legacy P&L or a complete statutory financial statement.
- Audited record changes store action, record identity, before/after revision hashes, changed field names and time. Sensitive record bodies are not duplicated in the audit trail.
- Actor is `local-session`, not an authenticated employee identity. Profile/settings changes outside the tracked record collections, printing and external providers are not a complete security-event log. Restoring a backup restores its historical audit snapshot.

No automatic sales/expense posting, period lock, fully classified GST ledger or full financial statements are claimed in this increment. The existing financial helpers and P&L remain unchanged.

## Supplier payments

Purchases → Payments supports partial/full payment, outstanding balance, references, history and reversal. The first tracked payment posts the purchase's saved **gross amount** to Purchases (tax unclassified) / Supplier payables, then posts Payables / Cash-bank for the payment. This is explicit opening recognition; it does not automatically assert GST credit eligibility, allocate tax heads or calculate inventory valuation.

Payment, payable status, journal entries and audit history commit together. Stale purchase revisions, excess payments, duplicate requests, cross-business allocation and duplicate reversal are rejected. Tracked purchase amount, line items and supplier identity are locked; correcting accounting entries retain the original source. Payment-status dropdowns remain for legacy untracked bills; tracked balances derive from actual payments.

Legacy Paid/Partial bills with no payment history are blocked from new tracking until opening history is reconciled. This release does not invent historical payment amounts. One payment currently allocates to one purchase. Supplier advances, multi-bill allocation, due-date aging, bank-specific ledger accounts and purchase returns remain later work.

## Validation and limits

Regression suites cover the retained financial helpers and all existing document types. Added checks exercise migration parity, stale-JSON isolation, rollback/process interruption, immutable journal history, balancing, reversals, supplier payment atomicity, cross-business stock, portable backups and desktop/mobile UI flows. Full packaging, hosted authentication, broad accessibility/performance review and accountant acceptance remain separate release gates.
