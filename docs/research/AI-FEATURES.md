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

The Overview sidebar opens the chat assistant. For aggregate reviews, open Reviews & drafts, then select a task, month, currency and available ChatGPT model. Preview the complete outbound user request, then explicitly consent to one generation. The OAuth adapter also supplies its fixed bookkeeping safety instructions. Outputs are plain text and can be copied; financial records remain unchanged.

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
| Implemented | Expense form | Category suggestions for the current draft | Approved category allowlist; selected-context consent; explicit apply; separate save. Receipt-to-expense extraction remains future work |
| Implemented | Income Tax → Bank CSV import | Explain narration and suggest categories for up to ten selected rows | Preserve parser and original row; valid categories only; review/apply each row; no implied bank reconciliation |
| Next | Invoice editor | Convert a plain-language request to an invoice draft | Resolve business/client/products locally, ask about ambiguity, use existing pricing/tax engine |
| Implemented | Invoice / receipt email dialog | Contextual payment or document email draft | Preview selected text, excluding recipient and PDF; review/apply; existing Resend send confirmation and idempotency |
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

The AI assistant now uses a chat interface with explicitly approved active-business record access. It uses a bounded two-request flow: propose a read-only search, validate the module/query, read active-business data locally, then answer from the returned records. Supported modules: invoices, clients, products, purchases, expenses, receipts, recurring schedules, journals, audit, stock movements, supplier payments and business profile. No arbitrary SQL or filesystem paths are accepted. Credentials and document binaries are filtered out. Records can include party names, addresses, GSTIN and financial details; this is distinct from aggregate-only summaries and is disclosed in the UI.

Each question reads one module and up to five matches within a bounded context. Sources and coverage are returned separately from model prose. Narrow searches or a known record ID can reach any record in these modules; this is not an exhaustive full-ledger analysis, attachment search or cross-module reconciliation agent. Large records, deep fields and lengthy arrays are bounded. The server rechecks business/account scope and the returned source fingerprint before showing the answer. No financial writes are performed. Broader retrieval, cross-module plans and reviewed write proposals remain roadmap work.


## Chat and contextual drafts — 1 November 2026

The browser-to-local-service chat transport uses WebSockets at `/api/ai/chat`. This does not change OpenAI inference into a Realtime API session: the official SDK continues streaming Responses internally, while the local socket sends real request phases and the completed, validated answer. A fresh socket per question prevents automatic replay. Connection failures preserve the typed question for manual retry. New chat, model changes, business changes and navigation discard pending UI results.

The socket requires the app session secret and loopback Host/Origin checks. The dev proxy and desktop gateway enforce their exact app origin before adding/forwarding the secret. Payloads are limited to 8 KB; malformed, concurrent and duplicate requests are rejected. Heartbeats close abandoned sockets. Secrets never appear in browser URLs or JavaScript.

Follow-ups use a server-owned conversation ID, bound to the active business and ChatGPT account. Context expires after 30 minutes, with a bounded conversation cache and at most three recent questions (2,000 serialized characters) plus source IDs. Old answers and financial values are not used as current evidence: every turn searches again and verifies record fingerprints before returning an answer. No client-supplied transcript is trusted.

Expense and selected bank-row category suggestions use the existing category allowlists. Descriptions, amounts, currencies, direction and current categories are previewed before sharing. Model output is validated, unknown categories are rejected, and apply changes only the local draft. Editing a source row or switching business/account invalidates stale suggestions. These suggestions do not determine tax deductibility or GST credit eligibility.

Invoice/receipt email drafting sends only the shown reference, sender name, purpose, subject and message. Recipient addresses and PDF bytes are excluded. Suggestions are validated plain text, require explicit apply, and can be edited before the existing separate Resend send action. Changed document, recipient, draft or account invalidates a pending suggestion. Automated tests never send real email.

Remaining roadmap: natural-language invoice drafts, expense receipt extraction, deterministic bank reconciliation, forecasting, catalog cleanup, and GST validation explanations. They are not represented as completed by the chat or category features.

### Verification of this implementation

On 1 November 2026, all 142 local service unit/integration tests passed, along with the domain/API/web workspace tests, source/type checks and the web production build. The full browser run passed 139 checks with two existing-page timeouts during an interrupted session; both passed in a clean targeted rerun (16 passed, one optional guide-capture test skipped), covering 141 distinct browser checks overall. The new chat, category and email flows passed with simulated provider replies, including invalid socket messages, stale replies, keyboard composition, consent, draft-only apply and account/context changes. Real socket tests also exercised the desktop gateway without launching an installer.

Desktop and 390 px dark chat screenshots were inspected; the guide uses the implemented interface with clearly fictional, simulated content. Dev health and same-origin WebSocket validation were checked at port 4184; forged remote and different-local-port origins were rejected. No live ChatGPT or Resend account was connected in the checked runtime, so live provider inference/email delivery are not claimed. No installer or desktop binary was built.


On 2 November, a fresh user-authorized ChatGPT sign-in succeeded and the official SDK completed a live READY-only request using an available model. No business context was included in that test. Sign-in recovery now preserves an unverified public registration ID separately from active credentials, and reports safe stage-specific errors; 13 OAuth/email tests cover this recovery, PKCE, identity checks and redaction. The original generic 400 did not retain enough detail to establish its precise provider cause. Mobile chat now uses natural page flow; all four chat browser tests pass with internal width/text-boundary checks at 320, 390, 480, 800 and 1440 pixels in both themes. Real email delivery remains untested.
