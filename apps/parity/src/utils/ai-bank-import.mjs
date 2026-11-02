import { parseCsv } from "./bulkCsv.js";

export function parseBankReviewCsv(text) {
  if (typeof text !== "string" || text.length > 500000)
    throw new Error("Choose a CSV smaller than 500 KB.");
  const table = parseCsv(text),
    header = (table.shift() || []).map((value) => value.trim().toLowerCase());
  const required = ["date", "description", "amount", "direction"];
  if (
    new Set(header).size !== header.length ||
    required.some((name) => !header.includes(name))
  )
    throw new Error(
      "Use columns: date, description, amount, direction, reference (optional). Dates must be YYYY-MM-DD; direction must be debit or credit.",
    );
  if (!table.length || table.length > 500)
    throw new Error("Choose 1–500 bank statement rows.");
  return table.map((row, index) => {
    if (row.length !== header.length)
      throw new Error(`Row ${index + 2} has a different number of columns.`);
    const value = Object.fromEntries(
      header.map((name, i) => [name, row[i].trim()]),
    );
    const amount = value.amount.replace(/,/g, "");
    if (!/^\d+(?:\.\d{1,2})?$/.test(amount))
      throw new Error(
        `Row ${index + 2} needs a positive amount with at most two decimal places.`,
      );
    return {
      date: value.date,
      description: value.description,
      amount: Number(amount),
      direction: value.direction.toLowerCase(),
      reference: value.reference || "",
    };
  });
}

export function bankReviewCsv(statements, categories, parties, accounts) {
  const cell = (value) =>
    '"' +
    String(value ?? "")
      .replace(/^[=+@\-\t\r]/, (match) => "'" + match)
      .replace(/"/g, '""') +
    '"';
  const rows = [
    [
      "Date",
      "Account",
      "Currency",
      "Description",
      "Reference",
      "Direction",
      "Amount",
      "Category",
      "Party",
      "Ledger account",
      "Review source",
    ],
  ];
  for (const statement of statements)
    for (const row of statement.rows)
      rows.push([
        row.date,
        statement.accountLabel,
        statement.currency,
        row.description,
        row.reference,
        row.direction,
        (row.amountMinor / 100).toFixed(2),
        categories[row.classification?.category] || "",
        parties.find((party) => party.id === row.classification?.partyId)
          ?.name || "",
        accounts.find((account) => account.id === row.classification?.account)
          ?.name || "",
        row.classification?.source || "Unreviewed",
      ]);
  return rows.map((row) => row.map(cell).join(",")).join("\r\n");
}
