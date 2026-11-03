# KnowGST changelog

## [1.0.3] - 2026-11-03

### Product branding
- Consistent KnowGST name and approved symbol across the app, desktop menus, onboarding and guide.
- Updated guide screenshots show the implemented app with fictional demonstration records.
- Existing business records, workspace folders and integration credentials stay in place during the branding update.
- New ChatGPT connections use the KnowGST name hint. Existing registrations are preserved; OpenAI controls its hosted sign-in icon.

### Desktop identity
- Preserve the existing application ID and KNOWGST data folder on Mac and Windows.
- Use KnowGST.app on Mac and KnowGST shortcuts on Windows while retaining the Windows executable filename.
- Verify workspace preservation and isolated test-directory overrides with regression checks.

## Earlier development history — SQLite and initial accounting

- Active storage migrated to SQLite 3.54.1 with verified legacy import and portable backup/restore.
- Added balanced INR journals, reversals, account balances and local-session audit history under Reports.
- Added business-owned inventory, explicit legacy assignment and quantity movement history.
- Added partial supplier payments, overpayment protection and payment reversal history.
- Existing invoice calculations, UI and KnowAI branding remain unchanged. Accounting scope and migration details: docs/SQLITE-ACCOUNTING.md.

# Compatibility preview history

## [0.1.0] - 2026-10-29

**Local compatibility preview with the KnowAI identity.**

### Added
- Illustrated user guide with real app screenshots.
- Complete data and PDF backup/restore with integrity verification.
- Signature and stamp layout controls.
- Purchase tax-head display and export.

### Fixed
- Invoice editor and Dashboard saves commit stock and linked payment receipts together.
- Client-credit source updates, invoice renumbering and document conversion commit together.
- Stale invoice/payment windows cannot overwrite a newer revision through migrated saves.
- Invoice editing preserves current payments without restoring deleted or outdated entries.
- CSV date-order warnings and rejection of month-first or mixed date formats.
- Stock updates for documents saved before an interrupted CSV import.
- Keyboard navigation in invoice action menus.
- Saved-client phone lookup and PDF download for desktop WhatsApp drafts.
- Import validation, transactional writes and recovery after interruption.
- Corrupt records no longer silently disappear or reset counters.
- Secondary backup ownership prevents one installation replacing another's copies.

### Known limitations
- Local compatibility preview; hosted access and signed macOS packaging are not ready.
- External delivery, government submission and exhaustive tax compliance are not certified.
- Standalone receipt, purchase/CSV, recurring, deletion/restore and PDF workflows still require transaction migration; network-drive backups need further hardening.

### Automatic sales and expense accounting
- Post saved INR sales, credit notes, invoice-linked collections/refunds and gross paid expenses atomically with their source records.
- Preserve source history with linked reversals on corrections, cancellations, deletion and restoration; guard duplicate saves and stale expense edits.
- Keep the current interface and KnowAI branding. Historical backfill, standalone receipt accounting, FX and period closing remain outside this increment.

### Standalone receipts and historical backfill
- Post standalone INR receipts to unallocated customer receipts, with atomic link/unlink and reversal handling that avoids duplicate cash.
- Add a reviewed historical backfill with source-history exclusion, stale-preview rejection, replay protection, explicit manual-journal review and source/PDF preservation.
- Preserve existing navigation, spacing and KnowAI branding; extend the Accounts & history tabs.
