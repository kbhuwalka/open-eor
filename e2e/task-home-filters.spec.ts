import { test, expect, type Page } from "@playwright/test"

import { openLiveDb } from "./support/live"

/**
 * The Onboarding specialist home's filters (task-inbox.md §7, ui-guidelines C43): Client, Task and
 * Status filters that narrow, combine and clear, and a search, over grouped rows opening a drawer
 * (e2e/task-inbox.spec.ts), whose collapsed groups `showAll` opens here. Finance has no task list:
 * its Home is the action tiles and "Waiting on you" (e2e/finance-home.spec.ts); the Payments
 * covered-invoices checks below sign in as Finance.
 * Read-only, so it runs on any seeded database:
 *
 *   DATABASE_FILE=/tmp/home-filters.sqlite pnpm dev -p 3740
 *   PLAYWRIGHT_BASE_URL=http://localhost:3740 DATABASE_FILE=/tmp/home-filters.sqlite pnpm exec playwright test e2e/task-home-filters.spec.ts
 *
 * Screenshots go to SHOT_DIR when it is set (light and dark with E2E_THEME, a narrow screen with
 * E2E_VIEWPORT_WIDTH=390, named by SHOT_PREFIX).
 */
test.skip(!process.env.DATABASE_FILE, "DATABASE_FILE (the database the server uses) is required: the specs read task facts from it")

test.use({ viewport: { width: Number(process.env.E2E_VIEWPORT_WIDTH ?? 1280), height: process.env.SHOT_DIR ? 2200 : 800 } })

const HOME = "/onboarding"
const ROLE = "onboarding_specialist"

async function shot(page: Page, name: string) {
  const dir = process.env.SHOT_DIR
  if (!dir) return
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${dir}/${process.env.SHOT_PREFIX ?? "light"}-${name}.png`, fullPage: true })
}

/** The specialist home starts with "Later" collapsed; counting every task needs it open. */
async function showAll(page: Page) {
  for (const toggle of await page.locator("[data-testid=task-section] button[aria-expanded=false]").all()) await toggle.click()
}

async function signIn(page: Page, persona: RegExp, home: string, landmark: string) {
  await page.goto("/pick")
  await page.getByRole("button", { name: persona }).click()
  await page.waitForURL(new RegExp(`${home}`))
  await expect(page.getByTestId(landmark)).toBeVisible()
}

type OpenTask = { id: string; key: string; clientId: string; client: string; person: string; dueDate: string | null }

/** The ready tasks the role's queue holds, as the database has them: the oracle for the page. */
async function queueOf(page: Page, role: string): Promise<OpenTask[]> {
  const database = await openLiveDb(page)
  try {
    return database
      .prepare(
        `select t.id id, t.key key, h.client_company_id clientId, cc.name client, u.display_name person, t.due_date dueDate
           from tasks t
           join onboarding_cases c on c.id = t.case_id and c.lifecycle = 'open'
           join hire_requests h on h.id = c.hire_request_id
           join client_companies cc on cc.id = h.client_company_id
           join users u on u.id = c.worker_user_id
          where t.status = 'ready' and t.assignee_kind = 'role' and t.assignee_role = ?
          order by t.due_date is null, t.due_date, t.seq, t.case_id, t.id`,
      )
      .all(role) as OpenTask[]
  } finally {
    database.close()
  }
}

const todayLocal = () => new Date().toLocaleDateString("en-CA")

test.describe("onboarding home", () => {
  test.beforeEach(async ({ context, baseURL, page }) => {
    if (process.env.E2E_THEME) await context.addCookies([{ name: "eor_theme", value: process.env.E2E_THEME, url: baseURL! }])
    await signIn(page, /Sam Ortiz/, HOME, "task-inbox")
  })

  test("lists every open task of the role, most urgent first", async ({ page }) => {
    const queue = await queueOf(page, ROLE)
    expect(queue.length).toBeGreaterThan(0)
    await page.goto(`${HOME}?size=100`)
    await showAll(page)
    const rows = page.getByTestId("task-row")
    await expect(rows).toHaveCount(queue.length)
    const hrefs = await page.getByTestId("task-link").evaluateAll((links) => links.map((link) => link.getAttribute("href")))
    expect(hrefs.every((href) => href?.startsWith("/onboarding?open="))).toBe(true)
    const titles = await page.getByTestId("task-link").evaluateAll((links) => links.map((link) => link.firstChild?.textContent))
    expect(new Set(titles).size).toBe(new Set(queue.map((task) => task.key)).size)
  })

  test("a middle click opens the task in a new tab", async ({ page, context }) => {
    const link = page.getByTestId("task-row").first().getByTestId("task-link")
    const href = (await link.getAttribute("href"))!
    const opened = context.waitForEvent("page")
    await link.click({ button: "middle" })
    const tab = await opened
    await tab.waitForURL((url) => url.pathname + url.search === href)
    await tab.close()
  })

  test("offers only the clients and tasks that are in the queue", async ({ page }) => {
    const queue = await queueOf(page, ROLE)
    const clients = [...new Set(queue.map((task) => task.client))].sort((a, b) => a.localeCompare(b))
    const options = async (filter: string) => {
      await page.getByTestId(filter).click()
      await expect(page.getByRole("option").first()).toBeVisible()
      const names = await page.getByRole("option").allTextContents()
      await page.keyboard.press("Escape")
      await expect(page.getByRole("option")).toHaveCount(0)
      return names
    }
    expect(await options("client-filter")).toEqual(["All clients", ...clients])
    expect(await options("status-filter")).toEqual(["All statuses", "Overdue", "At risk", "Due this week"])
    expect((await options("task-filter")).length - 1).toBe(new Set(queue.map((task) => task.key)).size)
  })

  test("a client filter narrows, shows in the URL, survives a reload and Clear resets it", async ({ page }) => {
    const queue = await queueOf(page, ROLE)
    const clients = [...new Set(queue.map((task) => task.client))]
    expect(clients.length).toBeGreaterThan(1)
    const target = clients[0]
    const expected = queue.filter((task) => task.client === target).length

    await page.getByTestId("client-filter").click()
    await page.getByRole("option", { name: target, exact: true }).click()
    await expect(page).toHaveURL(/client=/)
    await showAll(page)
    await expect(page.getByTestId("task-row")).toHaveCount(expected)
    for (const row of await page.getByTestId("task-row").all()) await expect(row).toContainText(target)

    await page.reload()
    await expect(page.getByTestId("client-filter")).toContainText(target)
    await expect(page.getByTestId("clear-task-filters")).toBeVisible()

    await page.getByTestId("clear-task-filters").click()
    await expect(page).toHaveURL(new RegExp(`${HOME}$`))
    await expect(page.getByTestId("clear-task-filters")).toHaveCount(0)
    await expect(page.getByTestId("client-filter")).toContainText("All clients")
  })

  test("filters combine: client and task and status each narrow further", async ({ page }) => {
    const queue = await queueOf(page, ROLE)
    const task = queue[0]
    const today = todayLocal()
    const overdue = queue.filter((item) => item.client === task.client && item.key === task.key && item.dueDate && item.dueDate < today)

    await page.goto(`${HOME}?client=${task.clientId}&task=${task.key}&size=100`)
    await showAll(page)
    await expect(page.getByTestId("task-row")).toHaveCount(queue.filter((item) => item.client === task.client && item.key === task.key).length)

    await page.goto(`${HOME}?client=${task.clientId}&task=${task.key}&status=overdue&size=100`)
    await showAll(page)
    if (overdue.length > 0) await expect(page.getByTestId("task-row")).toHaveCount(overdue.length)
    else await expect(page.getByTestId("no-tasks")).toBeVisible()
    await shot(page, "onboarding-home-filtered")
  })

  test("Overdue lists exactly the overdue tasks and At risk lists only flagged ones", async ({ page }) => {
    const queue = await queueOf(page, ROLE)
    const today = todayLocal()
    const late = queue.filter((item) => item.dueDate && item.dueDate < today)
    await page.goto(`${HOME}?status=overdue&size=100`)
    await showAll(page)
    if (late.length > 0) {
      await expect(page.getByTestId("task-row")).toHaveCount(late.length)
      for (const row of await page.getByTestId("task-row").all()) await expect(row).toHaveAttribute("data-overdue", "true")
    } else {
      await expect(page.getByTestId("no-tasks")).toBeVisible()
    }

    await page.goto(`${HOME}?status=at_risk&size=100`)
    await showAll(page)
    const rows = page.getByTestId("task-row")
    if ((await rows.count()) > 0) {
      for (const row of await rows.all()) await expect(row).toHaveAttribute("data-at-risk", "true")
    } else {
      await expect(page.getByTestId("no-tasks")).toBeVisible()
    }
  })

  test("a filter with no match says so and is not the empty inbox; Clear brings the list back", async ({ page }) => {
    await page.goto(`${HOME}?client=client_that_is_not_there`)
    await expect(page.getByTestId("no-tasks")).toHaveText(/No tasks match these filters/)
    await expect(page.getByText(/Nothing needs you right now/)).toHaveCount(0)
    await page.getByTestId("no-tasks").getByRole("button", { name: "Clear" }).click()
    await expect(page).toHaveURL(new RegExp(`${HOME}$`))
    await showAll(page)
    await expect(page.getByTestId("task-row").first()).toBeVisible()
    await shot(page, "onboarding-home-no-match")
  })

  test("search narrows and Clear empties the field", async ({ page }) => {
    const queue = await queueOf(page, ROLE)
    const person = queue[0].person
    await showAll(page)
    await page.getByTestId("task-search").fill(person)
    await expect(page).toHaveURL(/q=/)
    const rows = page.getByTestId("task-row")
    await expect(rows.first()).toContainText(person)
    await page.getByTestId("clear-task-filters").click()
    await expect(page.getByTestId("task-search")).toHaveValue("")
  })
})

test.describe("finance payments: covered invoices", () => {
  test.beforeEach(async ({ context, baseURL, page }) => {
    if (process.env.E2E_THEME) await context.addCookies([{ name: "eor_theme", value: process.env.E2E_THEME, url: baseURL! }])
    await signIn(page, /Morgan Reyes/, "/finance", "waiting-on-you")
  })

  async function multiInvoicePayment(page: Page, status: string) {
    const database = await openLiveDb(page)
    try {
      return database
        .prepare(
          `select p.id id, count(*) invoices from payments p join payment_allocations a on a.payment_id = p.id
            where p.status = ? group by p.id having count(*) > 1 order by p.initiated_at desc, p.id limit 1`,
        )
        .get(status) as { id: string; invoices: number } | undefined
    } finally {
      database.close()
    }
  }

  test("a payment covering several invoices says how many, and its drawer lists each, opening in place with Back", async ({ page }) => {
    const payment = await multiInvoicePayment(page, "initiated")
    test.skip(!payment, "the database has no initiated payment covering several invoices")
    await page.goto("/finance/payments?size=100")
    const row = page.locator(`[data-testid=payment-row][data-payment-id="${payment!.id}"]`)
    await expect(row.getByTestId("payment-detail")).toContainText(`${payment!.invoices} invoices`)
    await row.getByTestId("payment-open").click()
    const drawer = page.getByTestId("payment-drawer")
    const items = drawer.getByTestId("payment-invoice")
    await expect(items).toHaveCount(payment!.invoices)
    await expect(items.first().getByTestId("payment-invoice-person")).not.toBeEmpty()
    await shot(page, "finance-payments-covered-drawer")
    const number = (await items.first().getByTestId("payment-invoice-number").innerText()).trim()
    await items.first().getByTestId("payment-invoice-open").click()
    const invoice = page.getByTestId("invoice-drawer")
    await expect(invoice.getByTestId("drawer-number")).toHaveText(number)
    await invoice.getByTestId("drawer-back").click()
    await expect(page.getByTestId("payment-drawer").getByTestId("payment-invoice")).toHaveCount(payment!.invoices)
  })

  test("a payment covering one invoice names it in the row", async ({ page }) => {
    const database = await openLiveDb(page)
    const single = database
      .prepare(
        `select p.id id, i.number number from payments p join payment_allocations a on a.payment_id = p.id join invoices i on i.id = a.invoice_id
          where p.status = 'initiated' group by p.id having count(*) = 1 limit 1`,
      )
      .get() as { id: string; number: string } | undefined
    database.close()
    test.skip(!single, "the database has no initiated payment covering one invoice")
    await page.goto("/finance/payments?size=100")
    const row = page.locator(`[data-testid=payment-row][data-payment-id="${single!.id}"]`)
    await expect(row.getByTestId("payment-detail")).toContainText(single!.number)
  })
})
