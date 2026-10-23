import { test, expect } from "@playwright/test"

test("home redirects to persona picker", async ({ page }) => {
  await page.goto("/")
  await expect(page).toHaveURL(/\/pick/)
  await expect(
    page.getByRole("heading", { name: /who.s working today/i })
  ).toBeVisible()
})
