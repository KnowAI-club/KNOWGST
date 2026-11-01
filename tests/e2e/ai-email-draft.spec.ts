import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

const consentLabel = "Share this email context with ChatGPT for one suggestion";
const suggestion = {
  subject: "Your document from Demo Studio",
  message:
    "Hello Demo Buyer,\n\nPlease find your document attached.\n\nThank you,\nDemo Studio",
};

async function setup(page: Page, request: APIRequestContext, key: string) {
  const profile = {
    id: `ai-mail-${key}`,
    businessName: "AI Mail Demo",
    country: "India",
    state: "Maharashtra",
    address: "Fictional demo address",
  };
  expect((await request.post("/api/profile", { data: profile })).ok()).toBe(
    true,
  );
  await request.post("/api/local-prefs", {
    data: {
      set: {
        gst_printSettings: JSON.stringify({ onboardingComplete: true }),
        freegstbill_onboarded: "true",
      },
    },
  });
  const invoiceNumber = `AI-MAIL-${key}`;
  const invoice = {
    id: invoiceNumber,
    invoiceNumber,
    invoiceDate: "2026-11-01",
    clientName: "Demo Buyer",
    invoiceType: "tax-invoice",
    status: "unpaid",
    totalAmount: 118,
    totalTaxAmount: 18,
    currency: "INR",
    data: {
      profile,
      client: {
        name: "Demo Buyer",
        email: "buyer@example.com",
        country: "India",
        state: "Maharashtra",
      },
      details: { invoiceNumber, invoiceDate: "2026-11-01" },
      items: [{ name: "Demo item", quantity: 1, rate: 100, taxPercent: 18 }],
      totals: {
        subtotal: 100,
        taxableAmount: 100,
        total: 118,
        cgst: 9,
        sgst: 9,
        totalTaxAmount: 18,
      },
      invoiceType: "tax-invoice",
    },
  };
  expect((await request.post("/api/bills", { data: invoice })).ok()).toBe(true);
  const receiptNo = `AI-RCPT-${key}`;
  expect(
    (
      await request.post("/api/receipts", {
        data: {
          id: receiptNo,
          receiptNo,
          date: "2026-11-01",
          clientName: "Demo Buyer",
          amount: 50,
          paymentMode: "Cash",
          profile,
          ownerName: profile.businessName,
        },
      })
    ).ok(),
  ).toBe(true);
  const status = {
    chatgpt: { active: "demo-account", accounts: [] },
    resend: {
      configured: true,
      from: "billing@example.com",
      name: "Demo Studio",
    },
  };
  await page.route("**/api/integrations", (route) =>
    route.fulfill({ json: status }),
  );
  await page.route("**/api/integrations/chatgpt/models", (route) =>
    route.fulfill({
      json: [{ id: "test-email-model", name: "Test email model" }],
    }),
  );
  const sent: any[] = [];
  await page.route("**/api/integrations/resend/send", (route) => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({ json: { id: "mock-email", status: "accepted" } });
  });
  return { invoiceNumber, receiptNo, status, sent };
}

async function openEmail(
  page: Page,
  kind: "invoice" | "receipt",
  reference: string,
  navigate = true,
) {
  if (navigate)
    await page.goto(`/?view=${kind === "invoice" ? "invoices" : "receipts"}`);
  const row = page.getByRole("row").filter({ hasText: reference });
  if (kind === "invoice") {
    await row.getByRole("button", { name: /more|actions/i }).click();
    await page.getByText("Email PDF with Resend", { exact: true }).click();
  } else {
    await row.getByTitle("Email receipt PDF").click();
  }
  const dialog = page.getByRole("dialog", {
    name: `Email ${kind}`,
    exact: true,
  });
  await expect(dialog.getByRole("link", { name: /Review PDF/ })).toBeVisible({
    timeout: 30000,
  });
  await dialog.getByText("Draft with ChatGPT", { exact: true }).click();
  await expect(
    dialog.getByLabel("Email draft model", { exact: true }),
  ).toHaveValue("test-email-model");
  return dialog;
}

async function generate(dialog: Locator) {
  await dialog.getByLabel(consentLabel).check();
  await dialog
    .getByRole("button", { name: "Generate email suggestion", exact: true })
    .click();
}

test("invoice and receipt AI drafts require consent, review and a separate send", async ({
  page,
  request,
}) => {
  const fixture = await setup(page, request, "review");
  const calls: any[] = [];
  await page.route("**/api/integrations/ai/email-draft", (route) => {
    calls.push(route.request().postDataJSON());
    return route.fulfill({ json: suggestion });
  });
  for (const [kind, reference] of [
    ["invoice", fixture.invoiceNumber],
    ["receipt", fixture.receiptNo],
  ] as const) {
    const dialog = await openEmail(page, kind, reference);
    if (kind === "receipt")
      await dialog.getByLabel("Recipient email").fill("receipt@example.com");
    const initialSubject = await dialog
      .getByLabel("Subject", { exact: true })
      .inputValue();
    const initialMessage = await dialog
      .getByRole("textbox", { name: "Message", exact: true })
      .inputValue();
    const before = calls.length;
    await expect(
      dialog.getByRole("button", {
        name: "Generate email suggestion",
        exact: true,
      }),
    ).toBeDisabled();
    expect(calls).toHaveLength(before);
    await dialog
      .getByText("Preview what will be shared", { exact: true })
      .click();
    await expect(dialog.locator("pre")).toContainText(initialSubject);
    await expect(dialog.locator("pre")).not.toContainText("buyer@example.com");
    await generate(dialog);
    const review = dialog.getByRole("region", { name: "Suggested email" });
    await expect(review).toContainText(suggestion.subject);
    await expect(dialog.getByLabel("Subject", { exact: true })).toHaveValue(
      initialSubject,
    );
    await expect(
      dialog.getByRole("textbox", { name: "Message", exact: true }),
    ).toHaveValue(initialMessage);
    expect(fixture.sent).toHaveLength(kind === "invoice" ? 0 : 1);
    expect(calls[before]).toMatchObject({
      consent: true,
      model: "test-email-model",
      kind,
      subject: initialSubject,
      message: initialMessage,
    });
    expect(Object.keys(calls[before]).sort()).toEqual(
      [
        "consent",
        "kind",
        "message",
        "model",
        "purpose",
        "reference",
        "senderName",
        "subject",
      ].sort(),
    );
    await review
      .getByRole("button", { name: "Apply suggested draft", exact: true })
      .click();
    await expect(dialog.getByLabel("Subject", { exact: true })).toHaveValue(
      suggestion.subject,
    );
    await expect(
      dialog.getByRole("textbox", { name: "Message", exact: true }),
    ).toHaveValue(suggestion.message);
    await expect(review).toHaveCount(0);
    expect(fixture.sent).toHaveLength(kind === "invoice" ? 0 : 1);
    await dialog
      .getByRole("button", { name: "Send email", exact: true })
      .click();
    await expect(dialog.getByRole("status")).toContainText(
      "Accepted by Resend",
    );
    const sent = fixture.sent.at(-1);
    expect(sent).toMatchObject({
      subject: suggestion.subject,
      text: suggestion.message,
      expectedSender: "billing@example.com",
    });
    expect(
      Buffer.from(sent.attachment.content, "base64").subarray(0, 5).toString(),
    ).toBe("%PDF-");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
  }
  expect(calls).toHaveLength(2);
  expect(fixture.sent).toHaveLength(2);
});

test("recipient changes and closed documents discard late AI email suggestions", async ({
  page,
  request,
}) => {
  const fixture = await setup(page, request, "stale");
  let release: (() => void) | undefined;
  let calls = 0;
  await page.route("**/api/integrations/ai/email-draft", async (route) => {
    calls++;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.fulfill({ json: suggestion });
  });
  let dialog = await openEmail(page, "invoice", fixture.invoiceNumber);
  const initialSubject = await dialog
    .getByLabel("Subject", { exact: true })
    .inputValue();
  await generate(dialog);
  await expect.poll(() => calls).toBe(1);
  await expect(
    dialog.getByRole("button", { name: "Send email", exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel("Recipient email").fill("another-buyer@example.com");
  release!();
  await expect(
    dialog.getByRole("button", {
      name: "Generate email suggestion",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("region", { name: "Suggested email" }),
  ).toHaveCount(0);
  await expect(dialog.getByLabel("Subject", { exact: true })).toHaveValue(
    initialSubject,
  );
  await expect(dialog.getByLabel(consentLabel)).not.toBeChecked();
  await generate(dialog);
  await expect.poll(() => calls).toBe(2);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  // A result for the closed invoice must not appear in a new receipt draft.
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Receipts", exact: true })
    .click();
  dialog = await openEmail(page, "receipt", fixture.receiptNo, false);
  const receiptSubject = await dialog
    .getByLabel("Subject", { exact: true })
    .inputValue();
  const finished = page.waitForResponse("**/api/integrations/ai/email-draft");
  const checkedStatus = page.waitForResponse("**/api/integrations");
  release!();
  await finished;
  await checkedStatus;
  await expect(
    dialog.getByRole("region", { name: "Suggested email" }),
  ).toHaveCount(0);
  await expect(dialog.getByLabel("Subject", { exact: true })).toHaveValue(
    receiptSubject,
  );
  await expect(dialog.getByLabel(consentLabel)).not.toBeChecked();
  expect(fixture.sent).toHaveLength(0);
});

test("email drafting errors and changed sender settings preserve the user's draft", async ({
  page,
  request,
}) => {
  const fixture = await setup(page, request, "failure");
  let fail = true;
  await page.route("**/api/integrations/ai/email-draft", (route) =>
    fail
      ? route.fulfill({
          status: 502,
          json: { error: "Provider unavailable. Please try again." },
        })
      : route.fulfill({ json: suggestion }),
  );
  const dialog = await openEmail(page, "invoice", fixture.invoiceNumber);
  const initialSubject = await dialog
    .getByLabel("Subject", { exact: true })
    .inputValue();
  const initialMessage = await dialog
    .getByRole("textbox", { name: "Message", exact: true })
    .inputValue();
  await generate(dialog);
  await expect(dialog.getByRole("alert")).toContainText("Provider unavailable");
  await expect(dialog.getByLabel("Subject", { exact: true })).toHaveValue(
    initialSubject,
  );
  await expect(
    dialog.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveValue(initialMessage);
  await expect(dialog.getByLabel(consentLabel)).not.toBeChecked();
  fail = false;
  await generate(dialog);
  await expect(
    dialog.getByRole("region", { name: "Suggested email" }),
  ).toBeVisible();
  fixture.status.resend.from = "changed@example.com";
  await dialog
    .getByRole("button", { name: "Apply suggested draft", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Sender or ChatGPT account changed",
  );
  await expect(
    dialog.getByRole("region", { name: "Suggested email" }),
  ).toHaveCount(0);
  await expect(dialog.getByLabel("Subject", { exact: true })).toHaveValue(
    initialSubject,
  );
  await expect(
    dialog.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveValue(initialMessage);
  expect(fixture.sent).toHaveLength(0);
});
