import { test, expect, type Page } from "@playwright/test"

/**
 * The popup signing flow on /dev/forms (dev only): real pdf.js rendering, the pdf.js worker under
 * Turbopack, and the server applying the signature at the generator's coordinates.
 */

const tag = (page: Page) => page.getByTestId("signature-tag")

async function openAgreementPopup(page: Page) {
  await page.goto("/dev/forms")
  await page.waitForLoadState("networkidle")
  await page.getByRole("button", { name: "Review and sign" }).click()
  await expect(page.getByTestId("signing-dialog")).toBeVisible()
  await expect(tag(page).first()).toBeVisible()
}

test("agreement: consent, adopt, sign on the page, finish", async ({ page }) => {
  await openAgreementPopup(page)
  await expect(page.getByTestId("signing-progress")).toContainText("Required: 0 of 1 completed")
  await expect(page.getByTestId("signing-finish")).toBeDisabled()

  await page.getByTestId("signing-consent").check()
  await page.getByTestId("signing-next").click()
  const signature = tag(page).filter({ hasText: "Sign here" })
  await expect(signature).toBeFocused()

  await signature.click()
  await expect(page.getByRole("heading", { name: "Adopt your signature" })).toBeVisible()
  await page.getByTestId("adopt-submit").click()
  await expect(tag(page).filter({ hasText: "Maria L. Santos-Rivera" })).toBeVisible()
  await expect(page.getByTestId("signing-progress")).toContainText("Required: 1 of 1 completed")

  await page.getByTestId("signing-finish").click()
  await expect(page.getByTestId("signed-result")).toBeVisible()
  await expect(page.getByTestId("signed-sha256")).toBeVisible()
})

test("declining asks first and leaves nothing signed", async ({ page }) => {
  await openAgreementPopup(page)
  await page.keyboard.press("Escape")
  await expect(page.getByTestId("exit-dialog")).toBeVisible()
  await page.getByTestId("exit-confirm").click()
  await expect(page.getByTestId("signing-dialog")).toBeHidden()
  await expect(page.getByTestId("signed-result")).toHaveCount(0)
})
