# Production gap review — 29 October 2026

## Source evidence

Checked current upstream HEAD `f2cf33939842db5d9e8206e922f2c8552da4cc38` against the original 1.10.80 baseline. Package version is 1.10.82, while current-main signature/stamp and purchase-tax changes are labelled 1.10.83 unreleased. See FEATURE-PARITY.md and UPSTREAM-SURFACE-AUDIT.md. The checked manifest is committed; CI prevents unnoticed missing source surfaces/API declarations. This check does not assert behavioral equivalence merely from file presence.

## Defects addressed

- Malformed saved JSON was silently treated as missing; directory reads could omit a bill and metadata reads could reset counters. Reads now report `data-corrupt` rather than silently returning empty data. The API returns a safe recovery message and preserves the file. Existing directory caches expire after five seconds; external file edits are not detected instantly.
- Record IDs mapped to colliding filenames (for example `a/b` and `a_b`) could replace or delete a different record. Writes/deletes/imports now reject collisions. Generated fallback IDs use UUIDs. Malformed entity shapes, invalid IDs and dangerous prototype keys are rejected at the boundary.
- JSON imports previously wrote records before discovering a malformed later collection. All import structures/identities are validated first. Changes and reconciled counters are staged in memory, then committed through a journal with saved originals. Failure rolls back; startup recovers an interrupted import. Merge/overwrite behavior and the local lock remain preserved.
- File writes now use unique temporary names, restrictive permissions and file fsync before rename. Transaction journal and saved-original bytes are synced. Directory entries are not universally fsynced; this remains process-crash coverage, not certified power-loss durability or multi-process storage safety.
- A secondary backup folder could be overwritten by another installation. An installation identity outside restored data and an exclusive folder ownership marker now stop this. Legacy unowned dated folders remain readable for restore but require a new empty folder for further copies. Shared/network folders still use synchronous filesystem operations and can block on disconnected drives; background copying is an explicit remaining gate.
- Ported upstream CSV date interpretation, partial-import stock application, keyboard menu behavior, saved-client WhatsApp sharing/PDF fallback, signature/stamp layout, and exact purchase tax-head display/export. The CSV parser also rejects mixed month-first/day-first files as a whole.
- KNOWGST About now shows its own offline release notes. Upstream donation welcome/supporter components and updater promises are deliberately not presented as KNOWGST behavior.

## Invoice transaction increment

The main invoice editor and Dashboard now call `/api/invoice-transactions`. A single synchronous journal commit includes the invoice, product stock deltas and linked payment receipt creation/edit/deletion. Multi-invoice client-credit patches commit with the target invoice. Renumbering archives the old record and relinks receipts in the same transaction; conversion clears the source stock ownership while applying the target stock effect. Existing calculation helpers remain unchanged.

The server derives stock deltas from persisted records and the existing stock-effect helper, checks every affected product and receipt identity, and validates all operations before installation. GET bills includes a content revision. Stale updates fail with an actionable conflict; successful saves return the new revision. Exact repeated saves are no-ops. The editor uses its prior successful revision and reloads payment truth rather than unioning obsolete payments back into the invoice.

The journal now supports deletion with original-byte rollback, including a removed payment receipt. Unit tests inject errors between each invoice/receipt/stock installation, and a child process exits after deleting a receipt to verify startup recovery. Browser tests exercise payment plus receipt persistence and conflict handling from an already-open payment window.

## Verification

Run `pnpm check`, `pnpm test`, `pnpm build`, `pnpm test:e2e`. New service/unit tests cover malformed import non-mutation, ID collisions including deletion, corrupt counters, transaction rollback and child-process interruption, secondary backup ownership and mixed date formats. New browser tests cover keyboard focus, a locally trapped WhatsApp draft URL plus PDF download, purchase-tax export precision, stock reconciliation after an injected second-purchase CSV failure, signature persistence/rendering and local release notes. No messages are sent.

The production dependency audit (`pnpm audit --prod --json`) returned zero reported advisories for 196 production dependencies at review time. This is point-in-time registry evidence, not a security certification.

## Remaining constraints

The compatibility service remains local, JSON-based and intended for one server process per runtime. The editor and Dashboard invoice/payment/stock flows now share recoverable file transactions, not a database. Legacy `/api/bills` writes, standalone receipt allocation/editing, client-view deletion and trash restore, purchase/CSV stock changes, recurring generation and printed-PDF updates still require transaction migration. PDF creation/cancellation stamping and recurring-template creation remain separate follow-up operations. Bulk dashboard actions are atomic per invoice, not all-or-nothing across the selection. Revisions protect migrated writers; legacy callers do not yet universally enforce optimistic concurrency. The local lock is not hosted authentication. Remote backup latency, arbitrary OCR scans, real provider authorization/delivery, full legal/schema review, signed packaging, deployment/rollback drills and broad accessibility/performance testing remain open. No wholesale financial rewrite was performed.
