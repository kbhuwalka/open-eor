import Database from "better-sqlite3"
import { test, expect, type Page } from "@playwright/test"

import { openLiveDb, signInAs } from "./support/live"

/**
 * The Finance portal on the real pages, as Morgan Reyes (Finance): Payments (settle one, settle in
 * bulk, mark failed with a reason, a deposit settling and completing Confirm deposit, a deposit
 * failing and reopening Pay deposit), Invoices (filters, chips, deep links, Mark as paid, void),
 * the old URLs, billing twice and receivables. It WRITES, so run it against a COPY of the seeded
 * database, on a production server:
 *
 *   cp data/eor.sqlite /tmp/finance-copy.sqlite
 *   DATABASE_FILE=/tmp/finance-copy.sqlite pnpm start -p 3120
 *   PLAYWRIGHT_BASE_URL=http://localhost:3120 DATABASE_FILE=/tmp/finance-copy.sqlite pnpm exec playwright test e2e/finance-portal.spec.ts --workers=1
 *
 * The tests run in order and share the copy: each takes the payments it needs from what the
 * earlier ones left. Screenshots go to SHOT_DIR when it is set (light and dark with E2E_THEME=dark).
 */
test.skip(!process.env.DATABASE_FILE, "DATABASE_FILE (the database copy the server uses) is required: this spec writes")
test.describe.configure({ mode: "serial" })

async function shot(page: Page, name: string) {
  const dir = process.env.SHOT_DIR
  if (!dir) return
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${dir}/${process.env.SHOT_PREFIX ?? "light"}-e2e-${name}.png` })
}

function one<T>(database: Database.Database, sql: string, ...args: unknown[]): T | undefined {
  return database.prepare(sql).get(...args) as T | undefined
}

async function read<T>(page: Page, fn: (database: Database.Database) => T): Promise<T> {
  const database = await openLiveDb(page)
  try {
    return fn(database)
  } finally {
    database.close()
  }
}

const taskStatuses = (database: Database.Database, caseId: string, key: string) =>
  (database.prepare("select status from tasks where case_id = ? and key = ? order by seq").all(caseId, key) as { status: string }[]).map((t) => t.status)

const paymentRow = (page: Page, id: string) => page.locator(`[data-testid=payment-row][data-payment-id="${id}"]`)

/** An initiated deposit payment whose order still waits on Confirm deposit. */
const SETTLEABLE_DEPOSIT = `select p.id paymentId, c.id caseId, i.id invoiceId, i.number number, co.name client
   from payments p join payment_allocations a on a.payment_id = p.id join invoices i on i.id = a.invoice_id
   join onboarding_cases c on c.hire_request_id = i.hire_id join client_companies co on co.id = p.company_id
   join tasks t on t.case_id = c.id and t.key = 'confirm_deposit' and t.status = 'ready'
  where p.status = 'initiated' and i.kind = 'deposit' and c.lifecycle = 'open' order by p.initiated_at, p.id limit 1`

type Deposit = { paymentId: string; caseId: string; invoiceId: string; number: string; client: string }

test.beforeEach(async ({ context, baseURL, page }) => {
  if (process.env.E2E_THEME) await context.addCookies([{ name: "eor_theme", value: process.env.E2E_THEME, url: baseURL! }])
  await page.goto("/pick")
  await page.getByRole("button", { name: /Morgan Reyes/ }).click()
  await page.waitForURL(/\/finance/)
})

test("the nav lists the Finance pages, Payments counts what waits to settle, and Deposits is gone", async ({ page }) => {
  const nav = page.getByRole("navigation")
  for (const label of ["Home", "Payments", "Invoices", "Receivables", "Billing run"]) {
    await expect(nav.getByRole("link", { name: new RegExp(`^${label}`) })).toBeVisible()
  }
  await expect(nav.getByRole("link", { name: /^Deposits/ })).toHaveCount(0)
  const waiting = await read(page, (db) => one<{ n: number }>(db, "select count(*) n from payments where status = 'initiated'")!.n)
  await expect(nav.getByRole("link", { name: /^Payments/ })).toContainText(String(waiting))
  await page.goto("/finance/payments")
  await expect(page.getByTestId("tab-count-to_settle")).toHaveText(`(${waiting})`)
})

test("the old pages are gone: Deposits and the task page 404, detail URLs open the drawer", async ({ page }) => {
  const ids = await read(page, (db) => ({
    task: one<{ id: string }>(db, "select id from tasks where key = 'confirm_deposit' limit 1")!.id,
    invoice: one<{ id: string; number: string }>(
      db,
      `select i.id id, i.number number from invoices i join payment_allocations a on a.invoice_id = i.id join payments p on p.id = a.payment_id
        where i.kind = 'payroll' and p.status = 'succeeded' order by i.issue_date desc limit 1`,
    )!,
    payment: one<{ id: string }>(db, "select id from payments where status = 'succeeded' order by settled_at desc limit 1")!.id,
  }))
  expect((await page.goto("/finance/deposits"))?.status()).toBe(404)
  expect((await page.goto(`/finance/tasks/${ids.task}`))?.status()).toBe(404)

  await page.goto(`/finance/invoices/${encodeURIComponent(ids.invoice.id)}`)
  await expect(page).toHaveURL(`/finance/invoices?open=${encodeURIComponent(ids.invoice.id)}`)
  await expect(page.getByTestId("invoice-drawer").getByTestId("drawer-number")).toHaveText(ids.invoice.number)

  await page.goto(`/finance/payments/${ids.payment}`)
  await expect(page).toHaveURL(`/finance/payments?open=${ids.payment}`)
  await expect(page.getByTestId("payments-list")).toHaveAttribute("data-tab", "settled")
  await expect(page.getByTestId("payment-drawer").getByTestId("payment-reference")).toHaveText(ids.payment)
  await shot(page, "payment-drawer-settled")
  await page.keyboard.press("Escape")
  await expect(page.getByTestId("payment-drawer")).toHaveCount(0)
  await expect(page).toHaveURL("/finance/payments?tab=settled")
})

test("other roles never see a Finance page or its PDF", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL })
  const page = await context.newPage()
  try {
    await page.goto("/pick")
    await page.getByRole("button", { name: /Alex Harper/ }).click()
    await page.waitForURL(/\/client/)
    for (const path of ["/finance/payments", "/finance/invoices", "/finance/receivables", "/finance/billing"]) {
      await page.goto(path)
      await expect(page.getByRole("heading", { name: /Payments|Invoices|Receivables|Billing run/ })).toHaveCount(0)
      await expect(page).not.toHaveURL(new RegExp(`${path}$`))
    }
    const pdf = await page.request.get("/finance/invoices/deposit%3Ahire_1/pdf")
    expect([401, 403, 404, 307]).toContain(pdf.status())
    expect(pdf.headers()["content-type"] ?? "").not.toContain("application/pdf")
  } finally {
    await context.close()
  }
})

test("To settle lists deposits first; settling one pays its invoice and completes Confirm deposit", async ({ page }) => {
  const deposit = await read(page, (db) => one<Deposit>(db, SETTLEABLE_DEPOSIT))
  expect(deposit, "a seeded deposit payment waiting on Finance").toBeTruthy()

  await page.goto("/finance/payments")
  const rows = page.getByTestId("payment-row")
  await expect(rows.first()).toHaveAttribute("data-deposit", "true")
  const row = paymentRow(page, deposit!.paymentId)
  await expect(row.getByTestId("payment-detail")).toContainText(/Deposit · starts \w{3} \d{1,2}/)
  await expect(row.getByTestId("payment-wait")).toHaveText(/^\w{3} \d{1,2} · (today|\d+ days?)$/)
  const before = Number((await page.getByTestId("tab-count-to_settle").innerText()).replace(/\D/g, ""))
  await shot(page, "payments-to-settle")

  await row.getByTestId("payment-open").click()
  const drawer = page.getByTestId("payment-drawer")
  await expect(drawer.getByTestId("payment-note")).toContainText("Settling it confirms the deposit")
  await shot(page, "payment-drawer-deposit")
  await page.keyboard.press("Escape")

  await row.getByTestId("settle-row").click()
  const dialog = page.getByTestId("settle-dialog")
  await expect(dialog.getByRole("heading")).toHaveText(new RegExp(`^Settle \\$[\\d,]+\\.\\d{2} from ${deposit!.client}\\?$`))
  await expect(dialog.getByTestId("action-confirm")).toHaveText(/^Settle \$[\d,]+\.\d{2}$/)
  await dialog.getByTestId("action-confirm").click()
  await expect(row).toHaveCount(0)
  await expect(page.getByTestId("tab-count-to_settle")).toHaveText(`(${before - 1})`)

  await read(page, (db) => {
    expect(one<{ status: string }>(db, "select status from payments where id = ?", deposit!.paymentId)?.status).toBe("succeeded")
    expect(taskStatuses(db, deposit!.caseId, "confirm_deposit")).toEqual(["done"])
  })

  await page.getByTestId("tab-settled").click()
  await expect(paymentRow(page, deposit!.paymentId)).toBeVisible()
  await page.goto(`/finance/invoices?open=${encodeURIComponent(deposit!.invoiceId)}`)
  const invoice = page.getByTestId("invoice-drawer")
  await expect(invoice.getByTestId("drawer-header")).toContainText("Paid")
  await expect(invoice.getByTestId("drawer-history")).toContainText("Payment settled")
  await expect(invoice.getByTestId("drawer-payment-open").first()).toBeVisible()
  await shot(page, "invoice-drawer-paid")
})

test("Mark failed on a deposit needs a reason, reopens the client's Pay deposit and makes the invoice payable", async ({ page, browser, baseURL }) => {
  const deposit = await read(page, (db) => one<Deposit & { userId: string }>(db, SETTLEABLE_DEPOSIT.replace("co.name client", "co.name client, (select u.id from users u where u.client_company_id = p.company_id and u.role = 'client_hr' limit 1) userId")))
  expect(deposit, "a second deposit payment waiting on Finance").toBeTruthy()

  await page.goto(`/finance/payments?open=${deposit!.paymentId}`)
  const drawer = page.getByTestId("payment-drawer")
  await drawer.getByTestId("drawer-mark-failed").click()
  await expect(drawer.getByTestId("fail-consequence")).toContainText(`${deposit!.number} becomes payable again, and the client's Pay deposit step reopens.`)
  await drawer.getByTestId("fail-confirm").click()
  await expect(drawer.getByTestId("fail-reason-error")).toBeVisible()
  await drawer.getByTestId("fail-reason").fill("ACH debit returned: R01")
  await shot(page, "payment-drawer-fail-reason")
  await drawer.getByTestId("fail-confirm").click()
  await expect(drawer.getByTestId("payment-failure")).toContainText("ACH debit returned: R01")
  await expect(drawer.getByTestId("drawer-mark-failed")).toHaveCount(0)

  await read(page, (db) => {
    expect(taskStatuses(db, deposit!.caseId, "pay_deposit")).toEqual(["done", "ready"])
    expect(one<{ status: string }>(db, "select status from invoices where id = ?", deposit!.invoiceId)?.status).toBe("open")
  })

  const clientContext = await browser.newContext({ baseURL })
  const clientPage = await clientContext.newPage()
  try {
    await signInAs(clientContext, baseURL!, deposit!.userId)
    await clientPage.goto(`/client/people/${deposit!.caseId}`)
    await expect(clientPage.getByTestId("task-reopen-note").first()).toContainText("ACH debit returned: R01")
  } finally {
    await clientContext.close()
  }
})

test("Mark failed from a row's menu opens the drawer on the reason; the payment moves to Failed with it", async ({ page }) => {
  await page.goto("/finance/payments")
  const row = page.getByTestId("payment-row").last()
  const id = (await row.getAttribute("data-payment-id"))!
  await row.hover()
  await row.getByTestId("payment-row-menu").click()
  await page.getByTestId("row-mark-failed").click()
  const drawer = page.getByTestId("payment-drawer")
  await expect(drawer.getByTestId("fail-reason")).toBeVisible()
  await drawer.getByTestId("fail-reason").fill("Bank returned the ACH debit")
  await drawer.getByTestId("fail-confirm").click()
  await expect(drawer.getByTestId("payment-failure")).toHaveText("Bank returned the ACH debit")
  await page.keyboard.press("Escape")
  await expect(paymentRow(page, id)).toHaveCount(0)
  await page.getByTestId("tab-failed").click()
  await expect(paymentRow(page, id).getByTestId("payment-detail")).toHaveText("Bank returned the ACH debit")
  await shot(page, "payments-failed")
})

test("bulk Settle: the bar sums the selection, the dialog states the cents, the bar reports the result", async ({ page }) => {
  await page.goto("/finance/payments")
  const rows = page.getByTestId("payment-row")
  const count = await rows.count()
  test.skip(count < 2, "fewer than two payments left to settle")
  const ids = [(await rows.nth(0).getAttribute("data-payment-id"))!, (await rows.nth(1).getAttribute("data-payment-id"))!]
  for (const index of [0, 1]) {
    await rows.nth(index).hover()
    await rows.nth(index).getByTestId("payment-select").click()
  }
  const bar = page.getByTestId("settle-bar")
  await expect(bar).toContainText("2 payments selected")
  await expect(bar.getByTestId("settle-selected")).toHaveText(/^Settle 2 · \$[\d,]+$/)
  await shot(page, "payments-bulk-bar")
  await bar.getByTestId("settle-selected").click()
  const dialog = page.getByTestId("bulk-settle-dialog")
  await expect(dialog.getByRole("heading")).toHaveText("Settle 2 payments?")
  await expect(dialog.getByTestId("action-confirm")).toHaveText(/^Settle \$[\d,]+\.\d{2}$/)
  await dialog.getByTestId("action-confirm").click()
  await expect(bar.getByTestId("bulk-outcome")).toContainText(/Settled 2 payments · \$[\d,]+\.\d{2}/)
  for (const id of ids) await expect(paymentRow(page, id)).toHaveCount(0)
  await bar.getByTestId("bulk-done").click()
  await expect(bar).toHaveCount(0)
  await read(page, (db) => {
    for (const id of ids) expect(one<{ status: string }>(db, "select status from payments where id = ?", id)?.status).toBe("succeeded")
  })
})

test("Mark as paid records an unpaid deposit paid outside the product", async ({ page }) => {
  const deposit = await read(page, (db) =>
    one<{ invoiceId: string; number: string; caseId: string }>(
      db,
      `select i.id invoiceId, i.number number, c.id caseId from invoices i join onboarding_cases c on c.hire_request_id = i.hire_id
        join tasks t on t.case_id = c.id and t.key = 'pay_deposit' and t.status = 'ready'
       where i.kind = 'deposit' and i.status = 'open' and c.lifecycle = 'open'
         and not exists (select 1 from payment_allocations a join payments p on p.id = a.payment_id where a.invoice_id = i.id and p.status = 'initiated')
       order by i.number limit 1`,
    ),
  )
  expect(deposit, "an unpaid deposit whose client has not paid").toBeTruthy()

  await page.goto(`/finance/invoices?kind=deposit&status=due&q=${deposit!.number}`)
  await expect(page.locator(`[data-testid=invoice-row][data-invoice-id="${deposit!.invoiceId}"]`)).toBeVisible()
  await page.goto(`/finance/invoices?open=${encodeURIComponent(deposit!.invoiceId)}`)
  const drawer = page.getByTestId("invoice-drawer")
  await expect(drawer.getByTestId("drawer-client")).not.toBeEmpty()
  await shot(page, "invoice-drawer-mark-paid")
  await drawer.getByTestId("mark-paid").click()
  const dialog = page.getByTestId("mark-paid-dialog")
  await expect(dialog.getByRole("heading")).toHaveText(`Mark ${deposit!.number} as paid?`)
  await expect(dialog).toContainText("Use this when the client paid outside the product.")
  await dialog.getByTestId("action-confirm").click()
  await expect(drawer.getByTestId("drawer-header")).toContainText("Paid")
  await expect(drawer.getByTestId("mark-paid")).toHaveCount(0)
  await read(page, (db) => {
    const settled = one<{ n: number }>(
      db,
      "select count(*) n from payment_allocations a join payments p on p.id = a.payment_id where a.invoice_id = ? and p.status = 'succeeded'",
      deposit!.invoiceId,
    )
    expect(settled?.n).toBe(1)
    expect(taskStatuses(db, deposit!.caseId, "pay_deposit").at(-1)).toBe("done")
  })
})

test("an overdue payroll invoice has no Mark as paid; voiding it needs a reason and hides it from the default list", async ({ page }) => {
  await page.goto("/finance/invoices?status=overdue&kind=payroll")
  const first = page.getByTestId("invoice-row").first()
  const number = (await first.getByTestId("invoice-number").innerText()).trim()
  await first.getByTestId("invoice-open").click()
  const drawer = page.getByTestId("invoice-drawer")
  await expect(drawer.getByTestId("drawer-number")).toHaveText(number)
  await expect(drawer.getByTestId("mark-paid")).toHaveCount(0)
  await expect(drawer.getByTestId("drawer-pdf")).toHaveAttribute("aria-label", "Download PDF")
  await shot(page, "invoice-drawer-overdue")

  await drawer.getByTestId("invoice-more").click()
  await expect(page.getByTestId("void-invoice")).toHaveText("Void invoice")
  await shot(page, "invoice-drawer-more-menu")
  await page.getByTestId("void-invoice").click()
  const dialog = page.getByTestId("void-dialog")
  await expect(dialog.getByRole("heading")).toHaveText(`Void ${number}?`)
  await dialog.getByTestId("action-confirm").click()
  await expect(dialog.getByTestId("reason-error")).toBeVisible()
  await dialog.getByTestId("reason-input").fill("Billed in error: wrong start date")
  await dialog.getByTestId("action-confirm").click()

  await expect(drawer.getByTestId("drawer-header")).toContainText("Void")
  await expect(drawer.getByTestId("invoice-more")).toHaveCount(0)
  await expect(drawer.getByTestId("drawer-history")).toContainText("Billed in error: wrong start date")
  await read(page, (db) => {
    expect(one<{ status: string; void_reason: string }>(db, "select status, void_reason from invoices where number = ?", number)).toEqual({
      status: "void",
      void_reason: "Billed in error: wrong start date",
    })
  })

  await page.goto(`/finance/invoices?q=${encodeURIComponent(number)}`)
  await expect(page.getByTestId("no-invoices")).toBeVisible()
  await page.goto(`/finance/invoices?q=${encodeURIComponent(number)}&status=void`)
  await expect(page.getByTestId("invoice-row")).toHaveCount(1)
})

const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

test("Invoices is a table, newest first, with the exact summary and no sort", async ({ page }) => {
  await page.goto("/finance/invoices?sort=amount")
  const { count, total } = await read(page, (db) =>
    one<{ count: number; total: number }>(db, "select count(*) count, sum(total_cents) total from invoices where status != 'void'")!,
  )
  await expect(page.getByTestId("invoice-summary")).toHaveText(
    new RegExp(`^${count.toLocaleString("en-US")} invoices · \\${dollars(total)} total · \\$[\\d,]+\\.\\d{2} outstanding$`),
  )
  await expect(page.getByTestId("invoice-sort")).toHaveCount(0)
  await expect(page.getByText("Sort", { exact: true })).toHaveCount(0)

  const table = page.getByRole("table", { name: "Invoices" })
  await expect(table.getByRole("columnheader")).toHaveText(["Invoice", "Person", "Client", "Due", "Status", "Amount"])
  const rows = page.getByTestId("invoice-row")
  await expect(rows).toHaveCount(10)
  const numbers = (await rows.getByTestId("invoice-number").allInnerTexts()).map((text) => text.trim())
  const newest = await read(page, (db) =>
    (db.prepare("select number from invoices where status != 'void' order by issue_date desc, number desc limit 10").all() as { number: string }[]).map(
      (row) => row.number,
    ),
  )
  expect(numbers).toEqual(newest)
  for (const text of await rows.getByTestId("invoice-due").allInnerTexts()) expect(text.trim()).toMatch(/^[A-Z][a-z]{2} \d{1,2}(, \d{4})?$/)
  for (const text of await rows.allInnerTexts()) expect(text).not.toMatch(/\bDue\b|Deposit|Payroll/)
  for (const height of await rows.evaluateAll((trs) => trs.map((tr) => tr.getBoundingClientRect().height))) expect(height).toBeLessThan(50)

  // The whole row is the link: its stretched area covers the amount, so a click there opens the drawer.
  await rows.first().getByTestId("invoice-amount").click({ force: true })
  await expect(page.getByTestId("invoice-drawer").getByTestId("drawer-number")).toHaveText(numbers[0])
  await page.keyboard.press("Escape")
  await expect(page).toHaveURL("/finance/invoices?sort=amount")
  await page.getByTestId("status-filter").click()
  await page.getByRole("option", { name: "Paid", exact: true }).click()
  await expect(page).toHaveURL("/finance/invoices?status=paid")
})

test("an old ?company=…&status=due link filters to that client's unpaid invoices", async ({ page }) => {
  const client = await read(page, (db) =>
    one<{ id: string; name: string }>(
      db,
      "select co.id id, co.name name from client_companies co join invoices i on i.company_id = co.id where i.status = 'open' group by co.id order by count(*) desc limit 1",
    )!,
  )
  await page.goto(`/finance/invoices?company=${client.id}&status=due`)
  await expect(page.getByTestId("status-filter")).toContainText("Unpaid")
  await expect(page.getByTestId("client-filter")).toContainText(client.name)
  await expect(page.getByTestId("filter-chip")).toHaveText(["Unpaid", client.name])
  const statuses = await page.getByTestId("invoice-row").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-status")))
  expect(statuses.length).toBeGreaterThan(0)
  for (const status of statuses) expect(["open", "overdue"]).toContain(status)
  for (const name of await page.getByTestId("invoice-client").allInnerTexts()) expect(name.trim()).toBe(client.name)
  const open = page.locator("[data-testid=invoice-row][data-status=open]").first()
  if (await open.count()) await expect(open.getByTestId("invoice-status")).toHaveText("Unpaid")
})

test("Invoices filters: Status, Client, the More popover, chips and Clear, all in the URL", async ({ page }) => {
  await page.goto("/finance/invoices")
  await expect(page.getByTestId("invoice-summary")).toHaveText(/^[\d,]+ invoices · \$[\d,]+\.\d{2} total · \$[\d,]+\.\d{2} outstanding$/)
  await expect(page.getByTestId("filter-chips")).toHaveCount(0)

  await page.getByTestId("status-filter").click()
  await page.getByRole("option", { name: "Overdue", exact: true }).click()
  await expect(page).toHaveURL(/status=overdue/)
  await expect(page.getByTestId("filter-chip")).toHaveText(["Overdue"])
  for (const status of await page.getByTestId("invoice-row").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-status")))) {
    expect(status).toBe("overdue")
  }

  await page.getByTestId("more-filters").click()
  const popover = page.getByTestId("more-filters-popover")
  await expect(popover).toBeVisible()
  await popover.getByTestId("kind-filter").click()
  await page.getByRole("option", { name: "Payroll", exact: true }).click()
  await expect(page).toHaveURL(/kind=payroll/)
  await expect(page.getByTestId("more-filters")).toContainText("(1)")
  await shot(page, "invoices-more-popover")
  await page.keyboard.press("Escape")
  await expect(page.getByTestId("filter-chip")).toHaveText(["Overdue", "Payroll"])
  for (const kind of await page.getByTestId("invoice-row").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-kind")))) {
    expect(kind).toBe("payroll")
  }
  await shot(page, "invoices-chips")

  await page.locator("[data-testid=filter-chip][data-chip=status]").getByTestId("filter-chip-remove").click()
  await expect(page).not.toHaveURL(/status=/)
  await expect(page.getByTestId("filter-chip")).toHaveText(["Payroll"])

  const client = (await page.getByTestId("invoice-client").first().innerText()).trim()
  await page.getByTestId("client-filter").click()
  await page.getByRole("option", { name: client, exact: true }).click()
  await expect(page).toHaveURL(/client=/)
  await expect(page.getByTestId("filter-chip")).toHaveText([client, "Payroll"])
  for (const name of await page.getByTestId("invoice-client").allInnerTexts()) expect(name.trim()).toBe(client)

  await page.getByTestId("clear-filters").click()
  await expect(page).toHaveURL("/finance/invoices")
  await expect(page.getByTestId("filter-chips")).toHaveCount(0)
  await expect(page.locator("[data-testid=invoice-row][data-status=void]")).toHaveCount(0)
})

test("the invoice drawer steps through the filtered list, opens a payment with Back, and closing drops ?open=", async ({ page }) => {
  await page.goto("/finance/invoices?status=paid")
  const rows = page.getByTestId("invoice-row")
  const second = (await rows.nth(1).getByTestId("invoice-number").innerText()).trim()
  await rows.first().getByTestId("invoice-open").click()
  const drawer = page.getByTestId("invoice-drawer")
  await drawer.getByRole("button", { name: "Next invoice" }).click()
  await expect(drawer.getByTestId("drawer-number")).toHaveText(second)
  await drawer.getByRole("button", { name: "Previous invoice" }).click()

  const payment = drawer.getByTestId("drawer-payment-open").first()
  await payment.click()
  const paymentDrawer = page.getByTestId("payment-drawer")
  await expect(paymentDrawer.getByTestId("payment-reference")).not.toBeEmpty()
  await paymentDrawer.getByTestId("drawer-back").click()
  await expect(page.getByTestId("invoice-drawer").getByTestId("drawer-history")).toBeVisible()

  const href = await rows.first().getByTestId("invoice-open").getAttribute("href")
  expect(href).toMatch(/^\/finance\/invoices\?status=paid&open=/)
  await page.goto(href!)
  await expect(page.getByTestId("invoice-drawer")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page).toHaveURL("/finance/invoices?status=paid")
})

test("Payments search and client filter narrow the tab and Clear resets them", async ({ page }) => {
  await page.goto("/finance/payments?tab=settled")
  const client = (await page.getByTestId("payment-client").first().innerText()).trim()
  await page.getByTestId("payment-client-filter").click()
  await page.getByRole("option", { name: client, exact: true }).click()
  await expect(page).toHaveURL(/client=/)
  for (const name of await page.getByTestId("payment-client").allInnerTexts()) expect(name.trim()).toBe(client)
  await page.getByTestId("clear-filters").click()
  await expect(page).toHaveURL("/finance/payments?tab=settled")
  await page.getByTestId("payment-search").fill("no client is called this")
  await expect(page).toHaveURL(/q=no/)
  await expect(page.getByTestId("no-payments")).toContainText("No payments match these filters.")
})

test("an invoice downloads as a PDF through the Finance route", async ({ page, request }) => {
  await page.goto("/finance/invoices")
  await page.getByTestId("invoice-open").first().click()
  const link = page.getByTestId("invoice-drawer").getByTestId("drawer-pdf")
  await expect(link).toHaveAttribute("href", /\/pdf$/)
  const response = await page.request.get((await link.getAttribute("href"))!)
  expect(response.status()).toBe(200)
  expect(response.headers()["content-type"]).toBe("application/pdf")
  expect((await response.body()).subarray(0, 4).toString()).toBe("%PDF")
  const anonymous = await request.get((await link.getAttribute("href"))!, { maxRedirects: 0 })
  expect([401, 403, 307]).toContain(anonymous.status())
})

test("billing run: preview, run, and a second press issues nothing", async ({ page, context }) => {
  await page.goto("/finance/billing")
  await expect(page.getByTestId("would-issue-summary")).toBeVisible()
  const database = await openLiveDb(page)
  const count = () => one<{ n: number }>(database, "select count(*) n from invoices")!.n
  const slips = () => one<{ n: number }>(database, "select count(*) n from payroll_entries")!.n
  const before = count()
  const slipsBefore = slips()
  const button = page.getByTestId("run-billing")
  const nothing = /^Nothing to issue\. Everything due as of .+ is already billed\.$/

  // The seed bills through today, so on a fresh copy there is nothing due and the button is off.
  if (await button.isDisabled()) {
    await expect(button).toHaveText("Run billing")
    await expect(page.getByTestId("would-issue-summary")).toHaveText(nothing)
    expect(count()).toBe(before)
    database.close()
    return
  }

  const due = Number(/^Run billing · (\d+) invoices?$/.exec((await button.innerText()).trim())?.[1])
  expect(due).toBeGreaterThan(0)
  // A tab opened before the run keeps the old preview: its press is the second press.
  const stale = await context.newPage()
  await stale.goto("/finance/billing")
  await expect(stale.getByTestId("run-billing")).toBeEnabled()

  await button.click()
  const result = page.getByTestId("run-result-text")
  await expect(result).toHaveText(new RegExp(`^Issued ${due} invoices? totalling `))
  await shot(page, "billing-result")
  expect(count()).toBe(before + due)
  expect(slips()).toBeGreaterThan(slipsBefore)
  await expect(button).toBeDisabled()

  await stale.getByTestId("run-billing").click()
  await expect(stale.getByTestId("run-result-text")).toHaveText(nothing)
  expect(count()).toBe(before + due)
  await stale.close()
  await page.reload()
  await expect(page.getByTestId("would-issue-summary")).toHaveText(nothing)
  database.close()
})

test("a client on Receivables filters its unpaid invoices, each opening in the Invoices drawer", async ({ page }) => {
  await page.goto("/finance/receivables")
  const row = page.getByTestId("by-client").locator("a[data-testid=bar-list-row]").first()
  const companyId = await row.getAttribute("data-key")
  await row.click()
  await expect(page).toHaveURL(`/finance/receivables?client=${companyId}`)
  const table = page.getByTestId("receivables-table")
  await expect(table.getByTestId("invoice-row").first()).toBeVisible()
  const name = await row.getByTestId("bar-list-label").innerText()
  for (const client of await table.getByTestId("invoice-client").allInnerTexts()) expect(client.trim()).toBe(name.trim())
  await shot(page, "receivables-drilldown")
  const number = await table.getByTestId("invoice-number").first().innerText()
  await table.getByTestId("invoice-open").first().click()
  await expect(page).toHaveURL(/\/finance\/invoices\?open=/)
  await expect(page.getByTestId("invoice-drawer").getByTestId("drawer-number")).toHaveText(number)
})
