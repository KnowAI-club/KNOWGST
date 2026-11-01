// Read-only dashboard projection. Every amount is integer minor units and every
// source is scoped by the caller to one business before reaching this module.
export function dashboardSummary({
  bills = [],
  receipts = [],
  expenses = [],
  purchases = [],
  products = [],
  accounting = {},
  month,
  currency = "INR",
  today,
  stockSettings = {},
}) {
  const warnings = [];
  const money = (v) => {
    const n = Number(v ?? 0),
      m = Math.round(n * 100);
    if (
      !Number.isFinite(n) ||
      !Number.isSafeInteger(m) ||
      Math.abs(n * 100 - m) > 0.00001
    ) {
      warnings.push("Some invalid monetary values were excluded.");
      return 0;
    }
    return m;
  };
  const unit = (r) => r.currency || r.data?.invoiceOptions?.currency || "INR";
  const sign = (b) =>
    b.status === "cancelled" || b.status === "draft" || b.convertedTo
      ? 0
      : {
          "tax-invoice": 1,
          "bill-of-supply": 1,
          composition: 1,
          "credit-note": -1,
        }[b.invoiceType || b.data?.invoiceType || "tax-invoice"] || 0;
  const day = (b) => b.invoiceDate || b.data?.details?.invoiceDate || "";
  const within = (d) => typeof d === "string" && d.slice(0, 7) === month;
  const [year, mo] = month.split("-").map(Number),
    previous = new Date(Date.UTC(year, mo - 2, 1)).toISOString().slice(0, 7);
  const currencies = [
    ...new Set([
      "INR",
      ...bills.map(unit),
      ...receipts.map(unit),
      ...expenses.map(unit),
      ...purchases.map(unit),
    ]),
  ].sort();
  let sales = 0,
    previousSales = 0,
    invoiceTax = 0,
    outstanding = 0,
    overdueAmount = 0;
  const overdue = [];
  for (const b of bills.filter((b) => unit(b) === currency)) {
    const s = sign(b),
      total = money(b.totalAmount),
      tax = money(b.totalTaxAmount ?? b.data?.totals?.totalTaxAmount);
    if (within(day(b))) {
      sales += s * (total - tax - money(b.data?.totals?.tcsAmount));
      invoiceTax += s * tax;
    }
    if (day(b).slice(0, 7) === previous)
      previousSales += s * (total - tax - money(b.data?.totals?.tcsAmount));
    if (s === 1) {
      const balance = Math.max(
        0,
        total -
          Math.min(total, Math.max(0, money(b.data?.totals?.tdsAmount))) -
          money(b.paidAmount),
      );
      outstanding += balance;
      if (
        balance > 0 &&
        b.data?.details?.dueDate &&
        b.data.details.dueDate < today
      ) {
        overdueAmount += balance;
        overdue.push(b.id);
      }
    }
  }
  const movements = [],
    paymentIds = new Set(),
    paymentNos = new Set();
  for (const b of bills) {
    for (const p of b.payments || b.data?.payments || []) {
      if (String(p.mode).startsWith("credit-")) continue;
      const key = p.id
        ? `id:${p.id}`
        : p.receiptNo
          ? `no:${p.receiptNo}`
          : null;
      if (key && paymentIds.has(key)) {
        warnings.push(
          "Repeated payment identifiers were counted once; review the source records.",
        );
        continue;
      }
      if (key) paymentIds.add(key);
      if (p.receiptNo) paymentNos.add(p.receiptNo);
      if (unit(b) !== currency) continue;
      if (!p.date) {
        warnings.push(
          "Undated invoice payments are excluded from the monthly movement chart.",
        );
        continue;
      }
      const n = money(p.amount);
      movements.push({
        date: p.date,
        in: Math.max(0, n),
        out: Math.max(0, -n),
      });
    }
  }
  const unallocated = [];
  for (const r of receipts) {
    if (
      r.billId ||
      r.againstInvoice ||
      paymentIds.has(`id:${r.id}`) ||
      (r.receiptNo && paymentNos.has(r.receiptNo))
    )
      continue;
    if (unit(r) !== currency) continue;
    unallocated.push(r.id);
    const n = money(r.amount);
    movements.push({ date: r.date, in: Math.max(0, n), out: Math.max(0, -n) });
  }
  for (const e of expenses.filter((e) => unit(e) === currency))
    movements.push({ date: e.date, in: 0, out: money(e.amount) });
  for (const p of accounting.supplierPayments || [])
    if ((p.currency || "INR") === currency) {
      const n = Number.isSafeInteger(p.amount) ? p.amount : 0;
      movements.push({
        date: p.date,
        in: p.reversalOf ? n : 0,
        out: p.reversalOf ? 0 : n,
      });
    }
  const weeks = Array.from(
    { length: Math.ceil(new Date(year, mo, 0).getDate() / 7) },
    (_, i) => ({
      label: `${i * 7 + 1}–${Math.min((i + 1) * 7, new Date(year, mo, 0).getDate())}`,
      in: 0,
      out: 0,
    }),
  );
  let received = 0,
    spent = 0;
  for (const m of movements)
    if (within(m.date)) {
      const index = Math.floor((Number(m.date.slice(8, 10)) - 1) / 7);
      if (!weeks[index]) {
        warnings.push("Invalid dated movements were excluded.");
        continue;
      }
      received += m.in;
      spent += m.out;
      weeks[index].in += m.in;
      weeks[index].out += m.out;
    }
  let payable = 0,
    untrackedPurchases = 0;
  for (const p of purchases.filter((p) => unit(p) === currency)) {
    if (!p.accountingManaged) {
      untrackedPurchases++;
      continue;
    }
    payable += Math.max(
      0,
      money(p.totalAmount) -
        (Number.isSafeInteger(p.supplierPaidMinor) ? p.supplierPaidMinor : 0),
    );
  }
  const threshold = Number.isFinite(Number(stockSettings.threshold))
    ? Number(stockSettings.threshold)
    : 5;
  const lowStock =
    stockSettings.enabled === false
      ? []
      : products
          .filter(
            (p) =>
              Number.isFinite(Number(p.stock)) && Number(p.stock) <= threshold,
          )
          .map((p) => ({
            id: p.id,
            name: p.name,
            stock: Number(p.stock),
            unit: p.unit || "",
          }));
  const activity = [];
  for (const [type, items] of [
    ["Invoice", bills],
    ["Receipt", receipts],
    ["Expense", expenses],
    ["Purchase", purchases],
  ])
    for (const r of items) {
      const date = type === "Invoice" ? day(r) : r.date;
      if (unit(r) !== currency || !within(date)) continue;
      const amount = money(
        type === "Receipt" || type === "Expense" ? r.amount : r.totalAmount,
      );
      activity.push({
        id: r.id,
        type,
        date,
        reference: r.invoiceNumber || r.receiptNo || r.invoiceNo || r.id,
        party:
          r.clientName ||
          r.data?.client?.name ||
          r.supplierName ||
          r.description ||
          r.vendorName ||
          "Unnamed record",
        amount,
        status:
          type === "Invoice"
            ? overdue.includes(r.id)
              ? "Overdue"
              : r.status || "unpaid"
            : type === "Receipt"
              ? r.billId
                ? "Linked"
                : r.againstInvoice
                  ? "Review link"
                  : "Unallocated"
              : type === "Purchase"
                ? r.paymentStatus || "Untracked"
                : "Recorded",
        invoiceType: r.invoiceType || r.data?.invoiceType || null,
      });
    }
  activity.sort(
    (a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id),
  );
  return {
    month,
    currency,
    currencies,
    sales,
    previousSales,
    invoiceTax,
    received,
    spent,
    outstanding,
    overdueAmount,
    overdue,
    unallocated,
    payable,
    untrackedPurchases,
    lowStock,
    weeks,
    activity: activity.slice(0, 100),
    activityTotal: activity.length,
    warnings: [...new Set(warnings)],
  };
}
