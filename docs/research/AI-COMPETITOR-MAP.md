# Accounting AI capability map and contextual UX proposal

Accessed **2 November 2026**. Scope: official Zoho Books documentation (India first), selected adjacent Zoho products, and QuickBooks Online/Intuit Intelligence US documentation. This is a dated capability map, not a guarantee of exhaustive coverage, universal availability, or equivalent financial correctness. Vendor documentation describes advertised behavior; no competitor tenant was exercised.

Updated for the v1 implementation on 2 November 2026. See [implemented workflows and precise limits](../AI-WORKFLOWS.md). Fifteen capability groups now have bounded implementations; eleven remain future work. This is not full Zoho or QuickBooks parity.

KNOWGST status below comes from the current source and `AI-FEATURES.md`, not from feature names alone. The research itself did not exercise competitor products. The new reviewed-invoice-draft implementation passed twelve unit tests and four browser scenarios with simulated provider replies; see [AI controls and verification boundaries](AI-GUARDRAILS.md). This is not complete competitor parity.

## Availability and product boundaries

- **Zoho Books India now has its own AI help page.** It documents feature enablement and provider/model preferences. Bank suggestions and AI custom fields are explicitly early access. Do not infer that every listed capability is enabled in every Indian organisation or plan. [Books India AI help][Z1]
- Zoho Books India pricing and Documents help distinguish scan allowances/add-ons from the underlying accounting plans. Neither inspected page establishes a complete per-plan entitlement matrix for every Zia feature. Confirm entitlement in a real tenant before promising parity with a named plan. [India plans][Z3], [Documents][Z2]
- **QuickBooks ceased Indian product access on 1 July 2023.** US QuickBooks is a UX/workflow reference, not an available Indian GST product or a source of Indian tax rules. [QuickBooks India notice][Q0]
- US Accounting AI is documented for Essentials, Plus, Advanced and Intuit Enterprise Suite; more advanced reconciliation/report review requires Plus, Advanced or Enterprise Suite. General bank suggestions have broader availability. [Accounting AI][Q2]
- Payments AI is explicitly US-only, for Essentials, Plus, Advanced and Enterprise Suite, and requires invoice editing permission. Finance AI is documented for Advanced and Enterprise Suite. These are separate capabilities, not one uniformly available assistant. [Payments AI][Q4], [Finance AI][Q6]
- General Intuit Intelligence includes plan-limited actions; payroll requires Workforce. Its common-tasks article says multi-entity management is unsupported, while Finance AI describes multi-company summaries. Treat those as different surfaces. [Common tasks][Q1], [Finance AI][Q6]
- Zia in **Zoho Analytics**, **Zoho Expense**, and **Zia Chat** must not be labelled as built-in Zoho Books functionality. Analytics has its own agents and plan gates; Expense covers employee expenses; Zia Chat is a separate cross-application offering with early-access licensing information. [Analytics][Z5], [Expense][Z6], [Zia Chat][Z7]

## Competitor capabilities confirmed in official documentation

Descriptions are intentionally narrow. “Documented” does not mean tested or automatically available.

| Product / surface | Documented capability | Source |
|---|---|---|
| Zoho Books | Ask Zia retrieves records and creates items/transactions, asking for missing details | [India AI help][Z1] |
| Zoho Books | CoCreate visibly fills sales documents; users can take control | [India AI help][Z1] |
| Zoho Books | Report charts, forecasts, anomaly views and narrative insights | [Books AI overview][Z4] |
| Zoho Books | Editable email generation; invoice overdue/payment-delay insights | [India AI help][Z1] |
| Zoho Books | Suggested bank category, party and account; early access | [India AI help][Z1] |
| Zoho Books | AI custom fields: keywords, sentiment and image interpretation; early access | [India AI help][Z1] |
| Zoho Books | Generated custom-module workflow blueprints; reviewed English speech input | [India AI help][Z1] |
| Zoho Books Documents | Upload/email intake, extraction, source/transaction comparison and suggested document matches | [Documents help][Z2] |
| Zoho Books | Prompt-based custom reports and MCP-connected actions are also described | [Books AI overview][Z4] |
| QuickBooks US Intelligence | Setup help, transaction actions, unusual-activity review and payroll assistance | [Common tasks][Q1] |
| QuickBooks US Banking | Category/payee suggestions, exact/partial/combined matches, explanations and review signals | [Bank suggestions][Q3] |
| QuickBooks US Accounting AI | Review grouped posting candidates; limited automatic matching/posting; requests for missing information | [Accounting AI][Q2] |
| QuickBooks US Accounting AI | Reconciliation issue explanations and report-level accounting investigations | [Accounting AI][Q2] |
| QuickBooks US Payments AI | Invoice autofill, editable emails, reminder schedules, payment-method and late-fee suggestions | [Payments AI][Q4] |
| QuickBooks US Bill Pay AI | Dedicated bill-email intake and extracted line-item drafts for review | [Bill Pay capture][Q12] |
| QuickBooks US setup | Conversational onboarding and expert support; release/plan conditions apply | [Fall 2026 update][Q13] |
| QuickBooks US Customer AI | Gmail/Outlook lead intake, prioritisation, response drafts and estimate autofill | [Customer AI][Q5] |
| QuickBooks US Finance AI | Financial summaries, comparisons, drill-down and editable exported narratives | [Finance AI][Q6] |
| QuickBooks US forecasting | Twelve-month projections and scenarios; budget conversion has a higher-plan gate | [Forecasting][Q7] |
| QuickBooks US Sales Tax AI | Suggested product tax categories and pre-file sales-report discrepancy review | [Sales Tax AI][Q8] |
| QuickBooks US Business Tax AI | Potential deduction recommendations; official launch material calls it beta | [Business Tax update][Q9] |
| QuickBooks US Project Management AI | Document-led project setup, estimates/budgets and variance explanations; some functions Enterprise Suite-only | [Project AI][Q10] |
| QuickBooks US Payroll AI | Employee-information collection and payroll assistance/automation | [AI overview][Q11] |
| Adjacent: Zoho Analytics | Natural-language analysis, queries/formulas, preparation, visualisation and presentations, with plan-specific agents | [Analytics help][Z5] |
| Adjacent: Zoho Expense | Receipt extraction, policy review and expense anomaly/fraud assistance | [Expense AI][Z6] |

Important distinctions: ordinary recurring invoices, bank rules, journal posting, low-stock thresholds and GST computation are deterministic accounting features even when presented alongside AI. They should not be rebuilt as model-generated decisions.

## KNOWGST gap map and per-capability guardrails

**Implemented** means a source-wired capability exists, with the stated boundary. **Partial** means related foundations exist but the broader capability does not. **Missing** means no corresponding workflow was found in the inspected active app. **In progress** is not a completion claim.

| Capability | KNOWGST status / evidence | Contextual UX and required guardrail |
|---|---|---|
| Ask about business records | **Implemented, bounded.** `ai-records.mjs`, `AiWorkspace.jsx`, `ai-chat-socket.mjs`: one module search per turn, up to five bounded records; short server-owned follow-up context | Keep source links and coverage beside the answer. Never infer business totals from a partial page. Scope to active business/account; reject changed records; no model SQL |
| Monthly / bookkeeping explanation | **Implemented, limited.** `ai-workspace.mjs` uses dashboard amounts and attention counts | “Explain this month” beside the existing report/summary. Show period, currency, calculation basis and source totals; distinguish missing data from zero |
| Natural-language invoice draft | **Implemented, bounded.** `ai-invoice-draft.mjs` and `AiInvoiceDraft.jsx`; new blank INR tax invoices with saved clients/products only | Preview shared candidates, consent, review, Apply, then Save. Saved prices/GST/cess and the existing calculator are authoritative. Partial manual entries, changed scope/catalog, duplicate application and unsafe amounts are blocked |
| Quotes, credit notes, purchases from prompts | **Missing as AI workflows.** Existing manual document types are not AI parity | Extend one validated proposal schema by document type. Credit links, signs, original references and stock effects need document-specific regression cases |
| Purchase-image extraction | **Implemented, bounded.** `ocr-extraction.mjs`, `BillOCR.jsx`, `ocr-purchase.mjs`; ChatGPT-only image path, local item matching, cess review | Retain source image beside editable extracted rows. Unreadable values remain unresolved; never invent tax rates. Duplicate bill detection and total reconciliation must precede save |
| Receipt-to-expense and document inbox | **Implemented for v1 image intake.** Persistent original/review queue, duplicate checks and reviewed receipt-to-expense/purchase handoff; no mailbox sync or PDF extraction | One Inbox with document status and source preview. Hash attachments, detect duplicate supplier/reference/date/amount, preserve originals, validate file type/size and isolate parsing. No auto-post |
| Expense category suggestion | **Implemented.** `ai-categorization.mjs`, `AiCategorySuggestions.jsx`, `ExpenseTracker.jsx` | Inline suggestion with reason and explicit Apply. Existing category allowlist only; category is not proof of deductibility or ITC eligibility |
| Selected bank narration categorisation | **Implemented narrowly.** `IncomeTax.jsx`: at most ten selected tax-import rows | Preserve original narration/amount/direction. Applying a suggestion edits the import draft only; show that this is not bank reconciliation |
| Bank party/account matching and learned rules | **Implemented for v1 classification.** Durable statement identities, reviewed known-party/account suggestions, explicit rules/history and conflict handling; no reconciliation or ledger posting | Explain matched evidence and ambiguity per row. Save corrections as explicit, business-local rules with history, disable/delete controls and conflict precedence |
| Bank reconciliation | **Missing.** Tax CSV import and GSTR-2B matching are different workflows | Build stable bank-transaction IDs, duplicate detection, statement balance checks and reversible allocations first. Match amounts/currency/direction deterministically; never create a second expense to force a match |
| Books anomaly / month-end review | **Implemented for v1 evidence checks.** Duplicate/missing-link/posting/balance candidates with source references, review notes and reopen-on-change; not a comprehensive audit engine | Add evidence-based findings to one review queue: duplicate candidates, stale receivables, missing links, suspense balances. Show source rows and resolution; never auto-reverse entries |
| Report drill-down explanations | **Implemented for posted-ledger reports.** P&L/balance-sheet contributions and period deltas with bounded evidence previews and optional narration; distinct from source-based Reports | “Explain movement” from a report row, with deterministic comparison/contribution queries and exact report filters. Model explains computed deltas rather than recomputing them |
| Forecasts, scenarios and budgets | **Missing.** Current totals are not forecasts | Add a tested forecast engine and data-quality gate before narrative AI. Show assumptions, history coverage and uncertainty; scenario edits never alter actual entries |
| Collection prioritisation | **Implemented for factual prioritization.** Age/outstanding/payment history with paid/cancelled/disputed/contact-hold exclusions; no likelihood predictions or automated outreach | Invoice register “Needs follow-up” view with factual age/outstanding/payment history. Avoid unsupported likelihood scores; exclude paid, cancelled, disputed or contact-suppressed items |
| Invoice / receipt email drafting | **Implemented.** `ai-email-draft.mjs`, `AiEmailDraft.jsx`, `EmailDocumentDialog.jsx` | Preview shared text; review/apply to the draft; separate Resend send action. Preserve sender/recipient checks and retry ID. No automatic sending or invented bank/payment details |
| Reminder schedules, late-fee/payment-method advice | **Missing as AI assistance.** Existing recurring documents and payment fields are not these capabilities | Draft schedule/policy proposals with per-customer controls. Do not change contractual fees or payment destinations without explicit confirmation; evaluate time zones and duplicate sends |
| Contact/item creation and catalog cleanup | **Implemented for reviewed drafts and aliases.** Grounded client/item fields open unsaved forms; duplicate candidates and reversible aliases preserve historical IDs; automatic merging remains excluded | Propose existing-record matches first. Explicit create/merge review; never overwrite GSTIN, price, stock or historical foreign keys. Keep an alias ledger and merge reversal strategy |
| Voice input | **Missing** | Optional dictation into the same prompt, editable before submission. Never treat transcription as approval; make recording state obvious and retain keyboard access |
| AI custom fields / workflow blueprints | **Missing** | Defer until schema/versioning and permissioned workflow execution exist. Generated expressions cannot execute arbitrary code, change policy or publish themselves |
| Natural-language report builder | **Missing** | Translate into a strict allowlisted report specification, not SQL. Preview dimensions, filters, accounting basis and currency before running |
| Supplier-payment assistance | **Implemented for payment planning.** Tracked outstanding bills, partial/reversed payments, explicit planning dates and budget allocation; no money movement or mailbox sync | Show due bills and deterministic balances before suggesting a payment plan. Recording a payment is distinct from transferring money; never change beneficiary details or execute transfers from model output |
| Guided onboarding / migration | **Implemented for master-data imports.** Client/product CSV mapping, validation/duplicate previews, verified pre-import backup, atomic create-only batches and guarded undo; no balance/history migration | Offer field mapping and setup suggestions with count/total previews, reversible import batches and a restorable backup. Never guess opening balances or import credentials |
| Client lead/CRM assistant | **Missing** | Later, separate opt-in mailbox connector with minimal scopes, selected-message preview and retention controls. Never infer consent to outreach from an extracted lead |
| GST / income-tax explanation | **Missing as contextual AI.** Existing tax calculators/returns and GSTR-2B reconciliation remain deterministic | Explain versioned validation results with rule/source/date references. No guessed HSN/SAC rates, legal eligibility, return certification, filing or payment |
| Payroll / project finance agents | **Missing** and dependent on new domains | Defer until employee/payroll or project/budget models and reconciliation are implemented. Indian payroll/tax requirements need separate verified rules; no imitation of US tax behavior |
| External AI/MCP write access | **Missing from inspected integration routes** | Defer write tools. Any future command must have typed inputs, scoped authority, preview, expiry, idempotency, audit provenance and existing transactional/reversal paths |

Source inspection covered `integration-routes.mjs`, `ai-records.mjs`, `ai-workspace.mjs`, `ai-categorization.mjs`, `ai-email-draft.mjs`, `ocr-extraction.mjs`, `resend-email.mjs`, `dashboard-summary.mjs`, `accounting.mjs`, `src/utils/ocr-purchase.mjs`, `AiWorkspace.jsx`, `AiCategorySuggestions.jsx`, `ExpenseTracker.jsx`, `IncomeTax.jsx`, `GSTReturns.jsx`, and the existing AI research notes. A table entry is not a claim that every edge case or production control has been independently certified.

## A seamless interface that fits the existing desktop app

The design proposal is **one consistent assistant pattern within the current pages**, keeping the KnowAI logo, typography, neutral palette, spacing and tables.

1. Put a quiet action where the work starts: **Describe invoice**, **Scan bill**, **Suggest category**, **Explain movement**, **Draft reminder**. The primary accounting action remains visible. Do not add a separate agent dashboard for each capability.
2. On desktop, open a contextual inspector beside the current form/table; keep the source and proposed change visible together. On narrow windows, use an accessible full-width sheet with a clear return action. A chat is useful for follow-up questions, not mandatory navigation.
3. Use the same result structure everywhere: **Suggested change → evidence → unresolved fields → Apply**. Highlight only changed fields with neutral emphasis. Provide Keep current, Edit and Discard. Copy-only explanations should never look like saved accounting entries.
4. Use clear states: Ready, Preparing, Needs review, Applied to draft, Saved. “Applied to draft” must not imply a posted journal, delivered message or filed return. Use factual progress from the service; no simulated token streaming or fake percentages.
5. Keep one compact data-sharing control: current business, connected account, selected records and “View shared data.” Remember harmless layout/model preferences; consent must still match the actual request and scope. Switching business, document, recipient or account invalidates stale results.
6. Consolidate actionable findings under the existing dashboard attention area and module filters. A finding opens its source record and explanation. It has a reason, detection time, resolution status and dismiss action; dismissing does not change financial data.
7. Give actionable inline errors while preserving the user's draft. A provider interruption permits an explicit retry; a financial write of unknown outcome first checks its command ID. No silent provider/account fallback. Manual entry remains available without AI.
8. Keep accessible keyboard flow, focus return, labelled controls, readable tables and 320–1440 px overflow checks in both themes. Do not replace uncertainty labels with colour alone or expose uncalibrated model confidence percentages.

These are KNOWGST design recommendations inferred from the documented contextual patterns, not screenshots or claims about exact competitor layouts. QuickBooks embeds invoice help in an invoice panel; its bank suggestions expose evidence within the row. Zoho CoCreate allows takeover during form filling. Adopt the review continuity while preserving KNOWGST's explicit save boundary. [Payments AI][Q4], [Bank suggestions][Q3], [Books India AI help][Z1]

## Safe implementation order

| Stage | Deliverable | Exit condition |
|---|---|---|
| 1 — current | Finish reviewed invoice drafts and standardise existing scan/category/email review controls | Source/user edits, ambiguous matches, money/tax invariants, cross-business/account changes, retry and cancellation tests; apply never saves or sends |
| 2 | Expense receipt extraction, document duplicate review, register-level collection drafts | Original document retained; visible unresolved fields; repeat import cannot duplicate a purchase/expense; email action remains explicit |
| 3 | Deterministic report drill-down and books review queue | Every finding links to records and a repeatable check; complete-versus-partial coverage visible; resolving uses existing transactions and audit/reversal |
| 4 | Durable banking/reconciliation foundation, then AI explanations and match suggestions | Statement integrity, duplicate protection, one/many-to-one allocations, partial payments and reversal tests; approved matches cannot double-post |
| 5 | Forecast/scenario engine and budget proposals | Sufficient history, reconciled inputs, deterministic baselines/backtesting and scenario separation; weak evidence produces “insufficient history” |
| 6 | Reviewed local learning, catalog cleanup, optional voice and constrained report builder | Inspectable rules, approved merges, strict report specification and explicit transcribed-prompt review |
| Separate expansion | Payroll, project costing, CRM/mail intake and published automation/MCP | Independent domain design, scope/credential review, audited command layer and country-specific rule validation |

Do not copy competitor auto-posting simply because a feature page advertises it. In KNOWGST, automatic journals/stock updates remain deterministic consequences of an explicit, validated financial command. AI may propose inputs; it must not bypass that command boundary.

## Shared technical acceptance contract

For each new proposal use a typed, server-owned envelope: proposal ID, business ID, feature kind, source IDs/revisions, draft fingerprint, model/account identity, creation/expiry time, allowed field changes, evidence references and unresolved fields. On Apply, recheck scope and fingerprints; on Save, re-run existing accounting/tax validators and command idempotency. Store minimal accepted-change provenance without raw prompts, credentials or unnecessary documents in logs.

Read tools need bounded filters, row/byte limits, currency/unit metadata and coverage. Write tools need an allowlisted domain command; there is no general SQL/file/network execution tool. Treat document text, imported narration, attachments and saved notes as untrusted data, including instructions that attempt to redirect the assistant.

Tests must include malformed output, invalid enum/IDs, fabricated amounts, mixed currencies, zero versus unreadable values, credits/returns, cess, duplicate uploads, concurrent source edits, account/business switching, cancelled and timed-out work, provider authentication/rate limits, and exact-once financial effects. Run live-provider checks with explicit fixture data; simulated replies only establish application behavior, not model accuracy.

## Official sources

All links below were accessed on **2026-11-02**. Plan and rollout statements may change; refer to the dated help page and an eligible tenant for purchase decisions. No promotional accuracy, time-saving or revenue-improvement percentage is adopted as an engineering requirement.

[Z1]: https://www.zoho.com/in/books/help/ai-features/ai-features.html
[Z2]: https://www.zoho.com/in/books/help/documents/documents.html
[Z3]: https://www.zoho.com/in/books/pricing/
[Z4]: https://www.zoho.com/us/books/accounting-software/ai-in-accounting/
[Z5]: https://www.zoho.com/analytics/help/zia/
[Z6]: https://www.zoho.com/us/expense/ai-expense-management-software/
[Z7]: https://www.zoho.com/ziachat/
[Q0]: https://quickbooks.intuit.com/in/
[Q1]: https://quickbooks.intuit.com/learn-support/en-us/help-article/intuit-ai/ask-intuit-intelligence-help-common-tasks/L0ZIVPyns_US_en_US
[Q2]: https://quickbooks.intuit.com/learn-support/en-us/help-article/bank-transactions/accounting-agent-features/L6pl9rv94_US_en_US
[Q3]: https://quickbooks.intuit.com/learn-support/en-us/help-article/bank-transactions/ai-suggestions-help-match-categorize-bank/L8FHOh4AD_US_en_US
[Q4]: https://quickbooks.intuit.com/learn-support/en-us/help-article/intuit-assist/get-started-payments-agent/L0FyKj9NL_US_en_US
[Q5]: https://quickbooks.intuit.com/learn-support/en-us/help-article/intuit-assist/get-started-customer-agent/L6KtREjm9_US_en_US
[Q6]: https://quickbooks.intuit.com/learn-support/en-us/help-article/intuit-assist/get-started-finance-agent/L0g3aJO6W_US_en_US
[Q7]: https://quickbooks.intuit.com/learn-support/en-us/help-article/tasks/forecast-financial-performance-intuit-intelligence/L7o5sk5t2_US_en_US
[Q8]: https://quickbooks.intuit.com/learn-support/en-us/help-article/sales-taxes/get-started-sales-tax-agent/L1TnR28W8_US_en_US
[Q9]: https://quickbooks.intuit.com/r/product-update/intuit-intelligence-ai-business-tax-2026/
[Q10]: https://quickbooks.intuit.com/learn-support/en-us/help-article/intuit-assist/get-started-project-management-agent/L40ChslX3_US_en_US
[Q11]: https://quickbooks.intuit.com/learn-support/en-us/help-article/accounting-bookkeeping/overview-agents-quickbooks-online/L9irCAtK4_US_en_US
[Q12]: https://quickbooks.intuit.com/r/payments/bill-pay-automation-cash-flow/
[Q13]: https://www.firmofthefuture.com/product-update/whats-new-quickbooks-fall-2026/
