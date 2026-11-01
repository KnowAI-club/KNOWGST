# Bookkeeping AI: research and first implementation

Reviewed 1 November 2026. This document distinguishes implemented features from future proposals.

## Evidence and product choices

| Official reference | Relevant pattern | KNOWGST decision |
|---|---|---|
| [QuickBooks Intuit Intelligence](https://quickbooks.intuit.com/learn-support/en-us/help-article/intuit-ai/ask-intuit-intelligence-help-common-tasks/L0ZIVPyns_US_en_US) | Natural-language financial questions, transaction assistance and review workflows; availability depends on plan and region | Begin with explanations of existing computed totals, then add reviewed drafts |
| [Zoho Books AI features](https://www.zoho.com/us/books/help/ai-features/ai-features.html) | Report insights, transaction drafting, email drafting and document extraction in its US documentation | Keep email drafts separate from sending; defer extraction until field-by-field validation is available |
| [OpenAI models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference) | Eligible user-authorized ChatGPT access through supported model discovery and Responses requests | Use the existing OAuth adapter and account model catalog, without a shared developer token |
| [OpenAI preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) | This OAuth flow has a narrower tool/API surface than standard API projects | Use text context. Do not depend on hosted Code Interpreter, file search or hosted MCP |

## Implemented first slice

- **Monthly review:** explain sales, recorded movements, all-date balances and review counts. These amounts come from the existing dashboard engine, in integer minor units.
- **Bookkeeping review:** explain counts requiring manual attention, including overdue invoices, unallocated receipts, low stock, untracked purchases and older-record reconciliation. It does not inspect every underlying entry or certify the books.
- **Payment reminder drafts:** produce reusable email and short-message templates with placeholders. No recipient identities or individual invoice data are sent; users fill and verify placeholders before using a draft. No automatic sending.

The Overview sidebar opens the AI assistant. Select a task, month, currency and available ChatGPT model. Preview the complete outbound user request, then explicitly consent to one generation. The OAuth adapter also supplies its fixed bookkeeping safety instructions. Outputs are plain text and can be copied; financial records remain unchanged.

## Architecture and privacy

`server.js` reads active-business records through the existing ownership rules and calls `dashboardSummary` and `previewBackfill`. `ai-workspace.mjs` allowlists aggregate fields. Customer names, invoice IDs, GSTIN/PAN, addresses, bank details, descriptions and credentials are excluded. The preview is held in server memory, expires in five minutes, and is consumed before inference so a failed request is not silently retried.

The server checks the business, selected account and summary fingerprint before and after inference. A stale or cross-business result is not returned. The UI also discards answers when its scope changes. A summary fingerprint is not a full-ledger revision: changes that leave the shared aggregate unchanged do not invalidate it. No raw ledger context is supplied, so this boundary is intentional.

The existing ChatGPT adapter validates account access and available models, uses `store:false`, parses streamed completion and rejects incomplete responses. No API-key fallback is used. Provider processing still occurs online; `store:false` is not a promise of zero provider retention. Credentials remain in the existing protected local integration store; this feature does not change its storage protections.

## Next, after review

1. Invoice and expense draft assistance with explicit field approval and deterministic recalculation.
2. Receipt extraction using supported image input, field confidence/review and duplicate detection; never automatically post extracted values.
3. Suggested expense categories backed by a business-specific chart of accounts and reversible review workflow.
4. Bank reconciliation suggestions only after bank import, statement integrity and deterministic matching are available.
5. Forecast explanations only after a tested forecasting engine, sufficient history and scenario assumptions exist.

Tax eligibility decisions, autonomous journal posting, automatic filing, uncontrolled SQL access and unattended collection emails are outside this slice.

## Validation boundary

Unit tests cover redaction, amount validation, one-use consent, expiry and account/business/summary changes. Browser tests cover real local summary data, cross-business rejection, consent, escaped output and 1440/800/390 px layouts. Provider responses are simulated in automated tests: successful live inference requires the user's eligible connected ChatGPT account. No email is sent and no installers are built.

## AI inside existing workflows — 1 November 2026 update

The product direction is contextual assistance in the current forms, tables and reports. The shared pattern is **capture → suggest → compare with source → approve → save through existing transaction APIs**. A standalone chat is optional, not the primary workflow.

Additional references reviewed:
- [QuickBooks Accounting AI](https://quickbooks.intuit.com/learn-support/en-us/help-article/bank-transactions/accounting-agent-features/L6pl9rv94_US_en_US): grouped transaction review, categorization, reconciliation explanations and report issue review. Availability varies by plan. KNOWGST should adopt visible review and source comparison before considering automation.
- [Zoho Books AI](https://www.zoho.com/us/books/help/ai-features/ai-features.html): document extraction, transaction drafts, report explanations and email assistance. This is US product documentation, not a claim of Indian feature availability.
- [OpenAI image input](https://developers.openai.com/api/docs/guides/images-vision) and [subscription-flow limits](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations): image understanding can use a supported model through this OAuth flow. Availability is account/model dependent; unsupported image requests must fail visibly, without switching to paid API credentials.

| Priority | Existing entry point | Proposed assistance | Required foundation / acceptance |
|---|---|---|---|
| Implemented in this change | Purchases → Import from image | ChatGPT image extraction; review extracted rows, product links and cess | Explicit image-sharing consent; validated model response; no auto-save; manual-entry fallback |
| Next | Expense form | Receipt-to-expense draft and category suggestion | Reuse extraction validator; approved category allowlist; duplicate checks; review before posting |
| Next | Income Tax → Bank CSV import | Explain narration and suggest uncertain categories | Preserve CSV parser and original row; suggest only valid categories; no implied bank reconciliation |
| Next | Invoice editor | Convert a plain-language request to an invoice draft | Resolve business/client/products locally, ask about ambiguity, use existing pricing/tax engine |
| Next | Invoice / receipt email dialog | Contextual payment or document email draft | Preview selected recipient data; edit draft; existing Resend confirmation and idempotency |
| Later | Reports | Explain movements with links to contributing records | Currency/business isolation; bounded source query; accurate period comparisons |
| Later | Banking / reconciliation | Propose matches and explain unmatched transactions | Persistent bank transaction IDs, opening/closing balance checks, duplicate prevention and reversible allocations; current tax CSV importer is insufficient |
| Later | Product catalog | Suggest aliases, duplicate candidates and reorder explanations | Explicit merge approval; preserve stock/history; deterministic reorder calculations |
| Later | GST workspace | Explain deterministic validation findings | Versioned GST rules and source references; no invented HSN rates, ITC eligibility or automatic filing |

Cross-cutting foundation before any AI write: schema-validated draft proposals, source references, business and record revisions, a visible before/after review, idempotent existing command execution, audit provenance and reversal. Model text never directly writes SQL or substitutes for money/tax calculations. Accepted category/alias corrections can later become explicit business-local rules rather than undisclosed model training.

Measure extraction field accuracy, correction rate, time to a reviewed draft, duplicate prevention, and transaction invariants. Do not display model-generated confidence percentages as calibrated accuracy. Test poor images, ambiguous item matches, unreadable rates, mixed GST, cess, credits, duplicate documents, interrupted requests, and account/business changes.

### OCR implementation details and limits

The user selected ChatGPT-only scanning; the offline OCR engine and bundled assets were removed. ChatGPT uses a maximum 3 MB PNG/JPEG/WebP inline image, shares no catalog, and requires consent for each request. Images are processed in memory, not stored by KNOWGST's extraction endpoint. The provider may process/retain inputs under its policies; `store:false` is not a zero-retention guarantee.

Extracted output is allowlisted and validated before display. Product matching stays local; ties are unlinked, product-name edits clear old links, and users can explicitly select or remove links. Reviewed IDs flow into the purchase stock transaction. Document tax rates are preserved instead of silently overwritten by catalog rates. Item cess is editable and preserved. A positive extracted cess total must reconcile to item cess before applying; fixed-amount cess is not converted to a guessed percentage. Unreadable item cess percentages must be filled from the source.

Form 16 parsing and Form 26AS reconciliation are future modules, not present capabilities. This release does not implement the rest of the roadmap above.


## Final implementation update: SDK and active-business access

Per the user's final direction, scanning is ChatGPT-only. Tesseract, language assets and preparation scripts have been removed. Manual purchase entry remains usable without AI. Automated desktop smoke coverage was updated to check the consent interface rather than claiming offline extraction; no installer was built or tested in this change.

Inference now uses the official `openai` JavaScript SDK (locked to 7.47.0 in the dependency lockfile). The server supplies the user's OAuth access token, uses `store:false` / `stream:true`, disables automatic retries, keeps the 90-second cancellation deadline, checks completion and output size, and translates provider/network errors into actionable messages without exposing credentials. OAuth registration, refresh and model catalog discovery retain their existing protocol implementation. [Official SDK documentation](https://developers.openai.com/api/reference/typescript)

The AI assistant now has a separate, explicitly approved **Ask about your business records** action. It uses a bounded two-request flow: propose a read-only search, validate the module/query, read active-business data locally, then answer from the returned records. Supported modules: invoices, clients, products, purchases, expenses, receipts, recurring schedules, journals, audit, stock movements, supplier payments and business profile. No arbitrary SQL or filesystem paths are accepted. Credentials and document binaries are filtered out. Records can include party names, addresses, GSTIN and financial details; this is distinct from aggregate-only summaries and is disclosed in the UI.

Each question reads one module and up to five matches within a bounded context. Sources and coverage are returned separately from model prose. Narrow searches or a known record ID can reach any record in these modules; this is not an exhaustive full-ledger analysis, attachment search or cross-module reconciliation agent. Large records, deep fields and lengthy arrays are bounded. The server rechecks business/account scope and the returned source fingerprint before showing the answer. No financial writes are performed. Broader retrieval, cross-module plans and reviewed write proposals remain roadmap work.
