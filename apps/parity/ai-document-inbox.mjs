import crypto from "node:crypto";
import { catalogName, resolveCatalogAlias } from "./ai-catalog.mjs";
import {
  extractBill,
  parseBillResponse,
  validateBillImage,
} from "./ocr-extraction.mjs";
import { ocrReviewIssue } from "./src/utils/ocr-purchase.mjs";

const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
const digest = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const MAX_DOCUMENTS = 30,
  MAX_BYTES = 8 * 1024 * 1024;
const paise = (value) => Math.round(value * 100);
const money = (value) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  Number.isSafeInteger(Math.round(value * 100)) &&
  Math.abs(value * 100 - Math.round(value * 100)) < 0.0001;
const summary = ({ image, extraction, account, ...rest }) => ({
  ...rest,
  hasExtraction: !!extraction,
});
function request(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    typeof input.businessId !== "string" ||
    !input.businessId ||
    input.businessId.length > 120
  )
    fail("Select the active business.");
  return input;
}

// Originals and review history are local records and travel with verified backups.
// Models can extract fields; only the normal expense/purchase form can save books.
export function documentInbox({ chat, readModule, store }) {
  const read = (input) => {
    request(input);
    readModule(input.businessId, "profile");
    const state = store.read({
      businessId: input.businessId,
      bucket: "documents",
    });
    if (
      state.data.documents !== undefined &&
      !Array.isArray(state.data.documents)
    )
      fail(
        "The document inbox could not be read. Restore a verified backup.",
        503,
      );
    return { ...state, documents: state.data.documents || [] };
  };
  const checkRevision = (state, input) => {
    if (
      !Number.isSafeInteger(input.revision) ||
      input.revision !== state.revision
    )
      fail("The inbox changed. Refresh it before continuing.", 409);
  };
  const find = (state, input) => {
    if (typeof input.documentId !== "string") fail("Choose a document.");
    const doc = state.documents.find((d) => d.id === input.documentId);
    if (!doc) fail("Document no longer exists. Refresh the inbox.", 409);
    return doc;
  };
  const save = (input, state, documents) =>
    store.update({
      businessId: input.businessId,
      bucket: "documents",
      revision: state.revision,
      data: { documents },
    });
  const overview = (state) => ({
    revision: state.revision,
    documents: (state.documents || state.data.documents || []).map(summary),
  });
  return {
    list: (input) => overview(read(input)),
    get: (input) => {
      const state = read(input),
        doc = find(state, input);
      const { account, ...document } = doc;
      return { revision: state.revision, document };
    },
    add: (input) => {
      const state = read(input);
      checkRevision(state, input);
      const image = validateBillImage(input.image),
        bytes = Buffer.from(image.split(",")[1], "base64");
      const hash = digest(bytes);
      if (state.documents.some((d) => d.sha256 === hash))
        fail("This image is already in this business’s inbox.", 409);
      if (
        state.documents.length >= MAX_DOCUMENTS ||
        state.documents.reduce((sum, d) => sum + d.bytes, 0) + bytes.length >
          MAX_BYTES
      )
        fail(
          "Inbox limit reached (30 documents / 8 MB). Download a verified backup, then remove completed documents.",
        );
      if (
        typeof input.name !== "string" ||
        !input.name.trim() ||
        input.name.length > 200
      )
        fail("Use a file name of up to 200 characters.");
      const doc = {
        id: crypto.randomUUID(),
        name: input.name.replace(/[\u0000-\u001f\u007f]/g, ""),
        image,
        sha256: hash,
        bytes: bytes.length,
        status: "new",
        createdAt: new Date().toISOString(),
      };
      return overview(save(input, state, [...state.documents, doc]));
    },
    remove: (input) => {
      const state = read(input);
      checkRevision(state, input);
      find(state, input);
      if (input.confirm !== true) fail("Confirm removing this local document.");
      return overview(
        save(
          input,
          state,
          state.documents.filter((d) => d.id !== input.documentId),
        ),
      );
    },
    extract: async (input) => {
      const state = read(input);
      checkRevision(state, input);
      const doc = find(state, input),
        account = chat.status().active;
      const extraction = await extractBill(
        chat,
        {
          model: input.model,
          image: doc.image,
          consent: input.consent,
          businessId: input.businessId,
        },
        { readModule },
      );
      const latest = read(input);
      checkRevision(latest, input);
      if (chat.status().active !== account)
        fail("ChatGPT account changed. Scan the document again.", 409);
      const updated = {
        ...doc,
        status: "needs-review",
        extraction,
        account: digest(String(account)),
        extractedAt: new Date().toISOString(),
      };
      const result = save(
        input,
        latest,
        latest.documents.map((d) => (d.id === doc.id ? updated : d)),
      );
      return {
        revision: result.revision,
        document: { ...summary(updated), image: updated.image, extraction },
      };
    },
    review: (input) => {
      const state = read(input);
      checkRevision(state, input);
      const doc = find(state, input);
      if (
        input.confirm !== true ||
        input.currency !== "INR" ||
        !["expense", "purchase"].includes(input.kind)
      )
        fail(
          "Review the extracted fields, confirm INR currency and choose expense or purchase.",
        );
      if (
        !doc.extraction ||
        doc.account !== digest(String(chat.status().active))
      )
        fail(
          "Scan this document using the current ChatGPT account before applying.",
          409,
        );
      const extraction = parseBillResponse(JSON.stringify(input.extraction));
      const issue = ocrReviewIssue(
        input.kind === "expense" ? { ...extraction, items: [] } : extraction,
      );
      if (issue) fail(issue);
      const tax = extraction.taxBreakdown;
      for (const field of [
        "taxableValue",
        "cgst",
        "sgst",
        "igst",
        "cess",
        "roundOff",
      ]) {
        const raw = input.extraction?.taxBreakdown?.[field];
        if (typeof raw !== "number" || !money(Math.abs(raw)))
          fail(
            "Enter each taxable value, tax and round-off amount with at most two decimal places.",
          );
      }
      if (tax.cgst !== tax.sgst)
        fail(
          "This form preserves equal CGST and SGST amounts only. Unequal components need a separately reviewed entry.",
        );
      if (tax.igst > 0 && (tax.cgst > 0 || tax.sgst > 0))
        fail(
          "The document mixes IGST and CGST/SGST. Reconcile it before applying.",
        );
      const duplicate = [
        ...readModule(input.businessId, "purchases"),
        ...readModule(input.businessId, "expenses"),
      ].some(
        (record) =>
          String(record.invoiceNumber || record.invoiceNo || "")
            .trim()
            .toLowerCase() === extraction.invoiceNumber.trim().toLowerCase() &&
          catalogName(record.supplierName || record.vendorName) ===
            catalogName(extraction.supplierName),
      );
      if (duplicate)
        fail(
          "This supplier document is already saved. Open its existing record instead.",
          409,
        );
      let draft;
      if (input.kind === "expense") {
        if (!money(extraction.grandTotal) || extraction.grandTotal <= 0)
          fail("Enter the total paid from the receipt.");
        if (
          tax.cess > 0 ||
          extraction.items.some((i) => Number(i.cessPercent) > 0)
        )
          fail(
            "This receipt includes cess. Use the purchase form to preserve its cess fields.",
          );
        const gstAmount =
          Math.round((tax.cgst + tax.sgst + tax.igst) * 100) / 100;
        if (gstAmount > extraction.grandTotal)
          fail("GST cannot exceed the receipt total.");
        if (
          paise(tax.taxableValue + gstAmount + tax.roundOff) !==
          paise(extraction.grandTotal)
        )
          fail(
            "Taxable value, GST and round off must match the receipt total.",
          );
        draft = {
          date: extraction.date,
          description:
            extraction.items
              .map((i) => i.name)
              .filter(Boolean)
              .join(", ")
              .slice(0, 500) || `Receipt ${extraction.invoiceNumber}`,
          amount: extraction.grandTotal,
          gstAmount,
          gstPercent: "",
          category: "Other",
          vendorName: extraction.supplierName,
          vendorGstin: extraction.supplierGstin,
          invoiceNo: extraction.invoiceNumber,
          interstate: tax.igst > 0,
          currency: "INR",
          note: "Reviewed from document inbox. Verify payment method before saving.",
        };
      } else {
        if (!extraction.items.length)
          fail("Enter the purchase line items before applying.");
        const total = extraction.items.reduce(
          (sum, i) =>
            sum +
            i.quantity *
              i.rate *
              (1 + (i.taxPercent + (i.cessPercent || 0)) / 100),
          0,
        );
        const roundOff = Math.round((Math.round(total) - total) * 100) / 100;
        const applyRoundOff = Math.abs(tax.roundOff) > 0.001;
        if (applyRoundOff && paise(roundOff) !== paise(tax.roundOff))
          fail(
            "This rounding adjustment needs manual entry in the purchase form.",
          );
        if (
          !money(extraction.grandTotal) ||
          paise(total + (applyRoundOff ? roundOff : 0)) !==
            paise(extraction.grandTotal)
        )
          fail(
            "Item totals must match the document total. Discounts need manual adjustment in the purchase form.",
          );
        const lineBase = extraction.items.reduce(
          (sum, i) => sum + i.quantity * i.rate,
          0,
        );
        const lineCess = extraction.items.reduce(
          (sum, i) => sum + (i.quantity * i.rate * (i.cessPercent || 0)) / 100,
          0,
        );
        if (paise(lineBase) !== paise(tax.taxableValue))
          fail("Item taxable value does not match the document taxable value.");
        if (paise(lineCess) !== paise(tax.cess))
          fail(
            "Item cess does not match the document cess. Reconcile both before applying.",
          );
        const lineTax = extraction.items.reduce(
          (sum, i) => sum + (i.quantity * i.rate * i.taxPercent) / 100,
          0,
        );
        if (paise(lineTax) !== paise(tax.cgst + tax.sgst + tax.igst))
          fail(
            "Item GST does not match the document GST. Reconcile the tax amounts.",
          );
        const products = readModule(input.businessId, "products");
        const aliases =
          store.read({ businessId: input.businessId, bucket: "catalog" }).data
            .aliases || [];
        draft = {
          ...extraction,
          applyRoundOff,
          items: extraction.items.map((item) => {
            const exact = products.filter(
              (p) => catalogName(p.name) === catalogName(item.name),
            );
            const product =
              exact.length === 1
                ? exact[0]
                : exact.length
                  ? null
                  : resolveCatalogAlias({
                      aliases,
                      records: products,
                      kind: "products",
                      name: item.name,
                    });
            return product
              ? {
                  ...item,
                  _matchedProductId: product.id,
                  _matchedName: product.name,
                }
              : item;
          }),
        };
      }
      const result = save(
        input,
        state,
        state.documents.map((d) =>
          d.id === doc.id
            ? {
                ...d,
                extraction,
                status: "draft-opened",
                kind: input.kind,
                reviewedAt: new Date().toISOString(),
              }
            : d,
        ),
      );
      return {
        revision: result.revision,
        kind: input.kind,
        draft,
        documentId: doc.id,
        businessId: input.businessId,
      };
    },
  };
}
