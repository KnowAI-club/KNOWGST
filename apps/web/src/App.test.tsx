import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "./App";
afterEach(() => vi.unstubAllGlobals());
it("shows the persisted workspace and previews a new invoice", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          business: { name: "Example business", address: "Pune" },
          invoices: [],
        }),
      }),
  );
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", {
    name: "Your first invoice starts here",
  });
  await user.click(screen.getByRole("button", { name: "New invoice" }));
  await user.type(screen.getByLabelText("Customer name"), "Example client");
  await user.type(screen.getByLabelText("Customer address"), "Mumbai");
  await user.type(screen.getByLabelText("Description 1"), "Consulting");
  await user.clear(screen.getByLabelText("Unit price 1"));
  await user.type(screen.getByLabelText("Unit price 1"), "100");
  expect(screen.getByText("₹118.00")).toBeVisible();
  expect(screen.getByText("CGST")).toBeVisible();
  await user.selectOptions(screen.getByLabelText("Supply type"), "inter");
  expect(screen.getByText("IGST")).toBeVisible();
  expect(screen.queryByText("CGST")).toBeNull();
});
