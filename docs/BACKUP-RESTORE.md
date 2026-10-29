# Complete local backup and restore

New dated snapshots use format 2 (`application-data-and-pdfs`). They contain `data/`, `saved-invoices/`, `pdf-trash/` and a SHA-256 manifest. Data excludes nested backups, diagnostic errors.log and the port marker. PDFs stored outside the configured runtime are not included. Snapshots are directories, not ZIP archives, and are not encrypted.

Create one from Control Panel or Settings. Manual creation refreshes today's snapshot; automatic daily creation keeps the first snapshot of that day. Up to 30 dated snapshots are retained. An optional extra backup folder receives a verified copy; failure there is reported even when the local snapshot succeeded. Keep an independent off-device copy.

Restore verifies all snapshot bytes before replacing live files. A complete pre-restore snapshot is created first, with five recovery snapshots retained. Replacement is staged and journaled; process interruption is rolled back at next server startup. Original local lock settings and the extra-backup location are preserved. Data added after the selected snapshot is removed as part of restoring that generation. Format-1 legacy snapshots restore data only and leave PDF folders untouched. JSON exports remain records-only.

Settings no longer refreshes today's backup immediately before restoring it: that used to overwrite a selected same-day snapshot. Control Panel now invokes the actual verified backup service rather than missing upstream scripts. Mutation tracking prevents starting a snapshot while another HTTP mutation is pending.

Tests cover complete data/PDF/trash restoration, exact PDF bytes through the API, corrupt files, extra live records, symlink rejection, injected partial-copy failure, injected rename-stage failure and process exit during restore. These tests prove process interruption recovery, not hardware power-loss durability. Journal writes are not an fsync-backed filesystem transaction. Disk or filesystem failure during rollback can still require recovery from an independent copy.

SHA-256 detects accidental corruption. An attacker able to alter both the files and manifest can replace their hashes; this is not a signed backup. Hosted storage, remote disaster-recovery drills and production-scale restore performance remain outside this local release.
