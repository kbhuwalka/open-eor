import { test, expect, type Locator, type Page } from "@playwright/test"

import { formatCents } from "@/lib/format"

import { cents, download, openLiveDb, pdfText, signInAs, writeLiveDb } from "./support/live"

/**
 * /client/finance and the person Payments tab on the REAL pages, against the seeded database
 * (three client companies with months of invoices, payments and Finance settlements). The /dev/finance
 * specs live in client-finance.spec.ts. Read-only tests sign in as Brightwave's client HR; the
 * payment tests change data and sign in as Acme's, serially, so nothing else shares those invoices.
 */

const ACME_HR = "user_client_hr"
const BRIGHTWAVE_HR = "user_client_hr_2"

const board = (page: Page) => page.getByTestId("tabpanel-invoices")
const payable = (section: Locator) =>
  section.locator("[data-testid=invoice-row][data-status=open], [data-testid=invoice-row][data-status=overdue]")

async function openFinance(page: Page, baseURL: string, userId: string) {
  await signInAs(page.context(), baseURL, userId)
  await page.goto("/client/finance")
  await expect(page.getByTestId("finance-summary")).toBeVisible()
  await expect(board(page).getByTestId("invoice-row").first()).toBeVisible()
}

/** The Finance page when the client may owe nothing: waits for the summary only. */
async function openFinanceAnyState(page: Page, baseURL: string, userId: string) {
  await signInAs(page.context(), baseURL, userId)
  await page.goto("/client/finance")
  await expect(page.getByTestId("finance-summary")).toBeVisible()
}

test.describe("read-only", () => {
  test("shows Due now and an invoice list whose Due now equals what Pay all due pays", async ({ page, baseURL }) => {
    await openFinance(page, baseURL!, BRIGHTWAVE_HR)
    await expect(page.getByRole("heading", { name: "Finance", exact: true })).toBeVisible()
    await expect(page.getByTestId("tile-due-now")).toBeVisible()
    await expect(page.getByTestId("tile-in-progress")).toHaveCount(0)
    const dueNow = cents(await page.getByTestId("tile-due-now-value").textContent())
    expect(dueNow).toBeGreaterThan(0)
    await expect(board(page).getByTestId("pay-bar-summary")).toContainText(formatCents(dueNow))

    await board(page).getByTestId("pay-all-due").click()
    expect(cents(await page.getByTestId("pay-total").textContent())).toBe(dueNow)
    const listed = await page.getByTestId("pay-invoices").locator("li [data-slot=money]").allTextContents()
    expect(listed.reduce((total, text) => total + cents(text), 0)).toBe(dueNow)
    await expect(page.getByTestId("pay-method")).toHaveText(/^ACH ••\d{4} — .+/)
    await page.keyboard.press("Escape")

    const overdue = cents(await page.getByTestId("tile-overdue-value").textContent())
    expect(overdue).toBeLessThanOrEqual(dueNow)
    await page.getByTestId("view-overdue").click()
    await expect(page.getByTestId("invoice-status-filter")).toContainText("Overdue")
  })

  test("the Invoices tab lists unpaid invoices only, with the filter All unpaid / Due / Overdue", async ({ page, baseURL }) => {
    await openFinance(page, baseURL!, BRIGHTWAVE_HR)
    const section = board(page)
    const statuses = await section.getByTestId("invoice-row").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-status")))
    expect(statuses.length).toBeGreaterThan(0)
    for (const status of statuses) expect(["open", "overdue"]).toContain(status)

    const db = await openLiveDb(page)
    const hidden = db
      .prepare(
        `select i.number from invoices i
         where i.company_id = 'client_2' and (i.status = 'void' or exists (select 1 from payment_allocations a join payments p on p.id = a.payment_id where a.invoice_id = i.id and p.status in ('initiated', 'succeeded')))
         limit 3`,
      )
      .all() as { number: string }[]
    db.close()
    expect(hidden.length).toBeGreaterThan(0)
    for (const { number } of hidden) {
      await section.getByTestId("invoice-search").fill(number)
      await expect(section.getByTestId("no-invoices")).toContainText("No unpaid invoices match these filters")
    }
    await section.getByTestId("clear-invoice-filters").click()

    await section.getByTestId("invoice-status-filter").click()
    await expect(page.getByRole("option")).toHaveText(["All unpaid", "Due", "Overdue"])
    await page.getByRole("option", { name: "Overdue" }).click()
    expect(new Set(await section.getByTestId("invoice-row").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-status"))))).toEqual(
      new Set(["overdue"]),
    )
    await section.getByTestId("invoice-status-filter").click()
    await page.getByRole("option", { name: "Due", exact: true }).click()
    await expect(section.getByTestId("invoice-status-filter")).toContainText("Due")
    await expect(section.locator("[data-testid=invoice-row][data-status=overdue]")).toHaveCount(0)
    await expect(section.locator("[data-testid=invoice-row][data-status=open], [data-testid=no-invoices]").first()).toBeVisible()
    await section.getByTestId("invoice-status-filter").click()
    await page.getByRole("option", { name: "All unpaid" }).click()

    const person = (await section.getByTestId("invoice-row").first().getByTestId("invoice-person").locator("span").first().textContent())!.trim()
    await section.getByTestId("invoice-search").fill(person)
    const people = await section.getByTestId("invoice-row").evaluateAll((rows) => rows.map((r) => r.textContent ?? ""))
    expect(people.length).toBeGreaterThan(0)
    for (const text of people) expect(text).toContain(person)
    await section.getByTestId("invoice-search").fill("no such person")
    await expect(section.getByTestId("no-invoices")).toContainText("No unpaid invoices match these filters")
  })

  test("the table has no Service period, Pay date or Period column", async ({ page, baseURL }) => {
    await openFinance(page, baseURL!, BRIGHTWAVE_HR)
    const headings = (await board(page).getByRole("columnheader").allTextContents()).map((text) => text.trim())
    expect(headings).toEqual(["", "Invoice", "Person", "Due", "Amount", "Status"])
    await expect(board(page).getByTestId("row-period")).toHaveCount(0)
  })

  test("the drawer shows lines that add up to the row; the PDF is a real PDF whose total equals the row", async ({ page, baseURL }) => {
    await openFinance(page, baseURL!, BRIGHTWAVE_HR)
    const section = board(page)
    const row = payable(section).filter({ hasText: "Payroll" }).first()
    const number = (await row.getByTestId("invoice-open").textContent())!.trim()
    const amount = cents(await row.locator("[data-slot=money]").textContent())

    await row.getByTestId("invoice-open").click()
    await expect(page.getByTestId("drawer-number")).toHaveText(number)
    await expect(page.getByTestId("drawer-lines")).toBeVisible()
    expect(cents(await page.getByTestId("drawer-total").textContent())).toBe(amount)
    const amounts = await page.getByTestId("drawer-line-amount").allTextContents()
    expect(amounts.length).toBeGreaterThan(2)
    expect(amounts.reduce((total, text) => total + cents(text), 0)).toBe(amount)
    await expect(page.getByTestId("drawer-person")).not.toBeEmpty()
    await expect(page.getByTestId("drawer-period")).toContainText(/\d{4}/)

    const href = (await page.getByTestId("drawer-pdf").getAttribute("href"))!
    const { response, bytes } = await download(page.request, href)
    expect(response.status()).toBe(200)
    expect(response.headers()["content-type"]).toBe("application/pdf")
    expect(response.headers()["content-disposition"]).toBe(`attachment; filename="${number}.pdf"`)
    expect(response.headers()["cache-control"]).toBe("private, no-store")
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-")
    const text = await pdfText(bytes)
    expect(text).toContain(number)
    expect(text).toContain(formatCents(amount))
  })

  test("the Payments tab lists payments newest first; each covered invoice is a link that opens its page in a new tab", async ({ page, baseURL }) => {
    await openFinance(page, baseURL!, BRIGHTWAVE_HR)
    await page.getByTestId("tab-payments").click()
    const rows = page.getByTestId("tabpanel-payments").getByTestId("payment-row")
    expect(await rows.count()).toBeGreaterThan(3)
    await expect(rows.first()).toContainText(/Processing|Settled|Failed/)
    const text = await page.getByTestId("tabpanel-payments").textContent()
    expect(text).toMatch(/Settled/)

    const link = rows
      .filter({ has: page.locator("[data-slot=payment-status][data-status=settled]") })
      .filter({ has: page.locator("a[data-testid=payment-invoice]") })
      .first()
      .getByTestId("payment-invoice")
      .first()
    await expect(link).toHaveAttribute("target", "_blank")
    await expect(link).toHaveAttribute("rel", /noopener/)
    await expect(link).toHaveAttribute("href", /^\/client\/finance\/invoices\/.+/)
    const number = (await link.textContent())!.trim()
    const [popup] = await Promise.all([page.waitForEvent("popup"), link.click()])
    await popup.waitForLoadState()
    await expect(popup.getByTestId("invoice-number")).toHaveText(number)
    await expect(popup.getByTestId("invoice-document")).toHaveAttribute("data-status", "paid")
    await popup.close()
    await expect(page).toHaveURL(/\/client\/finance$/)
    await expect(page.getByTestId("tabpanel-payments")).toBeVisible()
  })

  test("the Payments tab paginates with the shared bar once there are more than ten payments", async ({ page, baseURL }) => {
    const db = await openLiveDb(page)
    const { total } = db.prepare("select count(*) total from payments where company_id = 'client_2'").get() as { total: number }
    db.close()
    test.skip(total <= 10, "the seeded client has ten payments or fewer")
    await openFinance(page, baseURL!, BRIGHTWAVE_HR)
    await page.getByTestId("tab-payments").click()
    const panel = page.getByTestId("tabpanel-payments")
    await expect(panel.getByTestId("payment-row")).toHaveCount(10)
    await expect(panel.getByTestId("page-range")).toHaveText(`1–10 of ${total}`)
    await panel.getByRole("button", { name: "Next page" }).click()
    await expect(panel.getByTestId("page-range")).toHaveText(`11–${Math.min(20, total)} of ${total}`)
    await expect(panel.getByTestId("payment-row")).toHaveCount(Math.min(10, total - 10))
    await panel.getByRole("combobox", { name: "Rows per page" }).click()
    await page.getByRole("option", { name: "25" }).click()
    await expect(panel.getByTestId("page-range")).toHaveText(`1–${Math.min(25, total)} of ${total}`)
  })

  test("a payment covering several invoices is an \"N invoices\" button that opens a dialog of new-tab rows", async ({ page, baseURL }) => {
    await openFinance(page, baseURL!, BRIGHTWAVE_HR)
    await page.getByTestId("tab-payments").click()
    const panel = page.getByTestId("tabpanel-payments")
    await panel.getByRole("combobox", { name: "Rows per page" }).click()
    await page.getByRole("option", { name: "25" }).click()

    const row = panel.getByTestId("payment-row").filter({ has: page.getByTestId("payment-invoices-trigger") }).first()
    const trigger = row.getByTestId("payment-invoices-trigger")
    await expect(trigger).toHaveText(/^\d+ invoices$/)
    const count = Number((await trigger.textContent())!.split(" ")[0])
    expect(count).toBeGreaterThan(1)
    await expect(row.getByTestId("payment-invoice")).toHaveCount(0)

    await trigger.click()
    const dialog = page.getByTestId("payment-invoices-dialog")
    await expect(dialog).toBeVisible()
    const paymentTotal = cents(await dialog.getByTestId("payment-invoices-title").locator("span").first().textContent())
    const items = dialog.getByTestId("payment-invoice")
    await expect(items).toHaveCount(count)
    let sum = 0
    for (let i = 0; i < count; i += 1) {
      const item = items.nth(i)
      await expect(item).toHaveAttribute("target", "_blank")
      await expect(item).toHaveAttribute("rel", /noopener/)
      await expect(item).toHaveAttribute("href", /^\/client\/finance\/invoices\/.+/)
      await expect(item.getByTestId("payment-invoice-person")).not.toBeEmpty()
      await expect(item.getByTestId("payment-invoice-period")).not.toBeEmpty()
      sum += cents(await item.locator("[data-slot=money]").textContent())
    }
    expect(sum).toBe(paymentTotal)

    const first = items.first()
    const number = (await first.getByTestId("payment-invoice-number").textContent())!.trim()
    const [popup] = await Promise.all([page.waitForEvent("popup"), first.getByTestId("payment-invoice-person").click()])
    await popup.waitForLoadState()
    await expect(popup.getByTestId("invoice-number")).toHaveText(number)
    await popup.close()
    await expect(dialog).toBeVisible()

    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
    await expect(trigger).toBeFocused()
  })

  test("paid and processing invoices are not in Invoices; their payments are in Payments", async ({ page, baseURL }) => {
    const db = await openLiveDb(page)
    const settled = db
      .prepare(
        `select i.number, p.id paymentId from invoices i join payment_allocations a on a.invoice_id = i.id join payments p on p.id = a.payment_id
         where i.company_id = 'client_2' and p.status = 'succeeded' order by p.initiated_at desc limit 1`,
      )
      .get() as { number: string; paymentId: string }
    db.close()
    await openFinance(page, baseURL!, BRIGHTWAVE_HR)
    await board(page).getByTestId("invoice-search").fill(settled.number)
    await expect(board(page).getByTestId("invoice-row")).toHaveCount(0)
    await page.getByTestId("tab-payments").click()
    await expect(page.locator(`[data-testid=payment-row][data-payment-id="${settled.paymentId}"]`)).toContainText("Settled")
  })

  test("the person Payments tab shows the person's invoices with totals", async ({ page, baseURL }) => {
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
    expect(await tab.getByTestId("person-invoice-row").count()).toBeGreaterThan(1)
    await expect(tab.getByTestId("person-paid-total")).toContainText("$")
    await expect(tab.getByTestId("person-outstanding-total")).toContainText("$")
    await expect(tab.getByTestId("person-invoice-row").first()).toContainText("Deposit")
  })

  test("another client's invoice is a 404 for the PDF and an unknown id; no session is 401; an employee is 403", async ({ page, baseURL }) => {
    const db = await openLiveDb(page)
    const theirs = db.prepare("select id from invoices where company_id = 'client_1' and kind = 'payroll' limit 1").get() as { id: string }
    const worker = db.prepare("select id from users where role = 'worker' limit 1").get() as { id: string }
    db.close()
    const url = (id: string) => `/client/finance/invoices/${encodeURIComponent(id)}/pdf`

    expect((await page.request.get(url(theirs.id))).status()).toBe(401)

    await signInAs(page.context(), baseURL!, BRIGHTWAVE_HR)
    const foreign = await page.request.get(url(theirs.id))
    const unknown = await page.request.get(url("payroll:no-such-hire:1"))
    expect(foreign.status()).toBe(404)
    expect(unknown.status()).toBe(404)
    expect(await foreign.json()).toEqual(await unknown.json())

    await page.context().clearCookies()
    await signInAs(page.context(), baseURL!, worker.id)
    expect((await page.request.get(url(theirs.id))).status()).toBe(403)
  })
})

test.describe.serial("paying", () => {
  // The paying tests move real rows. They remove the payments they made afterwards, so the same
  // seeded database can run the spec again.
  let startedAt = 0
  test.beforeAll(() => {
    startedAt = Date.now()
  })
  test.afterAll(() => {
    writeLiveDb((db) => {
      const made = "select id from payments where company_id = 'client_1' and initiated_at >= ?"
      db.prepare(`delete from payment_allocations where payment_id in (${made})`).run(startedAt)
      db.prepare("delete from payments where company_id = 'client_1' and initiated_at >= ?").run(startedAt)
    })
  })

  test("Pay selected initiates one payment: the invoices read Processing and the tiles move; Pay all due then clears Due now", async ({ page, baseURL }) => {
    await openFinance(page, baseURL!, ACME_HR)
    const section = board(page)
    const dueBefore = cents(await page.getByTestId("tile-due-now-value").textContent())
    expect(dueBefore).toBeGreaterThan(0)

    const first = payable(section).nth(0)
    const second = payable(section).nth(1)
    const numbers = [
      (await first.getByTestId("invoice-open").textContent())!.trim(),
      (await second.getByTestId("invoice-open").textContent())!.trim(),
    ]
    const picked = cents(await first.locator("[data-slot=money]").textContent()) + cents(await second.locator("[data-slot=money]").textContent())
    await first.getByTestId("invoice-select").click()
    await second.getByTestId("invoice-select").click()
    const button = section.getByTestId("pay-selected")
    await expect(button).toContainText("Pay selected (2)")
    expect(cents((await button.textContent())!.split("·")[1])).toBe(picked)

    await button.click()
    expect(cents(await page.getByTestId("pay-total").textContent())).toBe(picked)
    await page.getByTestId("pay-confirm").click()
    await expect(page.getByTestId("pay-success")).toContainText("2 invoices")
    await page.getByTestId("pay-done").click()

    await page.reload()
    await expect(page.getByTestId("finance-summary")).toBeVisible()
    expect(cents(await page.getByTestId("tile-due-now-value").textContent())).toBe(dueBefore - picked)
    for (const number of numbers) {
      await board(page).getByTestId("invoice-search").fill(number)
      await expect(board(page).getByTestId("invoice-row")).toHaveCount(0)
      await expect(board(page).getByTestId("no-invoices")).toContainText("No unpaid invoices match these filters")
    }

    await page.getByTestId("tab-payments").click()
    const newest = page.getByTestId("tabpanel-payments").getByTestId("payment-row").first()
    await expect(newest).toContainText("Processing")
    expect(cents(await newest.locator("[data-slot=money]").textContent())).toBe(picked)
    await expect(newest.getByTestId("payment-invoices-trigger")).toHaveText("2 invoices")
    await newest.getByTestId("payment-invoices-trigger").click()
    const dialog = page.getByTestId("payment-invoices-dialog")
    await expect(dialog.getByTestId("payment-invoice")).toHaveCount(2)
    for (const number of numbers) await expect(dialog).toContainText(number)
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)

    await page.getByTestId("tab-invoices").click()
    await board(page).getByTestId("invoice-search").fill("")
    await board(page).getByTestId("pay-all-due").click()
    const allDue = cents(await page.getByTestId("pay-total").textContent())
    expect(allDue).toBe(dueBefore - picked)
    await page.getByTestId("pay-confirm").click()
    await expect(page.getByTestId("pay-success")).toBeVisible()
    await page.getByTestId("pay-done").click()

    await page.reload()
    await expect(page.getByTestId("tile-due-now")).toContainText("$0.00")
    await expect(board(page).getByTestId("pay-all-due")).toHaveCount(0)
    await expect(board(page).getByTestId("no-unpaid-invoices")).toContainText("Nothing to pay right now")
  })

  test("Finance settling the payment later shows it as Settled under Payments, and the invoice stays out of Invoices", async ({ page, baseURL }) => {
    const db = await openLiveDb(page)
    const processing = db
      .prepare("select id from payments where company_id = 'client_1' and status = 'initiated' and initiated_at >= ? order by initiated_at desc limit 1")
      .get(startedAt) as { id: string }
    const invoicesOf = db
      .prepare("select i.number from payment_allocations a join invoices i on i.id = a.invoice_id where a.payment_id = ?")
      .all(processing.id) as { number: string }[]
    expect(invoicesOf.length).toBeGreaterThan(0)
    db.close()
    writeLiveDb((writer) =>
      writer
        .prepare("update payments set status = 'succeeded', settled_at = ?, settled_by_user_id = 'user_finance_1' where id = ?")
        .run(Date.now(), processing.id),
    )

    await openFinanceAnyState(page, baseURL!, ACME_HR)
    for (const { number } of invoicesOf) {
      await expect(board(page).getByText(number)).toHaveCount(0)
    }
    await page.getByTestId("tab-payments").click()
    await expect(page.getByTestId("tabpanel-payments").getByTestId("payment-row").and(page.locator(`[data-payment-id="${processing.id}"]`))).toContainText("Settled")
  })

  test("Finance failing a payment puts the invoice back under Invoices and keeps the failed attempt under Payments", async ({ page, baseURL, browser }) => {
    const db = await openLiveDb(page)
    const processing = db
      .prepare("select id from payments where company_id = 'client_1' and status = 'initiated' and initiated_at >= ? order by initiated_at limit 1")
      .get(startedAt) as { id: string }
    const covered = db
      .prepare("select i.id, i.number, i.kind from payment_allocations a join invoices i on i.id = a.invoice_id where a.payment_id = ? order by i.number")
      .all(processing.id) as { id: string; number: string; kind: string }[]
    db.close()
    expect(covered.length).toBeGreaterThan(0)

    await openFinanceAnyState(page, baseURL!, ACME_HR)
    await page.getByTestId("tab-payments").click()
    const processingRow = page.locator(`[data-testid=payment-row][data-payment-id="${processing.id}"]`)
    await expect(processingRow).toContainText("Processing")
    for (const { number } of covered) await expect(board(page).getByText(number)).toHaveCount(0)

    const financeContext = await browser.newContext()
    await signInAs(financeContext, baseURL!, "user_finance_1")
    const finance = await financeContext.newPage()
    await finance.goto("/finance/payments")
    const queueRow = finance.locator(`[data-testid=payment-row][data-payment-id="${processing.id}"]`)
    await queueRow.getByTestId("fail-row").click()
    const dialog = finance.getByTestId("fail-dialog")
    await dialog.getByTestId("reason-input").fill("Bank returned the ACH debit")
    await dialog.getByTestId("action-confirm").click()
    await expect(queueRow).toHaveCount(0)
    await financeContext.close()

    await page.reload()
    await expect(page.getByTestId("finance-summary")).toBeVisible()
    await page.getByTestId("tab-invoices").click()
    for (const { number } of covered) {
      await board(page).getByTestId("invoice-search").fill(number)
      const row = board(page).getByTestId("invoice-row")
      await expect(row).toHaveCount(1)
      await expect(row).toHaveAttribute("data-status", /^(open|overdue)$/)
      await expect(row.getByTestId("invoice-select")).toBeVisible()
    }
    await page.getByTestId("tab-payments").click()
    const failedRow = page.locator(`[data-testid=payment-row][data-payment-id="${processing.id}"]`)
    await expect(failedRow).toHaveAttribute("data-status", "failed")
    await expect(failedRow).toContainText("Bank returned the ACH debit")
    const trigger = failedRow.getByTestId("payment-invoices-trigger")
    if ((await trigger.count()) > 0) await trigger.click()
    const link = ((await trigger.count()) > 0 ? page.getByTestId("payment-invoices-dialog") : failedRow).getByTestId("payment-invoice").first()
    await expect(link).toHaveAttribute("target", "_blank")
    const [popup] = await Promise.all([page.waitForEvent("popup"), link.click()])
    await popup.waitForLoadState()
    await expect(popup.getByTestId("invoice-document")).toHaveAttribute("data-status", /^(open|overdue)$/)
    await expect(popup.getByTestId("invoice-payment").first()).toContainText("Failed")
    await expect(popup.getByTestId("invoice-pay")).toBeVisible()
    await popup.close()
  })
})
