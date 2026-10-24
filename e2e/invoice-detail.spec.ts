import { test, expect, type Page } from "@playwright/test"

import { formatCents } from "@/lib/format"

import { cents, download, openLiveDb, pdfText, signInAs } from "./support/live"

/**
 * The full-page invoice at /client/finance/invoices/[id], against the seeded database (run with
 * DATABASE_FILE pointing at a COPY when the server under test is not the shared dev server).
 * Read-only: nothing here pays or changes an invoice. Signs in as Brightwave's client HR.
 */

const BRIGHTWAVE_HR = "user_client_hr_2"
const ACME_HR = "user_client_hr"

const board = (page: Page) => page.getByTestId("tabpanel-invoices")

async function openFinance(page: Page, baseURL: string, userId = BRIGHTWAVE_HR) {
  await signInAs(page.context(), baseURL, userId)
  await page.goto("/client/finance")
  await expect(page.getByTestId("finance-summary")).toBeVisible()
  await expect(board(page).getByTestId("invoice-row").first()).toBeVisible()
}

/** Everything on the page that is an amount, in document order, from each line row. */
async function lineAmounts(page: Page): Promise<number[]> {
  return (await page.getByTestId("invoice-line-amount").allTextContents()).map((text) => cents(text))
}

const invoiceUrl = (id: string) => `/client/finance/invoices/${encodeURIComponent(id)}`

/** Every stored line code of the invoice, in order: the page and the PDF must show each as its own row. */
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

test("opens from the list: who it is for, the period, grouped lines and a total equal to the list row", async ({ page, baseURL }) => {
  await openFinance(page, baseURL!)
  const section = board(page)
  const row = section.locator("[data-testid=invoice-row][data-status=open], [data-testid=invoice-row][data-status=overdue]").filter({ hasText: "Payroll" }).first()
  const number = (await row.getByTestId("invoice-open").textContent())!.trim()
  const amount = cents(await row.locator("[data-slot=money]").textContent())
  const person = (await row.getByTestId("invoice-person").locator("span").first().textContent())!.trim()

  await row.getByTestId("invoice-open").click()
  const period = (await page.getByTestId("drawer-period").locator("span").first().textContent())!.trim()
  expect(period).toMatch(/\d{4}/)
  await page.getByTestId("drawer-full-invoice").click()
  await page.waitForURL(/\/client\/finance\/invoices\/.+/)
  const document = page.getByTestId("invoice-document")
  await expect(document).toBeVisible()

  await expect(page.getByTestId("invoice-number")).toHaveText(number)
  await expect(page.getByTestId("invoice-person-name")).toHaveText(person)
  await expect(page.getByTestId("invoice-period")).toHaveText(period)
  await expect(page.getByTestId("invoice-for")).toContainText("Work location:")
  await expect(page.getByTestId("invoice-for")).not.toContainText("start date")
  await expect(page.getByTestId("invoice-issuer")).toContainText("Northwind")
  await expect(page.getByTestId("invoice-bill-to")).toContainText("Brightwave")
  await expect(document).toContainText("Pay date")
  await expect(document).toContainText("Tax year")
  await expect(document).not.toContainText("Terms")
  await expect(document).not.toContainText("Please pay")

  const groups = await page.getByTestId("invoice-group").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-group")))
  expect(groups).toEqual(expect.arrayContaining(["wage", "statutory", "service_fee"]))
  expect(await page.getByTestId("invoice-line").count()).toBeGreaterThan(4)
  await expect(page.getByTestId("invoice-line-basis").first()).not.toBeEmpty()
  expect(await page.getByTestId("invoice-lines").textContent()).not.toMatch(/\d{4}-\d{2}-\d{2}/)

  expect((await lineAmounts(page)).reduce((total, value) => total + value, 0)).toBe(amount)
  expect(cents(await page.getByTestId("invoice-total").textContent())).toBe(amount)
  expect(cents(await page.getByTestId("invoice-amount-due").textContent())).toBe(amount)
  await expect(page.getByTestId("invoice-pay")).toBeVisible()

  const pdf = await download(page.request, (await page.getByTestId("invoice-pdf").getAttribute("href"))!)
  expect(pdf.response.status()).toBe(200)
  expect(pdf.response.headers()["content-type"]).toBe("application/pdf")
  expect(pdf.response.headers()["content-disposition"]).toBe(`attachment; filename="${number}.pdf"`)
  const printed = flat(await pdfText(pdf.bytes))
  expect(printed).toContain(number)
  expect(printed).toContain(person)
  expect(printed).not.toContain("Terms")
  expect(printed).not.toContain("Please pay")
  expect(printed).not.toContain("start date")
  for (const title of await page.locator("[data-testid=invoice-line] td:first-child > p:first-child").allTextContents()) {
    expect(printed, title).toContain(flat(title))
  }
  for (const value of await lineAmounts(page)) expect(printed).toContain(formatCents(value))
  expect(printed).toContain(`Total ${formatCents(amount)}`)

  await page.getByRole("link", { name: "Back to Finance" }).click()
  await expect(page).toHaveURL(/\/client\/finance$/)
})

test("every stored line of a paid payroll invoice is its own row on the page and in the PDF; a settled invoice reads $0.00 due", async ({ page, baseURL }) => {
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

  await signInAs(page.context(), baseURL!, BRIGHTWAVE_HR)
  await page.goto(invoiceUrl(paid.id))
  await expect(page.getByTestId("invoice-document")).toHaveAttribute("data-status", "paid")
  const codes = await page.getByTestId("invoice-line").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-code")))
  expect([...codes].sort()).toEqual(stored.rows.map((line) => line.code).sort())
  expect(new Set(codes).size).toBe(codes.length)
  const shown = new Map(codes.map((code, index) => [code, 0 + index]))
  const amounts = await lineAmounts(page)
  for (const line of stored.rows) expect(amounts[shown.get(line.code)!], line.code).toBe(line.amountCents)
  expect(cents(await page.getByTestId("invoice-total").textContent())).toBe(stored.total)
  await expect(page.getByTestId("invoice-balance")).toHaveText("$0.00")
  await expect(page.getByTestId("invoice-payment").first()).toContainText("Settled")
  await expect(page.getByTestId("invoice-pay")).toHaveCount(0)

  const pdf = await download(page.request, (await page.getByTestId("invoice-pdf").getAttribute("href"))!)
  const printed = flat(await pdfText(pdf.bytes))
  for (const value of stored.rows.map((line) => line.amountCents)) expect(printed).toContain(formatCents(value))
  expect(printed).toContain(`Total ${formatCents(stored.total)}`)
})

test("a deposit invoice itemises its components, with no pay period, for the person it covers", async ({ page, baseURL }) => {
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
  await signInAs(page.context(), baseURL!, BRIGHTWAVE_HR)
  await page.goto(invoiceUrl(deposit.id))
  await expect(page.getByTestId("invoice-document")).toHaveAttribute("data-kind", "deposit")
  await expect(page.getByTestId("invoice-number")).toHaveText(deposit.number)
  const person = (await page.getByTestId("invoice-person-name").textContent())!.trim()
  expect(person.length).toBeGreaterThan(0)
  await expect(page.getByTestId("invoice-period")).toContainText("None (security deposit)")
  await expect(page.getByTestId("invoice-for")).not.toContainText("start date")
  await expect(page.getByTestId("invoice-document")).not.toContainText("Terms")
  await expect(page.getByTestId("invoice-document")).not.toContainText("Please pay")
  await expect(page.getByTestId("invoice-lines")).toContainText("Security deposit")
  await expect(page.getByTestId("invoice-deposit-note")).toBeVisible()
  expect(cents(await page.getByTestId("invoice-total").textContent())).toBe(amount)

  const stored = await storedLines(deposit.id, page)
  expect(stored.rows.length).toBeGreaterThan(1)
  const codes = await page.getByTestId("invoice-line").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-code")))
  expect(codes).toEqual(stored.rows.map((line) => line.code))
  expect(await lineAmounts(page)).toEqual(stored.rows.map((line) => line.amountCents))
  expect((await lineAmounts(page)).reduce((total, value) => total + value, 0)).toBe(amount)

  const pdf = await download(page.request, (await page.getByTestId("invoice-pdf").getAttribute("href"))!)
  const printed = flat(await pdfText(pdf.bytes))
  expect(printed).toContain(person)
  expect(printed).toContain("Security deposit")
  for (const line of stored.rows) expect(printed).toContain(formatCents(line.amountCents))
  expect(printed).toContain(`Total ${formatCents(amount)}`)
  expect(printed).not.toContain("Terms")
  expect(printed).not.toContain("Please pay")
})

test("a payable invoice offers Pay from the page and opens the shared pay dialog (without paying)", async ({ page, baseURL }) => {
  await openFinance(page, baseURL!)
  const row = board(page).locator("[data-testid=invoice-row][data-status=open], [data-testid=invoice-row][data-status=overdue]").first()
  const amount = cents(await row.locator("[data-slot=money]").textContent())
  await row.getByTestId("invoice-open").click()
  await page.getByTestId("drawer-full-invoice").click()
  await expect(page.getByTestId("invoice-document")).toBeVisible()
  await expect(page.getByTestId("invoice-balance")).toHaveText(formatCents(amount))
  await page.getByTestId("invoice-pay").click()
  expect(cents(await page.getByTestId("pay-total").textContent())).toBe(amount)
  await expect(page.getByTestId("pay-method")).toHaveText(/^ACH ••\d{4}/)
  await page.keyboard.press("Escape")
  await expect(page.getByTestId("pay-total")).toHaveCount(0)
})

test("a void invoice reads $0.00 due with the reason", async ({ page, baseURL }) => {
  const db = await openLiveDb(page)
  const voided = db.prepare("select id, total_cents totalCents from invoices where company_id = 'client_2' and status = 'void' limit 1").get() as
    | { id: string; totalCents: number }
    | undefined
  db.close()
  test.skip(!voided, "the seeded database has no void invoice for this client")
  await signInAs(page.context(), baseURL!, BRIGHTWAVE_HR)
  await page.goto(`/client/finance/invoices/${encodeURIComponent(voided!.id)}`)
  await expect(page.getByTestId("invoice-document")).toHaveAttribute("data-status", "void")
  await expect(page.getByTestId("invoice-amount-due")).toHaveText("$0.00")
  await expect(page.getByTestId("invoice-balance")).toHaveText("$0.00")
  await expect(page.getByTestId("invoice-void-reason")).toBeVisible()
  expect(cents(await page.getByTestId("invoice-total").textContent())).toBe(voided!.totalCents)
  await expect(page.getByTestId("invoice-pay")).toHaveCount(0)
})

test("the person's Payments tab links each invoice to its page and labels the period", async ({ page, baseURL }) => {
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
  const href = await tab.getByTestId("person-invoice-link").first().getAttribute("href")
  expect(href).toMatch(/^\/client\/finance\/invoices\/.+/)
  await expect(tab.getByTestId("person-invoice-link").first()).toHaveAttribute("target", "_blank")
  await expect(tab.getByTestId("person-invoice-link").first()).toHaveAttribute("rel", /noopener/)
  await expect(tab).not.toContainText("Pay invoices, see payment history")
  await page.goto(href!)
  await expect(page.getByTestId("invoice-document")).toBeVisible()
})

test("another company's invoice is a 404 page, the same as an unknown id; the owner opens it", async ({ page, baseURL }) => {
  const db = await openLiveDb(page)
  const theirs = db.prepare("select id, number from invoices where company_id = 'client_1' and kind = 'payroll' limit 1").get() as {
    id: string
    number: string
  }
  db.close()
  const url = (id: string) => `/client/finance/invoices/${encodeURIComponent(id)}`

  await signInAs(page.context(), baseURL!, BRIGHTWAVE_HR)
  const foreign = await page.goto(url(theirs.id))
  // The page streams inside Suspense, so a missing invoice is the 404 screen with status 200.
  expect([200, 404]).toContain(foreign!.status())
  await expect(page.getByRole("heading", { name: "This page could not be found." })).toBeVisible()
  await expect(page.getByTestId("invoice-document")).toHaveCount(0)
  await expect(page.locator("body")).not.toContainText(theirs.number)
  await page.goto(url("payroll:no-such-hire:1"))
  await expect(page.getByRole("heading", { name: "This page could not be found." })).toBeVisible()

  await page.context().clearCookies()
  await signInAs(page.context(), baseURL!, ACME_HR)
  await page.goto(url(theirs.id))
  await expect(page.getByTestId("invoice-number")).toHaveText(theirs.number)
})

test("print preview shows only the document: no sidebar, no actions", async ({ page, baseURL }) => {
  const db = await openLiveDb(page)
  const own = db.prepare("select id from invoices where company_id = 'client_2' and kind = 'payroll' limit 1").get() as { id: string }
  db.close()
  await signInAs(page.context(), baseURL!, BRIGHTWAVE_HR)
  await page.goto(`/client/finance/invoices/${encodeURIComponent(own.id)}`)
  await expect(page.getByTestId("invoice-document")).toBeVisible()
  await page.emulateMedia({ media: "print" })
  await expect(page.locator("aside")).toBeHidden()
  await expect(page.getByTestId("invoice-actions")).toBeHidden()
  await expect(page.getByRole("link", { name: "Back to Finance" })).toBeHidden()
  await expect(page.getByTestId("invoice-totals")).toBeVisible()
})
