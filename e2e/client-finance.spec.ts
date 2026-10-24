import { test, expect, type Locator, type Page } from "@playwright/test"

/**
 * The client finance components on /dev/finance (dev only): populated from the real billing
 * domain, so selection totals, the pay dialog and the invoice drawer can be exercised before the
 * invoice tables exist. The live /client/finance page renders the same components.
 */

const cents = (text: string | null) => Math.round(Number((text ?? "").replace(/[^0-9.]/g, "")) * 100)

async function open(page: Page) {
  await page.goto("/dev/finance")
  await page.waitForLoadState("networkidle")
  return page.getByTestId("dev-populated")
}

const payableRows = (section: Locator) =>
  section.locator('[data-testid=invoice-row][data-status=open], [data-testid=invoice-row][data-status=overdue]')

test("selecting invoices totals them on the Pay selected button and in the pay dialog", async ({ page }) => {
  const section = await open(page)
  await expect(section.getByTestId("pay-selected")).toBeDisabled()

  const rows = payableRows(section)
  const payableBefore = await rows.count()
  const first = rows.nth(0)
  const second = rows.nth(1)
  const expected =
    cents(await first.locator("[data-slot=money]").textContent()) + cents(await second.locator("[data-slot=money]").textContent())
  await first.getByTestId("invoice-select").click()
  await second.getByTestId("invoice-select").click()

  const button = section.getByTestId("pay-selected")
  await expect(button).toBeEnabled()
  expect(cents((await button.textContent())!.split("·")[1])).toBe(expected)
  await expect(button).toContainText("Pay selected (2)")

  await button.click()
  const dialog = page.getByTestId("pay-dialog")
  await expect(dialog).toBeVisible()
  await expect(page.getByTestId("pay-invoices").getByRole("listitem")).toHaveCount(2)
  expect(cents(await page.getByTestId("pay-total").textContent())).toBe(expected)
  await expect(page.getByTestId("pay-method")).toHaveText("ACH ••1234 — Northwind demo bank")
  await expect(dialog).toContainText("initiated now")

  await page.getByTestId("pay-confirm").click()
  await expect(page.getByTestId("pay-success")).toContainText("2 invoices")
  await page.getByTestId("pay-done").click()

  await expect(section.getByTestId("pay-selected")).toBeDisabled()
  await expect(section.locator("[data-testid=invoice-row][data-status=processing]")).toHaveCount(0)
  await expect(payableRows(section)).toHaveCount(payableBefore - 2)
  await section.getByTestId("tab-payments").click()
  await expect(section.getByTestId("payment-row").first()).toContainText("Processing")
})

test("Pay all due covers every payable invoice and matches the Due now tile", async ({ page }) => {
  const section = await open(page)
  const dueNow = cents(await section.getByTestId("tile-due-now-value").textContent())
  await section.getByTestId("pay-all-due").click()
  await expect(page.getByTestId("pay-dialog")).toBeVisible()
  expect(cents(await page.getByTestId("pay-total").textContent())).toBe(dueNow)
  const listed = await page.getByTestId("pay-invoices").locator("li [data-slot=money]").allTextContents()
  expect(listed.reduce((total, text) => total + cents(text), 0)).toBe(dueNow)
})

test("a refused payment shows the error and leaves the invoices unchanged", async ({ page }) => {
  const section = await open(page)
  await section.getByTestId("dev-outcome").click()
  await page.getByRole("option", { name: "Fails: not available" }).click()
  const before = await payableRows(section).count()
  await section.getByTestId("tab-payments").click()
  const processingBefore = await section.getByTestId("payment-row").filter({ hasText: "Processing" }).count()
  await section.getByTestId("tab-invoices").click()
  await section.getByTestId("pay-all-due").click()
  await page.getByTestId("pay-confirm").click()
  await expect(page.getByTestId("pay-error")).toContainText("not available")
  await page.keyboard.press("Escape")
  await expect(payableRows(section)).toHaveCount(before)
  await section.getByTestId("tab-payments").click()
  await expect(section.getByTestId("payment-row").filter({ hasText: "Processing" })).toHaveCount(processingBefore)
})

test("without a payment method every Pay control is disabled", async ({ page }) => {
  const section = await open(page)
  await section.getByTestId("dev-method").click()
  await page.getByRole("option", { name: "No payment method" }).click()
  await expect(section.getByTestId("pay-all-due")).toBeDisabled()
  await expect(section.getByTestId("pay-selected")).toBeDisabled()
  await expect(payableRows(section).first().getByTestId("invoice-select")).toHaveAttribute("aria-disabled", "true")
  await expect(section.getByTestId("pay-bar-summary")).toContainText("payment method")
})

test("clicking a row opens the drawer with itemised lines, totals, history and the PDF link", async ({ page }) => {
  const section = await open(page)
  const row = payableRows(section).first()
  const number = (await row.getByTestId("invoice-open").textContent())!.trim()
  const amount = cents(await row.locator("[data-slot=money]").textContent())

  await row.getByTestId("invoice-open").click()
  const drawer = page.getByTestId("invoice-drawer")
  await expect(drawer).toBeVisible()
  await expect(page.getByTestId("drawer-number")).toHaveText(number)
  await expect(page.getByTestId("drawer-lines")).toBeVisible()
  expect(cents(await page.getByTestId("drawer-total").textContent())).toBe(amount)
  expect(cents(await page.getByTestId("drawer-due").textContent())).toBe(amount)
  await expect(page.getByTestId("drawer-period")).toBeVisible()
  await expect(drawer).not.toContainText("Terms")
  await expect(drawer).not.toContainText("start date")
  await expect(page.getByTestId("drawer-pdf")).toHaveAttribute("href", /\/client\/finance\/invoices\/.+\/pdf$/)
  await expect(page.getByTestId("drawer-actions").locator("> *").first()).toHaveText(/^Pay \$/)
  await expect(page.getByTestId("drawer-position")).toHaveText(/^1 of \d+$/)
  await expect(drawer).not.toContainText(/view full invoice/i)

  await page.getByRole("button", { name: "Next invoice" }).click()
  await expect(page.getByTestId("drawer-number")).toHaveText((await payableRows(section).nth(1).getByTestId("invoice-open").textContent())!.trim())

  await page.keyboard.press("Escape")
  await expect(drawer).toBeHidden()
})

test("the Invoices tab lists unpaid invoices only, with no period or pay date columns", async ({ page }) => {
  const section = await open(page)
  const statuses = await section.getByTestId("invoice-row").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-status")))
  expect(statuses.length).toBeGreaterThan(0)
  for (const status of statuses) expect(["open", "overdue"]).toContain(status)
  const headers = (await section.locator("[data-testid=invoice-table] th").allTextContents()).join("|")
  expect(headers).not.toMatch(/Service period|Pay date|Period/)
  await section.getByTestId("invoice-status-filter").click()
  await expect(page.getByRole("option")).toHaveText(["All unpaid", "Due", "Overdue"])
})

test("the status filter and search narrow the invoice list", async ({ page }) => {
  const section = await open(page)
  await section.getByTestId("invoice-status-filter").click()
  await page.getByRole("option", { name: "Overdue" }).click()
  const statuses = await section.getByTestId("invoice-row").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-status")))
  expect(statuses.length).toBeGreaterThan(0)
  expect(new Set(statuses)).toEqual(new Set(["overdue"]))

  await section.getByTestId("clear-invoice-filters").click()
  await section.getByTestId("invoice-search").fill("marcus")
  const people = await section.getByTestId("invoice-row").evaluateAll((rows) => rows.map((r) => r.textContent))
  expect(people.length).toBeGreaterThan(0)
  for (const text of people) expect(text).toContain("Marcus Reed")

  await section.getByTestId("invoice-search").fill("no such person")
  await expect(section.getByTestId("no-invoices")).toContainText("No unpaid invoices match these filters")
})

test("empty and loading states read as finished", async ({ page }) => {
  await open(page)
  const empty = page.getByTestId("dev-empty")
  await expect(empty.getByTestId("no-invoices-yet")).toContainText("Invoices are issued 7 days before each pay date")
  await expect(empty.getByTestId("tile-due-now")).toContainText("$0.00")
  await empty.getByTestId("tab-payments").click()
  await expect(empty.getByTestId("no-payments")).toBeVisible()
  await expect(page.getByTestId("dev-loading").getByTestId("finance-skeleton")).toBeVisible()
})

test("the person Payments tab lists invoices with totals", async ({ page }) => {
  await open(page)
  const person = page.getByTestId("dev-person")
  await expect(person.getByTestId("person-payments")).toHaveCount(2)
  await expect(person.getByTestId("person-no-invoices")).toHaveCount(1)
  await expect(person.getByTestId("person-paid-total").first()).toContainText("$")
})
