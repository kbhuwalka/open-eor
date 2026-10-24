import Database from "better-sqlite3"
import { test, expect, type Page } from "@playwright/test"

import { formatCents } from "@/lib/format"

import { addDays, cents, dbFile, download, openLiveDb, pdfText, signInAs, todayEastern, writeLiveDb } from "./support/live"

/**
 * /worker/pay and the pay slip pages on the REAL pages, against the seeded database (employees
 * paid every other Friday since their start date). The /dev/pay specs live in employee-pay.spec.ts.
 * Tests are read-only except the future-slip one, which adds one slip and removes it afterwards.
 */

type Employee = { id: string; slips: number }

const slipUrl = (id: string) => `/worker/pay/${encodeURIComponent(id)}`
const pdfUrl = (id: string) => `${slipUrl(id)}/pdf`
const dashboard = (page: Page) => page.getByTestId("pay-dashboard")

async function employees(page: Page): Promise<{ paid: Employee[]; newHire: string; deposit: { id: string; label: string } }> {
  const db = await openLiveDb(page)
  const today = todayEastern()
  const paid = db
    .prepare(
      `select worker_user_id id, count(*) slips from payroll_entries
       where pay_date <= ? and tax_year = ? group by worker_user_id having count(*) >= 3
       order by slips desc, id`,
    )
    .all(today, Number(today.slice(0, 4))) as Employee[]
  const newHire = db
    .prepare(
      `select c.worker_user_id id from onboarding_cases c join hire_requests h on h.id = c.hire_request_id
       where c.lifecycle = 'open' and h.start_date > ?
         and c.worker_user_id not in (select worker_user_id from payroll_entries) order by h.start_date, c.id limit 1`,
    )
    .get(today) as { id: string }
  const withDeposit = db
    .prepare(
      `select e.worker_user_id id, f.data_json json from payroll_entries e
       join form_submissions f on f.case_id = e.case_id and f.form_type = 'direct_deposit'
       where e.pay_date <= ? and (select count(*) from form_submissions g where g.case_id = e.case_id and g.form_type = 'direct_deposit') = 1 limit 1`,
    )
    .get(today) as { id: string; json: string } | undefined
  db.close()
  expect(paid.length).toBeGreaterThan(2)
  const stored = withDeposit ? (JSON.parse(withDeposit.json) as { accountType: string; last4: string }) : null
  const label = stored ? `${stored.accountType === "savings" ? "Savings" : "Checking"} ••${stored.last4}` : ""
  return { paid, newHire: newHire.id, deposit: { id: withDeposit?.id ?? "", label } }
}

async function signIn(page: Page, baseURL: string, userId: string) {
  await page.context().clearCookies()
  await signInAs(page.context(), baseURL, userId)
}

/** The slip page streams inside Suspense, so a missing slip is the 404 screen with status 200. */
async function expectNotFoundPage(page: Page, url: string) {
  await page.goto(url)
  await expect(page.getByRole("heading", { name: "This page could not be found." })).toBeVisible()
  await expect(page.getByTestId("payslip-detail")).toHaveCount(0)
}

/** Taxes and deductions are not columns of the list; they come from what the payroll run stored. */
function storedAmounts(id: string): { taxes: number; deductions: number; payDate: string } {
  const db = new Database(dbFile(), { readonly: true, fileMustExist: true })
  const row = db
    .prepare("select taxes_cents taxes, pre_tax_deductions_cents + post_tax_deductions_cents deductions, pay_date payDate from payroll_entries where id = ?")
    .get(id) as { taxes: number; deductions: number; payDate: string }
  db.close()
  return row
}

async function listedSlips(page: Page) {
  await expect(dashboard(page).getByTestId("payslip-table").getByRole("columnheader")).toHaveText(["Pay period", "Gross pay", "Net pay", "Download"])
  const rows = dashboard(page).getByTestId("payslip-row")
  const count = await rows.count()
  const slips: { id: string; period: string; payDate: string; gross: number; taxes: number; deductions: number; net: number; pdf: string }[] = []
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index)
    const cells = await row.locator("td").allTextContents()
    expect(cells).toHaveLength(4)
    const link = (await row.getByRole("link").first().getAttribute("href"))!
    const id = decodeURIComponent(link.split("/").at(-1)!)
    slips.push({
      id,
      period: cells[0].trim(),
      ...storedAmounts(id),
      gross: cents(cells[1]),
      net: cents(cells[2]),
      pdf: (await row.getByRole("link", { name: `Download pay slip for ${cells[0].trim()}` }).getAttribute("href"))!,
    })
  }
  return slips
}

test("the dashboard lists only slips paid up to today, newest first, each adding up, with tiles that reconcile", async ({ page, baseURL }) => {
  const { paid } = await employees(page)
  await signIn(page, baseURL!, paid[0].id)
  await page.goto("/worker/pay")
  await expect(dashboard(page).getByRole("heading", { name: "Pay", exact: true }).or(page.getByRole("heading", { name: "Pay", exact: true }))).toBeVisible()

  const slips = await listedSlips(page)
  expect(slips).toHaveLength(paid[0].slips)
  for (const slip of slips) expect(slip.net).toBe(slip.gross - slip.taxes - slip.deductions)

  const db = new Database(dbFile(), { readonly: true, fileMustExist: true })
  const today = todayEastern()
  const stored = db
    .prepare("select id, pay_date payDate, gross_cents gross, taxes_cents taxes, net_cents net from payroll_entries where worker_user_id = ? and tax_year = ? and pay_date <= ? order by pay_date desc")
    .all(paid[0].id, Number(today.slice(0, 4)), today) as { id: string; payDate: string; gross: number; taxes: number; net: number }[]
  db.close()
  expect(slips.map((slip) => slip.id)).toEqual(stored.map((entry) => entry.id))
  expect(stored[0].payDate <= today).toBe(true)

  const board = dashboard(page)
  expect(cents(await board.getByTestId("tile-latest-net").textContent())).toBe(stored[0].net)
  expect(cents(await board.getByTestId("tile-ytd-gross").textContent())).toBe(stored.reduce((total, entry) => total + entry.gross, 0))
  expect(cents(await board.getByTestId("tile-ytd-taxes").textContent())).toBe(stored.reduce((total, entry) => total + entry.taxes, 0))
  await expect(board.getByTestId("tile-next-pay-date")).toContainText(/20\d\d/)
  for (const slip of slips) expect(slip.pdf).toBe(pdfUrl(slip.id))
})

test("the direct deposit card shows the stored label only, never a full account number", async ({ page, baseURL }) => {
  const { deposit } = await employees(page)
  test.skip(!deposit.id, "no seeded employee with a direct deposit form")
  await signIn(page, baseURL!, deposit.id)
  await page.goto("/worker/pay")
  await expect(dashboard(page).getByTestId("direct-deposit-label")).toHaveText(deposit.label)
  expect(deposit.label).toMatch(/^(Checking|Savings) ••\d{4}$/)
})

test("a slip adds up: net = gross - deductions - taxes, and the PDF prints the same figures", async ({ page, baseURL }) => {
  const { paid } = await employees(page)
  await signIn(page, baseURL!, paid[0].id)
  await page.goto("/worker/pay")
  const slips = await listedSlips(page)
  const target = slips[0]

  await dashboard(page).getByTestId("payslip-row").first().getByRole("link").first().click()
  await expect(page).toHaveURL(/\/worker\/pay\/payslip(:|%3A)/)
  const slip = page.getByTestId("payslip-detail")
  await expect(slip.getByTestId("net-summary")).toBeVisible()

  const summary = ((await slip.getByTestId("net-summary").textContent()) ?? "").match(/\$[\d,]+\.\d{2}/g)!.map((text) => cents(text))
  const [gross, ...rest] = summary
  const net = rest.pop()!
  expect(gross).toBe(target.gross)
  expect(net).toBe(target.net)
  expect(net).toBe(gross - rest.reduce((total, value) => total + value, 0))
  expect(cents(await slip.getByTestId("net-pay").textContent())).toBe(net)

  const earned = cents(await slip.getByTestId("earnings").getByTestId("current").first().textContent())
  expect(earned).toBeGreaterThan(0)
  await expect(slip.getByTestId("taxes").getByTestId("taxes-total")).toBeVisible()
  const taxes = cents(await slip.getByTestId("taxes-total").getByTestId("current").textContent())
  expect(taxes).toBe(target.taxes)

  const href = (await slip.getByTestId("download-pdf").getAttribute("href"))!
  expect(decodeURIComponent(href)).toBe(decodeURIComponent(pdfUrl(target.id)))
  const { response, bytes } = await download(page.request, href)
  expect(response.status()).toBe(200)
  expect(response.headers()["content-type"]).toBe("application/pdf")
  expect(response.headers()["content-disposition"]).toMatch(/^attachment; filename=".+\.pdf"$/)
  expect(response.headers()["cache-control"]).toBe("private, no-store")
  expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-")
  const text = await pdfText(bytes)
  expect(text).toContain(formatCents(net))
  expect(text).toContain(formatCents(gross))
  expect(text).not.toMatch(/\b\d{3}-\d{2}-\d{4}\b/)
  expect(text).not.toMatch(/\b\d{8,}\b/)

  await expect(slip.getByTestId("paid-to")).toHaveText(/^(Checking|Savings) ••\d{4}$/)
})

test("the YTD column of the latest slip equals the sum of the visible slips of the year", async ({ page, baseURL }) => {
  const { paid } = await employees(page)
  await signIn(page, baseURL!, paid[0].id)
  await page.goto("/worker/pay")
  const slips = await listedSlips(page)
  await page.goto(slipUrl(slips[0].id))
  const slip = page.getByTestId("payslip-detail")
  const ytdGross = cents(await slip.getByTestId("earnings").getByTestId("ytd").first().textContent())
  expect(ytdGross).toBe(slips.reduce((total, row) => total + row.gross, 0))
  const ytdTaxes = cents(await slip.getByTestId("taxes-total").getByTestId("ytd").textContent())
  expect(ytdTaxes).toBe(slips.reduce((total, row) => total + row.taxes, 0))
})

test.describe("a slip dated tomorrow", () => {
  let futureId = ""

  test.afterAll(() => {
    if (!futureId) return
    writeLiveDb((db) => {
      db.prepare("delete from payroll_entries where id = ?").run(`payslip:${futureId}`)
      db.prepare("delete from invoices where id = ?").run(`payroll:${futureId}`)
    })
  })

  test("is not listed, and its page and PDF are 404", async ({ page, baseURL }) => {
    const { paid } = await employees(page)
    const db = await openLiveDb(page)
    const latest = db
      .prepare("select * from payroll_entries where worker_user_id = ? order by period_index desc limit 1")
      .get(paid[0].id) as Record<string, string | number>
    const invoice = db.prepare("select * from invoices where id = ?").get(latest.invoice_id) as Record<string, string | number | null>
    const tomorrow = addDays(todayEastern(), 1)
    const index = Number(latest.period_index) + 50
    futureId = `${latest.hire_id}:${index}`
    const insert = (writer: Database.Database, table: string, row: Record<string, unknown>) =>
      writer.prepare(`insert into ${table} (${Object.keys(row).join(",")}) values (${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row))
    // Void, so the copy never counts toward the client's Due now while other specs read the same database.
    const clonedInvoice = { ...invoice, id: `payroll:${futureId}`, number: `INV-FUTURE-${index}`, period_index: index, pay_date: tomorrow, status: "void", void_reason: "e2e" }
    db.close()
    writeLiveDb((writer) => {
      insert(writer, "invoices", clonedInvoice)
      insert(writer, "payroll_entries", { ...latest, id: `payslip:${futureId}`, invoice_id: clonedInvoice.id, period_index: index, pay_date: tomorrow })
    })

    await signIn(page, baseURL!, paid[0].id)
    await page.goto("/worker/pay")
    const slips = await listedSlips(page)
    expect(slips).toHaveLength(paid[0].slips)
    expect(slips.map((slip) => slip.id)).not.toContain(`payslip:${futureId}`)
    await expect(dashboard(page).getByTestId("tile-latest-net")).not.toContainText(formatCents(Number(latest.net_cents) + 1))

    expect((await page.request.get(pdfUrl(`payslip:${futureId}`))).status()).toBe(404)
    await expectNotFoundPage(page, slipUrl(`payslip:${futureId}`))
  })
})

test("an employee cannot open or download another employee's slip; the answer matches an unknown id", async ({ page, baseURL }) => {
  const { paid } = await employees(page)
  const db = await openLiveDb(page)
  const theirs = db.prepare("select id from payroll_entries where worker_user_id = ? order by pay_date desc limit 1").get(paid[1].id) as { id: string }
  db.close()
  await signIn(page, baseURL!, paid[0].id)

  const pdfOfTheirs = await page.request.get(pdfUrl(theirs.id))
  const pdfOfUnknown = await page.request.get(pdfUrl("payslip:no-such-hire:1"))
  expect(pdfOfTheirs.status()).toBe(404)
  expect(pdfOfUnknown.status()).toBe(404)
  expect(await pdfOfTheirs.json()).toEqual(await pdfOfUnknown.json())
  await expectNotFoundPage(page, slipUrl(theirs.id))
  await expectNotFoundPage(page, slipUrl("payslip:no-such-hire:1"))
})

test("the slip PDF needs a session (401) and the worker role (403)", async ({ page, baseURL }) => {
  const { paid } = await employees(page)
  const db = await openLiveDb(page)
  const own = db.prepare("select id from payroll_entries where worker_user_id = ? order by pay_date desc limit 1").get(paid[0].id) as { id: string }
  const hr = db.prepare("select id from users where role = 'client_hr' limit 1").get() as { id: string }
  db.close()

  await page.context().clearCookies()
  expect((await page.request.get(pdfUrl(own.id))).status()).toBe(401)
  await signIn(page, baseURL!, hr.id)
  expect((await page.request.get(pdfUrl(own.id))).status()).toBe(403)
})

test("before the first pay date the page says when it is and lists nothing", async ({ page, baseURL }) => {
  const { newHire } = await employees(page)
  await signIn(page, baseURL!, newHire)
  await page.goto("/worker/pay")
  await expect(dashboard(page).getByTestId("payslips-empty")).toContainText(/Your first pay slip appears on your first pay date — \w{3}, \w{3} \d{1,2}, \d{4}\./)
  await expect(dashboard(page).getByTestId("payslip-table")).toHaveCount(0)
  await expect(dashboard(page).getByTestId("tile-next-pay-date")).toContainText(/20\d\d/)
})
