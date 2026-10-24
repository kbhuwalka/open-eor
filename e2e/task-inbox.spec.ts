import type Database from "better-sqlite3"
import { test, expect, type Page } from "@playwright/test"

import { todayIso } from "@/domain/employment-term"
import { sortByUrgency } from "@/lib/task-order"

import { openLiveDb, signInAs } from "./support/live"

/**
 * The four portal homes on the REAL pages, against the seeded database (task-inbox.md): the client's
 * "Needs your attention" panel, the employee's guided list, the specialist's and Finance's one
 * filterable list (whole-row links, ui-guidelines C43), the task route's authorization and finishing
 * a task from each portal's own screen. Ids and counts come from the database, not from names. The
 * tests that change data run serially at the end so the read-only ones never share a task with them.
 *
 *   DATABASE_FILE=/tmp/task-inbox.sqlite UPLOADS_ROOT=/tmp/task-inbox-uploads pnpm db:seed
 *   DATABASE_FILE=/tmp/task-inbox.sqlite UPLOADS_ROOT=/tmp/task-inbox-uploads pnpm exec next dev -p 3750
 *   PLAYWRIGHT_BASE_URL=http://localhost:3750 DATABASE_FILE=/tmp/task-inbox.sqlite pnpm exec playwright test e2e/task-inbox.spec.ts
 */

const SPECIALIST = "user_specialist_1"
const FINANCE = "user_finance_1"
const CLIENT = "user_client_hr"
const OTHER_CLIENT = "user_client_hr_3"
const NOT_FOUND = "This page could not be found"

type ReadyTask = { id: string; type: string; seq: number; dueDate: string | null; caseId: string }

const READY_OF_USER = `SELECT t.id, t.type, t.seq, t.due_date AS dueDate, t.case_id AS caseId
         FROM tasks t JOIN onboarding_cases c ON c.id = t.case_id
        WHERE t.assignee_kind = 'user' AND t.assignee_user_id = ? AND t.status = 'ready' AND c.lifecycle = 'open'`

function readyTasksOf(db: Database.Database, userId: string): ReadyTask[] {
  return db.prepare(READY_OF_USER).all(userId) as ReadyTask[]
}

/** An employee with at least two ready tasks, so "Also to do" and the next-task order are visible. */
function busyEmployees(db: Database.Database): string[] {
  const rows = db
    .prepare(
      `SELECT t.assignee_user_id AS id FROM tasks t JOIN onboarding_cases c ON c.id = t.case_id
        WHERE t.assignee_kind = 'user' AND t.assignee_user_id LIKE 'user_worker%' AND t.status = 'ready' AND c.lifecycle = 'open'
        GROUP BY t.assignee_user_id HAVING COUNT(*) >= 2 ORDER BY t.assignee_user_id`,
    )
    .all() as { id: string }[]
  return rows.map((row) => row.id)
}

function queueSize(db: Database.Database, role: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM tasks t JOIN onboarding_cases c ON c.id = t.case_id
        WHERE t.assignee_kind = 'role' AND t.assignee_role = ? AND t.status = 'ready' AND c.lifecycle = 'open'`,
    )
    .get(role) as { n: number }
  return row.n
}

const roleTasks = (db: Database.Database, role: string) =>
  db
    .prepare(
      `SELECT t.id, t.type, cc.name AS client, u.display_name AS person
         FROM tasks t JOIN onboarding_cases c ON c.id = t.case_id
         JOIN hire_requests h ON h.id = c.hire_request_id
         JOIN client_companies cc ON cc.id = h.client_company_id
         JOIN users u ON u.id = c.worker_user_id
        WHERE t.assignee_kind = 'role' AND t.assignee_role = ? AND t.status = 'ready' AND c.lifecycle = 'open'
        ORDER BY t.due_date IS NULL, t.due_date, t.seq, t.case_id, t.id`,
    )
    .all(role) as { id: string; type: string; client: string; person: string }[]

const taskStatus = (db: Database.Database, id: string) => (db.prepare("SELECT status FROM tasks WHERE id = ?").get(id) as { status: string }).status

/** The row's type, by its link: staff rows carry the task type on `data-task-type`. */
const typesOf = (page: Page) =>
  page.getByTestId("task-row").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-task-type")))

test.describe("client home", () => {
  test("Needs your attention counts the client's own open tasks, and a row opens its action", async ({ page, baseURL }) => {
    const db = await openLiveDb(page)
    const own = readyTasksOf(db, CLIENT)
    expect(own.length).toBeGreaterThan(0)

    await signInAs(page.context(), baseURL!, CLIENT)
    await page.goto("/client")
    const panel = page.getByTestId("attention-panel")
    await expect(panel).toBeVisible()
    await expect(page.getByTestId("attention-count")).toHaveText(String(own.length))
    const rows = page.getByTestId("attention-row")
    await expect(rows).toHaveCount(Math.min(own.length, 3))

    if (own.length > 3) {
      await page.getByTestId("attention-view-all").click()
      await expect(rows).toHaveCount(own.length)
    }

    const deposit = rows.filter({ has: page.locator("[data-task-type=pay_deposit]") }).first()
    await expect(deposit).toBeVisible()
    await deposit.getByTestId("task-action").click()
    const dialog = page.getByTestId("pay-deposit-dialog")
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText("Pay the deposit for")
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId("attention-count")).toHaveText(String(own.length))
  })

  test("another client sees only their own company's tasks, and cannot open this client's task", async ({ page, baseURL }) => {
    const db = await openLiveDb(page)
    const [task] = readyTasksOf(db, CLIENT)
    const theirs = readyTasksOf(db, OTHER_CLIENT)

    await signInAs(page.context(), baseURL!, OTHER_CLIENT)
    await page.goto("/client")
    if (theirs.length > 0) await expect(page.getByTestId("attention-count")).toHaveText(String(theirs.length))
    else await expect(page.getByTestId("attention-panel")).toHaveCount(0)
    await page.goto(`/client/tasks/${task.id}`)
    await expect(page.getByText(NOT_FOUND)).toBeVisible()

    await signInAs(page.context(), baseURL!, CLIENT)
    await page.goto(`/client/tasks/${task.id}`)
    await expect(page.getByText(NOT_FOUND)).toHaveCount(0)
    await expect(page.getByRole("heading").first()).toBeVisible()
  })
})

test.describe("employee home", () => {
  test("the home leads with Continue, which opens the most urgent task", async ({ page, baseURL }) => {
    const db = await openLiveDb(page)
    const [employee] = busyEmployees(db)
    expect(employee).toBeTruthy()
    const ready = readyTasksOf(db, employee)
    const urgent = sortByUrgency(ready, todayIso(new Date()))[0]

    await signInAs(page.context(), baseURL!, employee)
    await page.goto("/worker")
    await expect(page.getByRole("heading", { level: 2 })).toContainText(/^Welcome, .+ — (\d+ of \d+|all \d+) tasks? done$/)
    await expect(page.getByTestId("home-continue")).toBeVisible()

    const nav = page.getByRole("navigation").getByRole("link", { name: /home/i })
    await expect(nav).toContainText(String(ready.length))

    await page.getByTestId("continue-button").click()
    await expect(page).toHaveURL(new RegExp(`/worker/tasks/${urgent.id}$`))
    await expect(page.getByTestId("employee-task")).toHaveAttribute("data-task-type", urgent.type)
    await expect(page.getByTestId("employee-task")).toHaveAttribute("data-task-status", "ready")

    await page.getByRole("link", { name: "Back to your checklist" }).click()
    await expect(page).toHaveURL(/\/worker$/)
  })

  test("another employee cannot open the task, and neither can a client, the specialist or Finance", async ({ page, baseURL }) => {
    const db = await openLiveDb(page)
    const [owner, other] = busyEmployees(db)
    const [task] = readyTasksOf(db, owner)
    const otherEmployee = (
      db.prepare("SELECT id FROM users WHERE role = 'worker' AND id <> ? AND id <> ? LIMIT 1").get(owner, other ?? owner) as { id: string }
    ).id

    for (const [userId, portal] of [
      [otherEmployee, "worker"],
      [CLIENT, "client"],
      [SPECIALIST, "onboarding"],
      [FINANCE, "finance"],
    ] as const) {
      await signInAs(page.context(), baseURL!, userId)
      await page.goto(`/${portal}/tasks/${task.id}`)
      await expect(page.getByText(NOT_FOUND), `${userId} in ${portal}`).toBeVisible()
    }

    await signInAs(page.context(), baseURL!, owner)
    await page.goto(`/worker/tasks/${task.id}`)
    await expect(page.getByTestId("employee-task")).toBeVisible()
    await expect(page.getByText(NOT_FOUND)).toHaveCount(0)
  })
})

test.describe("specialist home", () => {
  test("is one list of every open task the role can see, with the open count to match the database", async ({ page, baseURL }) => {
    const db = await openLiveDb(page)
    const queued = roleTasks(db, "onboarding_specialist")
    expect(queued.length).toBeGreaterThan(0)

    await signInAs(page.context(), baseURL!, SPECIALIST)
    await page.goto("/onboarding?size=100")
    await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible()
    const rows = page.getByTestId("task-row")
    await expect(rows).toHaveCount(queued.length)
    await expect(page.getByTestId("tile-open-value")).toHaveText(String(queued.length))
    await expect(page.getByRole("navigation").getByRole("link", { name: /^Home/ })).toContainText(String(queued.length))

    const types = await typesOf(page)
    expect(types).toContain("review_order")
    expect(types).toContain("verify_i9_section2")
    expect([...types].sort()).toEqual(queued.map((task) => task.type).sort())

    await expect(page.getByRole("tab")).toHaveCount(0)
    await expect(page.getByRole("columnheader", { name: /assigned/i })).toHaveCount(0)
    await expect(page.getByRole("button", { name: /^Open$/ })).toHaveCount(0)
    const overdue = await page.locator("[data-testid=task-row][data-overdue=true]").count()
    if (overdue > 0) await expect(rows.first()).toHaveAttribute("data-overdue", "true")
  })

  test("searches and filters, and a row opens the task page from anywhere on it", async ({ page, baseURL }) => {
    await signInAs(page.context(), baseURL!, SPECIALIST)
    await page.goto("/onboarding?size=100")
    await page.getByTestId("task-search").fill("review the order")
    await expect(page).toHaveURL(/q=review/)
    const rows = page.getByTestId("task-row")
    await expect(rows.first()).toHaveAttribute("data-task-type", "review_order")
    for (const type of await typesOf(page)) expect(type).toBe("review_order")

    const first = rows.first()
    const href = await first.getByTestId("task-link").getAttribute("href")
    expect(href).toMatch(/^\/onboarding\/tasks\/task_/)
    const box = (await first.boundingBox())!
    await page.mouse.click(box.x + box.width - 20, box.y + box.height / 2)
    await expect(page).toHaveURL(new RegExp(`${href}$`))
    await expect(page.getByRole("heading", { name: "Review the order" })).toBeVisible()
  })

  test("a search or filter with no match is not the empty inbox", async ({ page, baseURL }) => {
    await signInAs(page.context(), baseURL!, SPECIALIST)
    await page.goto("/onboarding?q=zzz-no-such-thing")
    await expect(page.getByTestId("no-tasks")).toContainText("No tasks match these filters")
    await expect(page.getByTestId("task-search")).toHaveValue("zzz-no-such-thing")
    await page.getByTestId("no-tasks").getByRole("button", { name: "Clear" }).click()
    await expect(page.getByTestId("task-row").first()).toBeVisible()
  })

  test("the I-9 row opens its own screen, which has no generic Mark complete", async ({ page, baseURL }) => {
    await signInAs(page.context(), baseURL!, SPECIALIST)
    await page.goto("/onboarding?size=100")
    const row = page.locator("[data-testid=task-row][data-task-type=verify_i9_section2]").first()
    await expect(row).toBeVisible()
    await row.getByTestId("task-link").click()
    await expect(page).toHaveURL(/\/onboarding\/tasks\/task_/)
    await expect(page.getByTestId("i9-checklist")).toBeVisible()
    await expect(page.getByRole("button", { name: /mark complete/i })).toHaveCount(0)
  })
})

test.describe("finance home", () => {
  test("lists only the deposits to confirm, each opening the deposits page", async ({ page, baseURL }) => {
    const db = await openLiveDb(page)
    const queued = roleTasks(db, "finance")
    expect(queued.length).toBeGreaterThan(0)

    await signInAs(page.context(), baseURL!, FINANCE)
    await page.goto("/finance")
    const rows = page.getByTestId("task-row")
    await expect(rows).toHaveCount(queued.length)
    for (const type of await typesOf(page)) expect(type).toBe("confirm_deposit")
    await expect(page.getByRole("tab")).toHaveCount(0)
    await expect(page.getByRole("columnheader", { name: /assigned/i })).toHaveCount(0)

    const clients = [...new Set(queued.map((task) => task.client))]
    await page.getByTestId("client-filter").click()
    await page.getByRole("option", { name: clients[0], exact: true }).click()
    await expect(page).toHaveURL(/client=/)
    await expect(rows).toHaveCount(queued.filter((task) => task.client === clients[0]).length)
    await page.getByTestId("clear-task-filters").click()
    await expect(rows).toHaveCount(queued.length)

    await rows.first().getByTestId("task-link").click()
    await expect(page).toHaveURL(/\/finance\/deposits$/)
    await expect(page.getByTestId("deposit-row").first()).toBeVisible()
  })

  test("the specialist and the client cannot open a Finance task", async ({ page, baseURL }) => {
    const db = await openLiveDb(page)
    const [task] = roleTasks(db, "finance")
    for (const [userId, portal] of [
      [SPECIALIST, "onboarding"],
      [CLIENT, "client"],
    ] as const) {
      await signInAs(page.context(), baseURL!, userId)
      await page.goto(`/${portal}/tasks/${task.id}`)
      await expect(page.getByText(NOT_FOUND), `${userId} in ${portal}`).toBeVisible()
    }
  })
})

test.describe("finishing a task", () => {
  test.describe.configure({ mode: "serial" })

  test("the specialist's review goes to the next task with a success message", async ({ page, baseURL }) => {
    const db = await openLiveDb(page)
    const before = queueSize(db, "onboarding_specialist")
    const review = db
      .prepare(
        `SELECT t.id FROM tasks t JOIN onboarding_cases c ON c.id = t.case_id
          WHERE t.type = 'review_order' AND t.status = 'ready' AND t.assignee_role = 'onboarding_specialist' AND c.lifecycle = 'open'
          ORDER BY t.id LIMIT 1`,
      )
      .get() as { id: string } | undefined
    expect(review, "a ready review_order").toBeTruthy()

    await signInAs(page.context(), baseURL!, SPECIALIST)
    await page.goto(`/onboarding/tasks/${review!.id}`)
    await page.getByTestId("approve-order").click()

    await expect(page).toHaveURL(/\/onboarding(\/tasks\/task_[\w-]+)?\?notice=/)
    await expect(page).not.toHaveURL(new RegExp(`/tasks/${review!.id}`))
    await expect(page.getByTestId("task-notice")).toContainText("Review the order is done.")

    expect(taskStatus(db, review!.id)).toBe("done")
    expect(queueSize(db, "onboarding_specialist")).toBeGreaterThanOrEqual(before - 1)

    await page.goto(`/onboarding/tasks/${review!.id}`)
    await expect(page.getByTestId("order-approved")).toBeVisible()
    await expect(page.getByTestId("approve-order")).toHaveCount(0)
  })

  test("an employee accepts the invitation on its screen and the next step opens up", async ({ page, baseURL }) => {
    const db = await openLiveDb(page)
    const candidate = db
      .prepare(
        `SELECT t.id, t.case_id AS caseId, t.assignee_user_id AS userId FROM tasks t
           JOIN onboarding_cases c ON c.id = t.case_id
          WHERE t.type = 'accept_invitation' AND t.status = 'ready' AND c.lifecycle = 'open'
          ORDER BY t.assignee_user_id DESC LIMIT 1`,
      )
      .get() as { id: string; caseId: string; userId: string } | undefined
    test.skip(!candidate, "no employee left with an invitation to accept in this database")

    await signInAs(page.context(), baseURL!, candidate!.userId)
    await page.goto("/worker")
    await page.getByTestId("continue-button").click()
    await expect(page).toHaveURL(new RegExp(`/worker/tasks/${candidate!.id}$`))
    await expect(page.getByTestId("employee-task")).toHaveAttribute("data-task-type", "accept_invitation")
    await page.getByTestId("accept-invitation").click()

    await expect(page.getByTestId("task-notice")).toBeVisible()
    expect(taskStatus(db, candidate!.id)).toBe("done")
    const next = db
      .prepare("SELECT status FROM tasks WHERE case_id = ? AND type = 'sign_agreement' AND assignee_user_id = ? ORDER BY seq DESC LIMIT 1")
      .get(candidate!.caseId, candidate!.userId) as { status: string } | undefined
    expect(next?.status).toBe("ready")
  })

  test("the client pays a deposit from the home panel: the row goes and Finance gets a task", async ({ page, baseURL }) => {
    const db = await openLiveDb(page)
    const count = (type: string) =>
      readyTasksOf(db, CLIENT).filter((task) => task.type === type).length
    const before = readyTasksOf(db, CLIENT).length
    const deposits = count("pay_deposit")
    test.skip(deposits === 0, "the client has no deposit left to pay in this database")
    const financeBefore = roleTasks(db, "finance").length

    await signInAs(page.context(), baseURL!, CLIENT)
    await page.goto("/client")
    await page.getByTestId("attention-view-all").click().catch(() => undefined)
    const row = page.locator("[data-testid=attention-row][data-task-type=pay_deposit]").first()
    await row.getByTestId("task-action").click()
    await page.getByTestId("confirm-pay-deposit").click()

    await expect(page.getByTestId("task-notice")).toBeVisible()
    await expect(page.getByTestId("attention-count")).toHaveText(String(before - 1))
    expect(count("pay_deposit")).toBe(deposits - 1)

    await signInAs(page.context(), baseURL!, FINANCE)
    await page.goto("/finance")
    await expect(page.getByTestId("task-row")).toHaveCount(financeBefore + 1)
    expect(roleTasks(db, "finance")).toHaveLength(financeBefore + 1)
  })
})
