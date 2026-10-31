> Implementation follow-up: [SQLite migration, journal, business inventory and supplier payments](SQLITE-ACCOUNTING.md). This review remains the baseline assessment before that increment.

# KNOWGST product and module review

Reviewed 30 October 2026 against the local working tree based on `6d9824e`, including the transaction-hardening increment accompanying this document. This is a source-led product review, not a statutory audit or a claim that every input combination has been tested.

## Recommendation

Keep the current minimal interface and KnowAI branding. Finish reliability and parity first, then turn the billing application into dependable bookkeeping through stable business identities, a journal, supplier payments and bank reconciliation. Add AI after these foundations; it should explain verified figures and propose changes for review.

The most useful next visible feature is a **supplier payments and outstanding workspace**. The most important underlying change is a **business-scoped accounting and stock ledger**. Avoid adding many new sidebar sections: use detail panels, contextual actions and tabs within the existing modules.

## What code actually runs

- `pnpm dev` starts `apps/parity`: React screens, `src/store.js` HTTP adapter and `server.js` local Express service. This is the broad Free GST feature implementation with KNOWGST UI and hardening.
- Records live in JSON collections, not PostgreSQL. Recoverable transaction planners now coordinate selected linked writes. Verified backups include application records and saved/trash PDFs.
- `apps/api`, `apps/web` and `packages/domain` form a separate, narrow SQLite/TypeScript prototype. Its audit table, idempotency table and decimal calculations do **not** power the current compatibility screens. Do not present these as current product controls.
- The local `packages/ai` folder defines connection policy types/checks. It is not a running AI integration and is untracked in this checkout. No working Resend delivery, WhatsApp Business messaging service, hosted user system or signed macOS application was found in the active runtime.
- The upstream comparison checks 66 source files and 48 explicit route declarations against the recorded current-main snapshot. This detects missing surfaces, not end-to-end equivalence. Retained upstream code and GPL attribution remain explicit.

## Module-by-module assessment

Source paths below are relative to `apps/parity/` unless stated otherwise.

| Module | Existing implementation | Next useful improvement and boundary |
| --- | --- | --- |
| Onboarding / business profiles | `SetupWizard.jsx`, profile APIs, business switcher, module visibility | Stable `businessId`, opening balances and import readiness checklist. Wizard completion is not proof the books are correctly initialized. |
| Dashboard / navigation | Invoice lists, filters, actions, overdue/stock/filing notifications; command palette in `App.jsx` | Saved filters, consistent entity search, actionable daily work queue. Command search already exists; extend it rather than build another palette. |
| Invoice creation | `InvoiceGenerator.jsx`, shared calculation helpers; seven document types, discounts, inclusive/exclusive tax, GST/UTGST/cess, TDS/TCS/RCM, round-off, conversion, credit application | Separate draft/issued lifecycle, linked amendments and approval/period controls. Preserve calculation fixtures; do not replace this with the narrower prototype calculator. |
| Preview / PDF / printing | `InvoicePreview.jsx`, print settings, signatures, paper/copy options, saved PDF routes | Immutable issued-document versions and PDF generation status/retry. Initial PDF creation and cancellation stamping are still separate from the financial save. |
| Clients | `ClientsView.jsx`, statements, aging, outstanding and overpayment-credit helpers | Stable party IDs in every document, contact history, credit limits and collection follow-ups. Existing grouping by name can conflate two clients with the same name. |
| Products / inventory | `InventoryView.jsx`, products API, stock alerts, bulk edit and historical closing-stock report | Business-scoped stock movements, reasoned adjustments, physical counts and valuation policy. Inventory currently loads the shared catalog; multi-profile switching is not stock isolation. |
| Purchases | `PurchaseBills.jsx`, purchase tax calculation, supplier history, OCR entry, CSV import | Supplier master, partial payments, advances, due dates, payable aging and statement reconciliation. The current payment-status dropdown is not a supplier payment ledger. |
| Expenses | `ExpenseTracker.jsx`, categories, GST fields, business/currency filtering and exports | Receipt attachments, duplicate detection, reimbursement status and approval. Plain expense CRUD still lacks universal revision and posting controls. |
| Receipts / payments | `ReceiptVoucher.jsx`, invoice payments, printable receipts, credit transfers | Many-to-many allocations, unallocated customer advances and refunds. Current standalone receipt allocation targets one invoice. Do not treat credit transfers as new cash receipts. |
| Recurring invoices | `RecurringInvoices.jsx`, server scheduler, pause, date/count endings, month-end anchors | Run history, failure queue, preview next occurrence and retry controls. Generation occurs while the local server runs; it is not an always-on hosted scheduler or automatic delivery. |
| Reports | `ReportsView.jsx`, client/product summaries, aging, party outstanding, stock, CSV/XLSX | Proper COGS, trial balance, balance sheet and cash flow after journal/valuation foundations. Current P&L is sales excluding tax minus expenses excluding GST; it is not complete inventory accounting. |
| GST workspace | `GSTReturns.jsx`, GSTR-1/3B exports, GSTR-2B reconciliation, HSN/TDS/TCS/e-way-bill helpers | Filing-period checklist, mismatch resolution history, immutable export snapshots and schema validation. Existing reconciliation is valuable; direct filing/portal acceptance is not established. |
| Income tax | `IncomeTax.jsx`, historical filing inputs, separate current-year estimator, bank CSV parsing/categorization | Versioned tax-year workspaces with documented scope and accountant handoff. Bank CSV categorization here is not bank-to-books reconciliation. See dated `TAX-RULE-REVIEW.md`; this review did not re-verify tax law. |
| Settings | Profiles, numbering, payment accounts, print/signature preferences, local lock, import/export and trash | Explicit data ownership, business-specific preferences where appropriate, change history and migration checks. Payment accounts printed on an invoice are not bank ledger accounts. |
| Backups / control panel | Verified snapshots, checksums, JSON/PDF recovery, secondary-folder ownership and folder actions | Scheduled restore verification, encrypted off-device backup, retention policy and visible recovery status. Local file transactions assume one server process per runtime. |
| Sharing / Drive / OCR | WhatsApp/email draft links, Drive OAuth/upload client, bundled Tesseract | Delivery outbox with authorization, retry and status tracking; document evidence inbox. Draft links are not sent/delivered messages. Provider tests do not prove live authorization or delivery. |
| Help / About | Local guide, implemented-app screenshots, contextual help, KNOWGST release notes | Task-oriented troubleshooting and release-specific help. Keep screenshots tied to actual application builds. |
| UI / accessibility | Shared headers/spacing, mobile navigation, themes, KnowAI logo, route/dialog layout tests | Audit keyboard access, form error association, screen readers and contrast systematically. Layout tests do not constitute full accessibility certification. |

## Findings to resolve before expanding scope

1. **Incomplete accounting model.** `ReportsView.jsx` computes `netProfit = revenueExTax - expenseExGST`; it does not consume purchases or cost layers for COGS. The stock report values quantities using product price data (`utils/products.js`), not an immutable valuation ledger. Clearly describe the present report's scope, then add accounting-backed reporting without silently changing historical totals.
2. **Business and party identity.** Bills snapshot a profile, expenses/purchases use owner fields, and client credit/grouping uses names. Products are globally listed. Introduce stable business/party IDs, retain historical snapshots and provide an explicit legacy-assignment review. Never guess ownership of unassigned history.
3. **Mixed write paths.** New transaction services improve selected workflows, but raw `/api/bills` writes and ordinary product/expense/profile CRUD still exist. Direct catalog stock edits can overwrite quantities without an adjustment history. Migrate all financial commands and enforce revisions at the boundary.
4. **Issued records are editable.** Revision hashes prevent some stale writes; they do not explain who changed what, when, or why. There is no active append-only accounting journal, complete audit history or financial-period lock.
5. **Local storage and access boundaries.** JSON journaling is process-crash protection, not multi-process/database durability. Local session protection and the UI PIN are not hosted user authentication or tenant isolation. Do not expose this local architecture as a multi-user SaaS without that work.
6. **Document and integration follow-ups.** Financial save, first PDF generation, stamping and provider delivery are not one distributed transaction. Add durable job states and retries rather than promising one atomic operation across filesystem and external providers.
7. **Operational maturity.** CI checks types, retained helpers, source surfaces, unit/service tests, builds and browser flows. Signed packaging, release rollback, large-data performance, real provider acceptance and broad accessibility checks remain separate release gates.

## Prioritized feature proposal

These are recommendations, not implemented features or an approved expansion of parity scope. Size is relative engineering scope, not a delivery promise.

| Order | Feature | Value | Minimum usable scope | Dependencies / size |
| --- | --- | --- | --- | --- |
| 0 | Data integrity centre | Makes existing books trustworthy | Detect duplicate party identities, missing references, payment mismatches, stock drift and failed jobs; review before repair | Complete current transaction migration; medium |
| 1 | Accounting journal, audit trail and period close | Makes reports explainable and prevents silent historical edits | Chart of accounts, balanced postings, opening balances, reversals, document links, before/after history, close/reopen with reason | Business IDs, money/date policy, migration reconciliation; large |
| 2 | Supplier payments and payable aging | Answers “who do I owe, how much, and when?” | Vendor records, due dates, partial payments, allocations, advances, outstanding statement | Journal/payment core; medium |
| 3 | Bank reconciliation | Removes daily matching work and finds missing entries | CSV staging with duplicate detection, one/many matches, fees/transfers, unmatched queue, opening/closing balance checks | Bank accounts plus journal and allocation model; large |
| 4 | Inventory movement ledger | Explains every stock change | Purchase/sale/return movements, counted-stock adjustments with reasons, as-of balances, reconciliation, explicit valuation policy | Business-scoped products and posted documents; large |
| 5 | Purchase orders and goods receipt | Separates ordering, receiving and supplier billing | PO → partial goods receipt → bill matching, pending quantities, returns | Supplier and stock ledgers; large; optional for service businesses |
| 6 | Evidence inbox | Keeps source documents attached to the books | Upload image/PDF, hash-based duplicate hints, OCR draft, source link, human confirmation, attachment backup | Attachment storage and restore coverage; medium |
| 7 | Accountant review and tax-period pack | Reduces filing preparation and corrections | Exception queue, notes, reconciled period snapshot, export manifest, lock after review | Stable IDs, audit and period controls; medium |
| 8 | Collection and delivery centre | Tracks invoice communication and overdue follow-up | Authorized email/WhatsApp sending, queue/retry, delivery events, opt-out handling, reminder approval | Provider setup, secrets, outbox and webhook verification; medium/large |
| 9 | AI review assistant | Saves reading and categorization time | Explain filtered report with linked source records; propose expense categories; flag duplicates/unusual changes | Trusted ledger/read models, permissions, evaluation fixtures; medium |
| 10 | Cash-flow planner | Helps owners plan tax and supplier payments | Forecast receivables/payables, scheduled costs, scenarios and confidence labels | Reliable due dates and allocation data; medium |

### Suggested first new product slice

After parity gates pass, start supplier payments with a narrowly scoped journal foundation. The flow should be: open a purchase → record a partial payment → show the remaining balance → inspect the supplier statement. The amount, allocation, payable balance and journal posting must commit together. Test duplicate submissions, stale edits, reversal, cross-business rejection and restore. Keep it inside Purchases using a supplier detail panel; retain current table spacing and branding.

### Proposed data-model additions

These are target entities, not the current schema:

- `Business`, `Party`, `PartyContact`: stable IDs; a party can be customer, supplier or both. Snapshot legal details on issued documents.
- `Account`, `JournalEntry`, `JournalLine`, `AccountingPeriod`: balanced postings in a declared functional currency, effective date, source-document ID and reversal links. Posted lines are immutable.
- `Payment`, `PaymentAllocation`: direction, account, currency, amount, external reference; one payment can settle several documents and one document can receive several payments. Unallocated balances remain explicit.
- `StockMovement`, `StockAdjustment`, `StockCount`, `InventoryValuation`: product and business IDs, signed quantity, source, unit, cost basis and reason. Locations/lots/serial numbers can follow later.
- `BankAccount`, `BankImport`, `BankTransaction`, `ReconciliationMatch`: source fingerprint, original row, normalized values, matching status and reconciliation period. Imported rows are not automatically posted.
- `Attachment`, `ExtractionDraft`: content hash, media type, storage key, linked record, extraction provenance and reviewed fields.
- `TaxPeriod`, `TaxRuleVersion`, `ReturnSnapshot`: frozen source set, rule/scheme version, export checksum, unresolved exceptions and review state. No implied government filing acceptance.
- `Job`, `OutboxMessage`, `DeliveryEvent`: durable attempt/state history, idempotency key, next attempt and sanitized error.
- `AuditEvent`: actor/session, business, command, entity, before/after revisions, reason and timestamp. Do not log secrets or unnecessarily duplicate sensitive attachments.

Apply tenant/business scope and referential integrity to every entity. Choose an explicit decimal/minor-unit policy with currency precision and separate quantity precision. Preserve original amounts and calculation versions during migration. The prototype's INR-only calculator is not a replacement for all existing financial behavior.

## Architecture and migration order

1. Finish parity and transaction coverage in the current app. Keep regression fixtures for all document types, discounts, tax heads, stock and client-credit scenarios.
2. Introduce stable IDs and command/query boundaries behind `store.js`, retaining the current UI. Add a versioned migration manifest and reconciliation report before switching storage.
3. For local/macOS use, extend the SQLite approach only after complete compatibility fixtures and rollback drills pass. For a future hosted edition, self-hosted PostgreSQL remains an option; Neon is not required. Keep adapter behavior consistent and defer synchronization complexity.
4. Add journal/payment/stock modules incrementally. For migration rehearsal, compare derived totals against the old records without making two stores independently authoritative.
5. Ship supplier payments, then reconciliation and evidence review. Add role-based collaboration only with hosted identity, authorization and tenant isolation.
6. Build AI over permission-checked read models and draft commands. Calculations remain deterministic. AI output must cite record IDs and disclose incomplete periods/data. Posting, payment, filing and deletion require deliberate user action. An AI connection-policy file is not evidence that subscription-based provider authorization works.

## Features to defer

Payroll, manufacturing/BOM, full CRM, multi-warehouse logistics, live bank feeds, automatic GST filing, autonomous AI posting and cross-device offline synchronization. These add substantial policy and reconciliation work and should not delay dependable billing and bookkeeping. Batch/serial tracking is useful for certain businesses, but should be an optional inventory extension after the movement ledger.

## Review boundaries

Reviewed the active module composition and persistence adapter, explicit server routes, transaction/backup services, calculation/report/credit/stock helpers, integration clients, prototype store/domain, test suites and CI definition. Module presence and retained source do not prove every workflow or external service. This review does not re-certify current tax rules, validate every historical dataset, or test a signed macOS release. See `FEATURE-PARITY.md`, `PRODUCTION-GAP-REVIEW.md`, `PARITY-VERIFICATION.md` and the test logs for the narrower evidence boundaries.
