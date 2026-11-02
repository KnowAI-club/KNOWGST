# AI controls and verification boundaries

Updated 2 November 2026. These are application controls, not a guarantee that a model's answer is correct. The [competitor capability map](AI-COMPETITOR-MAP.md) separates current workflows from future work.

## Authority

AI can read approved context and propose an answer or draft. No inference request exposes SQL, filesystem, network, email, payment, filing or record-write tools. An instruction in a supplier invoice, catalog name, narration, prior question or model response cannot authorize an application action. The app validates the model's requested record search against a fixed module/field allowlist. Arbitrary paths, SQL, URLs, action keys and foreign-business selectors are rejected.

Chat searches only the active business, one module and up to five bounded records per turn. Source labels and coverage are produced by the server, separate from model prose. Conversations are bound to business, account and model; they retain only bounded recent questions and source IDs in memory. Aggregate analysis uses the existing deterministic summary engine and validates its period, currency, integer money amounts and review counts.

## Review and accounting

| Workflow | Allowed result | Required action |
|---|---|---|
| Record questions / summaries | Plain-text explanation with coverage | Open source records; no write endpoint exists in this workflow |
| Invoice drafting | Existing client/product aliases and positive quantities | Preview shared context, consent, review resolved lines, apply to a blank invoice, then separately save |
| Purchase image | Validated extracted fields, editable local product links | Compare source image, resolve unreadable values and cess, apply to purchase form, then separately save |
| Expense / bank categorisation | Existing category or unresolved result | Apply an individual suggestion to draft state; save/import separately |
| Invoice / receipt email | Subject and plain message | Apply, edit and use the existing separate Resend send action |

Invoice draft prices, GST and cess come from saved products, not generated values. The existing calculator recomputes totals. Unknown/ambiguous matches and unsupported changes must be resolved before applying. Generated extra financial fields or action keys fail schema validation. Existing invoice/purchase save, stock, journal and reversal code remains authoritative; these AI endpoints never post to it. Credit notes, quotations, other currencies and saved-invoice edits are not supported by the initial AI invoice draft flow.

Email drafts cannot introduce a new detected URL, domain, email address or UPI destination. URL path/query case is preserved when checking against the reviewed source. This check is an additional safeguard, not a factual verifier for arbitrary prose or bank account numbers. The user must still review the draft and recipient. Nothing is sent automatically.

## Data and scope

- New clients are owned by the active business; cross-business edits and stale revisions are rejected. Older unassigned clients remain outside invoice/AI selection until an explicit, revision-checked assignment. Linked transaction history must agree with that business. Client statements read business-scoped invoices.
- Credential storage is not an available record module. Known credential keys, document binaries and attachments are excluded from record search. Common secret patterns in ordinary text are redacted before sharing and returning responses. Pattern matching cannot identify every possible secret or encoded value, and image inputs are not automatically redacted. The user previews and explicitly approves image sharing.
- Before data transmission, including after asynchronous model discovery/token renewal and immediately inside the SDK fetch boundary, the app rechecks scope. Record answers also recheck their source fingerprint. Changed business, account, catalog, source data, expired snapshots or edited forms invalidate pending results.
- Invoice previews expire after ten minutes. Generation and apply resolution are single-use. Summary previews expire after five minutes and are consumed before inference. A failed request needs a new explicit user action; there is no automatic retry/replay.
- OAuth credentials remain in owner-protected local files, outside portable backups. This is not an encrypted system keychain. Provider processing is online; `store:false` is not a zero-retention guarantee. Do not put credentials in business descriptions, prompts or images.

## Resource and output bounds

All inference paths share an in-memory allowance of at most two concurrent requests and thirty model requests in five minutes. Record chat uses up to two model requests per question. This is a local runaway-request safeguard, not a provider spending cap; it resets on app restart. No SDK automatic retries are enabled.

The SDK enforces a 90-second inference deadline, a 4 MB stream-event budget and a 32,000-character text limit, including after redaction. Individual workflows impose smaller schema/size limits. Explicit refusals, malformed JSON, forbidden fields, invalid IDs/enums, incomplete streams and control characters fail without applying a draft. Errors show a recovery step rather than raw provider bodies or credentials.

The ChatGPT subscription route does not support every standard API capability. We omit unsupported token-limit fields and do not depend on hosted file search, Code Interpreter, computer use or MCP. Bounds are enforced locally. [Current subscription-route limits](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

## Regression coverage and remaining work

Tests exercise hostile action-bearing search plans, embedded credential patterns, invalid/refused/oversized outputs, stale scope during model preflight, changed source records, cross-business/account/model conversations, duplicate generation/apply, quantity and money bounds, unresolved matches, and review-before-save/send. Browser checks use fictional records in an isolated runtime and simulated provider replies. They test application behavior, not the model's accuracy on real documents.

Prompt isolation, schemas and approvals reduce prompt-injection risk; they do not make model prose trustworthy. [OpenAI's agent safety guidance](https://developers.openai.com/api/docs/guides/agent-builder-safety)

Future AI write tools require a separate design: typed proposals, current record revisions, explicit approval, transactional/idempotent command execution, accepted-change provenance and reversals. A persistent AI provenance ledger, comprehensive semantic/factual validation, a production model-evaluation dataset and cross-module reconciliation/forecasting are not delivered by these guardrails. The current financial audit trail continues to record ordinary accepted saves; it is not a complete AI decision log.
