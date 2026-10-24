import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { test, expect, type Page } from "@playwright/test"

import type { SessionUser } from "@/auth"
import * as schema from "@/db/schema"
import { formatCents } from "@/lib/format"
import { clientAgeing, type ClientAgeing } from "@/server/finance-insights"

import { dbFile, openLiveDb, signInAs, writeLiveDb } from "./support/live"

/**
 * Receivables and Billing run on the real pages, as Morgan Reyes (Finance): the figures line, both
 * bar lists and the table agree with the book; a By age row filters the table, By client follows
 * it (a crossfilter) and a second click clears; chips and Clear; a row opens the Invoices drawer;
 * the Billing run page shows the Run card and the cadence chart, and running billing issues
 * invoices once, a second press finding nothing to issue; last, with everything owed voided,
 * "Nothing is owed." It WRITES (it makes three payroll invoices due again, then voids what is owed),
 * so run this against a COPY of the seeded database outside the project directory:
 *
 *   cp data/eor.sqlite /tmp/recv.sqlite
 *   DATABASE_FILE=/tmp/recv.sqlite pnpm start -p 3223   (after pnpm build)
 *   PLAYWRIGHT_BASE_URL=http://localhost:3223 DATABASE_FILE=/tmp/recv.sqlite pnpm exec playwright test e2e/finance-receivables-billing.spec.ts
 *
 * Screenshots go to SHOT_DIR when it is set (E2E_THEME picks the preset).
 */
test.skip(!process.env.DATABASE_FILE, "DATABASE_FILE (the database copy the server uses) is required: this spec writes")
test.describe.configure({ mode: "serial" })

const FINANCE: SessionUser = { id: "user_finance_1", email: "", displayName: "Morgan Reyes", role: "finance", clientCompanyId: null, providerId: null }

async function shot(page: Page, name: string) {
  const dir = process.env.SHOT_DIR
  if (!dir) return
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${dir}/${process.env.SHOT_PREFIX ?? process.env.E2E_THEME ?? "light"}-e2e-${name}.png`, fullPage: true })
}

/** The book as the server computes it right now, read through the same read model. */
async function book(page: Page): Promise<ClientAgeing> {
  const sqlite = await openLiveDb(page)
  try {
    return clientAgeing(drizzle(sqlite, { schema }), FINANCE, new Date())
  } finally {
    sqlite.close()
  }
}

function count(sql: string): number {
  const sqlite = new Database(dbFile(), { fileMustExist: true, readonly: true })
  try {
    return (sqlite.prepare(sql).get() as { n: number }).n
  } finally {
    sqlite.close()
  }
}

test.beforeEach(async ({ context, baseURL, page }) => {
  if (process.env.E2E_THEME) await context.addCookies([{ name: "eor_theme", value: process.env.E2E_THEME, url: baseURL! }])
  await signInAs(context, baseURL!, FINANCE.id)
  await page.goto("/finance")
})

const byAgeRow = (page: Page, key: string) => page.locator(`[data-testid=by-age] [data-testid=bar-list-row][data-key="${key}"]`)
const byClientRow = (page: Page, key: string) => page.locator(`[data-testid=by-client] [data-testid=bar-list-row][data-key="${key}"]`)

/** The `data-cents` of every row of a chart, by key. */
async function chartCents(page: Page, chart: "by-age" | "by-client"): Promise<Record<string, number>> {
  const rows = page.locator(`[data-testid=${chart}] [data-testid=bar-list-row]`)
  await expect(rows.first()).toBeVisible()
  return Object.fromEntries(
    await rows.evaluateAll((nodes) => nodes.map((node) => [(node as HTMLElement).dataset.key!, Number((node as HTMLElement).dataset.cents)])),
  )
}

const sum = (values: Record<string, number>) => Object.values(values).reduce((total, value) => total + value, 0)

async function expectFigures(page: Page, outstanding: number, overdue: number, count: number) {
  await expect(page.getByTestId("receivables-outstanding")).toHaveAttribute("data-cents", String(outstanding))
  await expect(page.getByTestId("receivables-overdue")).toHaveAttribute("data-cents", String(overdue))
  const table = page.getByTestId("receivables-invoices")
  await expect(table).toHaveAttribute("data-total-cents", String(outstanding))
  await expect(table).toHaveAttribute("data-total", String(count))
}

test("the figures line, both charts and the table agree with the book to the cent", async ({ page }) => {
  await page.goto("/finance/receivables?size=100")
  const expected = await book(page)
  const { bookAgeing } = expected
  expect(expected.clients.length).toBeGreaterThan(1)
  await expect(page.getByRole("heading", { level: 2, name: "Receivables" })).toBeVisible()
  await expectFigures(page, bookAgeing.outstandingCents, bookAgeing.overdueCents, bookAgeing.invoiceCount)
  await expect(page.getByTestId("receivables-outstanding")).toHaveAttribute("title", formatCents(bookAgeing.outstandingCents))
  await expect(page.getByTestId("receivables-inflight")).toHaveAttribute("data-cents", String(bookAgeing.inFlight.cents))
  await expect(page.getByTestId("receivables-inflight-link")).toHaveAttribute("href", "/finance/payments")

  const byAge = await chartCents(page, "by-age")
  expect(byAge).toEqual(Object.fromEntries(Object.entries(bookAgeing.buckets).map(([key, total]) => [key, total.cents])))
  expect(sum(byAge)).toBe(bookAgeing.outstandingCents)
  const byClient = await chartCents(page, "by-client")
  expect(sum(byClient)).toBe(bookAgeing.outstandingCents)
  expect(Object.keys(byClient)).toEqual(expected.clients.filter((client) => client.outstandingCents > 0).sort((a, b) => b.outstandingCents - a.outstandingCents).map((client) => client.companyId))

  const rows = page.getByTestId("receivables-table").getByTestId("invoice-row")
  await expect(rows).toHaveCount(bookAgeing.invoiceCount)
  const days = await page.getByTestId("invoice-days-late").evaluateAll((cells) => cells.map((cell) => Number((cell as HTMLElement).dataset.days)))
  expect(days).toEqual([...days].sort((a, b) => b - a))
  const statuses = await rows.evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.status))
  for (const status of statuses) expect(["open", "overdue"]).toContain(status)
  expect(statuses.filter((status) => status === "overdue")).toHaveLength(bookAgeing.overdueCount)
  await shot(page, "receivables")
})

test("a By age row filters the table, By client follows it, and a second click clears it", async ({ page }) => {
  await page.goto("/finance/receivables")
  const { bookAgeing, clients } = await book(page)
  const byAgeBefore = await chartCents(page, "by-age")

  await byAgeRow(page, "current").click()
  await expect(page).toHaveURL(/\/finance\/receivables\?bucket=current$/)
  await expect(byAgeRow(page, "current")).toHaveAttribute("aria-pressed", "true")
  await expect(byAgeRow(page, "current")).toHaveAccessibleName(/, selected$/)
  await expect(byAgeRow(page, "days1to30")).toHaveAttribute("aria-pressed", "false")
  await expectFigures(page, bookAgeing.buckets.current.cents, 0, bookAgeing.buckets.current.count)
  await expect(page.getByTestId("receivables-inflight-link")).toHaveCount(0)
  expect(await chartCents(page, "by-age")).toEqual(byAgeBefore)
  const inCurrent = clients.filter((client) => client.buckets.current.cents > 0)
  await expect(page.locator("[data-testid=by-client] [data-testid=bar-list-row]")).toHaveCount(inCurrent.length)
  expect(await chartCents(page, "by-client")).toEqual(Object.fromEntries(inCurrent.map((client) => [client.companyId, client.buckets.current.cents])))
  for (const cell of await page.getByTestId("invoice-days-late").evaluateAll((cells) => cells.map((c) => Number((c as HTMLElement).dataset.days)))) {
    expect(cell).toBeLessThanOrEqual(0)
  }
  await expect(page.getByTestId("filter-chip")).toHaveText(["Current"])
  await shot(page, "receivables-bucket")

  const client = inCurrent[0]
  await byClientRow(page, client.companyId).click()
  await expect(page).toHaveURL(`/finance/receivables?bucket=current&client=${client.companyId}`)
  await expectFigures(page, client.buckets.current.cents, 0, client.buckets.current.count)
  expect(await chartCents(page, "by-age")).toEqual(Object.fromEntries(Object.entries(client.buckets).map(([key, total]) => [key, total.cents])))
  await expect(page.getByTestId("filter-chip")).toHaveText(["Current", client.companyName])
  for (const name of await page.getByTestId("invoice-client").allInnerTexts()) expect(name.trim()).toBe(client.companyName)
  await shot(page, "receivables-both")

  await byAgeRow(page, "current").click()
  await expect(page).toHaveURL(`/finance/receivables?client=${client.companyId}`)
  await expectFigures(page, client.outstandingCents, client.overdueCents, client.invoiceCount)
  await byClientRow(page, client.companyId).focus()
  await page.keyboard.press("Space")
  await expect(page).toHaveURL(/\/finance\/receivables$/)
  await expectFigures(page, bookAgeing.outstandingCents, bookAgeing.overdueCents, bookAgeing.invoiceCount)

  // An empty bucket filters nothing; a filter leaves the page size and drops the page.
  const empty = Object.entries(bookAgeing.buckets).find(([, total]) => total.cents === 0)
  if (empty) await expect(byAgeRow(page, empty[0])).toBeDisabled()
  await page.goto("/finance/receivables?size=25&page=2")
  await byAgeRow(page, "days1to30").click()
  await expect(page).toHaveURL("/finance/receivables?size=25&bucket=1-30")
})

test("chips remove one filter each and Clear removes both; a selection with nothing in it says so", async ({ page }) => {
  await page.goto("/finance/receivables")
  const { clients, bookAgeing } = await book(page)
  const client = clients.find((row) => row.overdueCents > 0)!
  await page.goto(`/finance/receivables?bucket=1-30&client=${client.companyId}`)
  await expectFigures(page, client.buckets.days1to30.cents, client.buckets.days1to30.cents, client.buckets.days1to30.count)
  await expect(page.getByTestId("filter-chip")).toHaveText(["1–30 days late", client.companyName])
  await page.getByRole("link", { name: "Remove filter: 1–30 days late" }).click()
  await expect(page).toHaveURL(`/finance/receivables?client=${client.companyId}`)
  await expect(page.getByTestId("filter-chip")).toHaveText([client.companyName])
  await page.getByTestId("clear-filters").click()
  await expect(page).toHaveURL(/\/finance\/receivables$/)
  await expect(page.getByTestId("filter-chips")).toHaveCount(0)

  // Unknown values are ignored rather than failing.
  await page.goto("/finance/receivables?bucket=in-flight&client=nobody")
  await expect(page.getByTestId("filter-chips")).toHaveCount(0)
  await expectFigures(page, bookAgeing.outstandingCents, bookAgeing.overdueCents, bookAgeing.invoiceCount)

  const late = Object.entries(bookAgeing.buckets).find(([key, total]) => key !== "current" && total.cents === 0)
  test.skip(!late, "every overdue bucket holds money in this database")
  const param = { days1to30: "1-30", days31to60: "31-60", days60plus: "60-plus" }[late![0]]!
  await page.goto(`/finance/receivables?bucket=${param}`)
  await expect(page.getByTestId("no-receivable-invoices")).toContainText("No unpaid invoices match these filters.")
  await expect(byAgeRow(page, late![0])).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByTestId("by-client")).toContainText("No client owes money of this age.")
  await shot(page, "receivables-no-match")
  await page.getByTestId("no-receivable-invoices").getByRole("link", { name: "Clear" }).click()
  await expect(page).toHaveURL(/\/finance\/receivables$/)
})

test("a table row opens the invoice in the Invoices drawer, by click or with j and Enter", async ({ page }) => {
  await page.goto("/finance/receivables")
  const table = page.getByTestId("receivables-table")
  const number = await table.getByTestId("invoice-number").first().innerText()
  const id = await table.getByTestId("invoice-row").first().getAttribute("data-invoice-id")
  await table.getByTestId("invoice-open").first().click()
  await expect(page).toHaveURL(`/finance/invoices?open=${encodeURIComponent(id!)}`)
  await expect(page.getByTestId("invoice-drawer").getByTestId("drawer-number")).toHaveText(number)

  await page.goto("/finance/receivables")
  await expect(table.getByTestId("invoice-row").first()).toBeVisible()
  // The first key press can land before the page has hydrated.
  await expect(async () => {
    await page.keyboard.press("j")
    await expect(table.locator("[data-testid=invoice-row][data-cursor=true]")).toHaveCount(1, { timeout: 500 })
  }).toPass()
  await expect(table.getByTestId("invoice-row").first()).toHaveAttribute("data-cursor", "true")
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(`/finance/invoices?open=${encodeURIComponent(id!)}`)
})

test("Billing run shows the Run card, By client, the cadence chart and recent issue dates", async ({ page }) => {
  await page.goto("/finance/billing")
  await expect(page.getByTestId("run-card")).toBeVisible()
  await expect(page.getByTestId("run-billing")).toBeVisible()
  await expect(page.getByRole("button", { name: /^Run billing/ })).toHaveCount(1)
  await expect(page.getByTestId("by-client")).toBeVisible()
  const chart = page.getByTestId("billing-cadence")
  await expect(chart.getByRole("heading", { name: "Next pay periods" })).toBeVisible()
  await expect(chart.locator("table caption")).toHaveCount(1)
  await expect(page.getByTestId("recent-row").first()).toBeVisible()
  await shot(page, "billing")
})

test("running billing issues the due invoices once; a second press finds nothing to issue", async ({ page, context }) => {
  // The seed bills through today, so make three payroll invoices of the last run due again.
  const removed = writeLiveDb((db) => {
    const ids = (
      db
        .prepare(
          `select id from invoices i where kind = 'payroll' and status = 'open'
             and issue_date = (select max(issue_date) from invoices where kind = 'payroll')
             and not exists (select 1 from payment_allocations a where a.invoice_id = i.id)
           order by id limit 3`,
        )
        .all() as { id: string }[]
    ).map((row) => row.id)
    const marks = ids.map(() => "?").join(",")
    db.transaction(() => {
      db.prepare(`delete from payroll_entries where invoice_id in (${marks})`).run(...ids)
      db.prepare(`delete from invoice_lines where invoice_id in (${marks})`).run(...ids)
      db.prepare(`delete from invoices where id in (${marks})`).run(...ids)
    })()
    return ids.length
  })
  expect(removed).toBe(3)

  await page.goto("/finance/billing")
  const button = page.getByTestId("run-billing")
  await expect(button).toHaveText("Run billing · 3 invoices")
  await expect(page.getByTestId("figure-payroll")).toContainText("3 invoices")
  await expect(page.getByTestId("figure-payslips")).toContainText("Creates 3 pay slips")
  await expect(page.getByTestId("by-client-row").first()).toBeVisible()
  await page.getByTestId("by-client-toggle").first().click()
  await expect(page.getByTestId("by-client-invoice").first()).toBeVisible()

  // A second tab opened before the run keeps the old preview: its press is the "second press".
  const stale = await context.newPage()
  await stale.goto("/finance/billing")
  await expect(stale.getByTestId("run-billing")).toHaveText("Run billing · 3 invoices")

  const before = count("select count(*) n from invoices")
  const slips = count("select count(*) n from payroll_entries")
  await button.click()
  const result = page.getByTestId("run-result-text")
  await expect(result).toHaveText(/^Issued 3 invoices totalling \$[\d,]+\.\d\d$/)
  await expect(page.getByTestId("run-result")).toContainText("3 payroll invoices · 3 pay slips created")
  expect(count("select count(*) n from invoices")).toBe(before + 3)
  expect(count("select count(*) n from payroll_entries")).toBe(slips + 3)
  await expect(page.getByTestId("by-client-empty")).toBeVisible()
  await expect(button).toBeDisabled()
  await shot(page, "billing-result")

  await stale.getByTestId("run-billing").click()
  await expect(stale.getByTestId("run-result-text")).toHaveText(/^Nothing to issue\. Everything due as of .+ is already billed\.$/)
  expect(count("select count(*) n from invoices")).toBe(before + 3)
  await stale.close()

  await page.reload()
  await expect(page.getByTestId("would-issue-summary")).toHaveText(/^Nothing to issue\. Everything due as of .+ is already billed\.$/)
  await expect(page.getByTestId("run-billing")).toBeDisabled()
})

test("once nothing is owed, Receivables says so with no charts and no table", async ({ page }) => {
  // Void every invoice that is still owed: open, and not in a payment that settled or is in flight.
  writeLiveDb((db) =>
    db
      .prepare(
        `update invoices set status = 'void' where status = 'open' and not exists (
           select 1 from payment_allocations a join payments p on p.id = a.payment_id
           where a.invoice_id = invoices.id and p.status in ('initiated', 'settled'))`,
      )
      .run(),
  )
  await page.goto("/finance/receivables")
  const { bookAgeing } = await book(page)
  expect(bookAgeing.outstandingCents).toBe(0)
  await expect(page.getByTestId("nothing-owed")).toContainText("Nothing is owed.")
  await expect(page.getByTestId("receivables-charts")).toHaveCount(0)
  await expect(page.getByTestId("receivables-table")).toHaveCount(0)
  if (bookAgeing.inFlight.cents > 0) await expect(page.getByTestId("receivables-inflight")).toHaveAttribute("data-cents", String(bookAgeing.inFlight.cents))
  await shot(page, "receivables-empty")
})
