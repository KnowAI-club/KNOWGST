import test from "node:test";
import assert from "node:assert/strict";
import {
  safeRecord,
  searchBusinessRecords,
  recordAssistant,
  RECORD_MODULES,
} from "../ai-records.mjs";
test("records remove nested credentials and binaries but retain accounting details", () => {
  assert.deepEqual(
    safeRecord({
      id: "one",
      data: {
        apiKey: "secret",
        customer: "Demo",
        accessToken: "secret",
        logo: "image",
      },
      amount: 42,
    }),
    { id: "one", data: { customer: "Demo" }, amount: 42 },
  );
  assert.equal(
    safeRecord("data:image/png;base64,secret"),
    "[binary or credential omitted]",
  );
});
test("every supported module is searchable and partial coverage is explicit", () => {
  const read = () =>
    Array.from({ length: 12 }, (_, i) => ({ id: String(i), name: "Water" }));
  for (const module of RECORD_MODULES) {
    const r = searchBusinessRecords(read, "a", { module, query: "water" });
    assert.equal(r.total, 12);
    assert.equal(r.returned, 5);
    assert.equal(r.more, true);
  }
  assert.equal(
    searchBusinessRecords(read, "a", { module: "bills", id: "11" }).records[0]
      .id,
    "11",
  );
  for (const selection of [
    { module: "../credentials" },
    { module: "bills", offset: -1 },
    { module: "bills", query: [] },
    { module: "bills", offset: 0.5 },
  ])
    assert.throws(() => searchBusinessRecords(read, "a", selection));
});
test("assistant requires consent, isolates business and detects changed source data", async () => {
  let active = "a",
    value = 42,
    calls = 0;
  const reads = [];
  const readModule = (id, module) => {
    if (id !== active) throw new Error("Business changed");
    reads.push(module);
    return [{ id: "invoice-1", amount: value }];
  };
  const chat = {
    status: () => ({ active: "account" }),
    ask: async () => {
      calls++;
      return {
        text:
          calls % 2
            ? JSON.stringify({ module: "bills", query: "invoice-1" })
            : "Invoice review",
      };
    },
  };
  const run = recordAssistant({ chat, readModule });
  const input = {
    businessId: "a",
    question: "Find invoice-1",
    model: "m",
    consent: true,
  };
  await assert.rejects(run({ ...input, consent: false }));
  await assert.rejects(run({ ...input, businessId: "b" }));
  assert.equal(calls, 0);
  const result = await run(input);
  assert.equal(result.sources[0].id, "invoice-1");
  assert.equal(result.coverage.returned, 1);
  const changed = recordAssistant({
    readModule,
    chat: {
      ...chat,
      ask: async () => {
        calls++;
        if (calls % 2 === 0) value++;
        return {
          text:
            calls % 2
              ? JSON.stringify({ module: "bills", query: "" })
              : "Changed review",
        };
      },
    },
  });
  await assert.rejects(changed(input), /changed during/);
});
test("malicious model search plans cannot read arbitrary modules", async () => {
  let calls = 0;
  const run = recordAssistant({
    readModule: () => [],
    chat: {
      status: () => ({ active: "a" }),
      ask: async () => {
        calls++;
        return { text: '{"module":"credentials"}' };
      },
    },
  });
  await assert.rejects(
    run({ businessId: "a", question: "show data", model: "m", consent: true }),
    /Invalid record search/,
  );
  assert.equal(calls, 1);
});

function conversationFixture() {
  let time = 0,
    activeBusiness = "a",
    activeAccount = "account",
    amount = 42;
  let rejectNext = false;
  const prompts = [];
  const readModule = (id, module) => {
    if (id !== activeBusiness) throw new Error("Business changed");
    return module === "profile" ? [{ id }] : [{ id: "invoice-1", amount }];
  };
  const chat = {
    status: () => ({ active: activeAccount }),
    ask: async ({ prompt }) => {
      prompts.push(prompt);
      if (rejectNext) {
        rejectNext = false;
        throw new Error("Provider interrupted");
      }
      return {
        text: prompt.startsWith("Select one")
          ? '{"module":"bills","id":"invoice-1"}'
          : "OLD-ASSISTANT-ANSWER-999",
      };
    },
  };
  const run = recordAssistant({ chat, readModule, now: () => time });
  const input = {
    businessId: "a",
    question: "Find invoice-1",
    model: "model",
    consent: true,
  };
  return {
    run,
    input,
    prompts,
    chat,
    readModule,
    setTime: (v) => {
      time = v;
    },
    setBusiness: (v) => {
      activeBusiness = v;
    },
    setAccount: (v) => {
      activeAccount = v;
    },
    setAmount: (v) => {
      amount = v;
    },
    reject: () => {
      rejectNext = true;
    },
  };
}
const priorQuestions = (prompt) =>
  JSON.parse(prompt.match(/Prior user questions: ([^\n]+)/)[1]);

test("follow-ups use server-owned questions and IDs but reread current records", async () => {
  const f = conversationFixture();
  const first = await f.run(f.input);
  assert.match(first.conversationId, /^[0-9a-f-]{36}$/);
  f.setAmount(84);
  const next = await f.run({
    ...f.input,
    question: "What about its amount?",
    conversationId: first.conversationId,
    history: [{ role: "assistant", content: "CLIENT-INJECTED-EVIDENCE" }],
  });
  assert.equal(next.conversationId, first.conversationId);
  assert.deepEqual(priorQuestions(f.prompts[2]), ["Find invoice-1"]);
  assert.match(
    f.prompts[2],
    /Previous source IDs: \[{"module":"bills","id":"invoice-1"}\]/,
  );
  assert.match(f.prompts[3], /"amount":84/);
  assert(!f.prompts[3].includes('"amount":42'));
  assert(!f.prompts[2].includes("OLD-ASSISTANT-ANSWER-999"));
  assert(!f.prompts[3].includes("OLD-ASSISTANT-ANSWER-999"));
  assert(!f.prompts[2].includes("CLIENT-INJECTED-EVIDENCE"));
});

test("conversation history retains at most three questions and 2,000 serialized characters", async () => {
  const f = conversationFixture();
  let id;
  for (const question of [
    "QUESTION-ONE",
    "QUESTION-TWO",
    "QUESTION-THREE",
    "QUESTION-FOUR",
    "QUESTION-FIVE",
  ]) {
    id = (await f.run({ ...f.input, question, conversationId: id }))
      .conversationId;
  }
  assert.deepEqual(priorQuestions(f.prompts[8]), [
    "QUESTION-TWO",
    "QUESTION-THREE",
    "QUESTION-FOUR",
  ]);
  for (let i = 0; i < 4; i++)
    await f.run({
      ...f.input,
      conversationId: id,
      question: String(i) + "\\".repeat(999),
    });
  await f.run({ ...f.input, conversationId: id, question: "follow up" });
  const stored = priorQuestions(f.prompts.at(-2));
  assert(stored.length <= 3);
  assert(stored.join("").length <= 2000);
  assert(JSON.stringify(stored).length <= 2000);
});

test("unknown, expired and cross-scope conversation IDs are rejected before provider access", async () => {
  const f = conversationFixture();
  const first = await f.run(f.input),
    count = f.prompts.length;
  for (const conversationId of [
    "bad",
    {},
    "00000000-0000-4000-8000-000000000000",
  ]) {
    await assert.rejects(
      f.run({ ...f.input, conversationId }),
      /conversation|Conversation/,
    );
  }
  f.setAccount("other");
  await assert.rejects(
    f.run({ ...f.input, conversationId: first.conversationId }),
    /another business or ChatGPT account/,
  );
  f.setAccount("account");
  f.setBusiness("b");
  await assert.rejects(
    f.run({
      ...f.input,
      businessId: "b",
      conversationId: first.conversationId,
    }),
    /another business or ChatGPT account/,
  );
  f.setBusiness("a");
  f.setTime(30 * 60 * 1000);
  await assert.rejects(
    f.run({ ...f.input, conversationId: first.conversationId }),
    /expired/,
  );
  assert.equal(f.prompts.length, count);
});

test("conversation capacity is bounded and evicts the oldest inactive conversation", async () => {
  const f = conversationFixture(),
    ids = [];
  for (let i = 0; i < 21; i++) {
    f.setTime(i);
    ids.push((await f.run(f.input)).conversationId);
  }
  const count = f.prompts.length;
  await assert.rejects(
    f.run({ ...f.input, conversationId: ids[0] }),
    /unavailable/,
  );
  assert.equal(f.prompts.length, count);
  assert.equal(
    (await f.run({ ...f.input, conversationId: ids[20] })).conversationId,
    ids[20],
  );
});

test("a failed turn preserves prior context, releases its lock and does not refresh expiry", async () => {
  const f = conversationFixture(),
    first = await f.run(f.input);
  f.setTime(1000);
  f.reject();
  await assert.rejects(
    f.run({
      ...f.input,
      conversationId: first.conversationId,
      question: "FAILED-TURN",
    }),
    /interrupted/,
  );
  const next = await f.run({
    ...f.input,
    conversationId: first.conversationId,
    question: "Retry now",
  });
  assert.equal(next.conversationId, first.conversationId);
  assert.deepEqual(priorQuestions(f.prompts.at(-2)), ["Find invoice-1"]);
  f.setTime(2000);
  f.reject();
  await assert.rejects(
    f.run({ ...f.input, conversationId: first.conversationId }),
  );
  f.setTime(1000 + 30 * 60 * 1000);
  await assert.rejects(
    f.run({ ...f.input, conversationId: first.conversationId }),
    /expired/,
  );
});

test("concurrent turns in the same conversation are rejected without duplicate provider calls", async () => {
  const f = conversationFixture();
  let release, started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  const ask = f.chat.ask;
  f.chat.ask = async (input) => {
    if (
      input.prompt.startsWith("Select one") &&
      input.prompt.includes("Question: BLOCKED")
    ) {
      started();
      await hold;
    }
    return ask(input);
  };
  const first = await f.run(f.input);
  const pending = f.run({
    ...f.input,
    conversationId: first.conversationId,
    question: "BLOCKED",
  });
  await ready;
  await assert.rejects(
    f.run({
      ...f.input,
      conversationId: first.conversationId,
      question: "Do not duplicate",
    }),
    /already in progress/,
  );
  release();
  await pending;
  assert.equal(f.prompts.length, 4);
  assert.equal(
    (await f.run({ ...f.input, conversationId: first.conversationId }))
      .conversationId,
    first.conversationId,
  );
});

test("concurrent new conversations share the bounded active request limit", async () => {
  let release,
    plans = 0;
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  const chat = {
    status: () => ({ active: "account" }),
    ask: async ({ prompt }) => {
      if (prompt.startsWith("Select one")) {
        plans++;
        await hold;
        return { text: '{"module":"bills"}' };
      }
      return { text: "Reviewed" };
    },
  };
  const run = recordAssistant({ chat, readModule: () => [] });
  const input = {
    businessId: "a",
    question: "Review records",
    consent: true,
    model: "model",
  };
  const pending = Array.from({ length: 20 }, () => run(input));
  assert.equal(plans, 20);
  await assert.rejects(run(input), /Too many active chat requests/);
  assert.equal(plans, 20);
  release();
  const answers = await Promise.all(pending);
  assert.equal(new Set(answers.map((a) => a.conversationId)).size, 20);
  await run(input);
  assert.equal(plans, 21);
});

test("closing chat during search stops the answer step and leaves prior conversation intact", async () => {
  const f = conversationFixture();
  const first = await f.run(f.input);
  let cancelled = false;
  const ask = f.chat.ask;
  f.chat.ask = async (input) => {
    const result = await ask(input);
    cancelled = true;
    return result;
  };
  await assert.rejects(
    f.run(
      {
        ...f.input,
        question: "CANCELLED-TURN",
        conversationId: first.conversationId,
      },
      { isCancelled: () => cancelled },
    ),
    /cancelled/,
  );
  assert.equal(f.prompts.length, 3);
  f.chat.ask = ask;
  const next = await f.run({
    ...f.input,
    conversationId: first.conversationId,
  });
  assert.equal(next.conversationId, first.conversationId);
  assert.deepEqual(priorQuestions(f.prompts.at(-2)), ["Find invoice-1"]);
});

test("credential values are removed from questions, nested records, history and answers", async () => {
  const secret = "sk-proj-" + "FictionalOnly".repeat(3);
  const readModule = (_id, module) =>
    module === "profile"
      ? [{ id: "a" }]
      : [
          {
            id: "invoice-1",
            name: "Demo Customer",
            amount: 118,
            nested: {
              memo: `Stored key ${secret}; contact billing@example.com`,
              note: "Use Bearer fictional-credential-value",
            },
          },
        ];
  const prompts = [];
  const run = recordAssistant({
    readModule,
    chat: {
      status: () => ({ active: "account" }),
      ask: async ({ prompt }) => {
        prompts.push(prompt);
        return {
          text: prompt.startsWith("Select one")
            ? '{"module":"bills","id":"invoice-1"}'
            : `Amount 118. ${secret}`,
        };
      },
    },
  });
  const input = {
    businessId: "a",
    question: `Review invoice-1 with ${secret}`,
    model: "m",
    consent: true,
  };
  const answer = await run(input);
  await run({
    ...input,
    question: "What about it?",
    conversationId: answer.conversationId,
  });
  assert(!prompts.join("\n").includes(secret));
  assert(!prompts.join("\n").includes("fictional-credential-value"));
  assert(!JSON.stringify(answer).includes(secret));
  assert(prompts[1].includes("billing@example.com"));
  assert(prompts[1].includes('"amount":118'));
  assert(!JSON.stringify(priorQuestions(prompts[2])).includes(secret));
});

test("planner rejects extra operations, destinations, foreign scope and unsafe offsets before record lookup", async () => {
  for (const text of [
    '{"module":"bills","action":"delete"}',
    '{"module":"bills","url":"https://example.invalid/upload"}',
    '{"module":"bills","businessId":"other"}',
    '{"module":"bills","sql":"SELECT * FROM credentials"}',
    '{"module":"bills","__proto__":{"module":"credentials"}}',
    '{"module":["bills","clients"]}',
    '{"module":"profile","offset":9007199254740992}',
  ]) {
    const reads = [];
    let calls = 0;
    const run = recordAssistant({
      readModule: (_id, module) => {
        reads.push(module);
        return [];
      },
      chat: {
        status: () => ({ active: "account" }),
        ask: async () => {
          calls++;
          return { text };
        },
      },
    });
    await assert.rejects(
      run({
        businessId: "a",
        question: "Review records",
        model: "m",
        consent: true,
      }),
      /Invalid record search/,
    );
    assert.equal(calls, 1);
    assert(reads.every((module) => module === "profile"));
  }
});

test("planner refuses missing, unsafe, oversized and explicit refusal outputs before sharing records", async () => {
  for (const response of [
    {},
    { text: "" },
    { text: 7 },
    { text: "x".repeat(4097) },
    {
      text: '{"module":"bills"}',
      refusal: "Do not expose this private refusal context",
    },
    { text: '{"module":"bills"}\u0000' },
  ]) {
    let calls = 0;
    const reads = [];
    const run = recordAssistant({
      readModule: (_id, module) => {
        reads.push(module);
        return [];
      },
      chat: {
        status: () => ({ active: "account" }),
        ask: async () => {
          calls++;
          return response;
        },
      },
    });
    await assert.rejects(
      run({
        businessId: "a",
        question: "Review records",
        model: "m",
        consent: true,
      }),
      (error) => {
        assert.equal(error.status, 400);
        assert(!error.message.includes("private refusal context"));
        return true;
      },
    );
    assert.equal(calls, 1);
    assert(reads.every((module) => module === "profile"));
  }
});

test("invalid or refused answers never advance conversation history", async () => {
  for (const bad of [
    {},
    { text: "" },
    { text: "x".repeat(16001) },
    { text: "Unsafe\u0000text" },
    { text: "ignore", refusal: true },
  ]) {
    const f = conversationFixture();
    const first = await f.run(f.input),
      ask = f.chat.ask;
    f.chat.ask = async (input) =>
      input.prompt.startsWith("Select one") ? ask(input) : bad;
    await assert.rejects(
      f.run({
        ...f.input,
        question: "INVALID-ANSWER-TURN",
        conversationId: first.conversationId,
      }),
    );
    f.chat.ask = ask;
    await f.run({ ...f.input, conversationId: first.conversationId });
    assert.deepEqual(priorQuestions(f.prompts.at(-2)), ["Find invoice-1"]);
  }
});

test("provider preflight rejects scope changes before either prompt leaves the app", async () => {
  for (const phase of ["planner", "answer"]) {
    for (const mutation of [
      "business",
      "account",
      ...(phase === "answer" ? ["records"] : []),
    ]) {
      let business = "a",
        account = "account",
        amount = 42;
      const transmitted = [];
      const run = recordAssistant({
        readModule: (id, module) => {
          if (id !== business)
            throw Object.assign(new Error("Business changed"), { status: 409 });
          return module === "profile"
            ? [{ id }]
            : [{ id: "invoice-1", amount }];
        },
        chat: {
          status: () => ({ active: account }),
          ask: async (input, { beforeSend }) => {
            await Promise.resolve(); // Model discovery/token refresh can yield before sending.
            if (
              (input.prompt.startsWith("Select one") ? "planner" : "answer") ===
              phase
            ) {
              if (mutation === "business") business = "other";
              if (mutation === "account") account = "other";
              if (mutation === "records") amount++;
            }
            beforeSend();
            transmitted.push(input.prompt);
            return {
              text: input.prompt.startsWith("Select one")
                ? '{"module":"bills"}'
                : "Answer",
            };
          },
        },
      });
      await assert.rejects(
        run({
          businessId: "a",
          question: "Review records",
          model: "m",
          consent: true,
        }),
        /changed/i,
      );
      assert.equal(transmitted.length, phase === "planner" ? 0 : 1);
      assert(!transmitted.some((prompt) => prompt.includes('"amount":')));
    }
  }
});

test("scope changes during planning prevent any subsequent business-record lookup", async () => {
  let business = "a",
    calls = 0;
  const reads = [];
  const run = recordAssistant({
    readModule: (id, module) => {
      if (id !== business) throw new Error("Business changed");
      reads.push(module);
      return [];
    },
    chat: {
      status: () => ({ active: "account" }),
      ask: async () => {
        calls++;
        business = "b";
        return { text: '{"module":"bills"}' };
      },
    },
  });
  await assert.rejects(
    run({
      businessId: "a",
      question: "Review records",
      model: "m",
      consent: true,
    }),
    /Business changed/,
  );
  assert.equal(calls, 1);
  assert(reads.every((module) => module === "profile"));
});

test("model changes cannot reuse an existing conversation", async () => {
  const f = conversationFixture(),
    first = await f.run(f.input),
    count = f.prompts.length;
  await assert.rejects(
    f.run({
      ...f.input,
      model: "another",
      conversationId: first.conversationId,
    }),
    /different model/,
  );
  assert.equal(f.prompts.length, count);
});

test("record search bounds oversized records and rejects malformed local data", () => {
  const records = Array.from({ length: 5 }, (_, index) => ({
    id: String(index),
    name: "x".repeat(1200),
    detail: Array.from({ length: 20 }, () => "x".repeat(1200)),
  }));
  const result = searchBusinessRecords(() => records, "a", { module: "bills" });
  assert.equal(result.returned, 5);
  assert(result.records.every((record) => record.omitted === true));
  assert(JSON.stringify(result).length < 6500);
  for (const invalid of [null, {}, [null], ["text"], [17]])
    assert.throws(
      () => searchBusinessRecords(() => invalid, "a", { module: "bills" }),
      /could not be reviewed/,
    );
});

test("malformed source labels never escape as renderable objects or conversation identifiers", async () => {
  const prompts = [];
  const run = recordAssistant({
    readModule: (_id, module) =>
      module === "profile"
        ? []
        : [
            {
              id: { apiKey: "private" },
              invoiceNumber: { text: "not a label" },
              name: ["not a label"],
              date: 20261102,
              amount: 118,
            },
          ],
    chat: {
      status: () => ({ active: "a" }),
      ask: async ({ prompt }) => {
        prompts.push(prompt);
        return {
          text: prompt.startsWith("Select one")
            ? '{"module":"bills"}'
            : "Review",
        };
      },
    },
  });
  const input = {
    businessId: "a",
    question: "Review records",
    model: "m",
    consent: true,
  };
  const first = await run(input);
  assert.deepEqual(first.sources, [
    { module: "bills", id: "", reference: "bills" },
  ]);
  await run({ ...input, conversationId: first.conversationId });
  assert.match(prompts[2], /Previous source IDs: \[\]/);
});
