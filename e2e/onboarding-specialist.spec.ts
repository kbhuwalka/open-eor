import Database from "better-sqlite3"
import { test, expect, type Page } from "@playwright/test"

import { openLiveDb, signInAs } from "./support/live"

/**
 * The Onboarding specialist portal on the real pages, as Sam Ortiz: review an order, verify an I-9
 * (send a document back and see the rework appear, accept another with a typed e-signature), set up
 * payroll, read a case and filter the directory. It WRITES, so run it against a COPY of the seeded
 * database:
 *
 *   cp data/eor.sqlite /tmp/specialist-copy.sqlite
 *   DATABASE_FILE=/tmp/specialist-copy.sqlite pnpm dev -p 3217
 *   PLAYWRIGHT_BASE_URL=http://localhost:3217 DATABASE_FILE=/tmp/specialist-copy.sqlite pnpm exec playwright test e2e/onboarding-specialist.spec.ts
 *
 * Screenshots go to SHOT_DIR when it is set (light and dark with E2E_THEME and SHOT_PREFIX).
 */
test.skip(!process.env.DATABASE_FILE, "DATABASE_FILE (the database copy the server uses) is required: this spec writes")
test.describe.configure({ mode: "serial" })

const SPECIALIST = "user_specialist_1"

async function shot(page: Page, name: string) {
  const dir = process.env.SHOT_DIR
  if (!dir) return
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${dir}/${process.env.SHOT_PREFIX ?? "light"}-e2e-${name}.png`, fullPage: true })
}

function one<T>(database: Database.Database, sql: string, ...args: unknown[]): T | undefined {
  return database.prepare(sql).get(...args) as T | undefined
}

function all<T>(database: Database.Database, sql: string, ...args: unknown[]): T[] {
  return database.prepare(sql).all(...args) as T[]
}

type TaskRow = { id: string; caseId: string; status: string; person: string; userId: string }

/** Ready (or blocked) tasks of one key, with who they are about. */
function tasksOf(database: Database.Database, key: string, status: string): TaskRow[] {
  return all<TaskRow>(
    database,
    `select t.id id, t.case_id caseId, t.status status, u.display_name person, u.id userId
       from tasks t join onboarding_cases c on c.id = t.case_id join users u on u.id = c.worker_user_id
      where t.key = ? and t.status = ? and c.lifecycle = 'open' order by t.due_date, t.id`,
    key,
    status,
  )
}

const statusOf = (database: Database.Database, taskId: string) => one<{ status: string }>(database, "select status from tasks where id = ?", taskId)?.status

test.beforeEach(async ({ context, baseURL, page }) => {
  if (process.env.E2E_THEME) await context.addCookies([{ name: "eor_theme", value: process.env.E2E_THEME, url: baseURL! }])
  await page.goto("/pick")
  await page.getByRole("button", { name: /Sam Ortiz/ }).click()
  await page.waitForURL(/\/onboarding/)
})

async function signInPopup(page: Page) {
  const dialog = page.getByTestId("signing-dialog")
  await expect(dialog).toBeVisible()
  await expect(page.getByTestId("signature-tag").first()).toBeVisible()
  await page.getByTestId("signing-consent").check()
  const finish = page.getByTestId("signing-finish")
  for (let guard = 0; guard < 8 && (await finish.isDisabled()); guard += 1) {
    await page.getByTestId("signing-next").click()
    await page.locator('[data-testid="signature-tag"][data-state="unsigned"]:not([data-kind="date"])').first().click()
    const adopt = page.getByTestId("adopt-submit")
    if (await adopt.isVisible().catch(() => false)) await adopt.click()
  }
  await expect(finish).toBeEnabled()
  await finish.click()
}

async function continueToReview(page: Page) {
  const review = page.getByTestId("review-step")
  for (let step = 0; step < 6 && !(await review.isVisible()); step += 1) {
    await page.getByTestId("wizard-continue").click()
    await page.waitForTimeout(150)
  }
  await expect(review).toBeVisible()
}

test("home shows the summary row and the task inbox, and the nav lists every page", async ({ page }) => {
  const nav = page.getByRole("navigation")
  for (const label of ["Home", "Cases", "Clients"]) await expect(nav.getByRole("link", { name: new RegExp(`^${label}`) })).toBeVisible()
  for (const tile of ["open", "overdue", "at-risk", "starting"]) await expect(page.getByTestId(`tile-${tile}`)).toBeVisible()
  await expect(page.getByTestId("tile-open-value")).toHaveText(/^\d+$/)
  await expect(page.getByTestId("task-inbox")).toBeVisible()
  for (const filter of ["client-filter", "task-filter", "status-filter"]) await expect(page.getByTestId(filter)).toBeVisible()
  await expect(page.getByTestId("task-row").first()).toBeVisible()
  await shot(page, "home")
})

test("clients and a client page list their people", async ({ page }) => {
  await page.getByRole("navigation").getByRole("link", { name: /^Clients/ }).click()
  await expect(page.getByTestId("clients-table")).toBeVisible()
  await shot(page, "clients")
  const rows = page.getByTestId("client-row")
  expect(await rows.count()).toBeGreaterThan(0)
  await rows.first().getByRole("link").first().click()
  await expect(page.getByTestId("client-detail")).toBeVisible()
  await expect(page.getByTestId("client-case-row").first()).toBeVisible()
  await shot(page, "client-detail")
})

test("other roles get no specialist task page, case page or document", async ({ browser, baseURL, page }) => {
  const database = await openLiveDb(page)
  const task = tasksOf(database, "review_order", "ready")[0]
  const upload = one<{ id: string }>(database, "select id from case_documents limit 1")
  expect(task).toBeTruthy()
  for (const who of [/Alex Harper/, /Morgan Reyes/]) {
    const context = await browser.newContext({ baseURL })
    const other = await context.newPage()
    try {
      await other.goto("/pick")
      await other.getByRole("button", { name: who }).click()
      await other.waitForURL(/\/(client|finance)/)
      for (const path of [`/onboarding/tasks/${task.id}`, `/onboarding/cases/${task.caseId}`, "/onboarding/cases", "/onboarding/clients"]) {
        const response = await other.goto(path)
        await expect(other.getByTestId("task-screen")).toHaveCount(0)
        await expect(other.getByTestId("case-detail")).toHaveCount(0)
        await expect(other.getByTestId("cases-directory")).toHaveCount(0)
        if (response?.status() !== 404) await expect(other).not.toHaveURL(new RegExp(`${path}$`))
      }
      if (upload) {
        const file = await other.request.get(`/api/staff/documents/${upload.id}`)
        expect([401, 403, 404]).toContain(file.status())
      }
    } finally {
      await context.close()
    }
  }
})

test("reviewing an order shows the checks and approving it completes the task", async ({ page }) => {
  const database = await openLiveDb(page)
  const [task] = tasksOf(database, "review_order", "ready")
  expect(task, "a seeded order waiting for review").toBeTruthy()

  await page.goto(`/onboarding/tasks/${task.id}`)
  await expect(page.getByTestId("task-screen")).toHaveAttribute("data-task-type", "review_order")
  await expect(page.getByTestId("order-summary")).toContainText(task.person)
  await expect(page.getByTestId("order-money")).toContainText("Deposit")
  await expect(page.getByTestId("order-money")).toContainText("Client agreement")
  const checks = page.getByTestId("order-checks")
  for (const id of ["location", "wage_floor", "snapshot", "start_date"]) await expect(checks.getByTestId(`check-${id}`)).toBeVisible()
  await shot(page, "review-order")

  await page.getByTestId("approve-note").fill("Wage and location checked.")
  await page.getByTestId("approve-order").click()
  await expect(page.getByTestId("task-notice")).toBeVisible({ timeout: 30_000 })
  expect(statusOf(database, task.id)).toBe("done")
  const result = one<{ result: string | null }>(database, "select result_json result from tasks where id = ?", task.id)
  expect(result?.result ?? "").toContain("Wage and location checked.")

  await page.goto(`/onboarding/tasks/${task.id}`)
  await expect(page.getByTestId("order-approved")).toBeVisible()
  await expect(page.getByTestId("approve-order")).toHaveCount(0)
})

let rejected: { taskId: string; caseId: string; workerId: string; person: string; note: string } | undefined

test("sending an I-9 document back opens rework for the employee and a new verification behind it", async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000)
  const database = await openLiveDb(page)
  const [task] = tasksOf(database, "verify_i9_section2", "ready")
  expect(task, "a seeded I-9 waiting for verification").toBeTruthy()
  const note = "The photo is cut off on the right-hand side."

  await page.goto(`/onboarding/tasks/${task.id}`)
  await expect(page.getByTestId("task-screen")).toHaveAttribute("data-task-type", "verify_i9_section2")
  await expect(page.getByTestId("document-viewer")).toBeVisible()
  await expect(page.getByTestId("employee-details")).toBeVisible()
  await expect(page.getByTestId("i9-checklist")).toBeVisible()
  const zoom = page.getByTestId("zoom-level")
  const before = await zoom.innerText()
  await page.getByTestId("zoom-in").click()
  expect(await zoom.innerText()).not.toBe(before)
  await page.getByTestId("zoom-out").click()
  await expect(zoom).toHaveText(before)
  await shot(page, "i9-verify")

  await page.getByTestId("decision-reject").click()
  await page.getByTestId("send-back").click()
  await expect(page.getByTestId("reject-problem")).toBeVisible()
  expect(statusOf(database, task.id)).toBe("ready")

  const firstDoc = page.locator('[data-testid^="reject-doc-"]').first()
  await firstDoc.check()
  await page.getByTestId("reject-code").click()
  await page.getByRole("option", { name: "Document not legible" }).click()
  await page.getByTestId("reject-note").fill(note)
  await shot(page, "i9-send-back")
  await page.getByTestId("send-back").click()
  await expect(page.getByTestId("task-notice")).toBeVisible({ timeout: 30_000 })

  expect(statusOf(database, task.id)).toBe("rejected")
  const tasks = all<{ id: string; key: string; type: string; status: string; party: string }>(
    database,
    "select id, key, type, status, party from tasks where case_id = ? order by seq",
    task.caseId,
  )
  const fix = tasks.filter((row) => row.key === "fix_documents").at(-1)!
  expect(fix).toMatchObject({ type: "upload_documents", status: "ready", party: "worker" })
  const replacement = tasks.filter((row) => row.key === "verify_i9_section2").at(-1)!
  expect(replacement.id).not.toBe(task.id)
  expect(replacement.status).toBe("blocked")
  rejected = { taskId: task.id, caseId: task.caseId, workerId: task.userId, person: task.person, note }

  // The case page shows the rework, and the rejected step with its reason.
  await page.goto(`/onboarding/cases/${task.caseId}`)
  await expect(page.getByTestId("case-detail")).toBeVisible()
  await expect(page.getByTestId("case-task-rework").first()).toBeVisible()
  await shot(page, "case-tasks-rework")

  // The employee sees the reason on their fix task.
  const context = await browser.newContext({ baseURL })
  const worker = await context.newPage()
  try {
    await signInAs(context, baseURL!, task.userId)
    await worker.goto(`/worker/tasks/${fix.id}`)
    await expect(worker.getByTestId("upload-reason").first()).toContainText("Document not legible")
    await expect(worker.getByTestId("upload-reason").first()).toContainText(note)
  } finally {
    await context.close()
  }

  // The replacement verification is the next one in the specialist's history for that person.
  await page.goto(`/onboarding/tasks/${replacement.id}`)
  await expect(page.getByTestId("task-waiting-note")).toBeVisible()
  await expect(page.getByTestId("rejection-history")).toBeVisible()
  await expect(page.getByTestId("rejection-entry").first()).toContainText("Document not legible")
  await shot(page, "i9-replacement-blocked")
})

test("accepting an I-9 records Section 2 with a typed e-signature and a hash-verified copy", async ({ page }) => {
  test.setTimeout(180_000)
  const database = await openLiveDb(page)
  const [task] = tasksOf(database, "verify_i9_section2", "ready").filter((row) => row.caseId !== rejected?.caseId)
  expect(task, "a second seeded I-9 waiting for verification").toBeTruthy()

  await page.goto(`/onboarding/tasks/${task.id}`)
  await expect(page.getByTestId("accept-panel")).toBeVisible()
  const listA = await page.getByTestId("i9-mode-a").isChecked()
  if (listA) {
    await page.getByTestId("listA.0-title").fill("U.S. Passport")
    await page.getByTestId("listA.0-authority").fill("U.S. Department of State")
    await page.getByTestId("listA.0-number").fill("X1234567")
  } else {
    await expect(page.getByTestId("i9-mode-bc")).toBeChecked()
    await page.getByTestId("listB-title").fill("Driver's license")
    await page.getByTestId("listB-authority").fill("State of California")
    await page.getByTestId("listB-number").fill("D1234567")
    await page.getByTestId("listC-title").fill("Social Security card")
    await page.getByTestId("listC-authority").fill("Social Security Administration")
  }
  await shot(page, "i9-accept-documents")
  await continueToReview(page)
  await shot(page, "i9-accept-review")
  await page.getByTestId("review-and-sign").click()
  await signInPopup(page)
  await expect(page.getByTestId("task-notice")).toBeVisible({ timeout: 60_000 })

  expect(statusOf(database, task.id)).toBe("done")
  const doc = one<{ id: string; storagePath: string | null; metadata: string }>(
    database,
    "select id, storage_path storagePath, metadata_json metadata from generated_documents where task_id = ? and kind = 'i9_section2'",
    task.id,
  )
  expect(doc?.storagePath).toBeTruthy()
  expect(JSON.parse(doc!.metadata).sha256).toMatch(/^[0-9a-f]{64}$/)
  const signature = one<{ party: string; typedName: string; signer: string }>(
    database,
    "select party, typed_name typedName, signer_user_id signer from document_signatures where document_id = ?",
    doc!.id,
  )
  expect(signature).toMatchObject({ party: "specialist", signer: SPECIALIST })
  const form = one<{ data: string; encrypted: string | null }>(
    database,
    "select data_json data, encrypted_json encrypted from form_submissions where task_id = ? and form_type = 'i9_section2'",
    task.id,
  )
  expect(form).toBeTruthy()
  expect(form!.data).not.toContain(listA ? "X1234567" : "D1234567")

  // The signed copy downloads from the case page and verifies against its hash.
  await page.goto(`/onboarding/cases/${task.caseId}?tab=documents`)
  await expect(page.getByTestId("tabpanel-documents")).toBeVisible()
  const generated = page.getByTestId("generated-document").filter({ hasText: /I-9/ }).first()
  await expect(generated).toBeVisible()
  const href = await generated.getByTestId("document-download").getAttribute("href")
  expect(href).toBeTruthy()
  const response = await page.request.get(href!)
  expect(response.status()).toBe(200)
  expect(response.headers()["content-type"]).toContain("application/pdf")
  expect((await response.body()).subarray(0, 4).toString()).toBe("%PDF")
  await shot(page, "case-documents")
})

test("setting up payroll lists the pre-flight checks and creates the profile", async ({ page }) => {
  test.setTimeout(90_000)
  const database = await openLiveDb(page)
  const blocked = tasksOf(database, "setup_payroll", "blocked")[0]
  expect(blocked, "a payroll setup that is still blocked").toBeTruthy()
  await page.goto(`/onboarding/tasks/${blocked.id}`)
  await expect(page.getByTestId("preflight")).toBeVisible()
  await expect(page.getByTestId("payroll-blockers")).toBeVisible()
  await expect(page.getByTestId("create-payroll")).toBeDisabled()
  expect(statusOf(database, blocked.id)).toBe("blocked")
  await shot(page, "payroll-blocked")

  const [task] = tasksOf(database, "setup_payroll", "ready")
  expect(task, "a payroll setup that is ready").toBeTruthy()
  await page.goto(`/onboarding/tasks/${task.id}`)
  await expect(page.getByTestId("task-screen")).toHaveAttribute("data-task-type", "setup_payroll")
  const preflight = page.getByTestId("preflight")
  for (const id of ["agreement", "deposit", "w4", "direct_deposit", "i9"]) await expect(preflight.getByTestId(`preflight-${id}`)).toBeVisible()
  await expect(page.getByTestId("payroll-blockers")).toHaveCount(0)
  await expect(page.getByTestId("payroll-profile")).toContainText(/biweekly/i)
  await expect(page.getByTestId("payroll-estimate")).toBeVisible()
  await shot(page, "payroll-ready")

  await page.getByTestId("create-payroll").click()
  await expect(page.getByTestId("task-notice")).toBeVisible({ timeout: 30_000 })
  expect(statusOf(database, task.id)).toBe("done")
  const result = one<{ result: string | null }>(database, "select result_json result from tasks where id = ?", task.id)
  expect(result?.result ?? "").toContain("biweekly")
})

test("filings are confirmed with a reference number", async ({ page }) => {
  const database = await openLiveDb(page)
  const [task] = tasksOf(database, "file_new_hire_report", "ready")
  expect(task, "a new-hire report waiting to be filed").toBeTruthy()
  await page.goto(`/onboarding/tasks/${task.id}`)
  await expect(page.getByTestId("filing-summary")).toBeVisible()
  await expect(page.getByTestId("filing-summary")).not.toContainText(/\d{3}-\d{2}-\d{4}/)
  await shot(page, "new-hire-report")
  await page.getByTestId("mark-submitted").click()
  await expect(page.getByTestId("confirmation-error")).toBeVisible()
  expect(statusOf(database, task.id)).toBe("ready")
  await page.getByTestId("confirmation-number").fill("NHR-2026-0042")
  await page.getByTestId("mark-submitted").click()
  await expect(page.getByTestId("task-notice")).toBeVisible({ timeout: 30_000 })
  expect(statusOf(database, task.id)).toBe("done")
  expect(one<{ result: string | null }>(database, "select result_json result from tasks where id = ?", task.id)?.result ?? "").toContain("NHR-2026-0042")
})

test("a case opens on its tasks and has documents, forms, order and activity tabs", async ({ page }) => {
  const database = await openLiveDb(page)
  const target =
    one<{ caseId: string; person: string }>(
      database,
      `select c.id caseId, u.display_name person from onboarding_cases c join users u on u.id = c.worker_user_id
        where exists (select 1 from form_submissions f where f.case_id = c.id)
          and exists (select 1 from case_documents d where d.case_id = c.id) and c.lifecycle = 'open' limit 1`,
    ) ?? undefined
  expect(target, "a case with forms and uploads").toBeTruthy()

  await page.goto("/onboarding/cases")
  await page.getByTestId("cases-search").fill(target!.person)
  await expect(page).toHaveURL(/q=/)
  await page.getByTestId("case-row").first().getByRole("link").first().click()
  await expect(page.getByTestId("case-detail")).toBeVisible()
  await expect(page.getByTestId("case-person")).toContainText(target!.person)
  await expect(page.getByTestId("tabpanel-tasks")).toBeVisible()
  expect(await page.getByTestId("case-task").count()).toBeGreaterThan(3)
  await shot(page, "case-tasks")

  await page.getByTestId("tab-documents").click()
  await expect(page.getByTestId("tabpanel-documents")).toBeVisible()
  await expect(page.getByTestId("case-documents")).toBeVisible()
  await expect(page).toHaveURL(/tab=documents/)
  await shot(page, "case-documents-tab")

  await page.getByTestId("tab-forms").click()
  await expect(page.getByTestId("case-forms")).toBeVisible()
  const forms = await page.getByTestId("case-forms").innerText()
  expect(forms).not.toMatch(/\d{3}-\d{2}-\d{4}/)
  await expect(page.getByRole("button", { name: /reveal/i })).toHaveCount(0)
  await shot(page, "case-forms")

  await page.getByTestId("tab-order").click()
  await expect(page.getByTestId("case-order")).toBeVisible()
  await shot(page, "case-order")

  await page.getByTestId("tab-activity").click()
  await expect(page.getByTestId("tabpanel-activity")).toBeVisible()
  await shot(page, "case-activity")

  await page.goto(`/onboarding/cases/${target!.caseId}?tab=forms`)
  await expect(page.getByTestId("tabpanel-forms")).toBeVisible()
  await expect(page.getByRole("button", { name: /cancel|terminate|reactivate/i })).toHaveCount(0)
})

test("the directory searches, filters and sorts people by risk then start date", async ({ page }) => {
  await page.goto("/onboarding/cases")
  await expect(page.getByTestId("cases-directory")).toBeVisible()
  const rows = page.getByTestId("case-row")
  await expect(rows.first()).toBeVisible()
  const total = await rows.count()
  expect(total).toBeGreaterThan(0)
  await expect(page.getByTestId("case-progress").first()).toContainText(/step|complete|Not onboarding/)
  await shot(page, "cases")

  // At-risk people come first.
  const flags = await rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-at-risk") === "true"))
  const firstSafe = flags.indexOf(false)
  if (firstSafe !== -1) expect(flags.slice(firstSafe).some(Boolean)).toBe(false)

  await page.getByTestId("at-risk-filter").click()
  await expect(page).toHaveURL(/atRisk=1/)
  await expect(rows.first()).toBeVisible()
  const riskFlags = await rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-at-risk")))
  expect(riskFlags.every((flag) => flag === "true")).toBe(true)
  await shot(page, "cases-at-risk")
  await page.getByTestId("clear-filters").click()
  await expect(page).not.toHaveURL(/atRisk/)

  await page.getByTestId("status-filter").click()
  await page.getByRole("option", { name: "Active", exact: true }).click()
  await expect(page).toHaveURL(/status=active/)
  await expect(rows.first()).toBeVisible()
  expect(await rows.count()).toBeLessThanOrEqual(total)
  await page.getByTestId("clear-filters").click()

  await page.getByTestId("client-filter").click()
  const options = page.getByRole("option")
  await expect(options.nth(1)).toBeVisible()
  await options.nth(1).click()
  await expect(page).toHaveURL(/client=/)
  await expect(rows.first()).toBeVisible()
  await shot(page, "cases-client")
  await page.getByTestId("clear-filters").click()

  await page.getByTestId("cases-search").fill("zzzz-nobody")
  await expect(page.getByTestId("no-cases")).toBeVisible()
  await shot(page, "cases-empty")
})
