import useDialogFocus from "./useDialogFocus";
import { useEffect, useState } from "react";
import { getAccounting, postSupplierPayment, getAllPurchases } from "../store";
import { toast } from "./Toast";
import { localToday } from "../utils";
export default function SupplierPaymentPanel({ purchase, onClose, onSaved }) {
  const [record, setRecord] = useState(purchase),
    [payments, setPayments] = useState([]),
    [busy, setBusy] = useState(false),
    [form, setForm] = useState({
      id: crypto.randomUUID(),
      amount: "",
      date: localToday(),
      reference: "",
    });
  useDialogFocus(true, () => {
    if (!busy) onClose();
  });
  async function load() {
    const [state, rows] = await Promise.all([
      getAccounting(),
      getAllPurchases(),
    ]);
    setPayments(
      state.supplierPayments.filter((p) => p.purchaseId === purchase.id),
    );
    setRecord(rows.find((p) => p.id === purchase.id) || purchase);
  }
  useEffect(() => {
    load().catch((e) => toast(e.message, "error"));
  }, []);
  async function submit(reversal) {
    setBusy(true);
    try {
      const payload = reversal
        ? {
            id: "reverse_" + reversal.id,
            amount: (reversal.amount / 100).toFixed(2),
            date: localToday(),
            reversalOf: reversal.id,
          }
        : form;
      await postSupplierPayment({
        ...payload,
        purchaseId: record.id,
        revision: record._revision,
      });
      setForm({
        id: crypto.randomUUID(),
        amount: "",
        date: localToday(),
        reference: "",
      });
      await load();
      onSaved();
      toast(reversal ? "Payment reversed" : "Payment recorded", "success");
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }
  const paid =
    payments.reduce((s, p) => s + (p.reversalOf ? -p.amount : p.amount), 0) /
    100;
  return (
    <div className="modal-overlay">
      <div
        className="modal-content accounting-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Supplier payments"
      >
        <h3>Supplier payments</h3>
        <p>
          {record.supplierName} · {record.invoiceNumber}
        </p>
        <p>
          <strong>
            Outstanding: {record.currency || "INR"}{" "}
            {(Number(record.totalAmount || 0) - paid).toFixed(2)}
          </strong>
        </p>
        {!record.accountingManaged && (
          <p className="text-muted">
            The first payment opens this payable at the bill’s gross amount. Tax
            remains unclassified in the journal; no input-tax claim is created.
            Earlier paid/partial bills require opening-history reconciliation.
          </p>
        )}
        <div className="form-grid">
          <label className="form-group">
            Payment amount
            <input
              className="form-input"
              type="number"
              min="0.01"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </label>
          <label className="form-group">
            Payment date
            <input
              className="form-input"
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </label>
        </div>
        <label className="form-group">
          Reference
          <input
            className="form-input"
            value={form.reference}
            onChange={(e) => setForm({ ...form, reference: e.target.value })}
          />
        </label>
        <div className="flex gap-2">
          <button
            className="btn btn-secondary"
            disabled={busy}
            onClick={onClose}
          >
            Close
          </button>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() => submit()}
          >
            Record payment
          </button>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Amount</th>
                <th>Reference</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>{p.date}</td>
                  <td>
                    {p.reversalOf ? "−" : ""}
                    {(p.amount / 100).toFixed(2)}
                  </td>
                  <td>{p.reference}</td>
                  <td>
                    {!p.reversalOf &&
                    !payments.some((r) => r.reversalOf === p.id) ? (
                      <button
                        className="btn btn-secondary"
                        disabled={busy}
                        onClick={() => submit(p)}
                      >
                        Reverse payment
                      </button>
                    ) : p.reversalOf ? (
                      "Reversal"
                    ) : (
                      "Reversed"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
