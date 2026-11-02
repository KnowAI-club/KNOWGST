# Desktop installation and release process

KNOWGST bundles Electron, its Node service, SQLite 3.54.1, the application and illustrated user guide. Users do not need Node.js or a development server. Core bookkeeping works offline; ChatGPT image extraction and email require a connection and the user's configured account.

## Choose an installer

Download only from [KNOWGST GitHub Releases](https://github.com/KnowAI-club/KNOWGST/releases).

| Computer | File |
| --- | --- |
| Mac with Apple silicon | `KNOWGST-1.0.0-mac-arm64.dmg` |
| Mac with Intel processor | `KNOWGST-1.0.0-mac-x64.dmg` |
| Windows x64 | `KNOWGST-1.0.0-win-x64.exe` |

Mac ZIP packages are also supplied. Check the release asset names if using a later version. On macOS, About This Mac identifies the chip/processor.

Verify the file against `SHA256SUMS` downloaded from the same release:

```sh
# macOS, in the download folder
shasum -a 256 KNOWGST-1.0.0-mac-arm64.dmg
```

```powershell
# Windows PowerShell, in the download folder
Get-FileHash .\KNOWGST-1.0.0-win-x64.exe -Algorithm SHA256
```

Compare the entire digest. A matching checksum confirms the file matches the published artifact; it is not publisher signing.

## Install and open

- **macOS:** Open the DMG and copy KNOWGST to Applications. Open KNOWGST from Applications. This community release is not Developer ID signed or notarized. macOS may require a specific approval in System Settings → Privacy & Security after the first open attempt. Do not disable system-wide security controls.
- **Windows:** Run the KNOWGST setup file and choose the installation location. Per-user installation creates KNOWGST Start Menu and optional desktop shortcuts without administrator access. The installer is not publisher-signed; Windows may show an unrecognized-app prompt. Review the source and checksum before choosing to proceed.

The releases page records which native installation tests passed. It does not certify every OS version, printer driver, antivirus configuration or device.

## Data, upgrades and moving computers

Data lives outside the installed application in Electron's KNOWGST user-data folder, under `workspace/`. Choose **File → Open data folder** to locate it. The database is `data/knowgst.sqlite`; generated PDFs, backups and local integration credentials occupy separate folders. Logs rotate at 2 MiB.

Before an upgrade, create a verified full backup. Replacing the application preserves its workspace, and Windows uninstall preserves user data. There is no automatic updater in v1.

Development/browser workspaces are not moved silently into the installed app. Create a verified backup in the existing workspace, then restore it through the installed app's backup controls. Full backups preserve PDFs, AI document originals and review state; integration credentials are intentionally excluded, so reconnect providers on the new computer. See [backup and restore](BACKUP-RESTORE.md).

## Build from the corresponding source

Check out the exact release tag. Use Node 22.22.3, pnpm 9.15.9, Python 3 and the platform's C/C++ compiler tools.

```sh
pnpm install --frozen-lockfile
# On a native Mac of the selected architecture:
pnpm desktop:build --mac --arm64
# Or on Intel Mac:
pnpm desktop:build --mac --x64
# On Windows x64:
pnpm desktop:build --win --x64
```

Never copy a native SQLite binding between platforms or architectures. The staging script verifies the embedded SQLite version, records the source commit and bundles the exact Node runtime license. Output is in `release/`.

## Test the installed package

Set `KNOWGST_TEST_INSTALLER` to the absolute DMG or setup EXE path, then run `pnpm desktop:test`. The test mounts/copies the Mac app or silently installs Windows into a temporary folder, then launches that installed copy with an isolated fictional workspace.

Checks cover installed launch, SQLite version, renderer isolation, unauthenticated gateway denial, invoice PDF output, verified backup/restore including PDF bytes, restart persistence, sandboxed report windows, extraction consent and bundled guide. Provider responses are not inferred from this packaging test; real ChatGPT/Resend access requires the owner's credentials. Evidence is written to `release/smoke/`.

The [Desktop installers workflow](../.github/workflows/desktop.yml) builds and tests natively on macOS arm64, macOS x64 and Windows x64. `node scripts/desktop/checksums.mjs` hashes the resulting packages. Only artifacts from successful platform jobs are eligible for publication.

## Release checklist

1. Run source checks, unit/financial tests, production web build and browser tests on the release commit.
2. Push the source commit; verify the Validate workflow.
3. Dispatch Desktop installers against that exact commit and require all native jobs to pass.
4. Download the installers and their smoke evidence; verify file hashes and version/source identity.
5. Publish the Git tag, release notes, native installers and combined checksums. Record unsigned status and any known limitations.
6. Verify the public release assets and tag resolve to the tested source.

Publisher signing and Apple notarization are tracked follow-up work requiring owner-managed certificates. They are not represented as completed by this community release. No signing identity or private key belongs in the repository.

GPL source is available at the corresponding release tag. LICENSE, third-party notices, dependency licenses, Electron licenses and the embedded Node license accompany builds. The application retains the KnowAI symbol and neutral UI.
