# AI workflows in v1

KNOWGST uses a single assistant workspace with contextual draft actions in the existing forms. Connect your own eligible ChatGPT account under **Settings → Integrations**. Choose an available model in **AI assistant**. Local review, mappings and saved rules remain usable without connecting a model; scans and generated explanations need online access.

All data queries are scoped to the active business. AI cannot execute SQL, post journals, make bank transfers, file returns or send email. Source or account changes invalidate stale proposals. “Applied to draft” is different from “Saved”.

## Chat and contextual drafts

- **Chat:** WebSocket conversation with source references. Each turn retrieves at most five records from one allowed module. Recent questions resolve follow-ups; records are read again. Credentials, attachments and other businesses are excluded from record chat. The document inbox has a separate explicit image-sharing flow.
- **Describe an invoice:** For a blank INR tax invoice, describe saved clients/items and quantities. Preview candidate data, generate and review the draft, then apply. Saved catalog data supplies prices, GST and cess. The normal invoice Save action remains separate.
- **Suggest a category:** Review suggestions for an expense draft or up to ten selected tax CSV rows. Categories are not tax-deductibility or input-credit decisions.
- **Draft email:** Generate subject/body text inside the invoice or receipt email dialog. The recipient and attachment stay outside that drafting request. Apply the text, review the complete message, then separately Send through Resend.

## Document inbox

1. Upload a PNG, JPEG or WebP image saved on your computer, including an attachment you downloaded from email. Originals remain in this business's local inbox.
2. Choose the image and approve sending it to the selected ChatGPT model. Review extracted fields beside the original.
3. Correct unreadable or inconsistent fields. Review supplier, reference, date, total, GST and line-item/cess values. Duplicates are flagged before draft creation.
4. Open an unsaved expense or purchase draft. Verify its payment state and product links, then use the existing Save action.

Limits: 3 MB per image, 30 documents and 8 MB total originals per business. Same-image hashes are blocked; supplier/reference duplicates are checked against saved expenses and purchases. Receipt expenses preserve a reviewed manual GST amount; cess-bearing receipts use purchases so their fields are not discarded. Purchase draft totals and tax must reconcile with the source.

Full verified backups include originals and reviews. Removing a document removes its local inbox copy, not a saved financial record. PDF extraction, mailbox synchronization and automatic posting are not provided in v1.

## Bank matching

Import a statement CSV into a local **classification workspace**. Review the account label, dates, descriptions, directions, currency and debit/credit totals. Exact statement hashes and possible duplicate rows are identified; explicitly choose duplicate handling.

Select rows to preview AI classification context. Suggestions may reference existing business parties and chart-of-account codes; review them before saving classifications. Alternatively, create an explicit description/direction/currency rule and confirm its application. Overlapping rules block automatic selection and require review. Rule changes have local history. Export reviewed CSV or remove an unneeded statement review.

Limits: 500 rows per statement, 40 statements/5,000 rows per business, 10 rows per AI request and 100 rules. This does not create ledger entries, import bank balances, prove reconciliation or initiate transfers. Existing Income Tax CSV categorization is a separate workflow.

## Catalog review

Review normalized same-name duplicate candidates without merging or deleting history. Confirm alternate names for existing clients/items; ambiguous, conflicting or stale aliases are not used. The document inbox can use valid product aliases when matching extracted items.

Describe a new client or product, preview the text being shared, then review generated fields. Identity and descriptive fields must be grounded in the supplied text. The model cannot invent HSN, rates, GST, cess, opening stock or payment details. Potential duplicates require separate acknowledgement. Open the normal unsaved client/product form, complete required fields and Save separately.

Aliases can be removed. v1 does not rewrite historical foreign keys or automatically merge stock and customer records.

## Books and payments

Choose **Books & payments** in the assistant, then a review type, period, currency and review date. Calculations run locally. Optional ChatGPT explanations use an explicitly previewed subset of evidence.

| Review | What it shows | Boundary |
| --- | --- | --- |
| Book review | Evidence-based duplicate candidates, missing links/postings, paid-status inconsistencies and unallocated receipt-account balances; source references; review notes and reopen controls | Candidates require human review. Marking reviewed changes only review state. Changed evidence reopens findings; no automatic reversal |
| Reports | Posted-ledger P&L, balance-sheet account contributions, prior-month movements and source entries | Stated ledger basis, currency and period; gross expense convention. This is distinct from the existing source-based Reports page and is not a complete accounting certification |
| Collections | Current outstanding balances, overdue age and recorded payment history; factual ordering; explicit disputed/do-not-contact holds | Paid/cancelled/suppressed records excluded. No predicted probability, changed payment terms or automatic reminders |
| Supplier plan | Tracked due-bill balances, partial payments and optional budget allocation; explicit planning dates when actual due dates are absent | Saved source values remain unchanged. Planning dates are labelled, and a plan does not record payment or move money |

## Import assistant

The guided importer is deterministic local software; sending a CSV to a model is unnecessary.

1. Select clients or products and upload a CSV (up to 250 KB / 300 data rows).
2. Review and map columns. Inspect ready, skipped duplicate and erroneous rows. Opening stock and balances are zero; they are not inferred.
3. Confirm the reviewed create-only import. A complete verified backup is created before an atomic batch writes records and its audit/import history.
4. Repeating the same successful batch does not create duplicates. Use **Undo import** only while records are unchanged and unreferenced. Edits, linked documents, stock history or aliases block unsafe removal.

The pre-import snapshot is available in Control Panel. Historical transactions, opening balances and replacing existing records are outside this importer. Use the appropriate established workflows for those tasks.

## Verification and limits

Automated tests use fictional records and simulated provider responses to check malformed output, business/account/source changes, duplicates, revisions, financial boundaries, import rollback and restore. Live ChatGPT model availability and Resend delivery depend on the user's account and network; simulated tests do not establish provider entitlement or delivery.

The [competitor research map](research/AI-COMPETITOR-MAP.md) distinguishes these bounded implementations from future capabilities. Bank reconciliation, forecasts/budgets, voice, autonomous reminders, AI workflow execution, payroll agents, contextual legal/tax advice and external AI write tools are not part of v1.
