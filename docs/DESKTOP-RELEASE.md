# KNOWGST desktop release candidate

The desktop shell retains the existing KnowAI logo, UI, financial engine and SQLite 3.54.1 service. It bundles Electron, a matching Node runtime, compiled SQLite binding, OCR data and the user guide. No Node installation or development server is required on the user's computer.

## Build and test

Use Node 22.22.3, pnpm 9.15.9 and the platform's native compiler tools. Run `pnpm install --frozen-lockfile`, then `pnpm desktop:build --mac` on macOS or `pnpm desktop:build --win` on Windows. Do not cross-copy native SQLite bindings between operating systems or architectures. The staging script verifies the actual bundled SQLite version before packaging. Output is in `release/`.

Set `KNOWGST_TEST_INSTALLER` to the absolute DMG/setup EXE path and run `pnpm desktop:test`. On macOS the test mounts the DMG, copies the application and launches that installed copy. On Windows it silently installs NSIS into a temporary folder and launches that installed executable. The test uses a separate data folder, checks sandboxing, unauthenticated service access, invoice PDF output, backup/restore including archived PDF bytes, persistence after restart, sandboxed report windows, offline OCR with external requests blocked, and the bundled guide. Evidence is in `release/smoke/`. `node scripts/desktop/checksums.mjs` writes SHA256SUMS.

The `Desktop installers` workflow builds and tests on native macOS and Windows runners and retains installers and test evidence as workflow artifacts. The native matrix does not certify all printer drivers, operating system versions, hardware or third-party integrations.

## Installation and data

- macOS: open the DMG and copy KNOWGST into Applications.
- Windows: run the KNOWGST setup EXE. It creates KNOWGST Start Menu and optional desktop shortcuts; no administrator access is required for a per-user installation.
- Data is outside the application: under Electron's KNOWGST user-data folder, in `workspace/`. Use File → Open data folder to locate it. Logs rotate at 2 MiB.
- Existing development/browser workspaces are not silently moved. Create a verified backup from the existing workspace, then restore it through the installed application's Backups section.
- Replacing the application preserves data. Windows uninstall preserves user data. Before upgrades, create a backup; restore drills and source regression tests cover supported backup formats.

## Security and release gates

The renderer has no Node access, uses context isolation and sandboxing, denies permission prompts/webviews and restricts navigation to its local origin. A per-launch random secret is injected by the main process only for the application's own web contents. The loopback gateway rejects missing secrets, unexpected origins and hosts; the API also requires the secret. Shutdown uses IPC so the service can flush and release its workspace lock on both platforms. A lost parent connection also shuts down the service.

These are **1.0.0-rc.1 test installers**, not a signed general-availability release. Apple Developer ID signing/notarization and Windows publisher signing need owner-managed certificates and CI secrets. The current build intentionally does not claim publisher verification or automatic signed updates. Do not label the release final until these gates and the native installation tests pass. IRP integration and taxpayer-specific compliance remain separate from desktop packaging.

The GPL source is the corresponding KNOWGST repository commit. LICENSE, upstream notices, dependency licenses, Electron licenses and the embedded Node license accompany the build. The icon is derived from the existing KnowAI symbol, not a new brand.
