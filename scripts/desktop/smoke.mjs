import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const root = path.resolve(import.meta.dirname, "../..");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "knowgst-install-"));
const output = path.join(root, "release/smoke");
fs.mkdirSync(output, { recursive: true });
let executable = process.env.KNOWGST_TEST_EXECUTABLE;
const installer = process.env.KNOWGST_TEST_INSTALLER;
if (installer && process.platform === "darwin") {
  const mount = path.join(work, "volume");
  fs.mkdirSync(mount);
  execFileSync("hdiutil", [
    "attach",
    installer,
    "-mountpoint",
    mount,
    "-nobrowse",
    "-quiet",
  ]);
  try {
    execFileSync("ditto", [
      path.join(mount, "KNOWGST.app"),
      path.join(work, "KNOWGST.app"),
    ]);
  } finally {
    execFileSync("hdiutil", ["detach", mount, "-quiet"]);
  }
  executable = path.join(work, "KNOWGST.app/Contents/MacOS/KNOWGST");
} else if (installer && process.platform === "win32") {
  const install = path.join(work, "installed");
  execFileSync(installer, ["/S", `/D=${install}`], { timeout: 120000 });
  executable = path.join(install, "KNOWGST.exe");
}
if (!executable)
  throw Error("Set KNOWGST_TEST_INSTALLER or KNOWGST_TEST_EXECUTABLE");
let app;
const errors = [];
const launch = async () => {
  app = await electron.launch({
    executablePath: executable,
    env: {
      ...process.env,
      KNOWGST_DESKTOP_TEST: "1",
      KNOWGST_DESKTOP_DATA: path.join(work, "data"),
    },
    timeout: 60000,
  });
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 30000 });
  await page.waitForLoadState("domcontentloaded");
  return page;
};
const api = (page, url, data) =>
  page.evaluate(
    async ({ url, data }) => {
      const response = await fetch(
        url,
        data === undefined
          ? {}
          : {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(data),
            },
      );
      if (!response.ok) throw Error(`${url}: ${response.status}`);
      return response.json();
    },
    { url, data },
  );
try {
  let page = await launch();
  const origin = new URL(page.url()).origin;
  const health = await api(page, "/api/health");
  expect(health.sqliteVersion).toBe("3.54.1");
  expect(health.version).toBe(JSON.parse(fs.readFileSync(path.join(root, 'apps/desktop/package.json'), 'utf8')).version);
  expect((await fetch(origin + "/api/profile")).status).toBe(403);
  const prefs = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
  );
  expect(prefs.nodeIntegration).toBe(false);
  expect(prefs.contextIsolation).toBe(true);
  expect(prefs.sandbox).toBe(true);
  await api(page, "/api/local-prefs", {
    set: {
      gst_printSettings: JSON.stringify({ onboardingComplete: true }),
      freegstbill_onboarded: "true",
    },
  });
  const profile = {
    id: "installer-demo",
    businessName: "Installer Test (Demo)",
    country: "India",
    state: "Maharashtra",
    address: "Sample Road",
  };
  await api(page, "/api/profile", profile);
  const invoice = {
    id: "TEST/26/001",
    invoiceNumber: "TEST/26/001",
    invoiceDate: "2026-11-01",
    clientName: "Demo Buyer",
    invoiceType: "tax-invoice",
    totalAmount: 118,
    totalTaxAmount: 18,
    status: "unpaid",
    data: {
      profile,
      client: { name: "Demo Buyer", state: "Maharashtra" },
      details: { invoiceNumber: "TEST/26/001", invoiceDate: "2026-11-01" },
      invoiceType: "tax-invoice",
      items: [
        {
          name: "Sample supplies",
          hsn: "820559",
          quantity: 1,
          unit: "Nos",
          rate: 100,
          taxPercent: 18,
        },
      ],
      totals: {
        subtotal: 100,
        taxableAmount: 100,
        cgst: 9,
        sgst: 9,
        igst: 0,
        totalTaxAmount: 18,
        total: 118,
      },
      invoiceOptions: { currency: "INR", paperSize: "a4", pdfStyle: "modern" },
    },
  };
  await api(page, "/api/bills", invoice);
  await page.goto(origin + "/?view=invoices");
  await expect(
    page.getByRole("button", { name: "View TEST/26/001", exact: true }),
  ).toBeVisible();
  expect((await page.getByPlaceholder('Search client or invoice...').boundingBox()).width).toBeGreaterThanOrEqual(200);
  const pdfPath = path.join(output, "installed-invoice.pdf");
  fs.rmSync(pdfPath, { force: true });
  await app.evaluate(({ BrowserWindow }, pdfPath) => {
    BrowserWindow.getAllWindows()[0].webContents.session.once(
      "will-download",
      (_e, item) => item.setSavePath(pdfPath),
    );
  }, pdfPath);
  await page
    .getByRole("button", { name: "All shown (1)", exact: true })
    .click();
  await expect
    .poll(() => fs.existsSync(pdfPath) && fs.statSync(pdfPath).size > 1000, {
      timeout: 30000,
    })
    .toBe(true);
  const require = createRequire(path.join(root, "apps/parity/package.json"));
  const { PDFDocument } = require("pdf-lib");
  await expect
    .poll(
      async () => {
        try {
          return (
            await PDFDocument.load(fs.readFileSync(pdfPath))
          ).getPageCount();
        } catch {
          return 0;
        }
      },
      { timeout: 10000 },
    )
    .toBe(1);
  const bytes = fs.readFileSync(pdfPath);
  await page.evaluate(async (base64) => {
    const response = await fetch(
      "/api/save-pdf?client=Demo&month=November2026&name=installer.pdf",
      {
        method: "POST",
        headers: { "Content-Type": "application/pdf" },
        body: Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
      },
    );
    if (!response.ok) throw Error("PDF archive failed");
  }, bytes.toString("base64"));
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/mWQAAAAASUVORK5CYII=';
  const inbox = await api(page, '/api/integrations/ai/documents/add', {businessId:profile.id, revision:0, name:'Installer demo.png', image});
  expect(inbox.documents).toHaveLength(1);
  await api(page, "/api/backups/now", {});
  const backups = await api(page, "/api/backups");
  expect(backups.length).toBeGreaterThan(0);
  await api(page, '/api/integrations/ai/documents/remove', {businessId:profile.id, revision:inbox.revision, documentId:inbox.documents[0].id, confirm:true});
  await api(page, "/api/profile", {
    ...profile,
    businessName: "Changed after backup",
  });
  await api(page, `/api/backups/${backups[0].date}/restore`, {});
  expect((await api(page, "/api/profile")).businessName).toBe(
    profile.businessName,
  );
  const restoredDocument = await api(page, '/api/integrations/ai/documents/get', {businessId:profile.id,documentId:inbox.documents[0].id});
  expect(restoredDocument.document.image).toBe(image);
  const archived = path.join(
    work,
    "data/workspace/Saved Invoices/Demo/November2026/installer.pdf",
  );
  expect(fs.readFileSync(archived).equals(bytes)).toBe(true);
  const stamp = await api(page, '/api/saved-pdf/cancel-mark', {fileName:'installer.pdf',clientName:'Demo',cancelled:true});
  expect(stamp).toEqual({updated:1,failed:0});
  expect(fs.readFileSync(archived).equals(bytes)).toBe(false);
  expect((await PDFDocument.load(fs.readFileSync(archived))).getPageCount()).toBe(1);
  const unstamp = await api(page, '/api/saved-pdf/cancel-mark', {fileName:'installer.pdf',clientName:'Demo',cancelled:false});
  expect(unstamp).toEqual({updated:1,failed:0});
  expect(fs.readFileSync(archived).equals(bytes)).toBe(true);
  const popupEvent = page.waitForEvent("popup");
  await page.evaluate(() => {
    const report = window.open("", "_blank");
    if (!report) throw Error("Report window blocked");
    report.document.write("<h1>KNOWGST report preview</h1>");
    report.document.close();
  });
  const popup = await popupEvent;
  await expect(popup.locator("h1")).toHaveText("KNOWGST report preview");
  expect(await popup.evaluate(() => typeof window.require)).toBe("undefined");
  await popup.close();
  await page.evaluate(() => { for (const element of document.querySelectorAll('*')) if (element instanceof HTMLElement && element.scrollTop) element.scrollTop = 0; });
  await page.screenshot({ path: path.join(output, "installed-app.png") });
  await app.close();
  app = null;
  page = await launch();
  const saved = await api(page, "/api/bills");
  expect(
    saved.some(
      (b) => b.invoiceNumber === "TEST/26/001" && b.totalAmount === 118,
    ),
  ).toBe(true);
  const external = [];
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
    external.push(route.request().url());
    return route.abort();
  });
  await page.goto(new URL(page.url()).origin + "/?view=purchases");
  await page.getByRole('button',{name:'Import from image (OCR)',exact:true}).click();
  await expect(page.getByLabel('Send this image to ChatGPT for extraction')).toBeVisible();
  await expect(page.getByLabel('OCR method')).toHaveCount(0);
  expect(external).toEqual([]);
  await page.goto(new URL(page.url()).origin + "/docs/");
  await expect(page.locator("body")).toContainText("KNOWGST");
  expect(errors).toEqual([]);
  fs.writeFileSync(
    path.join(output, "result.json"),
    JSON.stringify(
      {
        platform: process.platform,
        arch: process.arch,
        sourceCommit: process.env.GITHUB_SHA || null,
        version: JSON.parse(fs.readFileSync(path.resolve('apps/desktop/package.json'), 'utf8')).version,
        installer: installer ? path.basename(installer) : null,
        checks: [
          "installed launch",
          "SQLite 3.54.1",
          "unauthenticated gateway denied",
          "sandboxed renderer",
          "usable invoice search in the installed window",
          "invoice PDF",
          "server-side PDF cancellation and byte-exact undo",
          "backup and restore including PDF bytes",
          "document original and AI review state restoration",
          "restart persistence",
          "bundled guide",
          "sandboxed report window",
          "ChatGPT extraction consent UI (no live inference)",
        ],
        passed: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "Installed desktop smoke passed:",
    process.platform,
    process.arch,
  );
} finally {
  if (app) await app.close();
}
