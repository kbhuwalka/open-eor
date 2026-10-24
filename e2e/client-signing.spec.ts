import { test, expect, type Page } from "@playwright/test"
import Database from "better-sqlite3"

/**
 * A client whose company has not signed the master EOR agreement: Create order stays disabled
 * until they sign it in the popup, the order then goes through createOrder, and the signed PDF
 * downloads from the person profile. Needs the database file of the server under test, because the
 * seeded companies have all signed already: it puts Acme Robotics' agreement back to draft.
 *
 *   E2E_DATABASE_FILE=/tmp/copy.sqlite DATABASE_FILE=/tmp/copy.sqlite pnpm start -p 3317
 *   PLAYWRIGHT_BASE_URL=http://localhost:3317 E2E_DATABASE_FILE=/tmp/copy.sqlite pnpm exec playwright test e2e/client-signing.spec.ts
 */
const databaseFile = process.env.E2E_DATABASE_FILE
test.skip(!databaseFile, "E2E_DATABASE_FILE (the server's database copy) is required to start from an unsigned agreement")
test.describe.configure({ mode: "serial" })

const COMPANY = "client_1"
const TASK_CASE = "case_jonas_reyes"

async function shot(page: Page, name: string, scrollTo?: string) {
  const dir = process.env.SHOT_DIR
  if (!dir) return
  if (scrollTo) await page.getByTestId(scrollTo).scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${dir}/${process.env.SHOT_PREFIX ?? "light"}-${name}.png` })
}

function resetAgreement() {
  const db = new Database(databaseFile!)
  try {
    db.pragma("busy_timeout = 5000")
    db.prepare("DELETE FROM company_document_signatures").run()
    db.prepare("DELETE FROM company_documents").run()
    db.prepare("UPDATE client_agreements SET status = 'draft', signed_at = NULL WHERE client_company_id = ?").run(COMPANY)
    db.prepare("UPDATE tasks SET status = 'ready', completed_at = NULL, completed_by_user_id = NULL WHERE case_id = ? AND type = 'accept_agreement'").run(TASK_CASE)
    db.prepare("UPDATE tasks SET status = 'blocked' WHERE case_id = ? AND type = 'review_order'").run(TASK_CASE)
  } finally {
    db.close()
  }
}

async function signIn(page: Page, persona: RegExp) {
  await page.goto("/pick")
  await page.getByRole("button", { name: persona }).click()
  await page.waitForURL(/\/client/)
}

async function pick(page: Page, trigger: string, option: string | RegExp) {
  await page.getByTestId(trigger).click()
  await page.getByRole("option", { name: option }).first().click()
}

async function fillDetails(page: Page, email: string) {
  await page.goto("/client/people/new")
  await page.getByTestId("first-name-input").fill("Casey")
  await page.getByTestId("last-name-input").fill("Signer")
  await page.getByTestId("email-input").fill(email)
  await pick(page, "state-trigger", "California")
  await pick(page, "role-trigger", /./)
  await page.getByTestId("start-date-input").click()
  await page.locator("[role=grid] button:not([disabled])").last().click()
  await page.getByTestId("wage-input").fill("150000")
  await page.getByTestId("review-quote").click()
  await expect(page.getByTestId("quote-step")).toBeVisible()
}

test.beforeAll(resetAgreement)
test.beforeEach(async ({ context, baseURL }) => {
  if (process.env.E2E_THEME) await context.addCookies([{ name: "eor_theme", value: process.env.E2E_THEME, url: baseURL! }])
})

test("new order: review, sign in the popup, create the order, see onboarding", async ({ page }) => {
  await signIn(page, /Alex Harper/)
  await fillDetails(page, `casey.signer.${Date.now()}@worker.example`)

  const card = page.getByTestId("agreement-card")
  await expect(card).toContainText("Northwind EOR agreement")
  await expect(page.getByRole("checkbox")).toHaveCount(0)
  await expect(page.getByTestId("submit-person")).toBeDisabled()
  const sign = card.getByRole("button", { name: "Review and sign" })
  await expect(sign).toBeEnabled()
  await shot(page, "1-review-unsigned", "submit-person")
  await sign.click()

  const dialog = page.getByTestId("signing-dialog")
  await expect(dialog).toBeVisible()
  const tags = page.getByTestId("signature-tag")
  await expect(tags.first()).toBeVisible()
  await expect(page.getByTestId("signing-progress")).toContainText("Required: 0 of 1 completed")
  await expect(page.getByTestId("signing-finish")).toBeDisabled()
  await shot(page, "2-dialog")

  await page.getByTestId("signing-consent").check()
  await page.getByTestId("signing-next").click()
  const signatureTag = tags.filter({ hasText: "Sign here" })
  await expect(signatureTag).toBeFocused()
  await signatureTag.click()
  await expect(page.getByRole("heading", { name: "Adopt your signature" })).toBeVisible()
  await page.getByTestId("adopt-submit").click()
  await expect(tags.filter({ hasText: "Alex Harper" })).toBeVisible()
  await expect(page.getByTestId("signing-progress")).toContainText("Required: 1 of 1 completed")
  await shot(page, "3-dialog-signed")
  await page.getByTestId("signing-finish").click()
  await expect(dialog).toBeHidden()

  await expect(page.getByTestId("agreement-signed")).toContainText(/Signed \d\d\/\d\d\/\d{4} by Alex Harper/)
  await expect(page.getByTestId("submit-person")).toBeEnabled()
  await shot(page, "4-review-signed", "submit-person")

  await page.getByTestId("submit-person").click()
  await page.waitForURL(/\/client\/people\/case_/)
  await expect(page.getByTestId("onboarding-stages")).toBeVisible()
  await expect(page.getByTestId("task-accept_agreement")).toHaveCount(0)
})

test("the signed agreement downloads from the person profile with its signature certificate", async ({ page, browser }) => {
  await signIn(page, /Alex Harper/)
  await page.goto("/client/people")
  await page.getByTestId("person-row").first().getByRole("link").first().click()
  await page.getByRole("tab", { name: "Details" }).click()

  const signed = page.getByTestId("signed-agreement")
  await expect(signed).toContainText("by Alex Harper")
  const link = signed.getByTestId("agreement-download")
  const href = await link.getAttribute("href")
  expect(href).toMatch(/^\/api\/company-documents\/cdoc_/)

  const download = page.waitForEvent("download")
  await link.click()
  const file = await download
  expect(file.suggestedFilename()).toBe("northwind-eor-master-services-agreement.pdf")

  const response = await page.request.get(href!)
  expect(response.status()).toBe(200)
  expect(response.headers()["content-type"]).toBe("application/pdf")
  const bytes = await response.body()
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-")

  const stranger = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  const other = await stranger.newPage()
  expect((await other.request.get(href!)).status()).toBe(401)
  await signIn(other, /Priya Raman/)
  expect((await other.request.get(href!)).status()).toBe(404)
  await stranger.close()
})

test("the accept_agreement task opens the same signing dialog and the engine completes it", async ({ page }) => {
  resetAgreement()
  await signIn(page, /Alex Harper/)
  await page.goto(`/client/people/${TASK_CASE}`)
  await page.getByRole("tab", { name: "Onboarding" }).click()

  const item = page.getByTestId("task-accept_agreement")
  await expect(item).toBeVisible()
  const sign = item.getByRole("button", { name: "Review and sign" })
  await expect(sign).toBeEnabled()
  await shot(page, "5-task-accept-agreement")
  await sign.click()

  const dialog = page.getByTestId("signing-dialog")
  await expect(dialog).toBeVisible()
  await page.getByTestId("signing-consent").check()
  await page.getByTestId("signing-next").click()
  await page.getByTestId("signature-tag").filter({ hasText: "Sign here" }).click()
  await page.getByTestId("adopt-submit").click()
  await page.getByTestId("signing-finish").click()
  await expect(dialog).toBeHidden()

  await expect(page.getByTestId("task-accept_agreement")).toHaveCount(0)
  await page.getByRole("tab", { name: "Details" }).click()
  await expect(page.getByTestId("signed-agreement")).toContainText("by Alex Harper")
  await shot(page, "6-task-signed-details")
})
