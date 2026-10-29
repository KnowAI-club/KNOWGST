# KNOWGST user guide

The implemented app serves its guide at `/docs/`. Open the sidebar's User Guide or a module's “Read the full guide” link. It has 20 topics, search, responsive topic navigation, persistent light/dark theme, contextual app links and a table of contents.

Content is original KNOWGST guidance. The user-supplied DiceCodes documentation informed navigation structure; its product, installer, licensing and data-path claims were not copied as KNOWGST capabilities.

Screenshots are actual Playwright captures of the current compatibility app, with fictional sample records in an isolated test runtime. The screen assets are under `apps/parity/public/docs/screenshots`. They are not AI mockups. The capture includes 13 module screens and a filled purchase-entry form; empty receipt/recurring views intentionally show those entry states. Dates reflect the capture run, not historical tax certification.

Refresh after changing the interface:

```sh
CAPTURE_DOCS=1 pnpm exec playwright test tests/e2e/documentation.spec.ts --grep 'capture actual'
```

Review the resulting images before committing them. Normal CI checks topic navigation, every linked screenshot, contextual help, TOC targets, mobile layout and theme persistence. Screenshot generation is opt-in to avoid silently replacing reviewed documentation assets during normal test runs.
