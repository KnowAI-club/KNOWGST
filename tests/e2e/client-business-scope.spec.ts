import { test, expect } from "@playwright/test";

test("legacy clients need explicit business assignment before invoice and AI selection", async ({
  page,
  request,
}) => {
  const profile = {
    id: "client-scope-browser",
    businessName: "Client Scope Demo",
    country: "India",
    state: "Maharashtra",
  };
  const legacy = {
    id: "legacy-client-browser",
    name: "Legacy Client Demo",
    city: "Pune",
    state: "Maharashtra",
    country: "India",
  };
  expect((await request.post("/api/profile", { data: profile })).ok()).toBe(
    true,
  );
  expect(
    (await request.post("/api/import", { data: { clients: [legacy] } })).ok(),
  ).toBe(true);
  await request.post("/api/local-prefs", {
    data: {
      set: {
        gst_printSettings: JSON.stringify({ onboardingComplete: true }),
        freegstbill_onboarded: "true",
      },
    },
  });
  expect(
    (await (await request.get("/api/clients")).json()).some(
      (client: any) => client.id === legacy.id,
    ),
  ).toBe(false);
  await page.goto("/?view=clients");
  const legacySection = page
    .locator("details")
    .filter({ has: page.getByText(/Clients needing a business/) });
  await legacySection.locator("summary").click();
  await expect(
    legacySection.getByText(legacy.name, { exact: true }),
  ).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  const row = legacySection
    .locator("div")
    .filter({ has: page.locator("strong", { hasText: legacy.name }) })
    .filter({
      has: page.getByRole("button", {
        name: "Assign to this business",
        exact: true,
      }),
    })
    .last();
  await row
    .getByRole("button", { name: "Assign to this business", exact: true })
    .click();
  await expect(
    page.getByText("Client assigned to this business", { exact: true }),
  ).toBeVisible();
  const owned = (await (await request.get("/api/clients")).json()).find(
    (client: any) => client.id === legacy.id,
  );
  expect(owned).toMatchObject({ ...legacy, businessId: profile.id });
  expect(typeof owned._revision).toBe("string");
  expect(
    (await (await request.get("/api/clients?unassigned=1")).json()).some(
      (client: any) => client.id === legacy.id,
    ),
  ).toBe(false);
  await request.post("/api/profile", {
    data: {
      ...profile,
      id: "client-scope-browser-other",
      businessName: "Other Scope Demo",
    },
  });
  await page.reload();
  await expect(page.getByText(legacy.name, { exact: true })).toHaveCount(0);
  expect(
    (
      await request.post("/api/clients", {
        data: { ...owned, name: "Illegal overwrite" },
      })
    ).status(),
  ).toBe(409);
});
