import type Database from "better-sqlite3"
import { test, expect, type Page } from "@playwright/test"

import { todayIso } from "@/domain/employment-term"
import { WAITING_LIMIT } from "@/lib/finance-home-view"
import { sortByUrgency } from "@/lib/task-order"

import { openLiveDb, signInAs } from "./support/live"

/**
 * The four portal homes on the REAL pages, against the seeded database (task-inbox.md): the client
 * Home's "To do", the employee's guided list, the specialist's one filterable list (whole-row
 * links, ui-guidelines C43), Finance's deposits to confirm waiting at the top of the Finance Home's
 * "To do" (finance-portal.md), the task route's authorization and finishing a task from
 * each portal's own screen. Ids and counts come from the database, not from names. The
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

/** Each deposit Finance must confirm, with the client's payment of it that is waiting to be settled. */
const depositsToConfirm = (db: Database.Database) =>
  db
    .prepare(
      `SELECT t.id AS taskId, p.id AS paymentId
         FROM tasks t JOIN onboarding_cases c ON c.id = t.case_id
         LEFT JOIN invoices i ON i.hire_id = c.hire_request_id AND i.kind = 'deposit'
         LEFT JOIN payment_allocations a ON a.invoice_id = i.id
         LEFT JOIN payments p ON p.id = a.payment_id AND p.status = 'initiated'
        WHERE t.assignee_kind = 'role' AND t.assignee_role = 'finance' AND t.status = 'ready' AND c.lifecycle = 'open'
        ORDER BY t.id`,
    )
    .all() as { taskId: string; paymentId: string | null }[]

const initiatedDeposits = (db: Database.Database) =>
  (
    db
      .prepare(
        `SELECT DISTINCT p.id FROM payments p JOIN payment_allocations a ON a.payment_id = p.id JOIN invoices i ON i.id = a.invoice_id
          WHERE p.status = 'initiated' AND i.kind = 'deposit'`,
      )
      .all() as { id: string }[]
  ).map((row) => row.id)

const initiatedCount = (db: Database.Database) =>
  (db.prepare("SELECT COUNT(*) AS n FROM payments WHERE status = 'initiated'").get() as { n: number }).n

const taskStatus = (db: Database.Database, id: string) => (db.prepare("SELECT status FROM tasks WHERE id = ?").get(id) as { status: string }).status

/** The row's type, by its link: staff rows carry the task type on `data-task-type`. */
const typesOf = (page: Page) =>
  page.getByTestId("task-row").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-task-type")))

test.describe("client home", () => {
  test("To do counts the client's own open tasks, and a row's button opens its dialog in place", async ({ page, baseURL }) => {
    const db = await openLiveDb(page)
    const own = readyTasksOf(db, CLIENT)
    expect(own.length).toBeGreaterThan(0)

    await signInAs(page.context(), baseURL!, CLIENT)
    await page.goto("/client")
    await expect(page.getByTestId("todo-count")).toHaveText(`· ${own.length}`)
    const rows = page.getByTestId("todo-row")
    await expect(rows).toHaveCount(Math.min(own.length, 3))

    if (own.length > 3) {
      await page.getByTestId("todo-view-all").click()
      await expect(rows).toHaveCount(own.length)
    }

    const deposit = page.locator("[data-testid=todo-row][data-task-type=pay_deposit]").first()
    await expect(deposit).toBeVisible()
    await deposit.getByTestId("task-action").click()
    const dialog = page.getByTestId("pay-deposit-dialog")
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText("Pay the deposit for")
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId("todo-count")).toHaveText(`· ${own.length}`)
  })

  test("another client sees only their own company's tasks, and cannot open this client's task", async ({ page, baseURL }) => {
    const db = await openLiveDb(page)
    const [task] = readyTasksOf(db, CLIENT)
    const theirs = readyTasksOf(db, OTHER_CLIENT)

    await signInAs(page.context(), baseURL!, OTHER_CLIENT)
    await page.goto("/client")
    if (theirs.length > 0) await expect(page.getByTestId("todo-count")).toHaveText(`· ${theirs.length}`)
    else await expect(page.getByTestId("todo-empty")).toBeVisible()
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
    await page.goto("/onboarding?group=task")
    await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible()
    const rows = page.getByTestId("task-row")
    await expect(rows).toHaveCount(queued.length)
    await expect(page.getByTestId("tile-open-value")).toHaveCount(0)
    await expect(page.getByRole("navigation").getByRole("link", { name: /^Home/ })).toContainText(String(queued.length))

    const types = await typesOf(page)
    expect(types).toContain("review_order")
    expect(types).toContain("verify_i9_section2")
    expect([...types].sort()).toEqual(queued.map((task) => task.type).sort())

    await expect(page.getByRole("tab")).toHaveCount(0)
    await expect(page.getByRole("columnheader", { name: /assigned/i })).toHaveCount(0)
    await expect(page.getByRole("button", { name: /^Open$/ })).toHaveCount(0)
    await expect(page.getByRole("columnheader")).toHaveCount(0)
  })

  test("groups by urgency with Later collapsed, or by task, and keeps the grouping in the URL", async ({ page, baseURL }) => {
    await signInAs(page.context(), baseURL!, SPECIALIST)
    await page.goto("/onboarding")
    const sections = page.getByTestId("task-section")
    const keys = await sections.evaluateAll((els) => els.map((el) => el.getAttribute("data-section")))
    expect(keys.every((key) => ["overdue", "week", "later"].includes(key ?? ""))).toBe(true)
    const later = page.locator("[data-testid=task-section][data-section=later]")
    if ((await later.count()) > 0) {
      await expect(later.getByTestId("task-row")).toHaveCount(0)
      await later.getByRole("button", { name: /later/i }).click()
      await expect(later.getByTestId("task-row").first()).toBeVisible()
    }
    for (const row of await page.locator("[data-testid=task-section][data-section=overdue] [data-testid=task-row]").all()) {
      await expect(row).toHaveAttribute("data-overdue", "true")
    }

    await page.getByTestId("group-select").click()
    await page.getByRole("option", { name: "Group by task" }).click()
    await expect(page).toHaveURL(/group=task/)
    const taskKeys = await sections.evaluateAll((els) => els.map((el) => el.getAttribute("data-section")))
    expect(taskKeys).toContain("review_order")
    for (const section of await sections.all()) {
      const type = await section.getAttribute("data-section")
      for (const row of await section.getByTestId("task-row").all()) await expect(row).toHaveAttribute("data-task-type", type!)
    }
  })

  test("searches and filters, and a row opens the drawer from anywhere on it, where the task is done", async ({ page, baseURL }) => {
    await signInAs(page.context(), baseURL!, SPECIALIST)
    await page.goto("/onboarding?group=task")
    await page.getByTestId("task-search").fill("review the order")
    await expect(page).toHaveURL(/q=review/)
    const rows = page.getByTestId("task-row")
    await expect(rows.first()).toHaveAttribute("data-task-type", "review_order")
    for (const type of await typesOf(page)) expect(type).toBe("review_order")

    const first = rows.first()
    const href = await first.getByTestId("task-link").getAttribute("href")
    expect(href).toMatch(/^\/onboarding\?open=task_/)
    const box = (await first.boundingBox())!
    await page.mouse.click(box.x + box.width - 20, box.y + box.height / 2)
    const drawer = page.getByTestId("task-drawer")
    await expect(drawer).toBeVisible()
    await expect(page).toHaveURL(/\/onboarding\?/)
    await expect(drawer).toContainText("Review the order")
    await expect(drawer.getByTestId("drawer-stepper")).toContainText(/^1 of \d+/)
    await expect(drawer.getByTestId("approve-order")).toBeVisible()
  })

  test("the drawer steps through the list and the keyboard moves and opens rows", async ({ page, baseURL }) => {
    await signInAs(page.context(), baseURL!, SPECIALIST)
    await page.goto("/onboarding?group=task")
    await expect(page.getByTestId("task-row").first()).toBeVisible()
    // The first key press can land before the page has hydrated.
    await expect(async () => {
      await page.keyboard.press("j")
      await expect(page.locator("[data-testid=task-row][data-cursor=true]")).toHaveCount(1, { timeout: 500 })
    }).toPass()
    await page.keyboard.press("Enter")
    const drawer = page.getByTestId("task-drawer")
    await expect(drawer).toBeVisible()
    const first = await drawer.getByRole("heading").first().innerText()
    const person = async () => (await drawer.locator("[data-slot=dialog-description]").innerText()).trim()
    const firstPerson = await person()
    const position = async () => Number(/^(\d+) of/.exec((await drawer.getByTestId("drawer-stepper").innerText()).trim())![1])
    const before = await position()
    await drawer.getByRole("button", { name: "Next task" }).click()
    await expect.poll(position).toBe(before + 1)
    expect(first).toBeTruthy()
    await expect.poll(person).not.toBe(firstPerson)
    await page.keyboard.press("Escape")
    await expect(drawer).toHaveCount(0)
  })

  test("a search or filter with no match is not the empty inbox", async ({ page, baseURL }) => {
    await signInAs(page.context(), baseURL!, SPECIALIST)
    await page.goto("/onboarding?q=zzz-no-such-thing")
    await expect(page.getByTestId("no-tasks")).toContainText("No tasks match these filters")
    await expect(page.getByTestId("task-search")).toHaveValue("zzz-no-such-thing")
    await page.getByTestId("no-tasks").getByRole("button", { name: "Clear" }).click()
    await expect(page.getByTestId("task-row").first()).toBeVisible()
  })

  test("the I-9 row opens its own review in the drawer, which has no generic Mark complete", async ({ page, baseURL }) => {
    await signInAs(page.context(), baseURL!, SPECIALIST)
    await page.goto("/onboarding?group=task")
    const row = page.locator("[data-testid=task-row][data-task-type=verify_i9_section2]").first()
    await expect(row).toBeVisible()
    await row.getByTestId("task-link").click()
    await expect(page.getByTestId("task-drawer")).toBeVisible()
    await expect(page.getByTestId("document-viewer")).toBeVisible()
    await expect(page.getByTestId("verify-and-sign")).toBeVisible()
    await expect(page.getByTestId("open-send-back")).toBeVisible()
    await expect(page.getByRole("button", { name: /mark complete/i })).toHaveCount(0)
  })
})

test.describe("finance home", () => {
  test("every deposit to confirm waits at the top of To do, its row opening the payment", async ({ page, baseURL }) => {
    const db = await openLiveDb(page)
    const queued = roleTasks(db, "finance")
    expect(queued.length).toBeGreaterThan(0)
    expect(queued.every((task) => task.type === "confirm_deposit")).toBe(true)
    const toConfirm = depositsToConfirm(db)
    expect(toConfirm).toHaveLength(queued.length)
    for (const deposit of toConfirm) expect(deposit.paymentId, `${deposit.taskId}'s deposit payment`).toBeTruthy()
    const deposits = initiatedDeposits(db)
    expect(deposits.length).toBeLessThanOrEqual(WAITING_LIMIT)

    await signInAs(page.context(), baseURL!, FINANCE)
    await page.goto("/finance")
    await expect(page.getByTestId("task-row")).toHaveCount(0)
    await expect(page.getByRole("tab")).toHaveCount(0)
    await expect(page.getByTestId("client-filter")).toHaveCount(0)

    const rows = page.getByTestId("waiting-row")
    const shown = await rows.evaluateAll((items) =>
      items.map((item) => ({ id: item.getAttribute("data-payment-id")!, deposit: item.getAttribute("data-deposit") === "true" })),
    )
    expect(shown.slice(0, deposits.length).every((row) => row.deposit)).toBe(true)
    expect(shown.slice(deposits.length).some((row) => row.deposit)).toBe(false)
    expect(shown.filter((row) => row.deposit).map((row) => row.id)).toEqual(expect.arrayContaining(toConfirm.map((row) => row.paymentId)))

    const paymentId = toConfirm[0].paymentId!
    const row = page.locator(`[data-testid=waiting-row][data-payment-id="${paymentId}"]`)
    await expect(row).toHaveAttribute("data-deposit", "true")
    await row.getByTestId("waiting-open").click()
    await expect(page).toHaveURL(`/finance/payments?open=${paymentId}`)
    await expect(page.getByTestId("payment-drawer").getByTestId("payment-reference")).toHaveText(paymentId)
    await expect(page.locator(`[data-testid=payment-row][data-payment-id="${paymentId}"]`)).toHaveAttribute("data-deposit", "true")
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

  test("approving in the drawer moves on to the next task and says what was done", async ({ page, baseURL }) => {
    const db = await openLiveDb(page)
    const before = queueSize(db, "onboarding_specialist")
    const review = db
      .prepare(
        `SELECT t.id, u.display_name AS person FROM tasks t JOIN onboarding_cases c ON c.id = t.case_id JOIN users u ON u.id = c.worker_user_id
          WHERE t.type = 'review_order' AND t.status = 'ready' AND t.assignee_role = 'onboarding_specialist' AND c.lifecycle = 'open'
          ORDER BY t.id LIMIT 1`,
      )
      .get() as { id: string; person: string } | undefined
    expect(review, "a ready review_order").toBeTruthy()

    await signInAs(page.context(), baseURL!, SPECIALIST)
    await page.goto(`/onboarding?open=${review!.id}`)
    await page.getByTestId("approve-order").click()

    await expect.poll(() => taskStatus(db, review!.id), { timeout: 30_000 }).toBe("done")
    await expect(page.getByTestId("drawer-notice")).toContainText("Order approved")
    await expect(page.getByTestId("task-drawer")).not.toContainText(review!.person)
    expect(queueSize(db, "onboarding_specialist")).toBeGreaterThanOrEqual(before - 1)
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

  test("the client pays a deposit from To do on the Home: the row goes, Finance gets a task and the payment waits on its Home", async ({
    page,
    baseURL,
  }) => {
    const db = await openLiveDb(page)
    const count = (type: string) =>
      readyTasksOf(db, CLIENT).filter((task) => task.type === type).length
    const before = readyTasksOf(db, CLIENT).length
    const deposits = count("pay_deposit")
    test.skip(deposits === 0, "the client has no deposit left to pay in this database")
    const financeBefore = roleTasks(db, "finance").length
    const depositsBefore = initiatedDeposits(db)
    const waitingBefore = initiatedCount(db)

    await signInAs(page.context(), baseURL!, CLIENT)
    await page.goto("/client")
    if (before > 3) await page.getByTestId("todo-view-all").click()
    const row = page.locator("[data-testid=todo-row][data-task-type=pay_deposit]").first()
    await row.getByTestId("task-action").click()
    await page.getByTestId("confirm-pay-deposit").click()

    await expect(page.getByTestId("task-notice")).toBeVisible()
    await expect(page.getByTestId("todo-count")).toHaveText(`· ${before - 1}`)
    expect(count("pay_deposit")).toBe(deposits - 1)

    expect(roleTasks(db, "finance")).toHaveLength(financeBefore + 1)
    const paid = initiatedDeposits(db).filter((id) => !depositsBefore.includes(id))
    expect(paid).toHaveLength(1)
    expect(depositsToConfirm(db).map((row) => row.paymentId)).toContain(paid[0])

    await signInAs(page.context(), baseURL!, FINANCE)
    await page.goto("/finance")
    const waiting = page.getByTestId("waiting-on-you")
    await expect(waiting.getByTestId("waiting-count")).toHaveText(String(waitingBefore + 1))
    await expect(page.getByRole("navigation").getByRole("link", { name: /^Payments/ })).toContainText(String(waitingBefore + 1))
    if (depositsBefore.length < WAITING_LIMIT) {
      await expect(waiting.locator(`[data-testid=waiting-row][data-payment-id="${paid[0]}"]`)).toHaveAttribute("data-deposit", "true")
    }
  })
})
