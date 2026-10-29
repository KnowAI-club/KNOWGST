export const pages = [
  {
    "id": "index",
    "title": "Welcome to KNOWGST",
    "group": "Start here",
    "intro": "A practical guide to your local billing workspace. Follow the steps, compare the screens, and check your records before sharing or filing.",
    "steps": [
      "Set up your business in Settings.",
      "Add a client and your products or services.",
      "Create an invoice, check the preview and save the PDF.",
      "Record purchases and payments, then review your reports."
    ],
    "notes": "This guide describes the current compatibility edition. Screenshots show the actual app with fictional records, captured on 29 October 2026. Hosted accounts, AI, bank feeds and packaged macOS installers are not part of this release.",
    "screen": "dashboard",
    "view": "dashboard"
  },
  {
    "id": "setup",
    "title": "Set up your business",
    "group": "Start here",
    "intro": "Keep your business identity consistent across invoices, reports and exports.",
    "steps": [
      "Open Settings and enter your business name, address, state and GSTIN where applicable.",
      "Review numbering, bank details and the modules you want to show.",
      "Save changes. Create a test document and inspect its business details before issuing real invoices."
    ],
    "notes": "The current app runs locally. Start it from the repository with pnpm dev after installing dependencies. The default address is http://127.0.0.1:4173. This is not hosted authentication.",
    "screen": "settings",
    "view": "settings"
  },
  {
    "id": "invoices",
    "title": "Create an invoice",
    "group": "Sales",
    "intro": "Start with the right document type, then add the customer and line items.",
    "steps": [
      "Open New Invoice and choose Tax Invoice, Quotation, Proforma / Estimate, Bill of Supply, Composition, Credit Note or Delivery Challan.",
      "Enter the client, address, state, invoice date and supply details. Add a reference when creating a credit note.",
      "Add each item, quantity, rate, discount and GST rate. Confirm the tax split and total.",
      "Inspect the preview, then choose Save & Download. Confirm the record appears on Dashboard and the downloaded PDF opens."
    ],
    "notes": "HSN descriptions are historical hints. They do not certify the applicable rate. Enter the verified rate for your supply; changing an HSN code no longer overwrites your selection.",
    "screen": "invoice",
    "view": "new"
  },
  {
    "id": "dashboard",
    "title": "Find and manage invoices",
    "group": "Sales",
    "intro": "Dashboard brings saved documents and collection information into one place.",
    "steps": [
      "Use the document list and filters to find a customer or invoice.",
      "Open the relevant row action to view, edit, print or duplicate a document.",
      "Review payment and cancellation status before relying on report totals."
    ],
    "notes": "Quotations, estimates and delivery challans are not sales revenue. Credit notes reduce sales. Keep supporting records for corrections.",
    "screen": "dashboard",
    "view": "dashboard"
  },
  {
    "id": "print-settings",
    "title": "Preview and print",
    "group": "Sales",
    "intro": "Check the output your customer will receive.",
    "steps": [
      "Open an invoice and review its preview.",
      "Use print settings to adjust the available template, paper and display options.",
      "Save the PDF and inspect all pages, tax particulars and totals before sharing it."
    ],
    "notes": "Printer output varies with device and browser settings. A generated PDF or GST export is not a government-issued IRN or a filed return.",
    "screen": "invoice",
    "view": "new"
  },
  {
    "id": "clients",
    "title": "Manage clients",
    "group": "People & stock",
    "intro": "Keep reusable customer details and review their activity.",
    "steps": [
      "Open Clients and select Add Client.",
      "Enter the client name and available contact, address and GST details. Save the record.",
      "Select the saved client when preparing an invoice and verify the populated details."
    ],
    "notes": "Check names and GSTINs against the customer’s records. A saved profile is not proof of GST registration.",
    "screen": "clients",
    "view": "clients"
  },
  {
    "id": "products",
    "title": "Manage products",
    "group": "People & stock",
    "intro": "Save item defaults to reduce repetitive entry.",
    "steps": [
      "Open Products and select Add Product.",
      "Enter the name, HSN/SAC, purchase price, selling price, GST rate, unit and stock where applicable.",
      "Save, then select the item on a new invoice. Review its quantity and tax treatment."
    ],
    "notes": "Product tax defaults need periodic review. Stock and report values depend on the transactions you record.",
    "screen": "products",
    "view": "inventory"
  },
  {
    "id": "receipts",
    "title": "Record a receipt",
    "group": "Money in",
    "intro": "Record money received and keep the payment details together.",
    "steps": [
      "Open Receipts and choose New Receipt.",
      "Enter Received From, the amount, date and available payment details.",
      "Save Receipt and verify the saved entry. Review any invoice allocation before relying on outstanding balances."
    ],
    "notes": "A standalone receipt is a payment record. Do not assume it clears a particular invoice without checking the allocation.",
    "screen": "receipts",
    "view": "receipts"
  },
  {
    "id": "recurring",
    "title": "Recurring invoices",
    "group": "Money in",
    "intro": "Use a saved template for repeating billing.",
    "steps": [
      "Open Recurring and choose New Template.",
      "Enter customer and item details, the schedule and its start or end conditions.",
      "Save the template. Use its generation control when due, and review the resulting invoice on Dashboard.",
      "Pause the template when billing should stop."
    ],
    "notes": "Generation is local and depends on the app/service running. This is not an always-on hosted scheduler or an automatic email-delivery service.",
    "screen": "recurring",
    "view": "recurring"
  },
  {
    "id": "purchases",
    "title": "Record purchase bills",
    "group": "Money out",
    "intro": "Track supplier invoices, payment status and the tax amounts used in your purchase register.",
    "steps": [
      "Open Purchases and choose Add Purchase.",
      "Enter the supplier name, supplier invoice number and date. Add the item, quantity, rate and GST percentage from the original bill.",
      "Check the Interstate setting against the supplier’s tax treatment. Review totals and payment status, then Save.",
      "For a scanned bill, choose Import from image (OCR), extract the fields and compare every value with the original before saving.",
      "Use CSV, Excel or Print / PDF to review and share the purchase register."
    ],
    "notes": "A purchase entry does not establish input-tax-credit eligibility. Reconcile with GSTR-2B and review the legal conditions before claiming credit. OCR can misread invoice numbers, amounts and GSTINs.",
    "screen": "purchases",
    "view": "purchases"
  },
  {
    "id": "expenses",
    "title": "Record expenses",
    "group": "Money out",
    "intro": "Keep operating costs available for your reports.",
    "steps": [
      "Open Expenses and choose Add Expense.",
      "Enter a clear description, date, amount and the available category and GST details.",
      "Save the entry and verify it in the register. Review expense totals in Reports."
    ],
    "notes": "Avoid recording the same cost as both a purchase and an expense. Tax eligibility must be reviewed separately from recording the cost.",
    "screen": "expenses",
    "view": "expenses"
  },
  {
    "id": "reports",
    "title": "Review reports",
    "group": "Review & tax",
    "intro": "Use reports to understand recorded sales, expenses, outstanding balances and stock.",
    "steps": [
      "Open Reports and choose the period you want to review.",
      "Review profit and loss, outstanding and aging, party balances, client analytics, product performance or stock.",
      "Export CSV or Excel where offered, and reconcile the output to your source documents."
    ],
    "notes": "Reports reflect recorded data and the report’s selected scope. They are not independently audited financial statements. Check currency, credit notes, cancellations and missing records.",
    "screen": "reports",
    "view": "reports"
  },
  {
    "id": "gst-returns",
    "title": "Prepare GST information",
    "group": "Review & tax",
    "intro": "Review books and prepare export files for your filing workflow.",
    "steps": [
      "Open GST Returns and select the relevant period.",
      "Review GSTR-1 and GSTR-3B information and compare totals with your books.",
      "Import the relevant GSTR-2B information for reconciliation. Investigate mismatched, books-only and portal-only records.",
      "Export the supported file, validate it with the current government utilities and complete filing through your authorized process."
    ],
    "notes": "KNOWGST does not currently submit returns or register invoices with an IRP. Export success is not filing acceptance. Verify rates, time of supply and credit eligibility.",
    "screen": "gst",
    "view": "filing"
  },
  {
    "id": "income-tax",
    "title": "Review income tax",
    "group": "Review & tax",
    "intro": "Keep the filing year separate from the year in which income is being earned.",
    "steps": [
      "Open Income Tax and confirm the financial year before entering figures.",
      "Use the supported historical filing-year calculations for FY 2024–25 or FY 2025–26.",
      "For ordinary current-year income, expand Tax Year 2026–27 · New-regime estimate and review its stated limits.",
      "Reconcile every figure and confirm the applicable deadline before filing externally."
    ],
    "notes": "The current-year estimate covers resident individuals with ordinary taxable income up to ₹50 lakh. It excludes capital gains, other special-rate income, surcharge and most deductions. It is not a full current-year return.",
    "screen": "income-tax",
    "view": "incometax"
  },
  {
    "id": "settings",
    "title": "Settings",
    "group": "Workspace",
    "intro": "Maintain your business profile and local preferences.",
    "steps": [
      "Open Settings to review business details, invoice preferences and enabled modules.",
      "Save the changes and inspect a document that uses them.",
      "Use the backup tools before importing or restoring records."
    ],
    "notes": "The local lock is not multi-user hosted authentication. Do not expose this local service directly to the internet.",
    "screen": "settings",
    "view": "settings"
  },
  {
    "id": "backups",
    "title": "Back up and restore",
    "group": "Workspace",
    "intro": "Protect both your records and the PDF files saved by KNOWGST.",
    "steps": [
      "Open Control Panel and choose Create Backup. Wait for the success message.",
      "Open the backups folder and keep a separate copy on another disk or protected location.",
      "To restore, select the required snapshot, read the confirmation and choose Restore.",
      "Reopen records and PDFs after restoration. Keep the pre-restore recovery copy until you have checked the result."
    ],
    "notes": "New complete snapshots include application data, Saved Invoices and PDF trash, verified with SHA-256 manifests. Legacy snapshots restore data only and leave PDFs in place. JSON exports are records-only. Backups are not encrypted.",
    "screen": "control-panel",
    "view": "controlpanel"
  },
  {
    "id": "control-panel",
    "title": "Control Panel",
    "group": "Workspace",
    "intro": "Create a complete snapshot and find your local data folders.",
    "steps": [
      "Choose Create Backup for an immediate snapshot.",
      "Use Open backups folder or Open data folder to locate local files.",
      "Review the saved snapshots and choose Restore only after checking the date."
    ],
    "notes": "A pre-restore snapshot is created before replacement. Interrupted restore recovery runs at service startup. Upstream self-update and installer execution are disabled in this edition.",
    "screen": "control-panel",
    "view": "controlpanel"
  },
  {
    "id": "integrations",
    "title": "OCR, Drive and sharing",
    "group": "Help",
    "intro": "Understand which features run locally and which use an external service.",
    "steps": [
      "Use purchase OCR to extract a draft from an image, then correct and save it.",
      "Configure Google Drive only if you want to send backup data to that provider. Verify authorization and the uploaded result.",
      "Review a WhatsApp draft and its recipient before sending it yourself."
    ],
    "notes": "Local OCR has automated extraction coverage. Live Drive authorization, real delivery and third-party account behavior remain unverified. AI and expanded messaging integrations are planned, not shipped.",
    "screen": "purchases",
    "view": "purchases"
  },
  {
    "id": "troubleshooting",
    "title": "Troubleshooting",
    "group": "Help",
    "intro": "Start with the failed action and preserve your original data.",
    "steps": [
      "If the app cannot load, confirm the local service is running and use the address it prints.",
      "If OCR returns poor results, use a clear image and enter the bill manually when needed.",
      "If a restore fails integrity checks, keep the rejected snapshot and use another verified copy. Do not edit its manifest to bypass validation.",
      "If totals look wrong, check document type, period, currency, payment status, rates and duplicate entries."
    ],
    "notes": "When reporting a problem, describe the steps and expected result. Remove customer details, tax identifiers and credentials from screenshots and logs.",
    "screen": null,
    "view": null
  },
  {
    "id": "limitations",
    "title": "Release scope",
    "group": "Help",
    "intro": "Know what has been implemented and what still needs production work.",
    "steps": [
      "Use the local compatibility edition for the implemented modules documented here.",
      "Keep independent backups and validate financial exports before external use.",
      "Track release evidence and remaining work in the repository documentation."
    ],
    "notes": "This is not a claim of exhaustive parity or production certification. Hosted authentication, PostgreSQL migration, packaged macOS builds, live integration validation, broader security/accessibility work and AI remain unfinished. KNOWGST is GPL-3.0-only with retained upstream MIT notices.",
    "screen": null,
    "view": null
  }
];
