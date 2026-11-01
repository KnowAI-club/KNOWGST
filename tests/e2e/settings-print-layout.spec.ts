import { test, expect } from "@playwright/test";
for (const width of [1440, 1024, 800, 390])
  test(`Settings PDF and invoice controls fit ${width}px`, async ({
    page,
    request,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await request.post("/api/profile", {
      data: {
        id: "settings-fit",
        businessName: "Layout Demo",
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
    await page.goto("/?view=settings");
    const section = page.locator("#section-print");
    await section.scrollIntoViewIfNeeded();
    for (const mode of [/PDF \(A4\)/, /Thermal \(80mm\)/, /Split view/]) {
      await section.getByRole("button", { name: mode }).click();
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 2,
          ),
        )
        .toBe(true);
      await expect
        .poll(() =>
          section
            .locator(".fitted-invoice-preview")
            .evaluateAll((nodes) =>
              nodes.every((el) => el.scrollWidth <= el.clientWidth + 2),
            ),
        )
        .toBe(true);
    }
    const overflow = await section
      .locator(".print-settings-body")
      .evaluate((root) => {
        const box = root.getBoundingClientRect();
        return [...root.querySelectorAll("input,select,button")]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return (
              r.width > 0 && (r.right > box.right + 2 || r.left < box.left - 2)
            );
          })
          .map((el) => el.textContent?.slice(0, 60) || el.tagName);
      });
    expect(overflow).toEqual([]);
    await section.screenshot({ path: info.outputPath("settings-print.png") });
    await page.goto("/?view=new");
    await page.getByRole("button", { name: "Customize", exact: true }).click();
    await expect(page.locator(".invoice-options")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath("invoice-options.png") });
  });
