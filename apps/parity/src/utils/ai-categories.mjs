// Each category is tagged with its ITR (Income Tax Return) head so the
// v1.7.0+ ITR Filing Summary can auto-aggregate expenses under the correct
// P&L line. Users don't have to think about heads - they pick the category
// they already understand.
//   - 'business'      → deductible business expense under section 37
//   - 'depreciation'  → section 32 (asset purchases, capitalised then
//                       depreciated per Rule 5)
//   - 'salary'        → separately tracked; declared under section 40A(2)(b)
//                       for related parties
//   - 'notDeductible' → personal / drawings / capital / non-business
export const EXPENSE_CATEGORIES = [
  { name: "Office Rent", itrHead: "business" },
  { name: "Utilities", itrHead: "business" },
  { name: "Internet & Phone", itrHead: "business" },
  { name: "Software & Tools", itrHead: "business" },
  { name: "Travel", itrHead: "business" },
  { name: "Meals & Entertainment", itrHead: "business" },
  { name: "Office Supplies", itrHead: "business" },
  { name: "Salary & Wages", itrHead: "salary" },
  { name: "Professional Fees", itrHead: "business" },
  { name: "Insurance", itrHead: "business" },
  { name: "Marketing & Ads", itrHead: "business" },
  { name: "Raw Materials", itrHead: "business" },
  { name: "Shipping & Courier", itrHead: "business" },
  { name: "Repairs & Maintenance", itrHead: "business" },
  { name: "Bank Charges", itrHead: "business" },
  { name: "GST Paid", itrHead: "business" },
  { name: "Asset Purchase", itrHead: "depreciation" },
  { name: "Personal / Drawings", itrHead: "notDeductible" },
  { name: "Other", itrHead: "business" },
];

export const BANK_CATEGORY_LABELS = {
  salary: "Salary income",
  business_in: "Business receipts",
  business_out: "Business expense",
  interest: "Interest earned",
  rent_received: "Rent received",
  investment: "Investment / MF / PPF",
  deduction_80C: "80C claim",
  deduction_80D: "80D claim",
  gst_paid: "GST paid",
  transfer: "Transfer / unclassified",
  personal: "Personal spending",
};

export const categoryLabels = (kind) =>
  kind === "expense"
    ? Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c.name, c.name]))
    : BANK_CATEGORY_LABELS;
