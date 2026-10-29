# KNOWGST

Open-source invoicing and bookkeeping for web and macOS. GPL-3.0-only.

**Early development — use test data only.** The first local invoice workflow works; GST compliance, full feature parity, hosted operation and the macOS package are not complete.

## Run locally

Use Node.js 22.22 or newer and pnpm 9.15.9.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open http://127.0.0.1:4173. The command starts both the web interface and local API. SQLite data is stored in `.local/knowgst.sqlite`, excluded from Git. `KNOWGST_DB` can select a separate test database. No online account or provider key is needed. Keep the development server bound to loopback; it is not a hosted deployment.

Create a test business, add an invoice, review totals, issue a test number, and record a payment. Refresh to see persisted records. Print preview uses the browser print dialog and clearly marks the output as a development document.

## Validate

```sh
pnpm check
pnpm test
pnpm build
```

## Architecture

- `apps/web`: React interface with semantic light/dark tokens and locally bundled Inter.
- `apps/api`: local Fastify service and transactional SQLite development adapter.
- `packages/domain/src/invoicing.ts`: runtime schemas and deterministic decimal calculations.
- `scripts/dev.ts`: local service lifecycle and protected development proxy.

Self-hosted PostgreSQL and Tauri packaging are planned. No Neon dependency. Each workspace will have one database authority; offline multi-writer sync is not part of the first release.

## Scope and roadmap

Feature parity with the audited source product comes first. AI, bank feeds and expanded messaging integrations follow only after parity. See [technical proposal](docs/TECHNICAL-PROPOSAL.md), [current implementation boundaries](docs/IMPLEMENTATION-STATUS.md), and [provenance notices](THIRD-PARTY-NOTICES.md).

The source product continues unchanged. This repository is not yet a production replacement. Do not import real financial records until migrations, financial regression coverage and restore verification pass.
