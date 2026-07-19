import { expect, test } from "@playwright/test";

test("renders and advances the Pacta negotiation room", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Pacta", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".mascot-stage canvas")).toBeVisible();
  await expect(page.locator(".participant")).toHaveCount(4);
  await expect(page.getByText("Customer chat is ready")).toBeVisible();
  await expect(
    page.getByText("Customer joined via ElevenLabs chat"),
  ).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "Pause demo" }).click();
  await expect(page.getByRole("button", { name: "Resume demo" })).toBeVisible();
});
