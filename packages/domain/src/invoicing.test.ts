import { describe, expect, it } from "vitest";
import { calculateInvoice, formatMinor } from "./invoicing.js";
const input = {
  customer: "Example client",
  customerAddress: "Pune",
  date: "2026-10-29",
  supply: "intra",
  lines: [
    {
      description: "Service",
      quantity: "2",
      unitPrice: "100.00",
      gstRate: "18",
    },
  ],
};
describe("explicit tax-exclusive INR calculations", () => {
  it("balances taxable value and intra-state components", () => {
    expect(calculateInvoice(input).totals).toEqual({
      taxable: "20000",
      cgst: "1800",
      sgst: "1800",
      igst: "0",
      total: "23600",
    });
  });
  it("uses IGST for the explicit inter-state selection", () => {
    expect(calculateInvoice({ ...input, supply: "inter" }).totals).toEqual({
      taxable: "20000",
      cgst: "0",
      sgst: "0",
      igst: "3600",
      total: "23600",
    });
  });
  it("preserves odd-paisa totals without floating-point loss", () => {
    const result = calculateInvoice({
      ...input,
      lines: [
        {
          description: "Fraction",
          quantity: "1",
          unitPrice: "0.03",
          gstRate: "18",
        },
      ],
    });
    expect(result.totals).toEqual({
      taxable: "3",
      cgst: "0",
      sgst: "1",
      igst: "0",
      total: "4",
    });
    expect(formatMinor("9007199254740993")).toBe("₹9,00,71,99,25,47,409.93");
  });
  it.each(["-1", "NaN", "Infinity", "1e3", "1.001"])(
    "rejects unsupported prices %s",
    (unitPrice) => {
      expect(() =>
        calculateInvoice({
          ...input,
          lines: [{ ...input.lines[0], unitPrice }],
        }),
      ).toThrow();
    },
  );
  it("rejects invalid dates and empty lines", () => {
    expect(() => calculateInvoice({ ...input, date: "2026-02-30" })).toThrow();
    expect(() => calculateInvoice({ ...input, lines: [] })).toThrow();
  });
});
