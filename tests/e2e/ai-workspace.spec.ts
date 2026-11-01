import { test, expect, type Page } from "@playwright/test";

async function expectChatContentsToFit(page: Page) {
  // Root scroll width can pass while a nested transcript clips its own text.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const conversation =
          document.querySelector<HTMLElement>(".ai-conversation");
        if (!conversation) return ["Missing conversation"];
        const bounds = conversation.getBoundingClientRect();
        const failures: string[] = [];
        for (const element of document.querySelectorAll<HTMLElement>(
          ".ai-conversation, .ai-message, .ai-answer, .ai-question, .ai-sources, .ai-sources li",
        )) {
          if (
            element.clientWidth &&
            element.scrollWidth > element.clientWidth + 1
          )
            failures.push(
              `${element.className || element.tagName}: ${element.scrollWidth}px content / ${element.clientWidth}px box`,
            );
        }
        for (const element of document.querySelectorAll(
          ".ai-answer, .ai-question, .ai-sources li > span",
        )) {
          const range = document.createRange();
          range.selectNodeContents(element);
          for (const rect of range.getClientRects()) {
            if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)
              failures.push(
                `${element.className || element.tagName}: text outside transcript`,
              );
          }
        }
        if (
          innerWidth <= 480 &&
          conversation.scrollHeight > conversation.clientHeight + 1
        )
          failures.push(
            `Mobile transcript clips ${conversation.scrollHeight - conversation.clientHeight}px of content`,
          );
        return failures;
      }),
    )
    .toEqual([]);
}
test("AI preview uses actual scoped totals, consent gates inference and layout fits", async ({
  page,
  request,
}) => {
  const profile = {
    id: "ai-demo",
    businessName: "AI demo business",
    country: "India",
    state: "Maharashtra",
  };
  await request.post("/api/profile", { data: profile });
  await request.post("/api/local-prefs", {
    data: {
      set: {
        gst_printSettings: JSON.stringify({ onboardingComplete: true }),
        freegstbill_onboarded: "true",
        freegstbill_theme: "light",
      },
    },
  });
  const month = new Date().toISOString().slice(0, 7);
  const bill = {
    id: "AI-SOURCE",
    invoiceNumber: "PRIVATE-REF",
    invoiceDate: month + "-01",
    invoiceType: "tax-invoice",
    clientName: "Private Customer",
    totalAmount: 118,
    totalTaxAmount: 18,
    paidAmount: 0,
    data: { profile, items: [], details: { dueDate: "2020-01-01" } },
  };
  expect(
    (
      await request.post("/api/invoice-transactions", {
        data: { operations: [{ bill }] },
      })
    ).ok(),
  ).toBe(true);
  const preview = await request.post("/api/integrations/ai/preview", {
    data: { businessId: profile.id, month, currency: "INR", task: "monthly" },
  });
  expect(preview.ok()).toBe(true);
  const snapshot = await preview.json();
  expect(snapshot.context.amounts.sales).toBe(10000);
  expect(snapshot.prompt).not.toContain("Private Customer");
  expect(snapshot.prompt).not.toContain("PRIVATE-REF");
  expect(
    (
      await request.post("/api/integrations/ai/analyze", {
        data: { snapshotId: snapshot.id, consent: false, model: "test" },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await request.post("/api/integrations/ai/preview", {
        data: {
          businessId: "another",
          month,
          currency: "INR",
          task: "monthly",
        },
      })
    ).status(),
  ).toBe(409);
  await page.route("**/api/integrations/chatgpt/models", (r) =>
    r.fulfill({ json: [{ id: "test", name: "Test model" }] }),
  );
  let calls = 0;
  await page.route("**/api/integrations/ai/analyze", (r) => {
    calls++;
    return r.fulfill({
      json: {
        text: "Example review response. <script>not executable</script>",
      },
    });
  });
  await page.goto("/?view=ai");
  await expect(
    page.getByRole("heading", { name: "AI assistant", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reviews & drafts" }).click();
  await page.getByRole("button", { name: "Preview data to share" }).click();
  const generate = page.getByRole("button", { name: "Generate review" });
  await expect(generate).toBeDisabled();
  expect(calls).toBe(0);
  for (const width of [1440, 800, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expectChatContentsToFit(page);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "apps/parity/public/docs/screenshots/ai-assistant.png",
    fullPage: true,
  });
  await page
    .getByLabel("Send this summary to ChatGPT for this request")
    .check();
  await generate.click();
  await expect(page.locator(".ai-answer")).toContainText(
    "<script>not executable</script>",
  );
  expect(calls).toBe(1);
  await page.getByRole("button", { name: "Reviews & drafts" }).click();
  await page.getByLabel("Month", { exact: true }).fill("2026-10");
  await expect(page.locator(".ai-answer")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Generate review" }),
  ).toHaveCount(0);
});

test("business record questions require consent and show source coverage", async ({
  page,
  request,
}) => {
  await request.post("/api/profile", {
    data: {
      id: "records-ai",
      businessName: "Records AI",
      country: "India",
      state: "Maharashtra",
    },
  });
  await request.post("/api/local-prefs", {
    data: {
      set: {
        gst_printSettings: JSON.stringify({ onboardingComplete: true }),
        freegstbill_onboarded: "true",
      },
    },
  });
  expect(
    (
      await request.post("/api/integrations/ai/records", {
        data: {
          businessId: "another-business",
          question: "Show invoices",
          model: "m",
          consent: true,
        },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await request.post("/api/integrations/ai/records", {
        data: {
          businessId: "records-ai",
          question: "Show invoices",
          model: "m",
          consent: false,
        },
      })
    ).status(),
  ).toBe(400);
  await page.route("**/api/integrations/chatgpt/models", (r) =>
    r.fulfill({ json: [{ id: "m", name: "Test model" }] }),
  );
  const longReference = "TEST-1-" + "REFERENCE".repeat(30);
  const questions: Array<Record<string, unknown>> = [];
  await page.routeWebSocket("**/api/ai/chat", (socket) => {
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      questions.push(message.payload);
      expect(message.payload.consent).toBe(true);
      socket.send(
        JSON.stringify({
          id: message.id,
          type: "status",
          message: "Reading the saved records…",
        }),
      );
      socket.send(
        JSON.stringify({
          id: message.id,
          type: "result",
          result: {
            conversationId: "12345678-1234-1234-1234-123456789abc",
            text:
              questions.length === 1
                ? `Invoice TEST-1 needs review. Reference: ${longReference}`
                : "TEST-1 remains unpaid.",
            sources: [{ id: "one", module: "bills", reference: longReference }],
            coverage: { module: "bills", total: 8, returned: 1, more: true },
          },
        }),
      );
    });
  });
  await page.goto("/?view=ai");
  await page.getByLabel("Message", { exact: true }).fill("Find TEST-1");
  const ask = page.getByRole("button", {
    name: "Send message",
    exact: true,
  });
  await expect(ask).toBeDisabled();
  await page
    .getByLabel(
      "Allow relevant business records to be shared with ChatGPT in this chat",
    )
    .check();
  await ask.click();
  await expect(page.locator(".ai-answer")).toContainText("TEST-1");
  await expect(page.getByText(/Source coverage: 1 of 8/)).toBeVisible();
  await page
    .getByLabel("Message", { exact: true })
    .fill("What is its payment status?");
  await page.getByLabel("Message", { exact: true }).press("Enter");
  await expect(page.locator(".ai-answer")).toHaveCount(2);
  expect(questions[0]!.conversationId).toBeUndefined();
  expect(questions[1]!.conversationId).toBe(
    "12345678-1234-1234-1234-123456789abc",
  );
  await page.locator(".ai-sources summary").last().click();
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (value) => document.documentElement.setAttribute("data-theme", value),
      theme,
    );
    for (const width of [1440, 800, 480, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expectChatContentsToFit(page);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page
    .getByRole("button", { name: "Open source register" })
    .last()
    .click();
  await expect(
    page.getByRole("heading", { name: "Invoices", exact: true, level: 1 }),
  ).toBeVisible();
});

test("chat resets safely, handles transport errors and supports keyboard composition", async ({
  page,
  request,
}) => {
  await request.post("/api/profile", {
    data: {
      id: "chat-lifecycle",
      businessName: "Pune Office Supply · Demo",
      country: "India",
      state: "Maharashtra",
    },
  });
  await request.post("/api/local-prefs", {
    data: {
      set: {
        gst_printSettings: JSON.stringify({ onboardingComplete: true }),
        freegstbill_onboarded: "true",
        freegstbill_theme: "light",
      },
    },
  });
  let account = "account-one",
    holdStatus = false;
  let releaseStatus: (() => void) | undefined;
  await page.route("**/api/integrations", async (r) => {
    if (holdStatus) {
      holdStatus = false;
      await new Promise<void>((resolve) => {
        releaseStatus = resolve;
      });
      return r.fulfill({
        json: { chatgpt: { active: "obsolete-account" }, resend: {} },
      });
    }
    return r.fulfill({ json: { chatgpt: { active: account }, resend: {} } });
  });
  await page.route("**/api/integrations/chatgpt/models", (r) =>
    r.fulfill({
      json: [
        { id: "m", name: "Test model" },
        { id: "m2", name: "Second model" },
      ],
    }),
  );
  const received: Array<{ id: string; payload: Record<string, unknown> }> = [];
  let reply: ((text: string) => void) | undefined;
  await page.routeWebSocket("**/api/ai/chat", (socket) => {
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      received.push(message);
      socket.send(
        JSON.stringify({
          id: message.id,
          type: "status",
          message: "Reading your records…",
        }),
      );
      reply = (text) =>
        socket.send(
          JSON.stringify({
            id: message.id,
            type: "result",
            result: {
              text,
              sources: [
                { module: "bills", id: "DEMO-1042", reference: "DEMO-1042" },
              ],
              coverage: { module: "bills", total: 1, returned: 1, more: false },
              conversationId: "12345678-1234-1234-1234-123456789abc",
            },
          }),
        );
      if (message.payload.question === "Malformed") socket.send("null");
      if (message.payload.question === "Fail once")
        socket.send(
          JSON.stringify({
            id: message.id,
            type: "error",
            error: "ChatGPT is temporarily unavailable. Try again.",
          }),
        );
    });
  });
  await page.goto("/?view=ai");
  const composer = page.getByLabel("Message", { exact: true });
  const consent = page.getByLabel(
    "Allow relevant business records to be shared with ChatGPT in this chat",
  );
  await composer.fill("First line");
  await composer.press("Shift+Enter");
  await composer.type("Second line");
  expect(await composer.inputValue()).toBe("First line\nSecond line");
  await consent.check();
  await composer.press("Enter");
  await expect(
    page.getByRole("status").filter({ hasText: "Reading your records" }),
  ).toBeVisible();
  expect(received).toHaveLength(1);
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  reply?.("Late reply must not appear");
  await expect(page.locator(".ai-message")).toHaveCount(0);
  await expect(consent).not.toBeChecked();
  await composer.fill("Fail once");
  await consent.check();
  await composer.press("Enter");
  await expect(page.getByRole("alert")).toContainText(
    "temporarily unavailable",
  );
  await expect(composer).toHaveValue("Fail once");
  expect(received).toHaveLength(2);
  await composer.fill("Find invoice DEMO-1042.");
  await composer.press("Enter");
  await expect.poll(() => received.length).toBe(3);
  reply?.(
    "Invoice DEMO-1042 is unpaid. ₹11,800 remains due.\n\nOpen the invoice register to verify its latest status before contacting the customer.",
  );
  await expect(page.locator(".ai-answer")).toContainText("DEMO-1042");
  for (const width of [1440, 800, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expectChatContentsToFit(page);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "apps/parity/public/docs/screenshots/ai-assistant.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() =>
    document.documentElement.setAttribute("data-theme", "dark"),
  );
  await page.locator(".ai-sources summary").click();
  await expectChatContentsToFit(page);
  await expect
    .poll(() =>
      page
        .locator(".sidebar")
        .evaluate((element) => element.getBoundingClientRect().right),
    )
    .toBeLessThanOrEqual(0);
  await page.screenshot({
    path: "/tmp/knowgst-ai-chat-mobile-dark.png",
    fullPage: true,
  });
  await composer.scrollIntoViewIfNeeded();
  await expect(composer).toBeInViewport({ ratio: 1 });
  await page.screenshot({
    path: "/tmp/knowgst-ai-chat-mobile-composer.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() =>
    document.documentElement.setAttribute("data-theme", "light"),
  );
  await page.getByLabel("ChatGPT model").selectOption("m2");
  await expect(page.locator(".ai-message")).toHaveCount(0);
  await expect(consent).not.toBeChecked();
  account = "account-two";
  await composer.fill("Question after account switch");
  await consent.check();
  await composer.press("Enter");
  await expect(page.getByRole("alert")).toContainText("account changed");
  expect(received).toHaveLength(3);
  await expect(page.locator(".ai-message")).toHaveCount(0);
  await composer.fill("Malformed");
  await consent.check();
  await composer.press("Enter");
  await expect(page.getByRole("alert")).toContainText("Invalid chat response");
  await expect(composer).toHaveValue("Malformed");
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  holdStatus = true;
  await composer.fill("Obsolete question");
  await consent.check();
  await composer.press("Enter");
  await expect.poll(() => typeof releaseStatus).toBe("function");
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await composer.fill("Fresh draft");
  releaseStatus?.();
  await expect(composer).toHaveValue("Fresh draft");
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(received).toHaveLength(4);
});

test("real chat WebSocket validates requests through the dev proxy", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const ws = new WebSocket(`ws://${location.host}/api/ai/chat`);
        ws.onopen = () =>
          ws.send(
            JSON.stringify({ id: "validation", type: "ask", payload: {} }),
          );
        ws.onmessage = (event) => {
          resolve(JSON.parse(event.data));
          ws.close();
        };
        ws.onerror = () => resolve({ error: "connection failed" });
      }),
  );
  expect(result).toMatchObject({
    type: "error",
    id: "validation",
    error: expect.stringContaining("valid question"),
  });
});
