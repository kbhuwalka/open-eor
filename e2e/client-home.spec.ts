import type Database from "better-sqlite3"
import { test, expect, type Locator, type Page } from "@playwright/test"

import { openLiveDb, signInAs, writeLiveDb } from "./support/live"

/**
 * The client Home (`/client`, ui-guidelines C28) on the real pages against a seeded database copy:
 * the nav and the People list's address, the three glance cards (each figure checked against the
 * page it links to), "To do" with its grouped rows and in-place dialogs. Ids, counts and amounts
 * come from the database or from the pages' own figures, never from names. The specs that write
 * (sign, pay) run last and need the server's database outside the project directory:
 *
 *   DATABASE_FILE=/tmp/e2e-home.sqlite pnpm start -p 3219
 *   PLAYWRIGHT_BASE_URL=http://localhost:3219 DATABASE_FILE=/tmp/e2e-home.sqlite pnpm exec playwright test e2e/client-home.spec.ts
 *
 * SHOT_DIR=/tmp/home-shots saves a screenshot of each state.
 */
test.describe.configure({ mode: "serial" })

const CLIENT = "user_client_hr"
const COMPANY = "client_1"
const QUIET_CLIENT = "user_client_hr_2"
const AGREEMENT_CASE = "case_jonas_reyes"

/** The shell scrolls inside `main`, so a tall viewport stands in for a full-page capture. */
async function shot(page: Page, name: string, width = 1280) {
  const dir = process.env.SHOT_DIR
  if (!dir) return
  const viewport = page.viewportSize()
  await page.setViewportSize({ width, height: 1500 })
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${dir}/home-${name}.png` })
  if (viewport) await page.setViewportSize(viewport)
}

const readyCount = (db: Database.Database, userId: string) =>
  (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM tasks t JOIN onboarding_cases c ON c.id = t.case_id
          WHERE t.assignee_kind = 'user' AND t.assignee_user_id = ? AND t.status = 'ready' AND c.lifecycle = 'open'`,
      )
      .get(userId) as { n: number }
  ).n

const cents = (text: string | null) => Math.round(Number((text ?? "").replace(/[^0-9.]/g, "")) * 100)

const card = (page: Page, id: "onboarding" | "at-risk" | "invoices") => page.locator(`[data-testid=glance-card][data-card=${id}]`)
const figureOf = async (locator: Locator) => (await locator.getByTestId("glance-figure").textContent()) ?? ""

/** "1–10 of 36" on the People list, or the row count when it fits on one page. */
async function peopleTotal(page: Page): Promise<number> {
  await expect(page.getByTestId("people-filters")).toBeVisible()
  const range = page.getByTestId("page-range").filter({ visible: true })
  if ((await range.count()) > 0) return Number((await range.textContent())?.match(/of (\d+)/)?.[1])
  const empty = page.getByTestId("no-people").filter({ visible: true })
  if ((await empty.count()) > 0) return 0
  return page.getByTestId("person-row").filter({ visible: true }).count()
}

async function expandTodo(page: Page) {
  const viewAll = page.getByTestId("todo-view-all")
  if ((await viewAll.count()) > 0 && (await viewAll.getAttribute("aria-expanded")) === "false") await viewAll.click()
}

test("Home is the client's landing page; People lives at /client/people with its own button and no task panel", async ({ page }) => {
  const db = await openLiveDb(page)
  const own = readyCount(db, CLIENT)

  await page.goto("/pick")
  await page.getByRole("button", { name: /Alex Harper/ }).click()
  await page.waitForURL(/\/client$/)
  await expect(page.getByRole("heading", { level: 2 })).toHaveText("Home")
  await expect(page.getByTestId("start-hire")).toHaveAttribute("href", "/client/people/new")

  const nav = page.getByRole("navigation", { name: "Portal" })
  await expect(nav.getByRole("link")).toHaveText([/^Home/, /^People/, /^Finance/, /^Cost calculator/])
  const home = nav.getByRole("link", { name: /^Home/ })
  await expect(home).toHaveAttribute("aria-current", "page")
  if (own > 0) {
    await expect(home.getByLabel(`${own} pending`)).toBeVisible()
    await expect(page.getByTestId("todo-count")).toHaveText(`· ${own}`)
  }
  await expect(nav.getByRole("link", { name: /^People/ }).getByLabel(/pending/)).toHaveCount(0)

  await nav.getByRole("link", { name: /^People/ }).click()
  await page.waitForURL(/\/client\/people$/)
  await expect(page.getByRole("heading", { level: 2 })).toHaveText("People")
  await expect(nav.getByRole("link", { name: /^People/ })).toHaveAttribute("aria-current", "page")
  // The Home stays mounted but hidden after a client navigation (cacheComponents), so count visible ones.
  await expect(page.getByTestId("start-hire").filter({ visible: true })).toHaveCount(1)
  await expect(page.getByTestId("person-row").first()).toBeVisible()
  await expect(page.getByTestId("client-todo").filter({ visible: true })).toHaveCount(0)
  await expect(page.getByTestId("glance-cards").filter({ visible: true })).toHaveCount(0)
  await expect(page.getByTestId("task-action").filter({ visible: true })).toHaveCount(0)
  await shot(page, "people")

  await page.getByTestId("person-row").first().getByRole("link").first().click()
  await page.waitForURL(/\/client\/people\/case_/)
  await expect(nav.getByRole("link", { name: /^People/ })).toHaveAttribute("aria-current", "page")
})

test("the Onboarding card's figure is the People list under ?status=onboarding", async ({ page, baseURL }) => {
  await signInAs(page.context(), baseURL!, CLIENT)
  await page.goto("/client")
  const onboarding = card(page, "onboarding")
  const figure = Number(await figureOf(onboarding))
  expect(figure).toBeGreaterThan(0)
  await expect(onboarding.getByRole("link", { name: `${figure} Onboarding, view people` })).toBeVisible()
  await shot(page, "full")
  await shot(page, "tablet", 768)
  await shot(page, "mobile", 390)

  await onboarding.click()
  await page.waitForURL(/\/client\/people\?status=onboarding$/)
  expect(await peopleTotal(page)).toBe(figure)
})

test("the At risk card's figure is the People list under ?atRisk=1, whose chip removes the filter", async ({ page, baseURL }) => {
  await signInAs(page.context(), baseURL!, CLIENT)
  await page.goto("/client")
  const atRisk = card(page, "at-risk")
  const figure = Number(await figureOf(atRisk))
  expect(figure).toBeGreaterThan(0)
  await expect(atRisk).not.toContainText(/start dates? at risk/)

  await atRisk.getByRole("link", { name: `${figure} At risk, view people` }).click()
  await page.waitForURL(/\/client\/people\?atRisk=1$/)
  expect(await peopleTotal(page)).toBe(figure)
  const rows = page.getByTestId("person-row").filter({ visible: true })
  for (const row of await rows.all()) await expect(row.getByTestId("start-at-risk")).toBeVisible()
  await expect(page.getByTestId("filter-chip").filter({ visible: true })).toHaveText("At risk")

  await page.getByRole("button", { name: "Remove filter: At risk" }).click()
  await page.waitForURL(/\/client\/people$/)
  await expect(page.getByTestId("filter-chip").filter({ visible: true })).toHaveCount(0)
})

test("the Invoices card shows the money once and its View goes to Finance, where To do's deposits make up the rest", async ({ page, baseURL }) => {
  await signInAs(page.context(), baseURL!, CLIENT)
  await page.goto("/client")
  const invoices = card(page, "invoices")
  const total = cents(await figureOf(invoices))
  expect(total).toBeGreaterThan(0)
  await expect(invoices.getByTestId("glance-context")).toHaveText(/^\d+ invoices?( · (\$[\d,]+\.\d\d overdue|all overdue))?$/)
  await expect(invoices.getByTestId("glance-view")).toHaveText("View")
  await expect(invoices.getByRole("button")).toHaveCount(0)
  await expect(invoices.getByRole("link")).toHaveAttribute("href", "/client/finance")

  await expandTodo(page)
  const depositLabels = await page.locator("[data-testid=todo-row][data-task-type=pay_deposit]").getByTestId("task-action").allTextContents()
  const inTodo = depositLabels.reduce((sum, label) => sum + cents(label), 0)

  // View is drawn under the card's stretched link on purpose, so the click lands on that link.
  await invoices.getByTestId("glance-view").click({ force: true })
  await page.waitForURL(/\/client\/finance$/)
  await expect(page.getByTestId("tabpanel-invoices")).toBeVisible()
  expect(cents(await page.getByTestId("tile-due-now-value").textContent())).toBe(total + inTodo)
})

test("To do groups the deposits under one header that says why once, with one outline button per person", async ({ page, baseURL }) => {
  const db = await openLiveDb(page)
  const own = readyCount(db, CLIENT)
  expect(own).toBeGreaterThan(1)

  await signInAs(page.context(), baseURL!, CLIENT)
  await page.goto("/client")
  await expect(page.getByRole("heading", { level: 3, name: /^To do/ })).toBeVisible()
  await expect(page.getByTestId("todo-count")).toHaveText(`· ${own}`)
  const rows = page.getByTestId("todo-row")
  await expect(rows).toHaveCount(Math.min(own, 3))

  const group = page.locator("[data-testid=todo-group][data-task-type=pay_deposit]").first()
  await expect(group.getByTestId("todo-group-title")).toHaveText(/^Pay deposits · \d+$/)
  await expect(group).toContainText("Start dates can't be confirmed until these are paid.")
  await expect(group.getByText(/can't be confirmed/)).toHaveCount(1)
  const groupRows = group.getByTestId("todo-row")
  await expect(groupRows.first()).toContainText(/Starts|Was to start|No start date yet/)
  for (const button of await groupRows.getByTestId("task-action").all()) await expect(button).toHaveText(/^Pay \$[\d,]+\.\d\d$/)

  if (own > 3) {
    await page.getByTestId("todo-view-all").click()
    await expect(rows).toHaveCount(own)
    await page.getByTestId("todo-view-all").click()
    await expect(rows).toHaveCount(3)
  }
})

test("paying a deposit from the grouped To do: the row goes, the count drops, and the Invoices card does not take the deposit", async ({
  page,
  baseURL,
}) => {
  const db = await openLiveDb(page)
  const own = readyCount(db, CLIENT)

  await signInAs(page.context(), baseURL!, CLIENT)
  await page.goto("/client")
  const total = await figureOf(card(page, "invoices"))
  const groupTitle = page.locator("[data-testid=todo-group][data-task-type=pay_deposit]").first().getByTestId("todo-group-title")
  const groupCount = Number((await groupTitle.textContent())?.match(/· (\d+)$/)?.[1])

  const row = page.locator("[data-testid=todo-group] [data-testid=todo-row][data-task-type=pay_deposit]").first()
  await expect(row.getByTestId("task-action")).toHaveText(/^Pay \$[\d,]+\.\d\d$/)
  await row.getByTestId("task-action").click()
  const dialog = page.getByTestId("pay-deposit-dialog")
  await expect(dialog).toBeVisible()
  await expect(page).toHaveURL(/\/client$/)
  await dialog.getByTestId("confirm-pay-deposit").click()

  await expect(page.getByTestId("task-notice")).toBeVisible()
  await expect(page.getByTestId("todo-count")).toHaveText(`· ${own - 1}`)
  await expect(page.getByRole("navigation", { name: "Portal" }).getByRole("link", { name: /^Home/ }).getByLabel(`${own - 1} pending`)).toBeVisible()
  if (groupCount > 2) await expect(groupTitle).toHaveText(`Pay deposits · ${groupCount - 1}`)
  await expect(card(page, "invoices").getByTestId("glance-figure")).toHaveText(total)
  await shot(page, "after-deposit")
})

test("the client signs the services agreement from To do, in place", async ({ page, baseURL }) => {
  writeLiveDb((db) => {
    const docs = db.prepare("SELECT id FROM company_documents WHERE client_company_id = ?").all(COMPANY) as { id: string }[]
    for (const doc of docs) db.prepare("DELETE FROM company_document_signatures WHERE document_id = ?").run(doc.id)
    db.prepare("DELETE FROM company_documents WHERE client_company_id = ?").run(COMPANY)
    db.prepare("UPDATE client_agreements SET status = 'draft', signed_at = NULL WHERE client_company_id = ?").run(COMPANY)
    db.prepare(
      "UPDATE tasks SET status = 'ready', completed_at = NULL, completed_by_user_id = NULL WHERE case_id = ? AND type = 'accept_agreement'",
    ).run(AGREEMENT_CASE)
    db.prepare("UPDATE tasks SET status = 'blocked' WHERE case_id = ? AND type = 'review_order'").run(AGREEMENT_CASE)
  })
  const db = await openLiveDb(page)
  const own = readyCount(db, CLIENT)

  await signInAs(page.context(), baseURL!, CLIENT)
  await page.goto("/client")
  await expect(page.getByTestId("todo-count")).toHaveText(`· ${own}`)
  await expandTodo(page)
  const row = page.locator("[data-testid=todo-row][data-task-type=accept_agreement]")
  await expect(row).toContainText("Sign the services agreement")
  await row.getByRole("button", { name: "Review and sign" }).click()

  const dialog = page.getByTestId("signing-dialog")
  await expect(dialog).toBeVisible()
  await expect(page).toHaveURL(/\/client$/)
  await page.getByTestId("signing-consent").check()
  await page.getByTestId("signing-next").click()
  await page.getByTestId("signature-tag").filter({ hasText: "Sign here" }).click()
  await page.getByTestId("adopt-submit").click()
  await page.getByTestId("signing-finish").click()

  await expect(page.getByTestId("task-notice")).toBeVisible()
  await expect(page).toHaveURL(/\/client\?notice=/)
  await expect(page.getByTestId("todo-count")).toHaveText(`· ${own - 1}`)
  await expect(page.locator("[data-testid=todo-row][data-task-type=accept_agreement]")).toHaveCount(0)
})

test("a client with nothing to do is all caught up, and after paying on Finance the Invoices card says Nothing due", async ({ page, baseURL }) => {
  const db = await openLiveDb(page)
  expect(readyCount(db, QUIET_CLIENT)).toBe(0)

  await signInAs(page.context(), baseURL!, QUIET_CLIENT)
  await page.goto("/client")
  await expect(page.getByTestId("todo-empty")).toHaveText("You're all caught up.")
  await expect(page.getByTestId("todo-count")).toHaveCount(0)
  await expect(page.getByTestId("todo-row")).toHaveCount(0)

  const invoices = card(page, "invoices")
  if ((await invoices.getByTestId("glance-view").count()) > 0) {
    await invoices.getByTestId("glance-view").click({ force: true })
    await page.waitForURL(/\/client\/finance$/)
    await page.getByTestId("pay-all-due").click()
    await page.getByTestId("pay-confirm").click()
    await expect(page.getByTestId("pay-success")).toBeVisible()
    await page.getByTestId("pay-done").click()
    await page.goto("/client")
  }
  await expect(invoices.getByTestId("glance-figure")).toHaveText("$0.00")
  await expect(invoices.getByTestId("glance-context")).toHaveText("Nothing due")
  await expect(invoices.getByTestId("glance-view")).toHaveCount(0)
  await expect(invoices.getByRole("link")).toHaveAttribute("href", "/client/finance")
  await shot(page, "empty")
})
