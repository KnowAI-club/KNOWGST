# Changelog

## 1.0.2 — 3 November 2026

### ChatGPT account and workspace selection

- Explicitly choose another ChatGPT account or workspace when an unfinished registration belongs to a different workspace. Ordinary retries still reuse the existing registration.
- Retain and resume multiple unfinished connections without overwriting saved accounts or changing this device's host identity.
- Show recognized authorization errors with safe recovery guidance. Authorization denial never creates a new registration automatically or changes the active account.
- Update the integration guide with workspace recovery and verification steps.

## 1.0.1 — 2 November 2026

### ChatGPT sign-in recovery

- A rejected authorization code starts one fresh authorization using the existing registration. Rejected codes are never replayed, and a repeated rejection stops visibly.
- Cancelling while the callback listener starts now cancels the entire attempt. Delayed failures from older attempts cannot overwrite a newer sign-in.
- The Settings retry link follows the current authorization attempt and disappears on completion or cancellation.
- Authorization denial still stops sign-in; account approval is always controlled by OpenAI and the user.

## 1.0.0 — 2 November 2026

First public KNOWGST desktop release for macOS and Windows. See the GitHub release for exact installer assets, native test evidence and checksums. Community installers are not publisher-signed or Apple-notarized.

### Billing and bookkeeping

- Compact desktop interface, KnowAI branding, categorized collapsible navigation and consistent light/dark controls.
- Business profiles, seven document types, neutral PDF layouts, customers, products, purchases, expenses, receipts and recurring invoices.
- SQLite 3.54.1 storage with transactional invoice/payment/stock changes, INR journal postings, append-only corrections and audit history.
- Supplier payments, business-wise inventory and reviewed historical posting backfill.
- Complete verified backups and interrupted-restore recovery, including saved/deleted PDF originals.

### Reviewed AI assistance

- User-authorized ChatGPT connection through the official OpenAI SDK, model discovery and WebSocket record chat with source references.
- Reviewed invoice drafts, image extraction, category suggestions and email drafting with separate financial Save/Send actions.
- Persistent document inbox and receipt-to-expense/purchase draft review.
- Statement classification, confirmed matching rules and local rule history; duplicate checks and reviewed CSV export.
- Catalog duplicate review, reversible alternate names and grounded client/product drafts.
- Evidence-based books review, ledger contribution explanations, collection prioritization/holds and supplier planning.
- Guided client/product CSV mapping, pre-import verified backup, atomic create-only batches and guarded undo.
- Active-business isolation, context previews, stale-result rejection, bounded input/output and failure handling.

### Desktop and project

- Native Apple silicon Mac, Intel Mac and Windows x64 packaging, installed-app smoke checks and release checksums.
- Bundled user guide with implemented-app screenshots, installation/architecture documentation and public contribution/security guidance.
- Resend configuration for explicitly confirmed invoice and receipt email delivery.

### Known boundaries

The ledger currently uses INR and gross expense conventions. Government filing/IRN generation, bank transfers/feeds/reconciliation, multi-user hosting, unattended AI actions, publisher signing, notarization and automatic updates are not included. Image intake does not parse PDFs or synchronize mailboxes. Credentials use owner-protected local files, not an encrypted OS vault. See [AI workflows](docs/AI-WORKFLOWS.md), [accounting scope](docs/SQLITE-ACCOUNTING.md) and [tax-rule review](docs/TAX-RULE-REVIEW.md).
