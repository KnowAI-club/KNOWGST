# Contributing to KNOWGST

Thank you for improving KNOWGST. Keep changes focused, explain the user-visible problem, and use fictional records in examples and tests.

## Get started

1. Follow the source setup in [README](README.md).
2. Create a branch for one change. The active application lives in `apps/parity`; the installed shell lives in `apps/desktop`.
3. Reproduce the problem before changing behavior. Preserve the compact desktop UI, KnowAI branding, keyboard access and both themes.
4. Add a regression test where behavior, financial correctness, data ownership or recovery is affected.
5. Run the relevant tests, then the checks listed below. Explain any checks you could not run in the pull request.

```sh
pnpm check
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

## Financial and data changes

Do not rewrite a working calculation as part of an unrelated refactor. Document the business rule, source and effective date for tax changes. Cover rounding, cancellations, partial payments, retries, reversals and historical records when relevant. Use integer minor units in ledger entries; do not mix currencies.

Writes affecting invoices, stock, payments and journals must use the established transaction planners. Preserve revision checks, business ownership, idempotency and append-only journal history. A migration needs backup, reconciliation and recovery tests. Tests must never use a person's real workspace.

## AI changes

Treat user text, documents and model output as untrusted input. Scope data to the active business, preview outbound context, validate model output and reject stale results after business/account/source changes. Do not add autonomous financial writes, emails, bank transfers, arbitrary SQL or tool execution. Draft application and financial Save must remain separate.

## Pull requests

Describe the problem and resulting behavior, tests performed and material limitations. Attach screenshots for visible changes. Keep generated binaries, private documents, runtime folders, credentials and OAuth callback URLs out of Git. Do not alter upstream notices. Contributions are made under the repository's GPL-3.0-only license, with existing third-party notices preserved.

The [native installer workflow](.github/workflows/desktop.yml) tests each supported build on its own operating system and architecture. A web build alone does not verify an installer.
