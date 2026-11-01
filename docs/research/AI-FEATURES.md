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
