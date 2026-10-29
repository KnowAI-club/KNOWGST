# Provenance and third-party notices

`apps/parity` includes substantial source from [Free-GST-Billing-Software](https://github.com/IamRamgarhia/Free-GST-Billing-Software), commit `07502f3cad1634a5e7b47a631968152e0bc7e34f`, version 1.10.80. Copyright (c) 2026 DiceCodes. The original MIT license is retained at `apps/parity/LICENSE`. Original source hashes are recorded in `docs/UPSTREAM-MANIFEST.json`; KNOWGST changes include branding, local service isolation, backup verification and build/test integration.

New KNOWGST code is GPL-3.0-only; see root LICENSE. The earlier prototype under apps/api, apps/web and packages/domain is separately implemented. This repository does not claim independent authorship of the reused source or tax certification.

Dependencies retain their own licenses. Inter is SIL OFL. Tesseract worker, WASM core and English trained data are bundled from lockfile-controlled packages; preserve their accompanying notices when redistributing. A complete dependency license/SBOM review remains a release gate.
