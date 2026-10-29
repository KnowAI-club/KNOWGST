# Upstream surface audit

Source: https://github.com/IamRamgarhia/Free-GST-Billing-Software, commit `f2cf33939842db5d9e8206e922f2c8552da4cc38`, package 1.10.82. Reviewed 29 October 2026. This commit also contains changes labelled **1.10.83 unreleased**; it is not just the published 1.10.82 release.

All 48 explicit API declarations are present. Some deliberately return disabled responses (upstream updater/launcher). A matching file or route does not prove its behavior. See FEATURE-PARITY.md and PRODUCTION-GAP-REVIEW.md.

| Source file | Disposition | Note |
| --- | --- | --- |
| src/App.jsx | adapted |  |
| src/components/ActionsMenu.jsx | identical |  |
| src/components/AppFooter.jsx | adapted |  |
| src/components/AppLock.jsx | identical |  |
| src/components/AppLockSettings.jsx | identical |  |
| src/components/BillOCR.jsx | adapted |  |
| src/components/BulkCsvImport.jsx | identical |  |
| src/components/ClientModal.jsx | identical |  |
| src/components/ClientsView.jsx | identical |  |
| src/components/ConfirmModal.jsx | identical |  |
| src/components/ControlPanel.jsx | adapted |  |
| src/components/Dashboard.jsx | adapted |  |
| src/components/ExpenseTracker.jsx | identical |  |
| src/components/GSTReturns.jsx | identical |  |
| src/components/HelpButton.jsx | adapted |  |
| src/components/IncomeTax.jsx | adapted |  |
| src/components/InventoryView.jsx | identical |  |
| src/components/InvoiceGenerator.jsx | adapted |  |
| src/components/InvoiceGridLayout.jsx | identical |  |
| src/components/InvoiceNumberSettings.jsx | identical |  |
| src/components/InvoicePreview.jsx | identical |  |
| src/components/LockButton.jsx | identical |  |
| src/components/PageHeader.jsx | identical |  |
| src/components/PartyOutstandingReport.jsx | identical |  |
| src/components/PrintPreviewModal.jsx | identical |  |
| src/components/PrintSettings.jsx | identical |  |
| src/components/ProductBulkEdit.jsx | identical |  |
| src/components/PurchaseBills.jsx | identical |  |
| src/components/ReceiptVoucher.jsx | identical |  |
| src/components/RecurringInvoices.jsx | identical |  |
| src/components/ReportsView.jsx | identical |  |
| src/components/SettingsView.jsx | adapted |  |
| src/components/SetupWizard.jsx | adapted |  |
| src/components/SignatureImages.jsx | identical |  |
| src/components/StarBanner.jsx | identical |  |
| src/components/StockReport.jsx | identical |  |
| src/components/SupportNudge.jsx | adapted |  |
| src/components/SupportView.jsx | adapted |  |
| src/components/SupportersList.jsx | product-specific replacement | Source donor list; upstream acknowledgments retained in KNOWGST About. |
| src/components/TableExport.jsx | identical |  |
| src/components/Toast.jsx | identical |  |
| src/components/UnassignedBanner.jsx | identical |  |
| src/components/WelcomeCard.jsx | product-specific replacement | Source donation welcome card; KNOWGST keeps its existing onboarding checklist. |
| src/components/WelcomeGuide.jsx | adapted |  |
| src/components/WhatsNew.jsx | product-specific replacement | Replaced by KNOWGST ReleaseNotes and local CHANGELOG.md; no upstream update promises. |
| src/components/useSupporters.js | identical |  |
| src/index.css | adapted |  |
| src/index.html | identical |  |
| src/main.jsx | adapted |  |
| src/services/googleDrive.js | adapted |  |
| src/store.js | identical |  |
| src/utils/appLock.js | identical |  |
| src/utils/bulkCsv.js | adapted |  |
| src/utils/changelog.js | identical |  |
| src/utils/clientCredit.js | identical |  |
| src/utils/hsnRates.js | adapted |  |
| src/utils/itr.js | adapted |  |
| src/utils/partyOutstanding.js | identical |  |
| src/utils/prefsMirror.js | adapted |  |
| src/utils/printSettings.js | identical |  |
| src/utils/products.js | identical |  |
| src/utils/share.js | identical |  |
| src/utils/supporters.js | identical |  |
| src/utils/xlsx.js | identical |  |
| src/utils.js | identical |  |
| server.js | adapted |  |
