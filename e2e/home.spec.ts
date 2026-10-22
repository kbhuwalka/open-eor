import { test, expect } from "@playwright/test"

test("home page loads the starter UI", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "To get started"
  )
  await expect(page.getByRole("link", { name: "Deploy Now" })).toBeVisible()
})
