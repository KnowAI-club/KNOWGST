# Device integrations — 1 November 2026

Settings → Integrations contains ChatGPT OAuth and Resend sending configuration. These optional integrations do not change financial calculations or journal posting. No binaries are built as part of this change.

## ChatGPT

Uses the documented open-source Sign in with ChatGPT flow: dynamic registration, stable per-runtime host ID, system-browser authorization, short-lived loopback listener, fresh state/nonce/S256 PKCE, issued client ID and signed ID-token validation against OpenAI JWKS. Returning registrations retain their verified subject and client ID. Accounts are stored separately; changing account cancels active inference. Refreshes are serialized and rotating credentials replaced atomically. Signing out attempts remote revocation, clears local tokens and retains registration identity for reconnection.

The model list comes from the active account. Responses use the public API, `store:false`, `stream:true`, and succeed only after `response.completed`. No shell, business-record write tools or automatic data upload are supplied. The settings question box sends typed text only. The AI assistant can additionally share explicitly approved, bounded active-business records and recent questions; summary reviews share approved aggregates. Purchase scanning, category suggestions and email drafting share only their separately reviewed image or text context. There is no fallback to another paid credential or a borrowed Codex session.

## Chat transport and reviewed drafts

The assistant uses a same-origin WebSocket to the local service (`/api/ai/chat`) for progress phases, errors and completed answers. The official OpenAI SDK remains the provider transport. Authentication checks run on upgrade independently of Express middleware; the dev proxy and desktop gateway validate the exact app origin, and the backend validates the local session secret, loopback peer and bounded JSON message shape. No secret is embedded in a browser URL. Requests are never replayed automatically after a disconnect.

Follow-ups use server-owned, short-lived context tied to the business and ChatGPT account. Only recent questions and source IDs persist in process memory; each answer re-reads current records and verifies their fingerprint. Socket cancellation stops subsequent provider steps and discards the result; an already-running SDK request can finish internally. Shutdown closes upgraded connections before stopping the server.

Expense and selected bank-import rows support suggested categories from existing allowlists. Applying a suggestion changes only draft state. Invoice and receipt dialogs support contextual email drafts: explicit preview/consent, validated text, apply, then the existing separate send action. Editing selected inputs or switching account invalidates stale suggestions. Provider responses are simulated in automated tests.

AI request controls, draft boundaries, output limits and their limitations are documented in [AI guardrails](research/AI-GUARDRAILS.md). The server rechecks active scope at the final SDK transmission boundary; safeguards are enforced in code as well as instructions.

## Resend

The API key is write-only in the UI. Configure a verified sender and optionally reply-to. Invoice and receipt dialogs render a PDF, expose it for review and require an explicit Send email action. The local service validates a single recipient, bounded subject/message and a PDF attachment up to 3 MB. A persistent request digest and Resend idempotency key protect same-draft retries. Accepted requests replay their saved result without resending; changed payloads under the same ID fail; uncertain attempts older than 23 hours require provider review. Accepted is not delivered. There is no delivery webhook in this local-only app.

## Storage and boundaries

Credentials and email request metadata live in `<runtime>/.credentials/integrations.json`, outside `data/`, PDF folders and portable backups. Writes are atomic; Unix directory/file modes are 0700/0600. This is protected local file storage, not encryption or a system keychain. Do not copy the directory into exports or support bundles. APIs never return keys/access/refresh/ID tokens. Sign-in URLs omit ID-token hints. No credentials are embedded in source or documentation screenshots.

Google Drive retains its existing browser-only OAuth implementation. The guide now distinguishes Web application client IDs/exact authorized origins from desktop synced-folder backups. A native Google OAuth flow is not claimed by this change.

## Validation boundary

Unit tests use generated JWT signatures and provider stubs; UI tests intercept outbound email submission. They validate callback state/PKCE/identity, cancellation, refresh, incomplete streams, secret redaction, retry behavior, PDF attachments, review-before-send, and responsive settings. Live ChatGPT consent, eligible account access, Resend domain verification and delivery require the user's provider accounts and are not represented as completed by these tests. No real email is sent during verification.

## Provider contracts

- [OpenAI open-source sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [Resend send-email API](https://resend.com/docs/api-reference/emails/send-email)
- [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys)

## Sign-in recovery — 2 November 2026

A failed first authorization-code exchange now retains only the issued public registration ID separately from connected accounts. A fresh attempt reuses that ID with a new state, nonce and PKCE verifier; no account becomes active until signed identity verification succeeds. Rejected registrations are cleared so the next explicit attempt can register again. OAuth errors identify the failing stage and an allowlisted provider error code, with response bodies capped at 8 KB and descriptions/tokens omitted. A generic HTTP 400 alone does not identify the underlying cause; the original provider cause was not retained by the older error handler. On 2 November, a fresh user sign-in succeeded, model discovery returned eight available models, and a live SDK request returned READY. Business records were not attached to that connection test.
