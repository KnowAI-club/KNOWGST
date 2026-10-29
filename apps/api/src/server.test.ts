import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Store } from "./store.js";
import { createApi } from "./server.js";
const secret = "test-local-service-key-with-32-characters";
const folders: string[] = [];
afterEach(() =>
  folders.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })),
);
describe("local invoice workflow", () => {
  it("persists issue and partial payment, rejects stale writes, and survives restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "knowgst-"));
    folders.push(dir);
    const path = join(dir, "test.sqlite");
    let store = new Store(path);
    const api = createApi(store, secret);
    const post = (url: string, payload: unknown, key: string) =>
      api.inject({
        method: "POST",
        url,
        payload: payload as object,
        headers: { "x-knowgst-key": secret, "idempotency-key": key },
      });
    expect((await api.inject("/api/v1/workspace")).statusCode).toBe(401);
    expect(
      (
        await post(
          "/api/v1/business",
          { name: "Example business", address: "Pune" },
          "setup-0001",
        )
      ).statusCode,
    ).toBe(200);
    const draft = (
      await post(
        "/api/v1/invoices",
        {
          customer: "Example client",
          customerAddress: "Pune",
          date: "2026-10-29",
          supply: "intra",
          lines: [
            {
              description: "Services",
              quantity: "1",
              unitPrice: "100",
              gstRate: "18",
            },
          ],
        },
        "draft-0001",
      )
    ).json();
    const url = `/api/v1/invoices/${draft.id}`;
    const issued = (
      await post(`${url}/issue`, { version: 1 }, "issue-0001")
    ).json();
    expect(issued.number).toBe("KG-000001");
    expect(
      (await post(`${url}/issue`, { version: 1 }, "issue-0001")).json(),
    ).toEqual(issued);
    expect(
      (await post(`${url}/issue`, { version: 1 }, "issue-0002")).statusCode,
    ).toBe(409);
    const paid = await post(
      `${url}/payments`,
      { version: 2, amount: "50.00", date: "2026-10-29", reference: "REF-01" },
      "payment-0001",
    );
    expect(paid.json().paid).toBe("5000");
    expect(
      (
        await post(
          `${url}/payments`,
          {
            version: 2,
            amount: "50.00",
            date: "2026-10-29",
            reference: "REF-01",
          },
          "payment-0001",
        )
      ).json().paid,
    ).toBe("5000");
    expect(
      (
        await post(
          `${url}/payments`,
          { version: 3, amount: "100.00", date: "2026-10-29", reference: "" },
          "payment-0002",
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await post(
          `${url}/payments`,
          { version: 2, amount: "1", date: "2026-10-29", reference: "" },
          "payment-0003",
        )
      ).statusCode,
    ).toBe(409);
    await api.close();
    store.close();
    store = new Store(path);
    expect(store.snapshot().invoices[0]?.paid).toBe("5000");
    expect(store.snapshot().invoices[0]?.number).toBe("KG-000001");
    expect(store.db.prepare("SELECT count(*) AS n FROM audit").get()?.n).toBe(
      4,
    );
    store.close();
  });
  it("rolls back effects on failed commands and detects changed retries", () => {
    const store = new Store(":memory:");
    expect(() =>
      store.command("failed-0001", "setup", {}, () => {
        store.setup({ name: "Example", address: "Pune" });
        throw new Error("failure");
      }),
    ).toThrow();
    expect(store.business()).toBeNull();
    store.command("success-0001", "setup", {}, () =>
      store.setup({ name: "Example", address: "Pune" }),
    );
    expect(() =>
      store.command("success-0001", "setup", { changed: true }, () => null),
    ).toThrow("different data");
    store.close();
  });
});
