# Security policy

## Reporting a vulnerability

Use GitHub's **Report a vulnerability** option in this repository's Security tab when available. If private reporting is unavailable, open a minimal issue requesting a private reporting channel without publishing exploit details, credentials or business records. Do not post real invoices, databases, API keys, access tokens or sign-in callback URLs.

Provide the affected version, operating system, a minimal reproduction using fictional data, expected and observed behavior, and the impact you identified. Maintainers review reports as availability permits; this community project does not promise a response SLA.

## Supported releases

Security fixes target the latest v1 release and the current main branch. Older development snapshots are not maintained independently. Check the release notes before upgrading and create a verified backup.

## Trust boundaries

The desktop application runs a local service on loopback. A per-launch secret protects service access through the application's own gateway. The renderer uses context isolation and sandboxing without Node integration. The app is intended for a single operating-system user; it is not a multi-user internet-hosted accounting service.

SQLite data and PDFs are local files. The optional app PIN controls application access; it does not encrypt the database. Integration credentials are stored in an owner-protected local file and are excluded from portable backups. They are not currently protected by Keychain or a dedicated encrypted vault. Full-disk encryption and operating-system account security remain the user's controls.

AI sends reviewed context to the user's connected provider. `store:false` is not a guarantee of zero provider retention. Model output cannot directly execute financial transactions or send email. Read [AI guardrails](docs/research/AI-GUARDRAILS.md) for enforced controls and limitations.

Community installer signing and test status are declared per release. SHA-256 checksums detect file mismatch; they do not substitute for publisher signing. Updates are manual.
