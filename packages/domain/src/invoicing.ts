import { Decimal } from "decimal.js";
import { z } from "zod";

// This first increment supports explicit, tax-exclusive INR lines only.
// Rates are user inputs, not a claim of statutory applicability.
const decimal = (places: number, max: string) =>
  z
    .string()
    .regex(new RegExp(`^\\d{1,10}(\\.\\d{1,${places}})?$`))
    .refine((v) => new Decimal(v).lte(max), "Amount exceeds supported range");
const name = z.string().trim().min(1).max(160);
export const businessSchema = z
  .object({
    name,
    address: z.string().trim().min(1).max(500),
  })
  .strict();
export const invoiceSchema = z
  .object({
    customer: name,
    customerAddress: z.string().trim().min(1).max(500),
    date: z.iso.date(),
    supply: z.enum(["intra", "inter"]),
    lines: z
      .array(
        z
          .object({
            description: name,
            quantity: decimal(3, "1000000").refine(
              (v) => new Decimal(v).gt(0),
              "Quantity must be positive",
            ),
            unitPrice: decimal(2, "10000000"),
            gstRate: decimal(2, "100"),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export const paymentSchema = z
  .object({
    amount: decimal(2, "1000000000").refine(
      (v) => new Decimal(v).gt(0),
      "Payment must be positive",
    ),
    date: z.iso.date(),
    reference: z.string().trim().max(160),
    version: z.number().int().positive(),
  })
  .strict();
export type Business = z.infer<typeof businessSchema>;
export type InvoiceInput = z.infer<typeof invoiceSchema>;
export type PaymentInput = z.infer<typeof paymentSchema>;
const minor = (v: Decimal) =>
  v.mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
export function calculateInvoice(raw: unknown) {
  const input = invoiceSchema.parse(raw);
  const lines = input.lines.map((line) => {
    const taxable = minor(new Decimal(line.quantity).mul(line.unitPrice));
    // Total tax rounds once; odd paise go to the second component.
    // This policy is explicit and awaits the full legacy/tax parity review.
    const tax = taxable
      .mul(line.gstRate)
      .div(100)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    const cgst = input.supply === "intra" ? tax.div(2).floor() : new Decimal(0);
    const sgst = input.supply === "intra" ? tax.minus(cgst) : new Decimal(0);
    const igst = input.supply === "inter" ? tax : new Decimal(0);
    return {
      ...line,
      taxable: taxable.toFixed(0),
      cgst: cgst.toFixed(0),
      sgst: sgst.toFixed(0),
      igst: igst.toFixed(0),
      total: taxable.plus(tax).toFixed(0),
    };
  });
  const sum = (key: "taxable" | "cgst" | "sgst" | "igst" | "total") =>
    lines.reduce((n, l) => n.plus(l[key]), new Decimal(0)).toFixed(0);
  const totals = {
    taxable: sum("taxable"),
    cgst: sum("cgst"),
    sgst: sum("sgst"),
    igst: sum("igst"),
    total: sum("total"),
  };
  if (new Decimal(totals.total).gt("100000000000"))
    throw new Error("Invoice exceeds supported amount");
  return {
    ...input,
    lines,
    totals,
    currency: "INR" as const,
    ruleVersion: "prototype-exclusive-inr-v1",
  };
}
export type Calculation = ReturnType<typeof calculateInvoice>;
export interface Invoice {
  id: string;
  number: string | null;
  status: "draft" | "issued";
  version: number;
  calculation: Calculation;
  business: Business;
  paid: string;
  payments: { id: string; amount: string; date: string; reference: string }[];
}
export interface Snapshot {
  business: Business | null;
  invoices: Invoice[];
}
export function formatMinor(value: string) {
  const [whole, fraction] = new Decimal(value).div(100).toFixed(2).split(".");
  return `₹${BigInt(whole!).toLocaleString("en-IN")}.${fraction}`;
}
