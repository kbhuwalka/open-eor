import { test, expect, type Page } from "@playwright/test"

import { formatCents } from "@/lib/format"
import { invoiceDrawerHref } from "@/lib/invoice-links"

import { cents, download, openLiveDb, pdfText, signInAs } from "./support/live"

/**
 * The client invoice drawer (docs/client-finance.md §2a): opened from the Invoices list, from a deep
 * link (`/client/finance?open=<id>`, any of the client's invoices) and from the person Payments tab,
 * against the seeded database (run with DATABASE_FILE pointing at a COPY when the server under test
 * is not the shared dev server). Read-only: nothing here pays or changes an invoice. Signs in as
 * Brightwave's client HR, and as Acme's for the void invoice (Brightwave has none in the seed).
 */

const BRIGHTWAVE_HR = "user_client_hr_2"
const ACME_HR = "user_client_hr"

const board = (page: Page) => page.getByTestId("tabpanel-invoices")
const drawer = (page: Page) => page.getByTestId("invoice-drawer")

async function openFinance(page: Page, baseURL: string, userId = BRIGHTWAVE_HR) {
  await signInAs(page.context(), baseURL, userId)
  await page.goto("/client/finance")
  await expect(page.getByTestId("finance-summary")).toBeVisible()
  await expect(board(page).getByTestId("invoice-row").first()).toBeVisible()
}

async function openLinked(page: Page, baseURL: string, invoiceId: string, userId = BRIGHTWAVE_HR) {
  await signInAs(page.context(), baseURL, userId)
  await page.goto(invoiceDrawerHref(invoiceId))
  await expect(drawer(page)).toBeVisible()
  await expect(drawer(page).getByTestId("drawer-lines")).toBeVisible()
}

/** Every line amount in the drawer, in order. */
async function lineAmounts(page: Page): Promise<number[]> {
  return (await drawer(page).getByTestId("drawer-line-amount").allTextContents()).map((text) => cents(text))
}

/** Every stored line code of the invoice, in order: the drawer and the PDF must show each as its own row. */
function storedLines(invoiceId: string, page: Page) {
  return openLiveDb(page).then((db) => {
    const rows = db
      .prepare("select code, description, amount_cents amountCents from invoice_lines where invoice_id = ? order by position")
      .all(invoiceId) as { code: string; description: string; amountCents: number }[]
    const total = (db.prepare("select total_cents totalCents from invoices where id = ?").get(invoiceId) as { totalCents: number }).totalCents
    db.close()
    return { rows, total }
  })
}

const flat = (text: string) => text.replace(/[\u2013\u2014]/g, "-").replace(/\s+/g, " ")

test("opens from the list: who it is for, the period, grouped lines, a total equal to the row, and a PDF with the same facts", async ({ page, baseURL }) => {
  await openFinance(page, baseURL!)
  const row = board(page).locator("[data-testid=invoice-row][data-status=open], [data-testid=invoice-row][data-status=overdue]").filter({ hasText: "Payroll" }).first()
  const number = (await row.getByTestId("invoice-open").textContent())!.trim()
  const amount = cents(await row.locator("[data-slot=money]").textContent())
  const person = (await row.getByTestId("invoice-person").locator("span").first().textContent())!.trim()

  await row.getByTestId("invoice-open").click()
  const panel = drawer(page)
  await expect(panel.getByTestId("drawer-number")).toHaveText(number)
  await expect(panel.getByTestId("drawer-header")).toContainText("Payroll invoice")
  await expect(panel.getByTestId("drawer-person")).toContainText(person)
  await expect(panel.getByTestId("drawer-period")).toContainText(/\d{4}/)
  await expect(panel.getByTestId("drawer-facts")).toContainText("Pay date")
  await expect(panel.getByTestId("drawer-facts")).not.toContainText("Terms")
  await expect(panel).not.toContainText("Please pay")
  await expect(panel).not.toContainText(/view full invoice/i)

  const groups = await panel.getByTestId("drawer-group").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-group")))
  expect(groups).toEqual(expect.arrayContaining(["wage", "statutory", "service_fee"]))
  expect(await panel.getByTestId("drawer-line").count()).toBeGreaterThan(4)
  expect(await panel.getByTestId("drawer-lines").textContent()).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  expect((await lineAmounts(page)).reduce((total, value) => total + value, 0)).toBe(amount)
  expect(cents(await panel.getByTestId("drawer-total").textContent())).toBe(amount)
  expect(cents(await panel.getByTestId("drawer-due").textContent())).toBe(amount)

  const actions = panel.getByTestId("drawer-actions")
  await expect(actions.locator("> *").first()).toHaveText(`Pay ${formatCents(amount)}`)
  await expect(actions.getByRole("link", { name: "Download PDF" })).toBeVisible()
  await expect(page.getByRole("button", { name: /close/i })).toHaveCount(1)

  const pdf = await download(page.request, (await panel.getByTestId("drawer-pdf").getAttribute("href"))!)
  expect(pdf.response.status()).toBe(200)
  expect(pdf.response.headers()["content-type"]).toBe("application/pdf")
  expect(pdf.response.headers()["content-disposition"]).toBe(`attachment; filename="${number}.pdf"`)
  const printed = flat(await pdfText(pdf.bytes))
  expect(printed).toContain(number)
  expect(printed).toContain(person)
  expect(printed).not.toContain("Terms")
  expect(printed).not.toContain("Please pay")
  for (const title of await panel.locator("[data-testid=drawer-line] > div > span:first-child").allTextContents()) {
    expect(printed, title).toContain(flat(title))
  }
  for (const value of await lineAmounts(page)) expect(printed).toContain(formatCents(value))
  expect(printed).toContain(`Total ${formatCents(amount)}`)

  await page.keyboard.press("Escape")
  await expect(drawer(page)).toHaveCount(0)
  await expect(page).toHaveURL(/\/client\/finance$/)
})

test("a deep link opens a paid payroll invoice: every stored line is its own row, no amount due, its payment, no Pay", async ({ page, baseURL }) => {
  const db = await openLiveDb(page)
  const paid = db
    .prepare(
      `select i.id, i.number from invoices i
       where i.company_id = 'client_2' and i.kind = 'payroll' and i.status <> 'void'
         and exists (select 1 from payment_allocations a join payments p on p.id = a.payment_id
                     where a.invoice_id = i.id and p.status = 'succeeded')
       order by i.period_index desc limit 1`,
    )
    .get() as { id: string; number: string }
  db.close()
  const stored = await storedLines(paid.id, page)
  expect(stored.rows.length).toBeGreaterThan(4)
  expect(stored.rows.reduce((total, line) => total + line.amountCents, 0)).toBe(stored.total)

  await openLinked(page, baseURL!, paid.id)
  const panel = drawer(page)
  await expect(panel.getByTestId("drawer-number")).toHaveText(paid.number)
  await expect(panel.getByTestId("drawer-header")).toContainText("Paid")
  await expect(panel.getByTestId("drawer-paid-date")).toBeVisible()
  await expect(page.getByTestId("tab-payments")).toHaveAttribute("aria-selected", "true")
  const codes = await panel.getByTestId("drawer-line").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-code")))
  expect([...codes].sort()).toEqual(stored.rows.map((line) => line.code).sort())
  expect(new Set(codes).size).toBe(codes.length)
  const amounts = await lineAmounts(page)
  for (const line of stored.rows) expect(amounts[codes.indexOf(line.code)], line.code).toBe(line.amountCents)
  expect(cents(await panel.getByTestId("drawer-total").textContent())).toBe(stored.total)
  await expect(panel.getByTestId("drawer-due")).toHaveCount(0)
  await expect(panel.getByTestId("drawer-payment").first()).toContainText("Settled")
  await expect(panel.getByTestId("drawer-pay")).toHaveCount(0)
  await expect(panel.getByTestId("drawer-stepper")).toHaveCount(0)

  const pdf = await download(page.request, (await panel.getByTestId("drawer-pdf").getAttribute("href"))!)
  const printed = flat(await pdfText(pdf.bytes))
  for (const value of stored.rows.map((line) => line.amountCents)) expect(printed).toContain(formatCents(value))
  expect(printed).toContain(`Total ${formatCents(stored.total)}`)

  await page.getByRole("button", { name: /close/i }).click()
  await expect(drawer(page)).toHaveCount(0)
  await expect(page).toHaveURL(/\/client\/finance$/)
})

test("a deposit invoice itemises its components under one subhead, with no repeated subtotal or pay period, for the person it covers", async ({ page, baseURL }) => {
  const db = await openLiveDb(page)
  const deposit = db
    .prepare(
      `select i.id, i.number, i.total_cents totalCents from invoices i
       where i.company_id = 'client_2' and i.kind = 'deposit' and i.status <> 'void'
         and (select count(*) from invoice_lines l where l.invoice_id = i.id) > 1
       limit 1`,
    )
    .get() as { id: string; number: string; totalCents: number }
  db.close()
  const amount = deposit.totalCents
  await openLinked(page, baseURL!, deposit.id)
  const panel = drawer(page)
  await expect(panel.getByTestId("drawer-number")).toHaveText(deposit.number)
  await expect(panel.getByTestId("drawer-header")).toContainText("Deposit invoice")
  await expect(panel.getByTestId("drawer-period")).toHaveText("Deposit")
  await expect(panel.getByTestId("drawer-facts")).not.toContainText("Pay date")
  const person = (await panel.getByTestId("drawer-person").locator("span").first().textContent())!.trim()
  expect(person.length).toBeGreaterThan(0)
  await expect(panel.getByTestId("drawer-group")).toHaveCount(1)
  await expect(panel.getByTestId("drawer-lines")).toContainText("Security deposit")
  await expect(panel.getByTestId("drawer-subtotal")).toHaveCount(0)
  expect(cents(await panel.getByTestId("drawer-total").textContent())).toBe(amount)

  const stored = await storedLines(deposit.id, page)
  expect(stored.rows.length).toBeGreaterThan(1)
  const codes = await panel.getByTestId("drawer-line").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-code")))
  expect(codes).toEqual(stored.rows.map((line) => line.code))
  expect(await lineAmounts(page)).toEqual(stored.rows.map((line) => line.amountCents))

  const pdf = await download(page.request, (await panel.getByTestId("drawer-pdf").getAttribute("href"))!)
  const printed = flat(await pdfText(pdf.bytes))
  expect(printed).toContain(person)
  expect(printed).toContain("Security deposit")
  for (const line of stored.rows) expect(printed).toContain(formatCents(line.amountCents))
  expect(printed).toContain(`Total ${formatCents(amount)}`)
})

test("an overdue invoice says Overdue once, in the header, steps through the unpaid list and offers Pay (without paying)", async ({ page, baseURL }) => {
  await openFinance(page, baseURL!)
  const overdue = board(page).locator("[data-testid=invoice-row][data-status=overdue]").first()
  test.skip((await overdue.count()) === 0, "the seeded database has no overdue invoice for this client")
  const amount = cents(await overdue.locator("[data-slot=money]").textContent())
  await overdue.getByTestId("invoice-open").click()
  const panel = drawer(page)
  await expect(panel.getByTestId("drawer-header")).toContainText("Overdue")
  await expect(panel.getByTestId("drawer-lines")).toBeVisible()
  await expect(panel.getByTestId("drawer-scroll")).not.toContainText("Overdue")
  await expect(panel.getByTestId("drawer-position")).toHaveText(/^\d+ of \d+$/)

  await panel.getByTestId("drawer-pay").click()
  await expect(drawer(page)).toHaveCount(0)
  expect(cents(await page.getByTestId("pay-total").textContent())).toBe(amount)
  await expect(page.getByTestId("pay-method")).toHaveText(/^ACH ••\d{4}/)
  await page.keyboard.press("Escape")
  await expect(page.getByTestId("pay-total")).toHaveCount(0)
})

test("a void invoice says why, and what was due, with no Pay", async ({ page, baseURL }) => {
  const db = await openLiveDb(page)
  const voided = db.prepare("select id, total_cents totalCents from invoices where company_id = 'client_1' and status = 'void' limit 1").get() as
    | { id: string; totalCents: number }
    | undefined
  db.close()
  test.skip(!voided, "the seeded database has no void invoice for Acme")
  await openLinked(page, baseURL!, voided!.id, ACME_HR)
  const panel = drawer(page)
  await expect(panel.getByTestId("drawer-header")).toContainText("Void")
  await expect(panel.getByTestId("drawer-void-reason")).not.toBeEmpty()
  await expect(panel.getByTestId("drawer-totals")).toContainText("Amount due (void)")
  expect(cents(await panel.getByTestId("drawer-total").textContent())).toBe(voided!.totalCents)
  await expect(panel.getByTestId("drawer-pay")).toHaveCount(0)
})

test("the person's Payments tab opens each invoice in the same drawer, links it to Finance, and labels the period", async ({ page, baseURL }) => {
  const db = await openLiveDb(page)
  const person = db
    .prepare(
      `select c.id caseId from invoices d join onboarding_cases c on c.hire_request_id = d.hire_id
       where d.kind = 'deposit' and d.company_id = 'client_2'
         and exists (select 1 from invoices p where p.hire_id = d.hire_id and p.kind = 'payroll')
       limit 1`,
    )
    .get() as { caseId: string }
  db.close()
  await signInAs(page.context(), baseURL!, BRIGHTWAVE_HR)
  await page.goto(`/client/people/${person.caseId}`)
  await page.getByRole("tab", { name: "Payments" }).click()
  const tab = page.getByTestId("person-payments")
  await expect(tab).toBeVisible()
  const periods = await tab.getByTestId("person-invoice-period").allTextContents()
  expect(periods).toContain("Deposit")
  expect(periods.filter((text) => /\d{4}/.test(text)).length).toBeGreaterThan(0)
  await expect(tab).not.toContainText("Pay invoices, see payment history")

  const first = tab.getByTestId("person-invoice-open").nth(1)
  const href = (await first.getAttribute("href"))!
  expect(href).toMatch(/^\/client\/finance\?open=.+/)
  await expect(first).not.toHaveAttribute("target", "_blank")
  const number = (await first.locator("span").first().textContent())!.trim()
  await first.click()
  await expect(drawer(page).getByTestId("drawer-number")).toHaveText(number)
  await expect(drawer(page).getByTestId("drawer-position")).toHaveText(/^2 of \d+$/)
  await expect(page).toHaveURL(new RegExp(`/client/people/${person.caseId}`))
  await page.keyboard.press("Escape")
  await expect(drawer(page)).toHaveCount(0)

  await page.goto(href)
  await expect(drawer(page).getByTestId("drawer-number")).toHaveText(number)
})

test("a deep link to another company's invoice, or an unknown id, opens nothing; the owner's opens it", async ({ page, baseURL }) => {
  const db = await openLiveDb(page)
  const theirs = db.prepare("select id, number from invoices where company_id = 'client_1' and kind = 'payroll' limit 1").get() as {
    id: string
    number: string
  }
  db.close()

  await openFinance(page, baseURL!)
  await page.goto(invoiceDrawerHref(theirs.id))
  await expect(board(page).getByTestId("invoice-row").first()).toBeVisible()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await expect(page.locator("body")).not.toContainText(theirs.number)
  await page.goto(invoiceDrawerHref("payroll:no-such-hire:1"))
  await expect(board(page).getByTestId("invoice-row").first()).toBeVisible()
  await expect(page.getByRole("dialog")).toHaveCount(0)

  await page.context().clearCookies()
  await openLinked(page, baseURL!, theirs.id, ACME_HR)
  await expect(drawer(page).getByTestId("drawer-number")).toHaveText(theirs.number)
})

test("the old invoice page is gone; its PDF route stays", async ({ page, baseURL }) => {
  const db = await openLiveDb(page)
  const own = db.prepare("select id from invoices where company_id = 'client_2' and kind = 'payroll' limit 1").get() as { id: string }
  db.close()
  await signInAs(page.context(), baseURL!, BRIGHTWAVE_HR)
  const old = await page.goto(`/client/finance/invoices/${encodeURIComponent(own.id)}`)
  expect(old!.status()).toBe(404)
  const pdf = await download(page.request, `/client/finance/invoices/${encodeURIComponent(own.id)}/pdf`)
  expect(pdf.response.status()).toBe(200)
})
