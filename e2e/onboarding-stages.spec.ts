import { test, expect } from "@playwright/test"

/**
 * The client Onboarding tab is a short stage stepper, not the task list: a headline, the
 * template's stages, and no internal task wording.
 */
test("an onboarding person's tab shows a headline and stages without task jargon", async ({ page }) => {
  await page.goto("/pick")
  await page.getByRole("button", { name: /Alex Harper/ }).click()
  await page.waitForURL(/\/client/)
  await page.getByRole("navigation").getByRole("link", { name: /^People/ }).click()
  await page.waitForURL(/\/client\/people$/)

  const row = page.getByTestId("person-row").filter({ has: page.locator('[data-status="onboarding"]') }).first()
  await expect(row).toBeVisible()
  await row.getByRole("link").first().click()

  const tab = page.getByTestId("onboarding-stages")
  await expect(tab).toBeVisible()
  await expect(page.getByTestId("stage-headline")).toContainText(/Waiting on|All set|In progress/)
  expect(await tab.getByRole("list", { name: "Onboarding progress" }).getByRole("listitem").count()).toBeGreaterThanOrEqual(6)
  await expect(tab.locator('[data-testid^="stage-"][data-status="current"]').first()).toBeVisible()

  const text = (await tab.textContent()) ?? ""
  expect(text).not.toMatch(/I-9|Section [12]|accept_invitation|invite_worker|generate_agreement|go_live|\bEOR\b/)
  await expect(page.getByTestId("item-invite_worker")).toHaveCount(0)
})
