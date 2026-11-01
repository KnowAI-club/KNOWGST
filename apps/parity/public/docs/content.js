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
    "notes": "This guide shows the implemented KNOWGST app with fictional sample records, refreshed on 1 November 2026. Your business records remain local. Optional ChatGPT and Resend connections use the internet only for the requests you initiate. Bank feeds and automatic tax filing are not included.",
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
    "notes": "Use the KNOWGST desktop app, or the local development preview started with pnpm dev. This guide uses fictional business data; enter your own verified business details before issuing documents.",
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
      "Inspect the preview, then choose Save & Download. Confirm the record appears in Invoices and the downloaded PDF opens."
    ],
    "notes": "HSN descriptions are historical hints. They do not certify the applicable rate. Enter the verified rate for your supply; changing an HSN code no longer overwrites your selection.",
    "screen": "invoice",
    "view": "new"
  },
  {
    "id": "dashboard",
    "title": "Understand your dashboard",
    "group": "Start here",
    "intro": "Review the selected business, recorded money movement and work needing attention.",
    "steps": [
      "Choose a month and currency. Sales exclude GST and TCS; money received includes recorded inflows in that month.",
      "Customer and supplier balances are current across all dates. Supplier balances include accounting-managed purchases only.",
      "Use the attention queue to review overdue invoices, unallocated receipts, low stock and historical accounting records.",
      "Filter recent activity or open a row to inspect it, then open its source register. Use Invoices for editing, payments and printing."
    ],
    "notes": "Recorded money movement is not a bank balance or profit. Manual journals and untracked purchase payments are excluded. Invoice tax is not a filed return. A backup date does not verify its integrity. Unassigned records are excluded and flagged.",
    "screen": "dashboard",
    "view": "dashboard"
  },
  {
    "id": "invoice-register",
    "title": "Find and manage invoices",
    "group": "Sales",
    "intro": "Invoices brings saved documents and collection information into one place.",
    "steps": [
      "Use the document list and filters to find a customer or invoice.",
      "Open the relevant row action to view, edit, print or duplicate a document.",
      "Review payment and cancellation status before relying on report totals."
    ],
    "notes": "Quotations, estimates and delivery challans are not sales revenue. Credit notes reduce sales. Keep supporting records for corrections.",
    "screen": "invoice-register",
    "view": "invoices"
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
    "notes": "When both images are present, Settings → Business Profile offers side-by-side, stacked or overlaid signature/stamp layouts. Printer output varies with device and browser settings. A generated PDF or GST export is not a government-issued IRN or a filed return.",
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
    "id": "email-documents",
    "title": "Email invoices and receipts",
    "group": "Sales",
    "intro": "Send a reviewed PDF attachment using your own verified Resend sender.",
    "screen": "email-invoice",
    "view": "invoices",
    "steps": [
      "Configure Resend under Settings → Integrations. Verify the sender domain in Resend before sending.",
      "For an invoice, open More actions → Email PDF with Resend. For a receipt, select Email receipt PDF.",
      "Check the recipient. Linked invoice customer email is prefilled where available; otherwise enter it yourself.",
      "Open Review PDF to inspect the generated attachment. PDFs larger than 3 MB are rejected.",
      "Review the subject and message, then select Send email. The app does not send when opening a draft.",
      "If the network result is unconfirmed, retry the same draft to reuse its request ID. Check Resend before closing and creating another draft."
    ],
    "notes": "Accepted by Resend means the provider queued the email; it is not confirmed delivery. Check the Resend dashboard for delivered, bounced or rejected messages. Draft fields lock after the first attempt to keep retries identical. Safe retries expire after 23 hours. The existing Open email app action remains available without Resend."
  },
  {
    "id": "recurring",
    "title": "Recurring invoices",
    "group": "Money in",
    "intro": "Use a saved template for repeating billing.",
    "steps": [
      "Open Recurring and choose New Template.",
      "Enter customer and item details, the schedule and its start or end conditions.",
      "Save the template. Use its generation control when due, and review the resulting invoice in Invoices.",
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
      "Use the section navigation to open Company, Print & PDF, Features, Backups, Integrations or Google Drive.",
      "Save business profile changes with Save changes. Print settings keep their existing save controls.",
      "Under Integrations, connect your own ChatGPT account or enter a Resend sending key and verified sender. Integration settings save separately from your business profile.",
      "Use the Google Drive section for browser OAuth or a synced secondary backup folder.",
      "Review a sample invoice after changing branding, tax details or print layout."
    ],
    "notes": "Connections apply to this device, across its business profiles. Saved secrets are write-only in the UI and excluded from portable backups. A saved Resend key is configured, not proof of delivery. Reconnect integrations when moving devices.",
    "screen": "settings",
    "view": "settings"
  },
  {
    "id": "integrations",
    "title": "Connect ChatGPT and email",
    "group": "Workspace",
    "intro": "Use your own ChatGPT account for read-only AI assistance and Resend to email document PDFs.",
    "screen": "integrations",
    "view": "settings",
    "steps": [
      "Open Settings → Integrations. Under ChatGPT, select Continue with ChatGPT.",
      "Complete sign-in and consent in your system browser. Authorize ChatGPT plan usage if your account is eligible, then return to KNOWGST. No API key or shared subscription is required.",
      "Your account appears after its identity is verified. Use Reconnect, Use account or Sign out to manage saved connections. Manage ChatGPT usage opens the provider’s account limits.",
      "Expand Ask ChatGPT, load your available models, choose one and enter a question. Only your typed question is sent; invoices, customer lists and books are not attached automatically.",
      "For email, create a Resend sending-access API key for your verified domain. Enter sender name, sender email, optional reply-to and API key; select Save email settings.",
      "Open an invoice’s More actions → Email PDF with Resend, or a receipt’s Email receipt PDF button. Review the PDF, recipient, subject and message, then select Send email."
    ],
    "notes": "ChatGPT OAuth supports eligible open-source/local-app plan usage; account permissions and availability are controlled by OpenAI. AI cannot edit your books or file returns. Resend uses an API key, not ChatGPT OAuth. Credentials are stored in owner-protected device files outside portable backups; this is not an encrypted vault. No live provider account is connected by default."
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
    "notes": "New complete snapshots include application data, Saved Invoices and PDF trash, verified with SHA-256 manifests. Legacy snapshots restore data only and leave PDFs in place. JSON exports are records-only. Backups are not encrypted. Use a separate secondary folder for each installation; a folder owned by another installation cannot be overwritten.",
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
      "Review a WhatsApp draft and its saved-client recipient before sending it yourself. On desktop, the PDF downloads for you to attach manually."
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
