const tokenize = (s) => {
  if (!s) return new Set();
  return new Set(
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3),
  );
};
const jaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return intersection / union;
};
export const matchProduct = (extractedName, catalog) => {
  if (!catalog?.length) return null;
  const tokens = tokenize(extractedName);
  if (!tokens.size) return null;
  let best = null,
    bestScore = 0.5,
    ambiguous = false; // threshold
  for (const p of catalog) {
    const score = jaccard(tokens, tokenize(p.name));
    if (score > bestScore) {
      best = p;
      bestScore = score;
      ambiguous = false;
    } else if (score === bestScore && best) {
      ambiguous = true;
    }
  }
  return best && !ambiguous ? { product: best, score: bestScore } : null;
};

export function purchaseOCRItems(extracted) {
  return extracted.items.map((it) => ({
    name: it.name || "",
    hsn: it.hsn || "",
    quantity: Number(it.quantity),
    rate: Number(it.rate),
    taxPercent: Number(it.taxPercent),
    cessPercent: Number(it.cessPercent) || 0,
    ...(it._matchedProductId ? { productId: it._matchedProductId } : {}),
  }));
}
export function ocrReviewIssue(parsed) {
  if (!parsed.supplierName?.trim() || !parsed.invoiceNumber?.trim())
    return "Enter the supplier and invoice number from the image.";
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date || "") ||
    !Number.isFinite(Date.parse(parsed.date)) ||
    new Date(parsed.date).toISOString().slice(0, 10) !== parsed.date
  )
    return "Enter a valid invoice date from the image.";
  if (
    parsed.supplierGstin &&
    !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(
      parsed.supplierGstin,
    )
  )
    return "Correct the supplier GSTIN format, or leave it blank for an unregistered supplier.";
  if (!parsed.items?.length && Number(parsed.taxBreakdown?.cess) > 0)
    return "Add item rows and allocate the bill cess before continuing.";
  for (const it of parsed.items || []) {
    if (
      !it.name?.trim() ||
      it.quantity == null ||
      !Number.isFinite(Number(it.quantity)) ||
      Number(it.quantity) <= 0 ||
      it.rate == null ||
      !Number.isFinite(Number(it.rate)) ||
      Number(it.rate) < 0 ||
      it.taxPercent == null ||
      !Number.isFinite(Number(it.taxPercent)) ||
      Number(it.taxPercent) < 0 ||
      Number(it.taxPercent) > 100 ||
      !Number.isFinite(Number(it.cessPercent ?? 0)) ||
      Number(it.cessPercent ?? 0) < 0 ||
      Number(it.cessPercent ?? 0) > 1000 ||
      !Number.isSafeInteger(
        Math.round(
          Number(it.quantity) *
            Number(it.rate) *
            (1 + (Number(it.taxPercent) + Number(it.cessPercent || 0)) / 100) *
            100,
        ),
      )
    )
      return "Review each item: name, positive quantity, rate, GST and cess must be valid.";
  }
  const cess = (parsed.items || []).reduce(
    (sum, it) =>
      sum +
      Math.round(
        Number(it.quantity) * Number(it.rate) * Number(it.cessPercent || 0),
      ) /
        100,
    0,
  );
  if (
    Number(parsed.taxBreakdown?.cess) > 0 &&
    Math.abs(cess - Number(parsed.taxBreakdown.cess)) > 0.02
  )
    return "Item cess does not match the bill cess. Enter the correct item cess percentages before continuing; fixed-amount cess requires manual handling.";
  return "";
}
