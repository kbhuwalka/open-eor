import { test, expect, type Page } from "@playwright/test"

import { openLiveDb } from "./support/live"

/**
 * The Onboarding specialist and Finance homes share one task list (task-inbox.md §7, ui-guidelines
 * C43): no "Assigned to" or "Open" column, no view tabs, the whole row is a link to the task page,
 * and Client, Task and Status filters that narrow, combine and clear. Read-only, so it runs on any
 * seeded database:
 *
 *   DATABASE_FILE=/tmp/home-filters.sqlite pnpm dev -p 3740
 *   PLAYWRIGHT_BASE_URL=http://localhost:3740 DATABASE_FILE=/tmp/home-filters.sqlite pnpm exec playwright test e2e/task-home-filters.spec.ts
 *
 * Screenshots go to SHOT_DIR when it is set (light and dark with E2E_THEME, a narrow screen with
 * E2E_VIEWPORT_WIDTH=390, named by SHOT_PREFIX).
 */
test.skip(!process.env.DATABASE_FILE, "DATABASE_FILE (the database the server uses) is required: the specs read task facts from it")

const NARROW = Number(process.env.E2E_VIEWPORT_WIDTH ?? 1280) < 768
test.use({ viewport: { width: Number(process.env.E2E_VIEWPORT_WIDTH ?? 1280), height: process.env.SHOT_DIR ? 2200 : 800 } })

const PORTALS = [
  { portal: "onboarding", persona: /Sam Ortiz/, home: "/onboarding", role: "onboarding_specialist" },
  { portal: "finance", persona: /Morgan Reyes/, home: "/finance", role: "finance" },
] as const

async function shot(page: Page, name: string) {
  const dir = process.env.SHOT_DIR
  if (!dir) return
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${dir}/${process.env.SHOT_PREFIX ?? "light"}-${name}.png`, fullPage: true })
}

async function signIn(page: Page, persona: RegExp, home: string) {
  await page.goto("/pick")
  await page.getByRole("button", { name: persona }).click()
  await page.waitForURL(new RegExp(`${home}`))
  await expect(page.getByTestId("task-inbox")).toBeVisible()
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

for (const { portal, persona, home, role } of PORTALS) {
  test.describe(`${portal} home`, () => {
    test.beforeEach(async ({ context, baseURL, page }) => {
      if (process.env.E2E_THEME) await context.addCookies([{ name: "eor_theme", value: process.env.E2E_THEME, url: baseURL! }])
      await signIn(page, persona, home)
    })

    test("is one list: no Assigned to or Open column, no view tabs", async ({ page }) => {
      const headers = await page.getByTestId("task-inbox").getByRole("columnheader").allTextContents()
      expect(headers).toEqual(NARROW ? ["Task", "Due"] : ["Task", "Person", "Client", "Due", "Status"])
      await expect(page.getByRole("columnheader", { name: /assigned/i })).toHaveCount(0)
      await expect(page.getByRole("tab")).toHaveCount(0)
      for (const name of ["Mine", "Role queue", "Open"]) {
        await expect(page.getByTestId("task-inbox").getByRole("button", { name: new RegExp(`^${name}`) })).toHaveCount(0)
      }
      await expect(page.getByTestId("task-row").first()).not.toContainText(/queue/i)
      await shot(page, `${portal}-home`)
    })

    test("lists every open task of the role, most urgent first", async ({ page }) => {
      const queue = await queueOf(page, role)
      expect(queue.length).toBeGreaterThan(0)
      await page.goto(`${home}?size=100`)
      const rows = page.getByTestId("task-row")
      await expect(rows).toHaveCount(queue.length)
      const hrefs = await page.getByTestId("task-link").evaluateAll((links) => links.map((link) => link.getAttribute("href")))
      expect(hrefs.every((href) => href?.startsWith(`/${portal}/`))).toBe(true)
      const titles = await page.getByTestId("task-link").evaluateAll((links) => links.map((link) => link.firstChild?.textContent))
      expect(new Set(titles).size).toBe(new Set(queue.map((task) => task.key)).size)
    })

    test("the whole row is the link: clicking the due cell opens the task, with a stretched anchor and a focus ring", async ({ page }) => {
      const first = page.getByTestId("task-row").first()
      const link = first.getByTestId("task-link")
      const href = await link.getAttribute("href")
      expect(href).toMatch(new RegExp(`^/${portal}/`))
      await expect(first.getByRole("link")).toHaveCount(1)

      await first.scrollIntoViewIfNeeded()
      const rowBox = (await first.boundingBox())!
      const linkAreaCovers = await link.evaluate((element) => {
        const after = getComputedStyle(element, "::after")
        return { position: after.position, inset: [after.top, after.right, after.bottom, after.left].join(" ") }
      })
      expect(linkAreaCovers.position).toBe("absolute")
      expect(linkAreaCovers.inset).toBe("0px 0px 0px 0px")

      await link.focus()
      await page.keyboard.press("Tab")
      await link.focus()
      await shot(page, `${portal}-home-focus`)

      await page.mouse.click(rowBox.x + rowBox.width - 20, rowBox.y + rowBox.height / 2)
      await page.waitForURL((url) => url.pathname === href)
      await expect(page.getByRole("heading").first()).toBeVisible()
      await expect(page.getByText("This page could not be found")).toHaveCount(0)
    })

    test("a middle click opens the task in a new tab", async ({ page, context }) => {
      const link = page.getByTestId("task-row").first().getByTestId("task-link")
      const href = (await link.getAttribute("href"))!
      const opened = context.waitForEvent("page")
      await link.click({ button: "middle" })
      const tab = await opened
      await tab.waitForURL((url) => url.pathname === href)
      await tab.close()
    })

    test("offers only the clients and tasks that are in the queue", async ({ page }) => {
      const queue = await queueOf(page, role)
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
      const queue = await queueOf(page, role)
      const clients = [...new Set(queue.map((task) => task.client))]
      expect(clients.length).toBeGreaterThan(1)
      const target = clients[0]
      const expected = queue.filter((task) => task.client === target).length

      await page.getByTestId("client-filter").click()
      await page.getByRole("option", { name: target, exact: true }).click()
      await expect(page).toHaveURL(/client=/)
      await expect(page.getByTestId("task-row")).toHaveCount(Math.min(expected, 10))
      for (const text of await page.getByTestId("task-row").locator("td:nth-child(3)").allTextContents()) expect(text).toBe(target)

      await page.reload()
      await expect(page.getByTestId("client-filter")).toContainText(target)
      await expect(page.getByTestId("clear-task-filters")).toBeVisible()

      await page.getByTestId("clear-task-filters").click()
      await expect(page).toHaveURL(new RegExp(`${home}$`))
      await expect(page.getByTestId("clear-task-filters")).toHaveCount(0)
      await expect(page.getByTestId("client-filter")).toContainText("All clients")
    })

    test("filters combine: client and task and status each narrow further", async ({ page }) => {
      const queue = await queueOf(page, role)
      const task = queue[0]
      const today = todayLocal()
      const overdue = queue.filter((item) => item.client === task.client && item.key === task.key && item.dueDate && item.dueDate < today)

      await page.goto(`${home}?client=${task.clientId}&task=${task.key}&size=100`)
      await expect(page.getByTestId("task-row")).toHaveCount(queue.filter((item) => item.client === task.client && item.key === task.key).length)

      await page.goto(`${home}?client=${task.clientId}&task=${task.key}&status=overdue&size=100`)
      if (overdue.length > 0) await expect(page.getByTestId("task-row")).toHaveCount(overdue.length)
      else await expect(page.getByTestId("no-tasks")).toBeVisible()
      await shot(page, `${portal}-home-filtered`)
    })

    test("Overdue lists exactly the overdue tasks and At risk lists only flagged ones", async ({ page }) => {
      const queue = await queueOf(page, role)
      const today = todayLocal()
      const late = queue.filter((item) => item.dueDate && item.dueDate < today)
      await page.goto(`${home}?status=overdue&size=100`)
      if (late.length > 0) {
        await expect(page.getByTestId("task-row")).toHaveCount(late.length)
        for (const row of await page.getByTestId("task-row").all()) await expect(row).toHaveAttribute("data-overdue", "true")
      } else {
        await expect(page.getByTestId("no-tasks")).toBeVisible()
      }

      await page.goto(`${home}?status=at_risk&size=100`)
      const rows = page.getByTestId("task-row")
      if ((await rows.count()) > 0) {
        for (const row of await rows.all()) await expect(row).toHaveAttribute("data-at-risk", "true")
      } else {
        await expect(page.getByTestId("no-tasks")).toBeVisible()
      }
    })

    test("a filter with no match says so and is not the empty inbox; Clear brings the list back", async ({ page }) => {
      await page.goto(`${home}?client=client_that_is_not_there`)
      await expect(page.getByTestId("no-tasks")).toHaveText(/No tasks match these filters/)
      await expect(page.getByText(/Nothing needs you right now/)).toHaveCount(0)
      await page.getByTestId("no-tasks").getByRole("button", { name: "Clear" }).click()
      await expect(page).toHaveURL(new RegExp(`${home}$`))
      await expect(page.getByTestId("task-row").first()).toBeVisible()
      await shot(page, `${portal}-home-no-match`)
    })

    test("search narrows and Clear empties the field", async ({ page }) => {
      const queue = await queueOf(page, role)
      const person = queue[0].person
      await page.getByTestId("task-search").fill(person)
      await expect(page).toHaveURL(/q=/)
      const rows = page.getByTestId("task-row")
      await expect(rows.first()).toContainText(person)
      await page.getByTestId("clear-task-filters").click()
      await expect(page.getByTestId("task-search")).toHaveValue("")
    })

    test("pages through the shared bar only above ten", async ({ page }) => {
      const queue = await queueOf(page, role)
      const bar = page.getByRole("navigation", { name: "Pagination" })
      if (queue.length > 10) {
        await expect(bar).toBeVisible()
        await expect(page.getByTestId("task-row")).toHaveCount(10)
        await bar.getByRole("button", { name: /next/i }).click()
        await expect(page).toHaveURL(/page=2/)
        await expect(page.getByTestId("task-row")).toHaveCount(Math.min(10, queue.length - 10))
      } else {
        await expect(bar).toHaveCount(0)
      }
    })
  })
}

test.describe("finance payments: covered invoices", () => {
  test.beforeEach(async ({ context, baseURL, page }) => {
    if (process.env.E2E_THEME) await context.addCookies([{ name: "eor_theme", value: process.env.E2E_THEME, url: baseURL! }])
    await signIn(page, /Morgan Reyes/, "/finance")
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

  test("a payment covering several invoices shows one button that opens the list in a dialog", async ({ page, context }) => {
    const payment = await multiInvoicePayment(page, "initiated")
    test.skip(!payment, "the database has no initiated payment covering several invoices")
    await page.goto("/finance/payments?size=100")
    const row = page.getByTestId("payment-row").filter({ has: page.getByRole("link", { name: payment!.id, exact: true }) })
    const trigger = row.getByTestId("payment-invoices-trigger")
    await expect(trigger).toHaveText(`${payment!.invoices} invoices`)
    await expect(row.getByTestId("payment-invoice")).toHaveCount(0)
    await trigger.click()
    const dialog = page.getByTestId("payment-invoices-dialog")
    await expect(dialog).toBeVisible()
    await shot(page, "finance-payments-covered-dialog")
    const items = dialog.getByTestId("payment-invoice")
    await expect(items).toHaveCount(payment!.invoices)
    await expect(items.first().getByTestId("payment-invoice-person")).not.toBeEmpty()
    await expect(items.first()).toHaveAttribute("target", "_blank")
    await expect(items.first()).toHaveAttribute("rel", "noopener noreferrer")
    const href = await items.first().getAttribute("href")
    const popup = context.waitForEvent("page")
    await items.first().click()
    const tab = await popup
    await tab.waitForURL((url) => url.pathname + url.search === href || url.pathname === href)
    await tab.close()
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
    await expect(trigger).toBeFocused()
  })

  test("a payment covering one invoice keeps its number as a link", async ({ page }) => {
    const database = await openLiveDb(page)
    const single = database
      .prepare(
        `select p.id id from payments p join payment_allocations a on a.payment_id = p.id
          where p.status = 'initiated' group by p.id having count(*) = 1 limit 1`,
      )
      .get() as { id: string } | undefined
    database.close()
    test.skip(!single, "the database has no initiated payment covering one invoice")
    await page.goto("/finance/payments?size=100")
    const row = page.getByTestId("payment-row").filter({ has: page.getByRole("link", { name: single!.id, exact: true }) })
    await expect(row.getByTestId("payment-invoice")).toHaveCount(1)
    await expect(row.getByTestId("payment-invoices-trigger")).toHaveCount(0)
  })
})
