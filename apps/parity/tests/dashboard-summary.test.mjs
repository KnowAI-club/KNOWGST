import test from "node:test";
import assert from "node:assert/strict";
import { dashboardSummary } from "../dashboard-summary.mjs";
const base = { month: "2026-11", currency: "INR", today: "2026-11-15" };
const invoice = (id, extra = {}) => ({
  id,
  invoiceType: "tax-invoice",
  invoiceDate: "2026-11-02",
  totalAmount: 118,
  totalTaxAmount: 18,
  status: "unpaid",
  paidAmount: 40,
  payments: [{ id: "payment-" + id, amount: 40, date: "2026-11-03" }],
  data: { details: { dueDate: "2026-11-10" } },
  ...extra,
});
test("dashboard distinguishes monthly revenue, recorded cash and all-date open balances", () => {
  const result = dashboardSummary({
    ...base,
    bills: [
      invoice("sale"),
      invoice("last", {
        invoiceDate: "2026-10-01",
        payments: [],
        paidAmount: 0,
      }),
      invoice("credit", {
        invoiceType: "credit-note",
        totalAmount: 11.8,
        totalTaxAmount: 1.8,
        payments: [],
        paidAmount: 0,
      }),
      invoice("estimate", { invoiceType: "proforma", payments: [] }),
      invoice("cancelled", {
        status: "cancelled",
        payments: [{ id: "retained-cash", amount: 10, date: "2026-11-04" }],
      }),
      invoice("usd", { currency: "USD" }),
    ],
    receipts: [
      { id: "payment-sale", amount: 40, date: "2026-11-03", billId: "sale" },
      { id: "standalone", amount: 20, date: "2026-11-05" },
    ],
    expenses: [{ id: "expense", amount: 15, date: "2026-11-06" }],
    purchases: [
      {
        id: "tracked",
        totalAmount: 50,
        supplierPaidMinor: 2000,
        accountingManaged: true,
      },
      { id: "untracked", totalAmount: 500 },
    ],
    accounting: {
      supplierPayments: [
        { id: "paid", amount: 2000, date: "2026-11-07", currency: "INR" },
      ],
    },
  });
  assert.equal(result.sales, 9000);
  assert.equal(result.previousSales, 10000);
  assert.equal(result.invoiceTax, 1620);
  assert.equal(result.received, 7000);
  assert.equal(result.spent, 3500);
  assert.equal(result.outstanding, 19600);
  assert.equal(result.overdueAmount, 19600);
  assert.equal(result.payable, 3000);
  assert.equal(result.untrackedPurchases, 1);
  assert.deepEqual(result.unallocated, ["standalone"]);
  assert.equal(
    result.weeks.reduce((n, w) => n + w.in, 0),
    result.received,
  );
  assert.equal(
    result.weeks.reduce((n, w) => n + w.out, 0),
    result.spent,
  );
  assert.ok(!result.activity.some((r) => r.id === "usd" || r.id === "last"));
});
test("cash refunds, supplier reversals and duplicate mirrored receipts reconcile exactly", () => {
  const s = dashboardSummary({
    ...base,
    bills: [
      invoice("one", {
        payments: [
          { id: "p", receiptNo: "R1", amount: 0.01, date: "2026-11-01" },
          { id: "refund", amount: -0.01, date: "2026-11-02" },
        ],
      }),
      invoice("two", {
        payments: [{ id: "p", amount: 0.01, date: "2026-11-01" }],
      }),
    ],
    receipts: [
      { id: "different-id", receiptNo: "R1", amount: 0.01, date: "2026-11-01" },
    ],
    accounting: {
      supplierPayments: [
        {
          amount: 99,
          date: "2026-11-02",
          currency: "INR",
          reversalOf: "original",
        },
      ],
    },
  });
  assert.equal(s.received, 100);
  assert.equal(s.spent, 1);
  assert.equal(s.unallocated.length, 0);
  assert.match(s.warnings.join(" "), /Repeated/);
});
test("month boundary, TCS exclusion, no activity and stock threshold settings are explicit", () => {
  const s = dashboardSummary({
    ...base,
    bills: [
      invoice("tcs", {
        totalAmount: 119,
        paidAmount: 0,
        payments: [],
        data: { totals: { tcsAmount: 1 } },
      }),
    ],
    products: [
      { id: "low", stock: 5 },
      { id: "high", stock: 6 },
    ],
    stockSettings: { threshold: 5 },
  });
  assert.equal(s.sales, 10000);
  assert.equal(s.lowStock.length, 1);
  assert.equal(s.weeks.length, 5);
  assert.equal(s.received, 0);
  assert.equal(
    dashboardSummary({
      ...base,
      products: [{ id: "low", stock: 0 }],
      stockSettings: { enabled: false },
    }).lowStock.length,
    0,
  );
  assert.equal(
    dashboardSummary({ ...base, bills: [], month: "2026-02" }).weeks.length,
    4,
  );
});
test("unsupported monetary precision is flagged instead of silently changing totals", () => {
  const s = dashboardSummary({
    ...base,
    expenses: [{ id: "invalid", date: "2026-11-01", amount: "1.001" }],
  });
  assert.equal(s.spent, 0);
  assert.ok(s.warnings.length);
});
