import { expect, test } from "@playwright/test";

test("validates and launches a negotiation session", async ({ page }) => {
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postDataJSON() as {
      customer: { phoneE164: string };
      suppliers: Array<{ phoneE164: string }>;
    };
    expect(body).toEqual({
      useCase: "freight_brokerage",
      customer: { phoneE164: "+41791234567" },
      suppliers: [{ phoneE164: "+41792345678" }, { phoneE164: "+41793456789" }],
    });
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ sessionId: "session-demo" }),
    });
  });

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /one customer/i }),
  ).toBeVisible();
  await expect(page.locator(".mascot-stage canvas")).toBeVisible();

  await page.getByLabel("Customer phone").fill("");
  await page.getByLabel("Supplier 1 phone").fill("");

  await page.getByRole("button", { name: "Start negotiation" }).click();
  await expect(
    page.getByText(/enter a valid E\.164 number/i).first(),
  ).toBeVisible();

  await page.getByLabel("Customer phone").fill("+41791234567");
  await page.getByLabel("Supplier 1 phone").fill("+41792345678");
  await page.getByRole("button", { name: "Add supplier" }).click();
  await page.getByLabel("Supplier 2 phone").fill("+41793456789");
  await page.getByRole("button", { name: "Add supplier" }).click();
  await expect(page.getByLabel("Supplier 3 phone")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add supplier" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Remove supplier 3" }).click();

  await page.getByRole("button", { name: "Start negotiation" }).click();
  await expect(page).toHaveURL(/\?session=session-demo$/);
  await expect(
    page.getByRole("region", { name: "Live negotiation map" }),
  ).toBeVisible();
  await expect(page.getByTestId("live-current-event")).toHaveText(
    "Connecting to the live session",
  );
  await expect(page.getByText("Verified event stream")).toHaveCount(0);
});
