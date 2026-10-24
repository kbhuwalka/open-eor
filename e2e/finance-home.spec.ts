import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { test, expect, type Page } from "@playwright/test"

import type { SessionUser } from "@/auth"
import * as schema from "@/db/schema"
import { ageingTakeaway, collectionTakeaway } from "@/lib/finance-chart-view"
import { homeDateLabel, shortWeekdayDay, topOverdueClients } from "@/lib/finance-home-view"
import { plural } from "@/lib/finance-portal-view"
import { formatCents } from "@/lib/format"
import { previewBillingRun } from "@/server/billing-preview"
import { billedVsCollectedByPeriod, clientAgeing } from "@/server/finance-insights"

import { cents, dbFile, openLiveDb, signInAs, todayEastern, writeLiveDb } from "./support/live"

/**
 * The Finance Home on the real page, as Morgan Reyes (Finance): the date, the three tiles agreeing
 * with Payments, Receivables and Billing run and linking to them, both charts with their takeaways,
 * Who owes us opening Receivables on a bucket or a client, Waiting on you in To settle's order with a row opening
 * the payment drawer, Settle from the Home, Run billing while invoices are due, and the empty state
 * once everything is settled. It WRITES (settles every waiting payment, makes three invoices due),
 * so run it against a fresh COPY of the seeded database on a production server:
 *
 *   cp data/eor.sqlite /tmp/fhome.sqlite
 *   DATABASE_FILE=/tmp/fhome.sqlite pnpm start -p 3224   (after pnpm build)
 *   PLAYWRIGHT_BASE_URL=http://localhost:3224 DATABASE_FILE=/tmp/fhome.sqlite pnpm exec playwright test e2e/finance-home.spec.ts
 *
 * Screenshots go to SHOT_DIR when it is set (E2E_THEME picks the preset).
 */
test.skip(!process.env.DATABASE_FILE, "DATABASE_FILE (the database copy the server uses) is required: this spec writes")
test.describe.configure({ mode: "serial" })
test.use({ viewport: { width: 1360, height: 1000 } })

const FINANCE: SessionUser = { id: "user_finance_1", email: "", displayName: "Morgan Reyes", role: "finance", clientCompanyId: null, providerId: null }

async function shot(page: Page, name: string) {
  const dir = process.env.SHOT_DIR
  if (!dir) return
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${dir}/${process.env.SHOT_PREFIX ?? process.env.E2E_THEME ?? "monochrome"}-home-${name}.png`, fullPage: true })
}

/** Runs a read model on the server's database, as Finance, right now. */
async function model<T>(page: Page, fn: (db: ReturnType<typeof drizzle<typeof schema>>) => T): Promise<T> {
  const sqlite = await openLiveDb(page)
  try {
    return fn(drizzle(sqlite, { schema }))
  } finally {
    sqlite.close()
  }
}

function initiated(): { count: number; cents: number } {
  const sqlite = new Database(dbFile(), { fileMustExist: true, readonly: true })
  try {
    return sqlite.prepare("select count(*) count, coalesce(sum(total_cents), 0) cents from payments where status = 'initiated'").get() as {
      count: number
      cents: number
    }
  } finally {
    sqlite.close()
  }
}

/** The initiated payments in To settle's order: deposits first, then the longest-waiting. */
function toSettleOrder(): { id: string; deposit: number }[] {
  const sqlite = new Database(dbFile(), { fileMustExist: true, readonly: true })
  try {
    return sqlite
      .prepare(
        `select p.id id, exists (select 1 from payment_allocations a join invoices i on i.id = a.invoice_id
                                 where a.payment_id = p.id and i.kind = 'deposit') deposit
           from payments p where p.status = 'initiated' order by deposit desc, p.initiated_at, p.id`,
      )
      .all() as { id: string; deposit: number }[]
  } finally {
    sqlite.close()
  }
}

const navPayments = (page: Page) => page.getByRole("navigation").getByRole("link", { name: /^Payments/ })
const tileValue = (page: Page, key: string) => page.getByTestId(`tile-${key}-value`)

test.beforeEach(async ({ context, baseURL, page }) => {
  if (process.env.E2E_THEME) await context.addCookies([{ name: "eor_theme", value: process.env.E2E_THEME, url: baseURL! }])
  await signInAs(context, baseURL!, FINANCE.id)
  await page.goto("/finance")
})

test("the header names the day and the three tiles agree with Payments, Receivables and Billing run, each linking there", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Finance", exact: true })).toBeVisible()
  await expect(page.getByTestId("home-date")).toHaveText(homeDateLabel(todayEastern()))
  await expect(page.getByTestId("task-inbox")).toHaveCount(0)
  await expect(page.getByTestId("task-row")).toHaveCount(0)
  await shot(page, "initial")

  const waiting = initiated()
  expect(waiting.count).toBeGreaterThan(0)
  await expect(tileValue(page, "to-settle")).toHaveText(`${plural(waiting.count, "payment")} · ${formatCents(waiting.cents)}`)
  await expect(page.getByTestId("tile-to-settle-context")).toHaveText(/^oldest (\d+ days?|started today)$/)
  await expect(navPayments(page)).toContainText(String(waiting.count))

  // Keyboard: the first tile is reachable with Tab and shows a focus ring on its stretched link.
  const settleLink = page.getByTestId("tile-to-settle-link")
  for (let i = 0; i < 40 && !(await settleLink.evaluate((el) => el === document.activeElement)); i += 1) await page.keyboard.press("Tab")
  await expect(settleLink).toBeFocused()
  expect(await settleLink.evaluate((el) => getComputedStyle(el, "::after").boxShadow)).not.toBe("none")

  await settleLink.click()
  await expect(page).toHaveURL(/\/finance\/payments$/)
  await expect(page.getByTestId("tab-count-to_settle")).toHaveText(`(${waiting.count})`)

  await page.goto("/finance")
  const book = await model(page, (db) => clientAgeing(db, FINANCE, new Date()).bookAgeing)
  expect(book.overdueCents).toBeGreaterThan(0)
  await expect(tileValue(page, "overdue")).toHaveText(`${formatCents(book.overdueCents)} across ${plural(book.overdueCount, "invoice")}`)
  await expect(page.getByTestId("tile-overdue-context")).toHaveText(`oldest ${plural(book.oldestOverdueDays!, "day")}`)
  await page.getByTestId("tile-overdue-link").click()
  await expect(page).toHaveURL(/\/finance\/receivables$/)
  await expect(page.getByTestId("receivables-overdue")).toHaveAttribute("data-cents", String(book.overdueCents))

  await page.goto("/finance")
  const preview = await model(page, (db) => previewBillingRun(db, FINANCE, new Date()))
  expect(preview.wouldIssue.count).toBe(0)
  await expect(tileValue(page, "ready-to-bill")).toHaveText("None")
  await expect(page.getByTestId("tile-ready-to-bill-context")).toHaveText(`next billing ${shortWeekdayDay(preview.upcoming[0].issueDate)}`)
  await expect(page.getByTestId("tile-run-billing")).toHaveCount(0)
  await page.getByTestId("tile-ready-to-bill-link").click()
  await expect(page).toHaveURL(/\/finance\/billing$/)
  await expect(page.getByTestId("would-issue-summary")).toHaveText(/^Nothing to issue\./)
  await expect(page.getByTestId("run-billing")).toBeDisabled()
})

test("both charts render with their takeaways and accessible tables; an ageing segment opens Receivables on its bucket", async ({ page }) => {
  const [billed, ageing] = await model(page, (db) => [billedVsCollectedByPeriod(db, FINANCE, new Date(), 8), clientAgeing(db, FINANCE, new Date())] as const)

  const left = page.getByTestId("home-billed")
  await expect(left.getByRole("figure", { name: "Billed vs collected by pay period" })).toBeVisible()
  await expect(left).toContainText(collectionTakeaway(billed.periods))
  await expect(left.locator("table caption")).toHaveCount(1)
  expect((await left.boundingBox())!.width).toBeGreaterThan((await page.getByTestId("home-who-owes").boundingBox())!.width)

  const right = page.getByTestId("home-who-owes")
  await expect(right.getByRole("figure", { name: "Who owes us" })).toBeVisible()
  await expect(right).toContainText(ageingTakeaway(ageing.bookAgeing))
  await expect(right.locator("table caption")).toHaveCount(1)
  await expect(right.locator("[data-dimmed]")).toHaveCount(0)

  const segment = right.locator("a[data-segment=current]")
  await expect(segment).toHaveAttribute("href", "/finance/receivables?bucket=current")
  await segment.click()
  await expect(page).toHaveURL(/\/finance\/receivables\?bucket=current$/)
  await expect(page.locator("[data-testid=by-age] [data-key=current]")).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByTestId("receivables-outstanding")).toHaveAttribute("data-cents", String(ageing.bookAgeing.buckets.current.cents))
  await shot(page, "receivables-selected-bucket")

  await page.goto("/finance")
  await expect(right.locator("a[data-segment=days1to30]")).toHaveAttribute("href", "/finance/receivables?bucket=1-30")
  if (ageing.bookAgeing.inFlight.cents > 0) await expect(right.locator("a[data-segment=inFlight]")).toHaveAttribute("href", "/finance/payments")
})

test("Who owes us lists the three clients owing the most overdue, each opening Receivables on that client", async ({ page }) => {
  const top = await model(page, (db) => topOverdueClients(clientAgeing(db, FINANCE, new Date()).clients))
  expect(top.length).toBeGreaterThan(0)
  const rows = page.getByTestId("home-top-client")
  await expect(rows).toHaveCount(top.length)
  for (const [index, client] of top.entries()) {
    await expect(rows.nth(index)).toHaveAttribute("data-company-id", client.companyId)
    await expect(rows.nth(index).getByTestId("home-top-client-overdue")).toContainText(formatCents(client.overdueCents))
    await expect(rows.nth(index).getByTestId("home-top-client-oldest")).toContainText(plural(client.oldestOverdueDays!, "day"))
  }
  await rows.first().getByTestId("home-top-client-open").click()
  await expect(page).toHaveURL(`/finance/receivables?client=${top[0].companyId}`)
  await expect(page.locator(`[data-testid=by-client] [data-key="${top[0].companyId}"]`)).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByTestId("filter-chip")).toHaveText([top[0].companyName])
  await expect(page.getByTestId("receivables-overdue")).toHaveAttribute("data-cents", String(top[0].overdueCents))
  for (const name of await page.getByTestId("invoice-client").allInnerTexts()) expect(name.trim()).toBe(top[0].companyName)
})

test("Waiting on you is the top of To settle: deposits first, then the oldest, with the full count", async ({ page }) => {
  const order = toSettleOrder()
  const section = page.getByTestId("waiting-on-you")
  await expect(section.getByTestId("waiting-count")).toHaveText(String(order.length))
  const rows = section.getByTestId("waiting-row")
  await expect(rows).toHaveCount(Math.min(5, order.length))
  const ids = await rows.evaluateAll((items) => items.map((item) => item.getAttribute("data-payment-id")))
  expect(ids).toEqual(order.slice(0, 5).map((row) => row.id))
  expect(order.some((row) => row.deposit)).toBe(true)
  await expect(rows.first()).toHaveAttribute("data-deposit", "true")
  await expect(rows.first().getByTestId("waiting-detail")).toHaveText(/^Deposit · starts \w{3} \d{1,2} · /)

  await page.goto("/finance/payments")
  const listed = await page.getByTestId("payment-row").evaluateAll((items) => items.slice(0, 5).map((item) => item.getAttribute("data-payment-id")))
  expect(listed).toEqual(ids)
  await page.goto("/finance")
  await section.getByTestId("waiting-view-all").click()
  await expect(page).toHaveURL(/\/finance\/payments$/)
})

test("a row opens the payment in the drawer on Payments", async ({ page }) => {
  const row = page.getByTestId("waiting-row").nth(1)
  const id = (await row.getAttribute("data-payment-id"))!
  // The stretched link covers the whole row, so a click on the amount lands on it.
  const amount = row.getByTestId("waiting-amount")
  await expect(amount).toBeVisible()
  const rowBox = (await row.boundingBox())!
  const amountBox = (await amount.boundingBox())!
  await row.click({ position: { x: amountBox.x - rowBox.x + amountBox.width / 2, y: rowBox.height / 2 } })
  await expect(page).toHaveURL(`/finance/payments?open=${id}`)
  await expect(page.getByTestId("payment-drawer").getByTestId("payment-reference")).toHaveText(id)
})

test("Settle from the Home: the row leaves, and To settle and the nav count go down by one", async ({ page }) => {
  const before = initiated()
  const row = page.getByTestId("waiting-row").first()
  const id = (await row.getAttribute("data-payment-id"))!
  const client = (await row.getByTestId("waiting-client").innerText()).trim()
  const amount = (await row.getByTestId("waiting-amount").innerText()).replace("Amount", "").trim()

  await row.getByTestId("waiting-settle").click()
  const dialog = page.getByTestId("settle-dialog")
  await expect(dialog.getByRole("heading")).toHaveText(`Settle ${amount} from ${client}?`)
  await expect(dialog.getByTestId("action-confirm")).toHaveText(`Settle ${amount}`)
  await shot(page, "settle-dialog")
  await dialog.getByTestId("action-confirm").click()

  await expect(page.locator(`[data-testid=waiting-row][data-payment-id="${id}"]`)).toHaveCount(0)
  await expect(page.getByTestId("waiting-settled")).toHaveText(`Settled ${amount} from ${client.replace(/\.?$/, ".")}`)
  await expect(page.getByTestId("waiting-count")).toHaveText(String(before.count - 1))
  await expect(tileValue(page, "to-settle")).toHaveText(`${plural(before.count - 1, "payment")} · ${formatCents(before.cents - cents(amount))}`)
  await expect(navPayments(page)).toContainText(String(before.count - 1))
  expect(initiated().count).toBe(before.count - 1)
  await shot(page, "after-settle")
})

test("Ready to bill offers Run billing while invoices are due, agreeing with Billing run, and it navigates there", async ({ page }) => {
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

  await page.reload()
  const preview = await model(page, (db) => previewBillingRun(db, FINANCE, new Date()))
  expect(preview.wouldIssue.count).toBe(3)
  await expect(tileValue(page, "ready-to-bill")).toHaveText(`3 invoices · ${formatCents(preview.wouldIssue.totalCents)}`)
  await shot(page, "ready-to-bill")
  await page.getByTestId("tile-run-billing").click()
  await expect(page).toHaveURL(/\/finance\/billing$/)
  await expect(page.getByTestId("run-billing")).toHaveText("Run billing · 3 invoices")
  await expect(page.getByTestId("figure-total")).toContainText(formatCents(preview.wouldIssue.totalCents))
  await expect(page.getByTestId("run-result")).toHaveCount(0)
})

test("with everything settled, Waiting on you says so quietly and To settle reads None", async ({ page }) => {
  const section = page.getByTestId("waiting-on-you")
  for (let left = initiated().count; left > 0; left -= 1) {
    await section.getByTestId("waiting-settle").first().click()
    await page.getByTestId("settle-dialog").getByTestId("action-confirm").click()
    await expect(section.getByTestId("waiting-count")).toHaveText(String(left - 1))
  }
  await expect(section.getByTestId("waiting-empty")).toHaveText("Nothing waiting on you.")
  await expect(section.getByTestId("waiting-row")).toHaveCount(0)
  await expect(tileValue(page, "to-settle")).toHaveText("None")
  await expect(page.getByTestId("tile-to-settle-context")).toHaveText("Nothing waiting on you")
  await expect(navPayments(page)).not.toContainText(/\d/)
  await shot(page, "empty")
})
