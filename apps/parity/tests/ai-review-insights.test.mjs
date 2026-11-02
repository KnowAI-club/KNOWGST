import test from "node:test";
import assert from "node:assert/strict";
import { reviewInsights } from "../ai-review-insights.mjs";

const options = {
  businessId: "business-one",
  month: "2026-11",
  currency: "INR",
  asOf: "2026-11-15",
};
const line = (account, debit, credit = 0) => ({ account, debit, credit });
const entry = (id, date, lines, other = {}) => ({
  id,
  date,
  lines,
  currency: "INR",
  businessId: options.businessId,
  ...other,
});
const bill = (id, other = {}) => ({
  id,
  businessId: options.businessId,
  invoiceNumber: `INV-${id}`,
  invoiceDate: "2026-11-01",
  totalAmount: 118,
  paidAmount: 0,
  status: "unpaid",
  invoiceType: "tax-invoice",
  data: {
    client: { name: "Example Customer" },
    details: { dueDate: "2026-11-10" },
    totals: { tdsAmount: 0 },
  },
  ...other,
});
const purchase = (id, other = {}) => ({
  id,
  businessId: options.businessId,
  date: "2026-11-01",
  invoiceNumber: `PUR-${id}`,
  supplierName: "Example Supplier",
  totalAmount: 100,
  paymentStatus: "Unpaid",
  currency: "INR",
  ...other,
});

function fixture() {
  const data = {
    bills: [],
    expenses: [],
    receipts: [],
    purchases: [],
    clients: [],
    journal: [],
    supplierPayments: [],
  };
  let account = "account-one",
    active = options.businessId,
    now = Date.parse("2026-11-15T00:00:00Z"),
    persisted = { revision: 0, data: {} },
    answer = { text: "Review the source references before making changes." },
    beforeRequest,
    afterRequest;
  const calls = [];
  const store = {
    read({ businessId, bucket }) {
      assert.equal(businessId, active);
      assert.equal(bucket, "insights");
      return structuredClone(persisted);
    },
    update({ businessId, bucket, revision, data }) {
      assert.equal(businessId, active);
      assert.equal(bucket, "insights");
      if (revision !== persisted.revision)
        throw Object.assign(new Error("Stale review state"), { status: 409 });
      persisted = { revision: revision + 1, data: structuredClone(data) };
      return structuredClone(persisted);
    },
  };
  const chat = {
    status: () => ({ active: account }),
    async ask(request, hooks) {
      await beforeRequest?.();
      hooks?.beforeSend?.();
      calls.push(request);
      await afterRequest?.();
      return answer;
    },
  };
  const readModule = (businessId, module) => {
    if (businessId !== active) throw new Error("Business changed");
    return module === "profile"
      ? [
          {
            id: active,
            bankAccount: "not-supplied-to-model",
            apiKey: "never-sent",
          },
        ]
      : structuredClone(data[module]);
  };
  const api = reviewInsights({ chat, readModule, store, now: () => now });
  return {
    api,
    data,
    calls,
    store,
    chat,
    readModule,
    get persisted() {
      return structuredClone(persisted);
    },
    setAccount(value) {
      account = value;
    },
    setBusiness(value) {
      active = value;
    },
    setTime(value) {
      now = value;
    },
    setAnswer(value) {
      answer = value;
    },
    before(fn) {
      beforeRequest = fn;
    },
    after(fn) {
      afterRequest = fn;
    },
  };
}

test("posted P&L and balance sheet include reversals, previous month deltas and source contributions", () => {
  const f = fixture();
  f.data.bills.push(bill("one"));
  f.data.expenses.push({
    id: "expense-one",
    businessId: options.businessId,
    date: "2026-11-03",
    amount: 20,
  });
  f.data.journal.push(
    entry("opening", "2026-10-01", [
      line("1000", 10000),
      line("3000", 0, 10000),
    ]),
    entry("sale-old", "2026-10-15", [
      line("1100", 5000),
      line("4000", 0, 5000),
    ]),
    entry(
      "sale-one",
      "2026-11-01",
      [line("1100", 11800), line("4000", 0, 10000), line("2100", 0, 1800)],
      { source: "sale:one", sourceKey: "sale" },
    ),
    entry(
      "cost-one",
      "2026-11-03",
      [line("5100", 2000), line("1000", 0, 2000)],
      { source: "expense:expense-one" },
    ),
    entry(
      "cost-reversal",
      "2026-11-03",
      [line("5100", 0, 2000), line("1000", 2000)],
      { source: "expense:expense-one", reversalOf: "cost-one" },
    ),
    entry(
      "cost-corrected",
      "2026-11-03",
      [line("5100", 3000), line("1000", 0, 3000)],
      { source: "expense:expense-one" },
    ),
    entry("future", "2026-12-01", [line("1100", 1000), line("4000", 0, 1000)]),
    entry(
      "foreign-unit",
      "2026-11-02",
      [line("1100", 500), line("4000", 0, 500)],
      { currency: "USD" },
    ),
  );
  const report = f.api.reports(options);
  assert.deepEqual(report.profitLoss, {
    income: 10000,
    expenses: 3000,
    profit: 7000,
    previousIncome: 5000,
    previousExpenses: 0,
    previousProfit: 5000,
    incomeDelta: 5000,
    expenseDelta: 3000,
    profitDelta: 2000,
  });
  assert.deepEqual(report.balanceSheet, {
    assets: 23800,
    liabilities: 1800,
    equity: 10000,
    retainedEarnings: 12000,
    equityIncludingEarnings: 22000,
    difference: 0,
  });
  assert.equal(report.coverage.entries, 6);
  assert.equal(report.coverage.otherCurrencies, 1);
  const sale = report.accounts.find((row) => row.code === "4000");
  assert.equal(sale.contributions.length, 2);
  assert.equal(sale.contributions[0].source.id, "one");
  assert.match(report.basis, /gross/);
  const preview = f.api.preview({ ...options, task: "reports" });
  const incomeContext = preview.context.accounts.find(
    (account) => account.code === "4000",
  );
  assert.equal(incomeContext.contributionCoverage.currentEntries, 1);
  assert.equal(incomeContext.contributions[0].source.id, "one");
  assert(!preview.prompt.includes("foreign-unit"));
  const foreign = f.api.reports({ ...options, currency: "USD" });
  assert.equal(foreign.profitLoss.income, 500);
  assert.match(foreign.note, /supports INR/);
});

test("invalid, duplicate and unbalanced journal sources cannot produce trusted report totals", () => {
  for (const lines of [
    [line("1100", 100), line("4000", 0, 90)],
    [line("1100", 10.5), line("4000", 0, 10.5)],
    [line("9999", 100), line("4000", 0, 100)],
  ]) {
    const f = fixture();
    f.data.journal.push(entry("invalid", "2026-11-01", lines));
    assert.throws(() => f.api.reports(options), /journal/i);
    assert(
      f.api
        .review(options)
        .findings.some((row) => row.kind === "invalid-journal"),
    );
  }
  const f = fixture();
  const one = entry("same", "2026-11-01", [
    line("1000", 100),
    line("3000", 0, 100),
  ]);
  f.data.journal.push(one, one);
  assert.throws(() => f.api.reports(options), /repeated identity/);
});

test("book review finds duplicate expenses, missing allocation and repeated active posting without treating reversals as duplicates", () => {
  const f = fixture();
  f.data.expenses.push(
    ...["one", "two"].map((id) => ({
      id,
      businessId: options.businessId,
      date: "2026-11-03",
      amount: 50,
      description: "Office internet",
      vendorName: "Example Provider",
    })),
  );
  f.data.receipts.push({
    id: "advance",
    businessId: options.businessId,
    date: "2026-11-02",
    amount: 10,
    receiptNo: "RC-1",
  });
  f.data.bills.push(bill("one"));
  f.data.journal.push(
    entry(
      "first",
      "2026-11-01",
      [line("1100", 11800), line("4000", 0, 11800)],
      { source: "sale:one", sourceKey: "sale" },
    ),
    entry(
      "reverse",
      "2026-11-01",
      [line("1100", 0, 11800), line("4000", 11800)],
      { source: "sale:one", sourceKey: "sale", reversalOf: "first" },
    ),
    entry(
      "corrected",
      "2026-11-01",
      [line("1100", 11800), line("4000", 0, 11800)],
      { source: "sale:one", sourceKey: "sale" },
    ),
  );
  let review = f.api.review(options);
  assert.equal(
    review.findings.filter((row) => row.kind === "duplicate-expenses").length,
    1,
  );
  assert.equal(
    review.findings.filter((row) => row.kind === "unallocated-receipt").length,
    1,
  );
  assert.equal(
    review.findings.filter((row) => row.kind === "duplicate-posting").length,
    0,
  );
  f.data.journal.push(
    entry(
      "duplicate",
      "2026-11-01",
      [line("1100", 11800), line("4000", 0, 11800)],
      { source: "sale:one", sourceKey: "sale" },
    ),
  );
  review = f.api.review(options);
  assert.equal(
    review.findings.filter((row) => row.kind === "duplicate-posting").length,
    1,
  );
});

test("finding review state is persisted, revision checked and changed evidence reopens it", () => {
  const f = fixture();
  f.data.receipts.push({
    id: "advance",
    businessId: options.businessId,
    date: "2026-11-02",
    amount: 10,
    receiptNo: "RC-1",
  });
  const first = f.api.review(options),
    finding = first.findings.find((row) => row.kind === "unallocated-receipt");
  const dismissed = f.api.resolve({
    ...options,
    findingId: finding.id,
    status: "dismissed",
    note: "Confirmed as a customer advance",
    revision: first.revision,
    fingerprint: first.fingerprint,
  });
  assert.equal(
    dismissed.findings.find((row) => row.id === finding.id).status,
    "dismissed",
  );
  assert.equal(f.persisted.revision, 1);
  assert.throws(
    () =>
      f.api.resolve({
        ...options,
        findingId: finding.id,
        status: "open",
        note: "",
        revision: first.revision,
        fingerprint: first.fingerprint,
      }),
    /changed/,
  );
  const restarted = reviewInsights({
    chat: f.chat,
    readModule: f.readModule,
    store: f.store,
  });
  assert.equal(
    restarted.review(options).findings.find((row) => row.id === finding.id)
      .status,
    "dismissed",
  );
  f.data.receipts[0].receiptNo = "RC-CHANGED";
  assert.equal(
    f.api.review(options).findings.find((row) => row.id === finding.id).status,
    "open",
  );
  assert.equal(f.data.receipts[0].amount, 10);
});

test("collection order uses age, TDS-adjusted balance and actual payment history, excluding unsafe contacts", () => {
  const f = fixture();
  f.data.clients.push({
    id: "suppressed-client",
    businessId: options.businessId,
    doNotContact: true,
  });
  f.data.bills.push(
    bill("late", {
      invoiceDate: "2026-10-01",
      totalAmount: 120,
      paidAmount: 20,
      data: {
        client: { name: "Example" },
        details: { dueDate: "2026-10-10" },
        totals: { tdsAmount: 10 },
      },
      payments: [{ id: "p", date: "2026-11-01", amount: 20, mode: "bank" }],
    }),
    bill("current"),
    bill("no-date", { data: { client: { name: "No due" }, totals: {} } }),
    bill("paid", { paidAmount: 118, status: "paid" }),
    bill("disputed", { disputed: true }),
    bill("suppress", { clientId: "suppressed-client" }),
    bill("cancel", { status: "cancelled" }),
    bill("credit", { invoiceType: "credit-note" }),
    bill("future", { invoiceDate: "2026-12-01" }),
    bill("foreign-unit", { currency: "USD" }),
  );
  const result = f.api.collections(options);
  assert.deepEqual(
    result.rows.map((row) => row.source.id),
    ["late", "current", "no-date"],
  );
  assert.equal(result.rows[0].balance, 9000);
  assert.equal(result.rows[0].daysOverdue, 36);
  assert.equal(result.rows[0].paymentCount, 1);
  assert.equal(result.rows[0].lastPaymentDate, "2026-11-01");
  assert.equal(result.rows[2].daysOverdue, null);
  assert.equal(result.totalOutstanding, 32600);
  assert.equal(result.excluded.length, 6);
  assert.equal(
    f.api.collections({ ...options, currency: "USD" }).rows.length,
    1,
  );
  assert.equal(f.calls.length, 0);
});

test("collection holds are explicit and durable, stale writes rejected and removing a hold never overrides source suppression", () => {
  const f = fixture();
  f.data.bills.push(bill("one"));
  const before = f.api.collections(options);
  const held = f.api.hold({
    ...options,
    invoiceId: "one",
    reason: "disputed",
    note: "Customer requested review",
    revision: before.revision,
    fingerprint: before.fingerprint,
  });
  assert.equal(held.rows.length, 0);
  assert.equal(held.excluded[0].held, true);
  assert.equal(f.persisted.data.holds.one.reason, "disputed");
  f.data.bills[0].doNotContact = true;
  assert.throws(
    () =>
      f.api.hold({
        ...options,
        invoiceId: "one",
        reason: "remove",
        note: "",
        revision: held.revision,
        fingerprint: held.fingerprint,
      }),
    /changed/,
  );
  const updated = f.api.collections(options);
  const removed = f.api.hold({
    ...options,
    invoiceId: "one",
    reason: "remove",
    note: "",
    revision: updated.revision,
    fingerprint: updated.fingerprint,
  });
  assert.equal(removed.rows.length, 0);
  assert.equal(removed.excluded[0].reason, "Contact suppressed");
  assert.equal(f.data.bills[0].paidAmount, 0);
});

test("supplier plan computes partial balances and reversals, excludes unknown legacy paid balances and budgets known dates only", () => {
  const f = fixture();
  f.data.purchases.push(
    purchase("tracked", {
      accountingManaged: true,
      supplierPaidMinor: 3000,
      dueDate: "2026-11-01",
      paymentStatus: "Partial",
    }),
    purchase("next", { dueDate: "2026-11-12", totalAmount: 50 }),
    purchase("unknown"),
    purchase("legacy", { paymentStatus: "Partial" }),
    purchase("settled", {
      accountingManaged: true,
      supplierPaidMinor: 10000,
      paymentStatus: "Paid",
    }),
  );
  f.data.supplierPayments.push(
    {
      id: "pay-one",
      purchaseId: "tracked",
      amount: 3000,
      currency: "INR",
      date: "2026-11-02",
    },
    {
      id: "pay-two",
      purchaseId: "tracked",
      amount: 2000,
      currency: "INR",
      date: "2026-11-03",
    },
    {
      id: "reverse-two",
      purchaseId: "tracked",
      amount: 2000,
      currency: "INR",
      date: "2026-11-04",
      reversalOf: "pay-two",
    },
    {
      id: "pay-settled",
      purchaseId: "settled",
      amount: 10000,
      currency: "INR",
      date: "2026-11-05",
    },
  );
  const result = f.api.suppliers({ ...options, budget: "90" });
  assert.deepEqual(
    result.rows.map((row) => [row.source.id, row.balance, row.proposedAmount]),
    [
      ["tracked", 7000, 7000],
      ["next", 5000, 2000],
      ["unknown", 10000, 0],
    ],
  );
  assert.equal(result.proposedTotal, 9000);
  assert.equal(result.remainingBudget, 0);
  assert.equal(result.outstanding, 22000);
  assert.equal(result.excluded.length, 2);
  assert.equal(result.rows[0].paid, 3000);
  const saved = f.api.planDue({
    ...options,
    purchaseId: "unknown",
    date: "2026-10-30",
    revision: result.revision,
    fingerprint: result.fingerprint,
    budget: "90",
  });
  assert.equal(saved.rows[0].source.id, "unknown");
  assert.equal(saved.rows[0].planningDate, true);
  assert.equal(saved.rows[0].proposedAmount, 9000);
  assert.equal(
    f.data.purchases.find((p) => p.id === "unknown").dueDate,
    undefined,
  );
  assert.equal(f.data.supplierPayments.length, 4);
});

test("supplier plan rejects inconsistent reversal or cached balances instead of proposing another payment", () => {
  for (const mutate of [
    (f) => {
      f.data.purchases[0].supplierPaidMinor = 1000;
    },
    (f) => {
      f.data.supplierPayments.push({
        id: "reverse",
        purchaseId: "one",
        amount: 1000,
        currency: "INR",
        date: "2026-11-05",
        reversalOf: "payment",
      });
    },
    (f) => {
      f.data.supplierPayments[0].currency = "USD";
    },
  ]) {
    const f = fixture();
    f.data.purchases.push(
      purchase("one", { accountingManaged: true, supplierPaidMinor: 2000 }),
    );
    f.data.supplierPayments.push({
      id: "payment",
      purchaseId: "one",
      amount: 2000,
      currency: "INR",
      date: "2026-11-02",
    });
    mutate(f);
    const result = f.api.suppliers(options);
    assert.equal(result.rows.length, 0);
    assert.equal(result.excluded.length, 1);
  }
});

test("requests reject invalid filters, duplicate source IDs and cross-business records", () => {
  for (const override of [
    { month: "2026-13" },
    { asOf: "2026-02-30" },
    { currency: "inr" },
    { businessId: "other" },
    { action: "pay" },
  ]) {
    const f = fixture();
    assert.throws(() => f.api.review({ ...options, ...override }));
  }
  const f = fixture();
  f.data.bills.push(bill("foreign", { businessId: "another-business" }));
  assert.throws(() => f.api.collections(options), /another business/);
  f.data.bills = [bill("same"), bill("same")];
  assert.throws(() => f.api.collections(options), /repeated identity/);
});

test("optional narration previews bounded evidence and never exposes raw credentials, bank details or full memos", async () => {
  const f = fixture();
  f.data.purchases.push(
    purchase("one", {
      bankAccount: "bank-secret",
      supplierGstin: "gst-secret",
      note: "memo-secret",
      dueDate: "2026-11-01",
    }),
  );
  const preview = f.api.preview({ ...options, task: "suppliers" });
  assert.equal(preview.context.rows.length, 1);
  for (const secret of [
    "bank-secret",
    "gst-secret",
    "memo-secret",
    "never-sent",
    "not-supplied-to-model",
  ])
    assert(!preview.prompt.includes(secret));
  await assert.rejects(
    f.api.explain({
      businessId: options.businessId,
      snapshotId: preview.id,
      model: "test",
      consent: false,
    }),
    /Approve/,
  );
  assert.equal(f.calls.length, 0);
  assert.match(
    (
      await f.api.explain({
        businessId: options.businessId,
        snapshotId: preview.id,
        model: "test",
        consent: true,
      })
    ).text,
    /Review/,
  );
  await assert.rejects(
    f.api.explain({
      businessId: options.businessId,
      snapshotId: preview.id,
      model: "test",
      consent: true,
    }),
    /expired/,
  );
  assert.equal(f.calls.length, 1);
});

test("narration rechecks account, business, records and review state immediately before transmission and after reply", async () => {
  for (const mutate of [
    (f) => f.setAccount("another-account"),
    (f) => f.setBusiness("another-business"),
    (f) => f.data.bills.push(bill("new-source")),
    (f) =>
      f.store.update({
        businessId: options.businessId,
        bucket: "insights",
        revision: 0,
        data: { holds: {} },
      }),
    (f) => f.setTime(Date.parse("2026-11-15T00:06:00Z")),
  ])
    for (const when of ["before", "after"]) {
      const f = fixture(),
        preview = f.api.preview({ ...options, task: "review" });
      f[when](() => mutate(f));
      await assert.rejects(
        f.api.explain({
          businessId: options.businessId,
          snapshotId: preview.id,
          model: "test",
          consent: true,
        }),
      );
      if (when === "before") assert.equal(f.calls.length, 0);
    }
});

test("provider refusals, malformed and oversized answers cannot be shown as successful explanations", async () => {
  for (const answer of [
    { refusal: true, text: "No" },
    { text: 1 },
    { text: "" },
    { text: "a".repeat(16001) },
    { text: "bad\u0000text" },
  ]) {
    const f = fixture();
    f.setAnswer(answer);
    const preview = f.api.preview({ ...options, task: "reports" });
    await assert.rejects(
      f.api.explain({
        businessId: options.businessId,
        snapshotId: preview.id,
        model: "test",
        consent: true,
      }),
    );
  }
});

test("month-end review compares supplier and receipt references across earlier months", () => {
  const f = fixture();
  f.data.purchases.push(
    purchase("old", { date: "2026-10-01", invoiceNumber: "REPEATED" }),
    purchase("new", { invoiceNumber: "REPEATED" }),
  );
  f.data.receipts.push(
    {
      id: "receipt-old",
      date: "2026-10-01",
      amount: 10,
      receiptNo: "REPEAT-RC",
    },
    {
      id: "receipt-new",
      date: "2026-11-01",
      amount: 10,
      receiptNo: "REPEAT-RC",
      againstInvoice: "missing-reference",
    },
  );
  const result = f.api.review(options);
  assert.equal(
    result.findings.filter((row) => row.kind === "duplicate-purchases").length,
    1,
  );
  assert.equal(
    result.findings.filter((row) => row.kind === "duplicate-receipts").length,
    1,
  );
  assert.equal(
    result.findings.filter((row) => row.kind === "broken-receipt-link").length,
    1,
  );
  assert.equal(
    f.api
      .review({ ...options, month: "2026-12" })
      .findings.filter((row) => row.kind.startsWith("duplicate-")).length,
    0,
  );
});

test("overpaid invoices are review candidates, not silently settled collection balances", () => {
  const f = fixture();
  f.data.bills.push(bill("overpaid", { paidAmount: 119 }));
  assert.equal(f.api.collections(options).rows.length, 0);
  assert.equal(
    f.api.collections(options).excluded[0].reason,
    "Invalid saved balance",
  );
  assert(
    f.api
      .review(options)
      .findings.some((row) => row.kind === "invalid-invoice-balance"),
  );
});

test("changed receipt amounts reopen review and credential-looking source IDs are redacted from provider evidence", () => {
  const f = fixture();
  f.data.receipts.push({
    id: "receipt-one",
    date: "2026-11-01",
    amount: 10,
    receiptNo: "RC-1",
  });
  const initial = f.api.review(options),
    finding = initial.findings.find(
      (row) => row.kind === "unallocated-receipt",
    );
  f.api.resolve({
    ...options,
    findingId: finding.id,
    status: "dismissed",
    note: "Reviewed",
    revision: initial.revision,
    fingerprint: initial.fingerprint,
  });
  f.data.receipts[0].amount = 15;
  assert.equal(
    f.api.review(options).findings.find((row) => row.id === finding.id).status,
    "open",
  );
  const secret = "sk-proj-abcdefghijklmnopqrstuv";
  f.data.bills.push(bill(secret));
  const preview = f.api.preview({ ...options, task: "collections" });
  assert(!preview.prompt.includes(secret));
  assert(!JSON.stringify(preview.context).includes(secret));
});
