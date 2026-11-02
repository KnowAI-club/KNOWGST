import { test, expect } from "@playwright/test";
test.beforeEach(async ({ request }) => {
  await request.post("/api/local-prefs", {
    data: {
      set: {
        gst_printSettings: JSON.stringify({ onboardingComplete: true }),
        freegstbill_onboarded: "true",
        freegstbill_theme: "light",
      },
    },
  });
});
const views = [
  "dashboard",
  "invoices",
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
  { width: 1920, height: 1080 },
  { width: 1440, height: 1000 },
  { width: 1280, height: 800 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 320, height: 700 },
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
      // Initial profile loading can remount the page after its first heading.
      // Retry the measurement, while keeping the same alignment assertion.
      await expect(async () => {
        const box = await heading.boundingBox();
        expect(box, `${view}: heading remains rendered`).not.toBeNull();
        headingLeft ??= box!.x;
        expect(box!.x, `${view}: common left edge`).toBe(headingLeft);
      }).toPass({ timeout: 5000 });
      await expect(page.locator(".workspace-heading")).toHaveCSS("margin-top", "0px");
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
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
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

test("sidebar groups collapse, keep the active route open and support keyboard navigation", async ({page}) => {
  await page.setViewportSize({width:1280,height:720});
  await page.goto('/?view=dashboard');
  const nav=page.getByRole('navigation',{name:'Main navigation'});
  const group=(name:string)=>nav.getByRole('button',{name,exact:true});
  await expect(group('Overview')).toHaveAttribute('aria-expanded','true');
  await expect(group('Sales')).toHaveAttribute('aria-expanded','false');
  await expect(group('Invoices')).toBeHidden();
  await group('Sales').click();
  await expect(group('Invoices')).toBeVisible();
  await group('Sales').click();
  await expect(group('Invoices')).toBeHidden();
  await group('Workspace').click();
  await group('Settings').click();
  await expect(page.locator('.workspace-heading h1')).toHaveText('Settings');
  await expect(group('Workspace')).toHaveAttribute('aria-disabled','true');
  await expect(group('Workspace')).toHaveAttribute('aria-expanded','true');
  await group('Sales').focus();
  await page.keyboard.press('Enter');
  await group('Invoices').click();
  await expect(group('Sales')).toHaveAttribute('aria-expanded','true');
  await expect(group('Sales')).toHaveAttribute('aria-disabled','true');
  await page.goto('/?view=filing');
  await expect(group('Accounting & tax')).toHaveAttribute('aria-expanded','true');
  await expect(group('Sales')).toHaveAttribute('aria-expanded','false');
  await page.getByRole('button',{name:'Auto-hide menu',exact:true}).click();
  await page.mouse.move(900,100);
  await group('Sales').focus();
  await page.keyboard.press('Enter');
  await group('Invoices').click();
  await expect(page.locator('.workspace-heading h1')).toHaveText('Invoices');
  await page.getByRole('button',{name:'Auto-hide menu',exact:true}).click();
});

test("every page uses the shared compact palette in both themes", async ({page},testInfo) => {
  test.setTimeout(120000);
  for (const theme of ['light','dark']) {
    if (theme === 'dark') {
      await page.getByRole('button',{name:'Dark Mode',exact:true}).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
    }
    let reference:unknown;
    for (const view of views) {
      await page.goto(`/?view=${view}`);
      await expect(page.locator('.workspace-heading h1')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
      const palette=await page.locator('.main-content').evaluate(el=>{
        const s=getComputedStyle(el);
        return ['--primary','--on-primary','--bg','--card-bg','--text','--border'].map(t=>s.getPropertyValue(t).trim());
      });
      reference ??= palette;
      expect(palette,`${theme}/${view}: shared tokens`).toEqual(reference);
      if (view === 'settings' || view === 'invoices') await page.screenshot({path:testInfo.outputPath(`${theme}-${view}.png`)});
      const primary=page.locator('.main-content .btn-primary:visible').first();
      if(await primary.count()) {
        const colors=await primary.evaluate(el=>{
          const s=getComputedStyle(el);const probe=document.createElement('span');
          probe.style.color='var(--on-primary)';el.appendChild(probe);
          const foreground=getComputedStyle(probe).color;probe.style.color='var(--primary)';
          const background=getComputedStyle(probe).color;probe.remove();
          return {actual:[s.color,s.backgroundColor],expected:[foreground,background]};
        });
        await expect.poll(() => primary.evaluate(el => { const s=getComputedStyle(el); return [s.color,s.backgroundColor]; }), {message:`${theme}/${view}: primary button contrast`}).toEqual(colors.expected);
      }
    }
  }
});
