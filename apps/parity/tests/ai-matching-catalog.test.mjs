import test from "node:test";
import assert from "node:assert/strict";
import { matchingAssistant, normalizeStatement } from "../ai-matching.mjs";
import {
  catalogAssistant,
  parseCatalogDraft,
  resolveCatalogAlias,
} from "../ai-catalog.mjs";
import {
  parseBankReviewCsv,
  bankReviewCsv,
} from "../src/utils/ai-bank-import.mjs";

function setup() {
  let active = "b1",
    account = "a1",
    clock = 1,
    response = {},
    preflight = () => {},
    calls = 0;
  const data = {
    profile: [{ id: "b1", businessName: "Fictional demo" }],
    clients: [
      {
        id: "c1",
        name: "Ananya Traders",
        email: "private@example.com",
        apiKey: "sk-private",
      },
    ],
    products: [
      {
        id: "p1",
        name: "Office notebook",
        sellingPrice: 45,
        taxPercent: 18,
        stock: 80,
      },
    ],
    purchases: [
      {
        id: "purchase1",
        supplierName: "Kiran Paper",
        supplierGstin: "27AAAAA0000A1Z0",
      },
    ],
  };
  const saved = new Map(),
    prompts = [];
  const readModule = (id, module) => {
    if (id !== active)
      throw Object.assign(new Error("Business changed"), { status: 409 });
    return structuredClone(data[module]);
  };
  const store = {
    read: ({ businessId, bucket }) => {
      readModule(businessId, "profile");
      return structuredClone(saved.get(bucket) || { revision: 0, data: {} });
    },
    update: ({ businessId, bucket, revision, data }) => {
      readModule(businessId, "profile");
      if (
        !Number.isSafeInteger(revision) ||
        revision !== (saved.get(bucket)?.revision || 0)
      )
        throw Object.assign(new Error("Revision conflict"), { status: 409 });
      const next = { revision: revision + 1, data: structuredClone(data) };
      saved.set(bucket, next);
      return structuredClone(next);
    },
  };
  const chat = {
    status: () => ({ active: account }),
    ask: async (input, options) => {
      preflight();
      options.beforeSend();
      calls++;
      prompts.push(input.prompt);
      return { text: JSON.stringify(response) };
    },
  };
  const deps = { chat, readModule, store, now: () => clock };
  return {
    matching: matchingAssistant(deps),
    catalog: catalogAssistant(deps),
    deps,
    data,
    saved,
    prompts,
    setActive: (id) => {
      active = id;
    },
    setAccount: (id) => {
      account = id;
    },
    setClock: (value) => {
      clock = value;
    },
    setResponse: (value) => {
      response = value;
    },
    preflight: (fn) => {
      preflight = fn;
    },
    get calls() {
      return calls;
    },
  };
}
const row = (overrides = {}) => ({
  date: "2026-10-15",
  description: "NEFT Ananya Traders",
  amount: 1250.5,
  direction: "credit",
  reference: "REF001",
  ...overrides,
});
const statement = (rows) => ({
  businessId: "b1",
  accountLabel: "Current account",
  currency: "INR",
  rows: rows || [row()],
});
function imported(s, rows) {
  const p = s.matching.previewImport(statement(rows));
  return s.matching.importStatement({
    businessId: "b1",
    ticketId: p.ticketId,
    confirm: true,
    duplicates: "skip",
  });
}
const rule = (s, revision) => ({
  businessId: "b1",
  revision,
  confirm: true,
  contains: "Ananya",
  direction: "credit",
  currency: "INR",
  category: "business_in",
  partyId: "client:c1",
  partyFingerprint: s.matching
    .list({ businessId: "b1" })
    .parties.find((party) => party.id === "client:c1")?.fingerprint,
  account: "1100",
});

test("statement validation requires real dates, bounded rows and precise positive amounts", () => {
  const normalized = normalizeStatement(statement());
  assert.equal(normalized.rows[0].amountMinor, 125050);
  assert.equal(
    normalized.id,
    normalizeStatement({ ...statement(), accountLabel: " current ACCOUNT " })
      .id,
  );
  for (const bad of [0, -1, NaN, Infinity, "10", 0.001, 1e11])
    assert.throws(() => normalizeStatement(statement([row({ amount: bad })])));
  for (const date of ["2026-02-30", "2026-13-01", "15/10/2026", ""])
    assert.throws(() => normalizeStatement(statement([row({ date })])));
  assert.throws(() =>
    normalizeStatement(statement(Array.from({ length: 501 }, () => row()))),
  );
  assert.throws(() =>
    normalizeStatement({ ...statement(), currency: "INR\n" }),
  );
});

test("statement reviews preserve row identity and detect whole, overlapping and repeated duplicates", () => {
  const s = setup(),
    result = imported(s);
  assert.equal(result.data.statements[0].rows.length, 1);
  const fingerprint = result.data.statements[0].rows[0].fingerprint;
  assert.equal(fingerprint.length, 64);
  assert.throws(
    () => s.matching.previewImport(statement()),
    /already imported/,
  );
  const preview = s.matching.previewImport(
    statement([
      row(),
      row({ reference: "REF002" }),
      row({ reference: "REF002" }),
    ]),
  );
  assert.equal(preview.duplicateCount, 2);
  const next = s.matching.importStatement({
    businessId: "b1",
    ticketId: preview.ticketId,
    confirm: true,
    duplicates: "skip",
  });
  assert.equal(next.data.statements[1].rows.length, 1);
  assert.equal(next.data.statements[1].rows[0].reference, "REF002");
  assert.throws(
    () =>
      s.matching.importStatement({
        businessId: "b1",
        ticketId: preview.ticketId,
        confirm: true,
        duplicates: "skip",
      }),
    /expired/,
  );
  assert.equal(s.calls, 0);
  assert.deepEqual(s.data.products[0].stock, 80);
  assert.equal(
    matchingAssistant(s.deps).list({ businessId: "b1" }).data.statements.length,
    2,
  );
});

test("statement import confirmation and source revisions prevent stale writes and business leakage", () => {
  const s = setup(),
    p = s.matching.previewImport(statement());
  assert.throws(
    () =>
      s.matching.importStatement({
        businessId: "b1",
        ticketId: p.ticketId,
        duplicates: "skip",
      }),
    /Review/,
  );
  s.matching.saveRule(rule(s, 0));
  assert.throws(
    () =>
      s.matching.importStatement({
        businessId: "b1",
        ticketId: p.ticketId,
        confirm: true,
        duplicates: "skip",
      }),
    /changed/,
  );
  s.setActive("b2");
  assert.throws(
    () => s.matching.list({ businessId: "b1" }),
    /Business changed/,
  );
  assert.throws(
    () => s.matching.previewImport(statement()),
    /Business changed/,
  );
});

test("reviewed rules match existing parties and accounts, detect overlap, and support edit and removal", () => {
  const s = setup();
  let result = imported(s);
  const ids = result.data.statements[0].rows.map((row) => row.id);
  for (const patch of [
    { partyId: "client:other-business" },
    { account: "9999" },
    { category: "invented" },
    { contains: "a" },
  ])
    assert.throws(() =>
      s.matching.saveRule({ ...rule(s, result.revision), ...patch }),
    );
  result = s.matching.saveRule(rule(s, result.revision));
  assert.throws(
    () => s.matching.saveRule(rule(s, result.revision)),
    /already uses/,
  );
  result = s.matching.applyRule({
    businessId: "b1",
    revision: result.revision,
    rowIds: ids,
    confirm: true,
  });
  assert.equal(
    result.data.statements[0].rows[0].classification.partyId,
    "client:c1",
  );
  assert.equal(
    result.data.statements[0].rows[0].classification.account,
    "1100",
  );
  result = s.matching.saveRule({
    ...rule(s, result.revision),
    contains: "Traders",
  });
  assert.throws(
    () =>
      s.matching.applyRule({
        businessId: "b1",
        revision: result.revision,
        rowIds: ids,
        confirm: true,
      }),
    /exactly one/,
  );
  const id = result.data.rules[1].id;
  result = s.matching.saveRule({
    ...rule(s, result.revision),
    id,
    contains: "unrelated",
  });
  result = s.matching.removeRule({
    businessId: "b1",
    revision: result.revision,
    id,
    confirm: true,
  });
  assert.equal(result.data.rules.length, 1);
  assert.deepEqual(
    result.data.ruleHistory.map((item) => item.action),
    ["create", "create", "update", "remove"],
  );
  assert.equal(result.data.ruleHistory[2].before.contains, "traders");
  assert.equal(result.data.ruleHistory[2].after.contains, "unrelated");
  assert.throws(
    () =>
      s.matching.removeRule({
        businessId: "b1",
        revision: 0,
        id: result.data.rules[0].id,
        confirm: true,
      }),
    /Revision conflict/,
  );
  assert.equal(s.data.clients.length, 1);
  assert.equal(s.calls, 0);
});

test("bank AI uses reviewed redacted context, allowed aliases and explicit classification apply", async () => {
  const s = setup(),
    original = imported(s, [
      row({ description: "NEFT Ananya Traders api_key=secret-do-not-send" }),
    ]);
  const id = original.data.statements[0].rows[0].id;
  const preview = s.matching.previewClassification({
    businessId: "b1",
    rowIds: [id],
  });
  assert.equal(s.calls, 0);
  assert.equal(preview.context.parties[0].id, "party0");
  assert.ok(!JSON.stringify(preview).includes("secret-do-not-send"));
  s.setResponse({
    suggestions: [
      {
        id: "row0",
        category: "business_in",
        account: "1100",
        partyId: "party0",
        reason: "Name matches the selected client; verify against the invoice.",
      },
    ],
  });
  const result = await s.matching.classify({
    businessId: "b1",
    ticketId: preview.ticketId,
    model: "test",
    consent: true,
  });
  assert.equal(s.calls, 1);
  for (const secret of [
    "private@example.com",
    "sk-private",
    "27AAAAA0000A1Z0",
    "secret-do-not-send",
    "client:c1",
  ])
    assert.ok(!s.prompts[0].includes(secret));
  assert.equal(result.suggestions[0].partyId, "client:c1");
  assert.equal(
    s.matching.list({ businessId: "b1" }).data.statements[0].rows[0]
      .classification,
    null,
  );
  assert.throws(
    () =>
      s.matching.applyClassification({
        businessId: "b1",
        ticketId: result.ticketId,
        rowIds: [id],
      }),
    /account or parties/,
  );
  const applied = s.matching.applyClassification({
    businessId: "b1",
    ticketId: result.ticketId,
    rowIds: [id],
    confirm: true,
  });
  assert.equal(
    applied.data.statements[0].rows[0].classification.source,
    "chatgpt-reviewed",
  );
  assert.equal(applied.data.statements[0].rows[0].amountMinor, 125050);
});

test("bank AI rejects invented identifiers, extra action keys, stale source and account changes", async () => {
  for (const suggestion of [
    {
      id: "row9",
      category: "business_in",
      account: null,
      partyId: null,
      reason: "guess",
    },
    {
      id: "row0",
      category: "business_in",
      account: "666",
      partyId: null,
      reason: "guess",
    },
    {
      id: "row0",
      category: "business_in",
      account: null,
      partyId: "other-business",
      reason: "guess",
    },
    {
      id: "row0",
      category: "business_in",
      account: null,
      partyId: null,
      reason: "guess",
      action: "transfer",
    },
  ]) {
    const s = setup(),
      result = imported(s),
      id = result.data.statements[0].rows[0].id;
    const p = s.matching.previewClassification({
      businessId: "b1",
      rowIds: [id],
    });
    s.setResponse({ suggestions: [suggestion] });
    await assert.rejects(
      s.matching.classify({
        businessId: "b1",
        ticketId: p.ticketId,
        model: "test",
        consent: true,
      }),
      /invalid/,
    );
    assert.equal(
      s.matching.list({ businessId: "b1" }).revision,
      result.revision,
    );
  }
  for (const mutate of [
    (s) => s.setAccount("a2"),
    (s) => s.data.clients.push({ id: "c2", name: "New party" }),
    (s) => s.setActive("b2"),
  ]) {
    const s = setup(),
      result = imported(s),
      p = s.matching.previewClassification({
        businessId: "b1",
        rowIds: [result.data.statements[0].rows[0].id],
      });
    s.preflight(() => mutate(s));
    await assert.rejects(
      s.matching.classify({
        businessId: "b1",
        ticketId: p.ticketId,
        model: "test",
        consent: true,
      }),
      /changed/,
    );
    assert.equal(s.calls, 0);
  }
});

test("bank statement deletion removes review state only and requires a current revision", () => {
  const s = setup(),
    result = imported(s),
    id = result.data.statements[0].id;
  assert.throws(
    () =>
      s.matching.removeStatement({
        businessId: "b1",
        id,
        revision: 0,
        confirm: true,
      }),
    /Revision/,
  );
  const removed = s.matching.removeStatement({
    businessId: "b1",
    id,
    revision: result.revision,
    confirm: true,
  });
  assert.equal(removed.data.statements.length, 0);
  assert.equal(s.data.purchases.length, 1);
  assert.equal(s.data.products[0].stock, 80);
});

test("saved party rules require the reviewed identity at save and apply", () => {
  const s = setup();
  let result = imported(s);
  const stale = rule(s, result.revision);
  s.data.clients[0].name = "Changed client identity";
  assert.throws(() => s.matching.saveRule(stale), /selected party changed/);
  result = s.matching.saveRule(rule(s, result.revision));
  s.data.clients[0].name = "Changed once more";
  assert.throws(
    () =>
      s.matching.applyRule({
        businessId: "b1",
        revision: result.revision,
        rowIds: [result.data.statements[0].rows[0].id],
        confirm: true,
      }),
    /party changed/,
  );
  assert.equal(
    s.matching.list({ businessId: "b1" }).data.statements[0].rows[0]
      .classification,
    null,
  );
});

test("catalog extraction permits only grounded provided identity fields, never prices, stock or tax", () => {
  const instruction = "Add A5 notebook. Description: ruled paper. Unit: Pcs.";
  const parsed = parseCatalogDraft(
    {
      text: JSON.stringify({
        draft: { name: "A5 notebook", description: "ruled paper", unit: "Pcs" },
        clarifications: [],
      }),
    },
    "products",
    instruction,
  );
  assert.equal(parsed.draft.unit, "Pcs");
  for (const draft of [
    { name: "A5 notebook", taxPercent: 18 },
    { name: "Made-up name" },
    { name: "A5 notebook", stock: 10 },
    { name: "A5 notebook", description: "invented fact" },
    { id: "p1", name: "A5 notebook" },
  ])
    assert.throws(() =>
      parseCatalogDraft(
        { text: JSON.stringify({ draft, clarifications: [] }) },
        "products",
        instruction,
      ),
    );
  assert.throws(() =>
    parseCatalogDraft(
      { text: JSON.stringify({ draft: { name: "name" }, clarifications: [] }) },
      "__proto__",
      "name",
    ),
  );
});

test("catalog drafts use single-use context approvals and return unsaved forms with explicit duplicate review", async () => {
  const s = setup();
  s.setResponse({
    draft: { name: "Ananya Traders", city: "Pune" },
    clarifications: [],
  });
  const p = s.catalog.preview({
    businessId: "b1",
    kind: "clients",
    instruction: "Create Ananya Traders in Pune",
  });
  assert.equal(s.calls, 0);
  const result = await s.catalog.generate({
    businessId: "b1",
    ticketId: p.ticketId,
    consent: true,
    model: "test",
  });
  assert.equal(result.duplicates.length, 1);
  assert.throws(
    () =>
      s.catalog.resolve({
        businessId: "b1",
        ticketId: result.ticketId,
        confirm: true,
      }),
    /existing record/,
  );
  const resolved = s.catalog.resolve({
    businessId: "b1",
    ticketId: result.ticketId,
    confirm: true,
    allowDuplicate: true,
  });
  assert.equal(resolved.kind, "clients");
  assert.equal(resolved.businessId, "b1");
  assert.equal(resolved.draft.name, "Ananya Traders");
  assert.ok(resolved.reviewId);
  assert.equal(s.data.clients.length, 1);
  assert.throws(
    () =>
      s.catalog.resolve({
        businessId: "b1",
        ticketId: result.ticketId,
        confirm: true,
        allowDuplicate: true,
      }),
    /expired/,
  );
  assert.ok(!s.prompts[0].includes("private@example.com"));
});

test("catalog source and account changes invalidate model requests and later form handoff", async () => {
  for (const mutate of [
    (s) => s.setAccount("a2"),
    (s) => {
      s.data.products[0].stock++;
    },
    (s) => s.setActive("b2"),
  ]) {
    const s = setup(),
      p = s.catalog.preview({
        businessId: "b1",
        kind: "products",
        instruction: "Add Office paper",
      });
    s.preflight(() => mutate(s));
    await assert.rejects(
      s.catalog.generate({
        businessId: "b1",
        ticketId: p.ticketId,
        consent: true,
        model: "test",
      }),
      /changed/,
    );
    assert.equal(s.calls, 0);
  }
  const s = setup();
  s.setResponse({ draft: { name: "Office paper" }, clarifications: [] });
  const p = s.catalog.preview({
    businessId: "b1",
    kind: "products",
    instruction: "Add Office paper",
  });
  const result = await s.catalog.generate({
    businessId: "b1",
    ticketId: p.ticketId,
    consent: true,
    model: "test",
  });
  s.data.products[0].sellingPrice = 99;
  assert.throws(
    () =>
      s.catalog.resolve({
        businessId: "b1",
        ticketId: result.ticketId,
        confirm: true,
      }),
    /changed/,
  );
});

test("catalog aliases remain scoped, conflict checked, revision checked and invalidated when sources change", () => {
  const s = setup();
  s.data.products.push({ id: "p2", name: "Other notebook" });
  const request = {
    businessId: "b1",
    kind: "products",
    alias: "Ruled book",
    targetId: "p1",
    targetFingerprint: s.catalog
      .list({ businessId: "b1", kind: "products" })
      .records.find((row) => row.id === "p1").fingerprint,
    revision: 0,
    confirm: true,
  };
  let result = s.catalog.saveAlias(request);
  const resolve = (name) =>
    resolveCatalogAlias({
      aliases: s.saved.get("catalog").data.aliases,
      records: s.data.products,
      kind: "products",
      name,
    });
  assert.equal(resolve("  ruled BOOK "), s.data.products[0]);
  assert.throws(
    () =>
      s.catalog.saveAlias({
        ...request,
        revision: result.revision,
        targetId: "p2",
        targetFingerprint: s.catalog
          .list({ businessId: "b1", kind: "products" })
          .records.find((row) => row.id === "p2").fingerprint,
      }),
    /another record/,
  );
  assert.throws(
    () =>
      s.catalog.saveAlias({
        ...request,
        revision: result.revision,
        alias: "Other notebook",
      }),
    /different record/,
  );
  assert.throws(
    () => s.catalog.saveAlias({ ...request, alias: "New alias", revision: 0 }),
    /Revision/,
  );
  s.data.products[0].stock++;
  assert.equal(resolve("Ruled book"), s.data.products[0]);
  s.data.products[0].name = "Updated notebook";
  assert.equal(resolve("Ruled book"), null);
  assert.equal(
    s.catalog.list({ businessId: "b1", kind: "products" }).aliases[0].stale,
    true,
  );
  assert.throws(
    () => s.catalog.saveAlias({ ...request, revision: result.revision }),
    /selected record changed/,
  );
  result = s.catalog.saveAlias({
    ...request,
    revision: result.revision,
    targetFingerprint: s.catalog
      .list({ businessId: "b1", kind: "products" })
      .records.find((row) => row.id === "p1").fingerprint,
  });
  assert.equal(resolve("Ruled book"), s.data.products[0]);
  result = s.catalog.removeAlias({
    businessId: "b1",
    kind: "products",
    id: result.aliases[0].id,
    revision: result.revision,
    confirm: true,
  });
  assert.equal(result.aliases.length, 0);
  assert.equal(s.data.products.length, 2);
});

test("catalog duplicate groups and expiring tickets do not invent or merge records", async () => {
  const s = setup();
  s.data.clients.push({ id: "c2", name: "ANANYA TRADERS" });
  assert.equal(
    s.catalog.list({ businessId: "b1", kind: "clients" }).duplicates.length,
    1,
  );
  const p = s.catalog.preview({
    businessId: "b1",
    kind: "clients",
    instruction: "Add Someone",
  });
  s.setClock(20 * 60 * 1000);
  await assert.rejects(
    s.catalog.generate({
      businessId: "b1",
      ticketId: p.ticketId,
      consent: true,
      model: "test",
    }),
    /expired/,
  );
});

test("bank CSV parser handles quoted descriptions, rejects ambiguous columns and exports formula-safe reviewed values", () => {
  const parsed = parseBankReviewCsv(
    'date,description,amount,direction,reference\n2026-10-15,"Trade, India",1250.50,credit,REF01',
  );
  assert.equal(parsed[0].description, "Trade, India");
  assert.equal(parsed[0].amount, 1250.5);
  assert.throws(
    () => parseBankReviewCsv("date,date,amount,direction\na,b,1,credit"),
    /columns/,
  );
  assert.throws(
    () =>
      parseBankReviewCsv(
        "date,description,amount,direction\n2026-01-01,test,1e4,credit",
      ),
    /amount/,
  );
  const csv = bankReviewCsv(
    [
      {
        accountLabel: '=WEBSERVICE("x")',
        currency: "INR",
        rows: [
          {
            date: "2026-10-15",
            description: "+formula",
            reference: "@formula",
            direction: "credit",
            amountMinor: 100,
          },
        ],
      },
    ],
    {},
    [],
    [],
  );
  assert.ok(csv.includes("'="));
  assert.ok(csv.includes("'+"));
  assert.ok(csv.includes("'@"));
});
