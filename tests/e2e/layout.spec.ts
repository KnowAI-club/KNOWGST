import { test, expect } from "@playwright/test";
test.beforeEach(async ({ request }) => {
  await request.post("/api/local-prefs", {
    data: {
      set: {
        gst_printSettings: JSON.stringify({ onboardingComplete: true }),
        freegstbill_onboarded: "true",
      },
    },
  });
});
const views = [
  "dashboard",
  "new",
  "clients",
  "inventory",
  "expenses",
  "purchases",
  "recurring",
  "receipts",
  "reports",
  "filing",
  "incometax",
  "settings",
  "controlpanel",
  "support",
];
for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
]) {
  test(`all workspace pages align and contain their content at ${viewport.width}px`, async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(120000);
    await page.setViewportSize(viewport);
    await request.post("/api/profile", {
      data: {
        businessName: "Layout review",
        country: "India",
        state: "Maharashtra",
      },
    });
    let headingLeft: number | undefined;
    for (const view of views) {
      await page.goto(`/?view=${view}`);
      const heading = page.locator(".workspace-heading h1");
      await expect(heading).toBeVisible();
      await expect(page.getByText("Loading…", { exact: true })).toHaveCount(0);
      const box = (await heading.boundingBox())!;
      headingLeft ??= box.x;
      expect(box.x, `${view}: common left edge`).toBe(headingLeft);
      const geometry = await page
        .locator(".main-content")
        .evaluate((el) => ({ width: el.clientWidth, scroll: el.scrollWidth }));
      expect(
        geometry.scroll,
        `${view}: no page-wide horizontal scrolling`,
      ).toBeLessThanOrEqual(geometry.width + 1);
      await expect(heading).toHaveCSS(
        "font-size",
        viewport.width > 768 ? "28px" : "24px",
      );
      if (view === "new" && viewport.width <= 768) {
        await expect(page.locator(".editor-pane")).toHaveCSS(
          "overflow-y",
          "visible",
        );
      }
      if (
        ["dashboard", "new", "settings", "reports", "incometax"].includes(view)
      ) {
        await page.screenshot({ path: testInfo.outputPath(`${view}.png`) });
      }
    }
  });
}
test("shared headers and actions remain readable in dark mode", async ({
  page,
}, testInfo) => {
  await page.goto("/?view=reports");
  await page.getByRole("button", { name: "Dark Mode", exact: true }).click();
  for (const view of views) {
    await page.goto(`/?view=${view}`);
    await expect(page.locator(".workspace-heading h1")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator(".workspace-heading")).toHaveCSS(
      "background-image",
      "none",
    );
  }
  await page.screenshot({ path: testInfo.outputPath("dark-about.png") });
  await page.getByRole("button", { name: "Light Mode", exact: true }).click();
});
test("report and tax subpages fit a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const groups: [string, string[]][] = [
    [
      "reports",
      [
        "Profit & Loss",
        "Outstanding & Aging",
        "Party Outstanding",
        "Client Analytics",
        "Product Performance",
        "Stock",
      ],
    ],
    [
      "filing",
      [
        "GSTR-1",
        "GSTR-3B",
        "GSTR-2B Reconciliation",
        "TDS / TCS Report",
        "Filing Guide",
      ],
    ],
    [
      "incometax",
      [
        "Regime Calculator",
        "Presumptive (§44AD/ADA)",
        "Advance Tax",
        "Bank Statement Import",
        "ITR Summary",
      ],
    ],
  ];
  for (const [view, tabs] of groups) {
    await page.goto(`/?view=${view}`);
    for (const name of tabs) {
      await page
        .locator(".main-content")
        .getByRole("button", { name, exact: true })
        .first()
        .click();
      const geometry = await page
        .locator(".main-content")
        .evaluate((el) => ({ width: el.clientWidth, scroll: el.scrollWidth }));
      expect(geometry.scroll, `${view}/${name}`).toBeLessThanOrEqual(
        geometry.width + 1,
      );
    }
  }
});
test("entry dialogs keep fields and actions inside the mobile viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [view, action] of [
    ["clients", "Add Client"],
    ["inventory", "Add Product"],
    ["expenses", "Add Expense"],
    ["purchases", "Add Purchase"],
    ["receipts", "New Receipt"],
    ["recurring", "New Template"],
  ] as const) {
    await page.goto(`/?view=${view}`);
    await page
      .locator(".main-content")
      .getByRole("button", { name: action, exact: true })
      .first()
      .click();
    const modal = page.locator(".modal-content").last();
    await expect(modal).toBeVisible();
    const box = (await modal.boundingBox())!;
    expect(box.x, view).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, view).toBeLessThanOrEqual(390);
    const content = await modal.evaluate((el) => ({
      width: el.clientWidth,
      scroll: el.scrollWidth,
    }));
    expect(content.scroll, view).toBeLessThanOrEqual(content.width + 1);
  }
});
