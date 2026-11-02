import { test, expect } from "@playwright/test";

test("review workspaces fit compact light/dark windows and support keyboard navigation", async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  await request.post("/api/profile", {
    data: {
      id: "workflow-layout",
      businessName: "Layout demo",
      country: "India",
      state: "Maharashtra",
    },
  });
  await request.post("/api/local-prefs", {
    data: {
      set: {
        freegstbill_onboarded: "true",
        gst_printSettings: JSON.stringify({ onboardingComplete: true }),
      },
    },
  });
  await page.route("**/api/integrations/chatgpt/models", (route) =>
    route.fulfill({ json: [{ id: "test", name: "Test model" }] }),
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const theme of ["light", "dark"]) {
    await request.post("/api/local-prefs", {
      data: { set: { freegstbill_theme: theme } },
    });
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto("/?view=ai");
      const tabs = page.getByRole("tablist", { name: "Assistant workspace" });
      for (const name of [
        "Chat",
        "Document inbox",
        "Books & payments",
        "Bank matching",
        "Catalog review",
        "Import assistant",
      ]) {
        await tabs.getByRole("tab", { name, exact: true }).click();
        await expect(page.locator("#ai-workspace-panel")).toBeVisible();
        await expect(
          page.getByText("Loading workspace…", { exact: true }),
        ).toHaveCount(0);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          `${theme} ${width} ${name}`,
        ).toBe(true);
      }
      const selected = tabs.getByRole("tab", {
        name: "Import assistant",
        exact: true,
      });
      await selected.focus();
      await page.keyboard.press("Home");
      await expect(
        tabs.getByRole("tab", { name: "Chat", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("ArrowRight");
      await expect(
        tabs.getByRole("tab", { name: "Document inbox", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
    }
  }
  expect(errors).toEqual([]);
});
