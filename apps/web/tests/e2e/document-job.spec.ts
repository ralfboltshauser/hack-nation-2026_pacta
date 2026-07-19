import { expect, test } from "@playwright/test";

test("creates a document-first session without a customer phone", async ({
  page,
}) => {
  await page.route("**/api/doc-jobs", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    expect(route.request().postDataJSON()).toEqual({
      useCase: "freight_brokerage",
      customer: { displayName: "Acme Logistics" },
      suppliers: [{ phoneE164: "+41792345678" }],
    });
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        sessionId: "document-session",
        customerCallStarted: false,
      }),
    });
  });
  await page.route("https://**", (route) => route.abort());

  await page.goto("/doc-job");
  await expect(
    page.getByRole("heading", { name: /turn a document/i }),
  ).toBeVisible();
  await expect(page.getByText("No customer call")).toBeVisible();

  await page.getByRole("button", { name: /create job from document/i }).click();
  await expect(
    page.getByText(/choose a pdf or image containing the job details/i),
  ).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    name: "shipment.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("Pickup: Zurich; destination: Basel"),
  });
  await page.getByLabel("Customer name").fill("Acme Logistics");
  await page.getByLabel("Supplier 1 phone").fill("+41792345678");
  await page.getByRole("button", { name: /create job from document/i }).click();

  await expect(page).toHaveURL(/\/doc-job\?session=document-session$/);
  await expect(
    page.getByRole("heading", { name: /let’s define the job/i }),
  ).toBeVisible();
  await expect(page.getByText("shipment.pdf")).toBeVisible();
});
