import Database from "better-sqlite3"
import { test, expect, type Page } from "@playwright/test"

import { openLiveDb, signInAs } from "./support/live"

/**
 * The Finance portal on the real pages, as Morgan Reyes (Finance): settle a payment the client
 * started (a deposit one, which must also complete the onboarding step), confirm a deposit or mark it
 * not received, run
 * billing twice and void an invoice. It WRITES, so run it against a COPY of the seeded database:
 *
 *   cp data/eor.sqlite /tmp/finance-copy.sqlite
 *   DATABASE_FILE=/tmp/finance-copy.sqlite pnpm dev -p 3120
 *   PLAYWRIGHT_BASE_URL=http://localhost:3120 DATABASE_FILE=/tmp/finance-copy.sqlite pnpm exec playwright test e2e/finance-portal.spec.ts
 *
 * Screenshots go to SHOT_DIR when it is set (light and dark with E2E_THEME=dark).
 */
test.skip(!process.env.DATABASE_FILE, "DATABASE_FILE (the database copy the server uses) is required: this spec writes")
test.describe.configure({ mode: "serial" })

async function shot(page: Page, name: string) {
  const dir = process.env.SHOT_DIR
  if (!dir) return
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${dir}/${process.env.SHOT_PREFIX ?? "light"}-e2e-${name}.png` })
}

async function db(page: Page): Promise<Database.Database> {
  return openLiveDb(page)
}

function one<T>(database: Database.Database, sql: string, ...args: unknown[]): T | undefined {
  return database.prepare(sql).get(...args) as T | undefined
}

test.beforeEach(async ({ context, baseURL, page }) => {
  if (process.env.E2E_THEME) await context.addCookies([{ name: "eor_theme", value: process.env.E2E_THEME, url: baseURL! }])
  await page.goto("/pick")
  await page.getByRole("button", { name: /Morgan Reyes/ }).click()
  await page.waitForURL(/\/finance/)
})

test("the nav lists every Finance page", async ({ page }) => {
  const nav = page.getByRole("navigation")
  for (const label of ["Home", "Payments", "Deposits", "Invoices", "Receivables", "Billing run"]) {
    await expect(nav.getByRole("link", { name: new RegExp(`^${label}`) })).toBeVisible()
  }
})

test("other roles never see a Finance page or its PDF", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL })
  const page = await context.newPage()
  try {
    await page.goto("/pick")
    await page.getByRole("button", { name: /Alex Harper/ }).click()
    await page.waitForURL(/\/client/)
    for (const path of ["/finance/payments", "/finance/deposits", "/finance/invoices", "/finance/receivables", "/finance/billing"]) {
      await page.goto(path)
      await expect(page.getByRole("heading", { name: /Payments|Deposits|Invoices|Receivables|Billing run/ })).toHaveCount(0)
      await expect(page).not.toHaveURL(new RegExp(`${path}$`))
    }
    const pdf = await page.request.get("/finance/invoices/deposit%3Ahire_1/pdf")
    expect([401, 403, 404, 307]).toContain(pdf.status())
    expect(pdf.headers()["content-type"] ?? "").not.toContain("application/pdf")
  } finally {
    await context.close()
  }
})

test("settling a client-initiated deposit payment pays the invoice and completes Confirm deposit", async ({ page }) => {
  const database = await db(page)
  const deposit = one<{ paymentId: string; hireId: string; invoiceId: string; number: string }>(
    database,
    `select p.id paymentId, i.hire_id hireId, i.id invoiceId, i.number number
       from payments p join payment_allocations a on a.payment_id = p.id join invoices i on i.id = a.invoice_id
        join onboarding_cases c on c.hire_request_id = i.hire_id
        join tasks t on t.case_id = c.id and t.key = 'confirm_deposit' and t.status = 'ready'
      where p.status = 'initiated' and i.kind = 'deposit' and c.lifecycle = 'open' limit 1`,
  )
  expect(deposit, "a seeded processing deposit payment").toBeTruthy()
  const taskBefore = one<{ status: string }>(
    database,
    `select t.status status from tasks t join onboarding_cases c on c.id = t.case_id
      where c.hire_request_id = ? and t.key = 'confirm_deposit'`,
    deposit!.hireId,
  )
  expect(taskBefore?.status).toBe("ready")

  await page.goto("/finance/payments")
  await expect(page.getByTestId("payment-tabs")).toBeVisible()
  const initiatedBefore = Number(await page.getByTestId("tab-count-initiated").innerText())
  const row = page.locator(`[data-testid=payment-row][data-payment-id="${deposit!.paymentId}"]`)
  await expect(row).toBeVisible()
  await shot(page, "payments-queue")
  await row.getByTestId("settle-row").click()
  const dialog = page.getByTestId("settle-dialog")
  await expect(dialog).toBeVisible()
  await shot(page, "settle-dialog")
  await dialog.getByTestId("action-confirm").click()

  await expect(row).toHaveCount(0)
  await expect(page.getByTestId("tab-count-initiated")).toHaveText(String(initiatedBefore - 1))

  const verify = await db(page)
  expect(one<{ status: string }>(verify, "select status from payments where id = ?", deposit!.paymentId)?.status).toBe("succeeded")
  const task = one<{ status: string }>(
    verify,
    `select t.status status from tasks t join onboarding_cases c on c.id = t.case_id
      where c.hire_request_id = ? and t.key = 'confirm_deposit'`,
    deposit!.hireId,
  )
  expect(task?.status).toBe("done")

  await page.getByTestId("tab-settled").click()
  await expect(page.locator(`[data-testid=payment-row][data-payment-id="${deposit!.paymentId}"]`)).toBeVisible()
  await page.goto(`/finance/invoices/${encodeURIComponent(deposit!.invoiceId)}`)
  await expect(page.getByTestId("invoice-summary")).toContainText("Paid")
  await expect(page.getByTestId("invoice-history")).toContainText("Payment settled")
  verify.close()
  database.close()
})

test("Mark failed needs a reason, then the payment moves to Failed", async ({ page }) => {
  await page.goto("/finance/payments")
  const row = page.getByTestId("payment-row").first()
  const id = await row.getAttribute("data-payment-id")
  await row.getByTestId("fail-row").click()
  const dialog = page.getByTestId("fail-dialog")
  await dialog.getByTestId("action-confirm").click()
  await expect(dialog.getByTestId("reason-error")).toBeVisible()
  await dialog.getByTestId("reason-input").fill("Bank returned the ACH debit")
  await dialog.getByTestId("action-confirm").click()
  await expect(page.locator(`[data-testid=payment-row][data-payment-id="${id}"]`)).toHaveCount(0)
  await page.getByTestId("tab-failed").click()
  const failed = page.locator(`[data-testid=payment-row][data-payment-id="${id}"]`)
  await expect(failed).toContainText("Bank returned the ACH debit")
})

test("Not received fails the deposit payment: the invoice is payable again for the client and Pay deposit reopens", async ({ page, browser, baseURL }) => {
  await page.goto("/finance/deposits")
  const processing = page.locator("[data-testid=deposit-row][data-state=processing]").filter({ has: page.getByTestId("not-received-deposit") }).first()
  await expect(processing).toBeVisible()
  const caseId = (await processing.getAttribute("data-case-id"))!
  const row = page.locator(`[data-testid=deposit-row][data-case-id="${caseId}"]`)
  const database = await db(page)
  const deposit = one<{ invoiceId: string; number: string; userId: string }>(
    database,
    `select i.id invoiceId, i.number number, u.id userId
       from onboarding_cases c join invoices i on i.hire_id = c.hire_request_id and i.kind = 'deposit'
        join users u on u.client_company_id = i.company_id and u.role = 'client_hr'
      where c.id = ? limit 1`,
    caseId,
  )
  database.close()
  expect(deposit, "the deposit's invoice and its client").toBeTruthy()

  await expect(row.getByRole("button")).toHaveText(["Confirm received", "Not received"])
  await shot(page, "deposits-not-received")
  await row.getByTestId("not-received-deposit").click()
  const dialog = page.getByTestId("not-received-dialog")
  await expect(dialog).toBeVisible()
  await shot(page, "not-received-dialog")
  await dialog.getByTestId("action-confirm").click()

  await expect(row).toHaveAttribute("data-state", "open")
  await expect(row).toContainText("Awaiting payment")
  await expect(row.getByTestId("not-received-deposit")).toHaveCount(0)
  await expect(row.getByTestId("confirm-deposit")).toBeVisible()
  await shot(page, "deposits-awaiting-payment")

  await page.goto("/finance/payments?tab=failed")
  await expect(page.getByTestId("payment-row").filter({ hasText: deposit!.number })).toContainText("Deposit not received")

  const verify = await db(page)
  const steps = verify
    .prepare("select status from tasks where case_id = ? and key = 'pay_deposit' order by seq")
    .all(caseId) as { status: string }[]
  expect(steps.map((step) => step.status)).toEqual(["done", "ready"])
  expect(one<{ status: string }>(verify, "select status from invoices where id = ?", deposit!.invoiceId)?.status).toBe("open")
  verify.close()

  const clientContext = await browser.newContext({ baseURL })
  const clientPage = await clientContext.newPage()
  try {
    await signInAs(clientContext, baseURL!, deposit!.userId)
    await clientPage.goto("/client/finance")
    const invoice = clientPage
      .getByTestId("tabpanel-invoices")
      .locator(`[data-testid=invoice-row][data-invoice-id="${deposit!.invoiceId}"]`)
    await expect(invoice).toBeVisible()
    await expect(invoice).toHaveAttribute("data-status", /^(open|overdue)$/)
    await expect(invoice).toContainText(deposit!.number)
    await clientPage.goto(`/client/people/${caseId}`)
    await expect(clientPage.getByTestId("task-reopen-note").first()).toContainText("Deposit not received")
  } finally {
    await clientContext.close()
  }
})

test("confirming a deposit as received removes it from the deposits list", async ({ page }) => {
  await page.goto("/finance/deposits")
  await expect(page.getByTestId("deposits-table")).toBeVisible()
  const rows = page.getByTestId("deposit-row")
  const before = await rows.count()
  const target = rows.filter({ has: page.getByTestId("confirm-deposit") }).first()
  const caseId = await target.getAttribute("data-case-id")
  const invoiceHref = await target.getByRole("link", { name: /^INV-/ }).getAttribute("href")
  await shot(page, "deposits")
  await target.getByTestId("confirm-deposit").click()
  const dialog = page.getByTestId("confirm-deposit-dialog")
  await expect(dialog).toBeVisible()
  await shot(page, "confirm-deposit-dialog")
  await dialog.getByTestId("action-confirm").click()
  await expect(page.locator(`[data-testid=deposit-row][data-case-id="${caseId}"]`)).toHaveCount(0)
  if (before > 1) await expect(rows).toHaveCount(before - 1)

  await page.goto(invoiceHref!)
  await expect(page.getByTestId("invoice-summary")).toContainText("Paid")
})

test("a deposit with no payment in flight offers Confirm received only", async ({ page }) => {
  await page.goto("/finance/deposits")
  await expect(page.getByTestId("deposits-table")).toBeVisible()
  const row = page.locator("[data-testid=deposit-row][data-state=open]").first()
  await expect(row).toContainText("Awaiting payment")
  await expect(row.getByRole("button")).toHaveCount(1)
  await expect(row.getByRole("button")).toHaveText("Confirm received")
  await expect(row.getByTestId("not-received-deposit")).toHaveCount(0)
})

test("billing run: preview, run, and a second press issues nothing", async ({ page }) => {
  await page.goto("/finance/billing")
  await expect(page.getByTestId("would-issue-summary")).toBeVisible()
  await shot(page, "billing-preview")
  const database = await db(page)
  const count = () => one<{ n: number }>(database, "select count(*) n from invoices")!.n
  const slips = () => one<{ n: number }>(database, "select count(*) n from payroll_entries")!.n
  const before = count()
  const slipsBefore = slips()

  await page.getByTestId("run-billing").click()
  const result = page.getByTestId("run-result-text")
  await expect(result).toBeVisible()
  await shot(page, "billing-result")
  const text = (await result.innerText()).trim()
  const issued = Number(/Issued (\d+) invoice/.exec(text)?.[1] ?? 0)
  expect(text).toMatch(issued > 0 ? /^Issued \d+ invoices?/ : /^Nothing to issue/)
  expect(count()).toBe(before + issued)
  if (issued > 0) expect(slips()).toBeGreaterThan(slipsBefore)

  await page.getByTestId("run-billing").click()
  await expect(result).toContainText("Nothing to issue")
  expect(count()).toBe(before + issued)
  await expect(page.getByTestId("would-issue-summary")).toContainText("Nothing to issue")
  database.close()
})

test("voiding an invoice needs a reason and removes it from the default list", async ({ page }) => {
  await page.goto("/finance/invoices?status=due&kind=payroll")
  const first = page.getByTestId("invoice-row").first()
  const number = (await first.getByTestId("invoice-open").innerText()).trim()
  await first.getByTestId("invoice-open").click()
  await expect(page.getByRole("heading", { name: number })).toBeVisible()
  await shot(page, "invoice-detail")

  await page.getByTestId("void-invoice").click()
  const dialog = page.getByTestId("void-dialog")
  await dialog.getByTestId("action-confirm").click()
  await expect(dialog.getByTestId("reason-error")).toBeVisible()
  await dialog.getByTestId("reason-input").fill("Billed in error: wrong start date")
  await dialog.getByTestId("action-confirm").click()

  await expect(page.getByTestId("void-invoice")).toHaveCount(0)
  await expect(page.getByTestId("invoice-history")).toContainText("Invoice voided")
  await expect(page.getByTestId("invoice-history")).toContainText("Billed in error: wrong start date")
  await shot(page, "invoice-voided")

  const database = await db(page)
  expect(one<{ status: string; void_reason: string }>(database, "select status, void_reason from invoices where number = ?", number)).toEqual({
    status: "void",
    void_reason: "Billed in error: wrong start date",
  })
  database.close()

  await page.goto(`/finance/invoices?q=${encodeURIComponent(number)}`)
  await expect(page.getByTestId("no-invoices")).toBeVisible()
  await page.goto(`/finance/invoices?q=${encodeURIComponent(number)}&status=void`)
  await expect(page.getByTestId("invoice-row")).toHaveCount(1)
})

test("an invoice downloads as a PDF through the Finance route", async ({ page, request }) => {
  await page.goto("/finance/invoices")
  const href = await page.getByTestId("invoice-open").first().getAttribute("href")
  expect(href).toBeTruthy()
  await page.goto(href!)
  const link = page.getByTestId("download-pdf")
  await expect(link).toHaveAttribute("href", /\/pdf$/)
  const response = await page.request.get((await link.getAttribute("href"))!)
  expect(response.status()).toBe(200)
  expect(response.headers()["content-type"]).toBe("application/pdf")
  expect((await response.body()).subarray(0, 4).toString()).toBe("%PDF")
  const anonymous = await request.get((await link.getAttribute("href"))!, { maxRedirects: 0 })
  expect([401, 403, 307]).toContain(anonymous.status())
})

test("receivables show the ageing buckets and drill down to a client's open invoices", async ({ page }) => {
  await page.goto("/finance/receivables")
  await expect(page.getByTestId("receivables-summary")).toBeVisible()
  await page.getByTestId("receivable-open").first().click()
  await expect(page.getByTestId("receivables-drilldown")).toBeVisible()
  await expect(page.getByTestId("drilldown-row").first()).toBeVisible()
  await shot(page, "receivables-drilldown")
})
