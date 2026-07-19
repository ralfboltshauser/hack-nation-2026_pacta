import { expect, test } from "@playwright/test";

const launchedSessionId = "00000000-0000-4000-8000-000000000001";
const legacySessionId = "00000000-0000-4000-8000-000000000003";

test("presents the Pacta story and opens the negotiation room", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /one request in/i }),
  ).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.getByText(/pacta opens the market/i)).toBeAttached();
  await expect(page.getByText(/only after it checks out/i)).toBeAttached();
  await expect(
    page.getByRole("heading", { name: /you choose.*supplier commits/i }),
  ).toBeAttached();

  await page.mouse.move(320, 280);
  await expect(page.getByTestId("cursor-signal")).toHaveCSS("opacity", "1");

  const marketRequest = page.getByTestId("market-request");
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo(0, document.getElementById("market")?.offsetTop ?? 0);
  });
  await expect(
    page.getByRole("img", { name: /confirmed request branching/i }),
  ).toBeVisible();
  const requestStartTransform = await marketRequest.evaluate(
    (element) => getComputedStyle(element).transform,
  );
  await page.evaluate(() => {
    window.scrollTo(
      0,
      (document.getElementById("market")?.offsetTop ?? 0) + 1_000,
    );
  });
  await expect
    .poll(() =>
      marketRequest.evaluate((element) => getComputedStyle(element).transform),
    )
    .not.toBe(requestStartTransform);

  await page.getByRole("link", { name: "Start a negotiation" }).first().click();
  await expect(page).toHaveURL(/\/negotiate$/);
  await expect(
    page.getByRole("heading", { name: /one customer/i }),
  ).toBeVisible();
});

test("redirects legacy session links to the negotiation room", async ({
  page,
}) => {
  await page.goto(`/?session=${legacySessionId}`);
  await expect(page).toHaveURL(
    new RegExp(`/negotiate\\?session=${legacySessionId}$`),
  );
  await expect(
    page.getByRole("region", { name: "Live negotiation map" }),
  ).toBeVisible();
});

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
      body: JSON.stringify({ sessionId: launchedSessionId }),
    });
  });

  await page.goto("/negotiate");
  await expect(
    page.getByRole("heading", { name: /one customer/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /start from a document/i }),
  ).toHaveAttribute("href", "/doc-job");
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
  await expect(page).toHaveURL(
    new RegExp(`/negotiate\\?session=${launchedSessionId}$`),
  );
  await expect(
    page.getByRole("region", { name: "Live negotiation map" }),
  ).toBeVisible();
  await expect(page.getByTestId("live-current-event")).toHaveText(
    "Connecting to the live session",
  );
  await expect(page.getByText("Verified event stream")).toHaveCount(0);

  const liveMascot = page.locator(".pacta-3d-stage");
  await expect(liveMascot).toHaveAttribute("data-ready", "true", {
    timeout: 15_000,
  });
  await expect(liveMascot.locator("img")).toHaveCSS("opacity", "0");
});
