import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  businessSchema,
  calculateInvoice,
  paymentSchema,
  type Business,
  type Invoice,
  type Snapshot,
} from "@know-gst/domain/invoicing";

export class Conflict extends Error {}
export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS business(id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS invoices(id TEXT PRIMARY KEY, number TEXT UNIQUE, payload TEXT NOT NULL, version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL REFERENCES invoices(id), amount INTEGER NOT NULL CHECK(amount>0), date TEXT NOT NULL, reference TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS series(id INTEGER PRIMARY KEY CHECK(id=1), next_number INTEGER NOT NULL);
      INSERT OR IGNORE INTO series VALUES(1,1);
      CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, action TEXT NOT NULL, at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests(key TEXT PRIMARY KEY, hash TEXT NOT NULL, response TEXT NOT NULL);
      INSERT OR IGNORE INTO migrations VALUES(1);`);
  }
  close() {
    this.db.close();
  }
  business(): Business | null {
    const row = this.db
      .prepare("SELECT payload FROM business WHERE id=1")
      .get();
    return row ? (JSON.parse(String(row.payload)) as Business) : null;
  }
  invoice(id: string): Invoice {
    const row = this.db
      .prepare("SELECT payload FROM invoices WHERE id=?")
      .get(id);
    if (!row) throw new Conflict("Invoice not found");
    const invoice = JSON.parse(String(row.payload)) as Invoice;
    const payments = this.db
      .prepare(
        "SELECT id,amount,date,reference FROM payments WHERE invoice_id=? ORDER BY rowid",
      )
      .all(id);
    invoice.payments = payments.map((p) => ({
      id: String(p.id),
      amount: String(p.amount),
      date: String(p.date),
      reference: String(p.reference),
    }));
    invoice.paid = invoice.payments
      .reduce((sum, p) => sum + BigInt(p.amount), 0n)
      .toString();
    return invoice;
  }
  snapshot(): Snapshot {
    return {
      business: this.business(),
      invoices: this.db
        .prepare("SELECT id FROM invoices ORDER BY rowid DESC")
        .all()
        .map((r) => this.invoice(String(r.id))),
    };
  }
  // The response and financial mutation commit together, including after retries.
  command<T>(key: string, operation: string, input: unknown, run: () => T): T {
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key))
      throw new Conflict("A valid idempotency key is required");
    const hash = createHash("sha256")
      .update(JSON.stringify([operation, input]))
      .digest("hex");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const previous = this.db
        .prepare("SELECT hash,response FROM requests WHERE key=?")
        .get(key);
      if (previous) {
        if (previous.hash !== hash)
          throw new Conflict(
            "This request key was already used for different data",
          );
        this.db.exec("COMMIT");
        return JSON.parse(String(previous.response)) as T;
      }
      const response = run();
      this.db
        .prepare("INSERT INTO requests VALUES(?,?,?)")
        .run(key, hash, JSON.stringify(response));
      this.db.exec("COMMIT");
      return response;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  audit(id: string, action: string) {
    this.db
      .prepare("INSERT INTO audit VALUES(?,?,?,?)")
      .run(randomUUID(), id, action, new Date().toISOString());
  }
  setup(raw: unknown) {
    const business = businessSchema.parse(raw);
    if (this.business())
      throw new Conflict("Business setup is already complete");
    this.db
      .prepare("INSERT INTO business VALUES(1,?)")
      .run(JSON.stringify(business));
    this.audit("business", "created");
    return business;
  }
  draft(raw: unknown): Invoice {
    const business = this.business();
    if (!business) throw new Conflict("Complete business setup first");
    const calculation = calculateInvoice(raw);
    const invoice: Invoice = {
      id: randomUUID(),
      number: null,
      status: "draft",
      version: 1,
      business,
      calculation,
      paid: "0",
      payments: [],
    };
    this.db
      .prepare("INSERT INTO invoices VALUES(?,?,?,?)")
      .run(invoice.id, null, JSON.stringify(invoice), 1);
    this.audit(invoice.id, "draft_created");
    return invoice;
  }
  issue(id: string, version: number) {
    const invoice = this.invoice(id);
    if (invoice.version !== version || invoice.status !== "draft")
      throw new Conflict(
        "Invoice changed or is already issued. Refresh and try again.",
      );
    const series = this.db
      .prepare("SELECT next_number FROM series WHERE id=1")
      .get()!;
    invoice.number = `KG-${String(series.next_number).padStart(6, "0")}`;
    invoice.status = "issued";
    invoice.version++;
    this.db
      .prepare("UPDATE series SET next_number=next_number+1 WHERE id=1")
      .run();
    this.db
      .prepare("UPDATE invoices SET number=?,payload=?,version=? WHERE id=?")
      .run(invoice.number, JSON.stringify(invoice), invoice.version, id);
    this.audit(id, "issued");
    return invoice;
  }
  pay(id: string, raw: unknown) {
    const payment = paymentSchema.parse(raw);
    const invoice = this.invoice(id);
    if (invoice.status !== "issued" || invoice.version !== payment.version)
      throw new Conflict("Invoice changed or has not been issued");
    const [whole, fraction = ""] = payment.amount.split(".");
    const amount = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
    if (
      amount >
      BigInt(invoice.calculation.totals.total) - BigInt(invoice.paid)
    )
      throw new Conflict("Payment exceeds the outstanding amount");
    this.db
      .prepare("INSERT INTO payments VALUES(?,?,?,?,?)")
      .run(randomUUID(), id, amount, payment.date, payment.reference);
    invoice.version++;
    this.db
      .prepare("UPDATE invoices SET payload=?,version=? WHERE id=?")
      .run(JSON.stringify(invoice), invoice.version, id);
    this.audit(id, "payment_recorded");
    return this.invoice(id);
  }
}
