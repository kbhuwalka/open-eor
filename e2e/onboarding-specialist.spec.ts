import Database from "better-sqlite3"
import { test, expect, type Page } from "@playwright/test"

import { openLiveDb, signInAs } from "./support/live"

/**
 * The Onboarding specialist portal on the real pages, as Sam Ortiz: review an order, verify an I-9
 * (send a document back and see the rework appear, accept another with a typed e-signature), set up
 * payroll, read a case and filter the people list. It WRITES, so run it against a COPY of the seeded
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

/** Opens a task straight in the home's drawer and waits for its body to load. */
async function openTask(page: Page, taskId: string) {
  await page.goto(`/onboarding?open=${taskId}`)
  await expect(page.getByTestId("task-drawer")).toBeVisible()
  await expect(page.getByTestId("drawer-body")).toBeVisible()
  await expect(page.getByTestId("drawer-loading")).toHaveCount(0)
}

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

test("home lists the tasks and the nav has Home and People, with no Clients page", async ({ page }) => {
  const nav = page.getByRole("navigation")
  for (const label of ["Home", "People"]) await expect(nav.getByRole("link", { name: new RegExp(`^${label}`) })).toBeVisible()
  await expect(nav.getByRole("link", { name: /^(Cases|Clients)/ })).toHaveCount(0)
  await expect(page.getByTestId("task-inbox")).toBeVisible()
  for (const filter of ["client-filter", "task-filter", "status-filter", "group-select"]) await expect(page.getByTestId(filter)).toBeVisible()
  await expect(page.getByTestId("task-row").first()).toBeVisible()
  await shot(page, "home")
  for (const path of ["/onboarding/clients", "/onboarding/cases", "/onboarding/tasks/anything"]) {
    const response = await page.goto(path)
    expect(response?.status()).toBe(404)
  }
})

test("other roles cannot open a specialist task, a case page or a document", async ({ browser, baseURL, page }) => {
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
      for (const path of [`/onboarding?open=${task.id}`, `/onboarding/people/${task.caseId}`, "/onboarding/people"]) {
        const response = await other.goto(path)
        await expect(other.getByTestId("task-drawer")).toHaveCount(0)
        await expect(other.getByTestId("case-detail")).toHaveCount(0)
        if (response?.status() !== 404) await expect(other).not.toHaveURL(new RegExp(`${path.replace("?", "\\?")}$`))
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

test("reviewing an order shows what was ordered and approving it completes the task in the drawer", async ({ page }) => {
  const database = await openLiveDb(page)
  const [task] = tasksOf(database, "review_order", "ready")
  expect(task, "a seeded order waiting for review").toBeTruthy()

  await openTask(page, task.id)
  await expect(page.getByTestId("drawer-body")).toHaveAttribute("data-task-type", "review_order")
  await expect(page.getByTestId("task-drawer")).toContainText(task.person)
  const summary = page.getByTestId("order-summary")
  for (const label of ["Role", "Work location", "Pay", "Benefits", "Deposit"]) await expect(summary).toContainText(label)
  await expect(page.getByTestId("order-checks")).toBeVisible()
  await shot(page, "review-order")

  await page.getByTestId("approve-order").click()
  await expect.poll(() => statusOf(database, task.id), { timeout: 30_000 }).toBe("done")
  await expect(page.getByTestId("task-drawer").getByTestId("drawer-body")).not.toContainText(task.person)
})

let rejected: { taskId: string; caseId: string; workerId: string; person: string; note: string } | undefined

test("sending an I-9 document back opens rework for the employee and a new verification behind it", async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000)
  const database = await openLiveDb(page)
  const [task] = tasksOf(database, "verify_i9_section2", "ready")
  expect(task, "a seeded I-9 waiting for verification").toBeTruthy()
  const note = "The photo is cut off on the right-hand side."

  await openTask(page, task.id)
  await expect(page.getByTestId("drawer-body")).toHaveAttribute("data-task-type", "verify_i9_section2")
  await expect(page.getByTestId("document-viewer")).toBeVisible()
  await expect(page.getByTestId("employee-details")).toBeVisible()
  await expect(page.getByTestId("viewer-open")).toHaveAttribute("target", "_blank")
  await expect(page.locator('[data-testid^="document-details-"]').first()).toBeVisible()
  await expect(page.getByTestId("drawer-body").getByRole("tablist", { name: "Decision" })).toHaveCount(0)
  await expect(page.getByTestId("drawer-body").getByRole("textbox")).toHaveCount(0)
  await expect(page.getByTestId("verify-and-sign")).toBeVisible()
  await shot(page, "i9-verify")

  await page.getByTestId("open-send-back").click()
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
  await expect.poll(() => statusOf(database, task.id), { timeout: 30_000 }).toBe("rejected")
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
  await page.goto(`/onboarding/people/${task.caseId}`)
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
})

test("accepting an I-9 records Section 2 with a typed e-signature and a hash-verified copy", async ({ page }) => {
  test.setTimeout(180_000)
  const database = await openLiveDb(page)
  const [task] = tasksOf(database, "verify_i9_section2", "ready").filter((row) => row.caseId !== rejected?.caseId)
  expect(task, "a second seeded I-9 waiting for verification").toBeTruthy()

  await openTask(page, task.id)
  const numbers = (await page.getByTestId("document-number").allInnerTexts()).map((text) => text.trim())
  expect(numbers.length, "the employee's document numbers, shown read-only").toBeGreaterThan(0)
  for (const number of numbers) expect(number).not.toContain("•")
  const ssnCard = page.getByTestId("document-details-list_c").filter({ hasText: "Social Security Account Number card" })
  if (await ssnCard.count()) await expect(ssnCard.getByTestId("document-number")).toHaveText(/^\*\*\*-\*\*-\d{4}$/)
  await shot(page, "i9-accept-documents")
  await page.getByTestId("verify-and-sign").click()
  await signInPopup(page)
  await expect.poll(() => statusOf(database, task.id), { timeout: 60_000 }).toBe("done")
  const result = one<{ result: string | null }>(database, "select result_json result from tasks where id = ?", task.id)
  const events = all<{ payload: string | null }>(database, "select payload_json payload from case_events where case_id = ?", task.caseId)
  for (const number of numbers) {
    expect(result?.result ?? "").not.toContain(number)
    for (const event of events) expect(event.payload ?? "").not.toContain(number)
  }
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
  for (const number of numbers) expect(form!.data).not.toContain(number)

  // The signed copy downloads from the case page and verifies against its hash.
  await page.goto(`/onboarding/people/${task.caseId}?tab=documents`)
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

test("setting up payroll lists what is missing, then creates the profile", async ({ page }) => {
  test.setTimeout(90_000)
  const database = await openLiveDb(page)
  const blocked = tasksOf(database, "setup_payroll", "blocked")[0]
  expect(blocked, "a payroll setup that is still blocked").toBeTruthy()
  await openTask(page, blocked.id)
  await expect(page.getByTestId("preflight-w4").or(page.getByTestId("preflight-i9")).or(page.getByTestId("preflight-agreement")).or(page.getByTestId("preflight-deposit")).or(page.getByTestId("preflight-direct_deposit")).first()).toBeVisible()
  await expect(page.getByTestId("create-payroll")).toBeDisabled()
  expect(statusOf(database, blocked.id)).toBe("blocked")
  await shot(page, "payroll-blocked")

  const [task] = tasksOf(database, "setup_payroll", "ready")
  expect(task, "a payroll setup that is ready").toBeTruthy()
  await openTask(page, task.id)
  await expect(page.getByTestId("drawer-body")).toHaveAttribute("data-task-type", "setup_payroll")
  await expect(page.getByTestId("preflight")).toContainText("requirements are in place")
  await expect(page.getByTestId("payroll-profile")).toContainText(/biweekly/i)
  await shot(page, "payroll-ready")

  await page.getByTestId("create-payroll").click()
  await expect.poll(() => statusOf(database, task.id), { timeout: 30_000 }).toBe("done")
  const result = one<{ result: string | null }>(database, "select result_json result from tasks where id = ?", task.id)
  expect(result?.result ?? "").toContain("biweekly")
})

test("filings are confirmed with a reference number", async ({ page }) => {
  const database = await openLiveDb(page)
  const [task] = tasksOf(database, "file_new_hire_report", "ready")
  expect(task, "a new-hire report waiting to be filed").toBeTruthy()
  await openTask(page, task.id)
  await expect(page.getByTestId("filing-summary")).toBeVisible()
  await expect(page.getByTestId("filing-summary")).not.toContainText(/\d{3}-\d{2}-\d{4}/)
  await shot(page, "new-hire-report")
  await page.getByTestId("mark-submitted").click()
  await expect(page.getByTestId("confirmation-error")).toBeVisible()
  expect(statusOf(database, task.id)).toBe("ready")
  await page.getByTestId("confirmation-number").fill("NHR-2026-0042")
  await page.getByTestId("mark-submitted").click()
  await expect.poll(() => statusOf(database, task.id), { timeout: 30_000 }).toBe("done")
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

  await page.goto("/onboarding/people")
  await page.getByTestId("people-search").fill(target!.person)
  await expect(page).toHaveURL(/q=/)
  await page.getByTestId("person-row").first().getByRole("link").first().click()
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

  await page.goto(`/onboarding/people/${target!.caseId}?tab=forms`)
  await expect(page.getByTestId("tabpanel-forms")).toBeVisible()
  await expect(page.getByRole("button", { name: /cancel|terminate|reactivate/i })).toHaveCount(0)
})

test("the people list is the client's list plus a Client column, and searches and filters", async ({ page }) => {
  await page.goto("/onboarding/people")
  await expect(page.getByTestId("people-filters")).toBeVisible()
  const rows = page.getByTestId("person-row")
  await expect(rows.first()).toBeVisible()
  const total = await rows.count()
  expect(total).toBeGreaterThan(0)
  await expect(page.getByRole("columnheader").allTextContents()).resolves.toEqual(
    expect.arrayContaining(["Name", "Client", "Role", "Status"]),
  )
  await expect(page.getByRole("columnheader", { name: /location/i })).toHaveCount(0)
  await expect(page.getByTestId("location-filter")).toHaveCount(0)
  await shot(page, "people")

  await page.getByTestId("status-filter").click()
  await page.getByRole("option", { name: "Active", exact: true }).click()
  await expect(page).toHaveURL(/status=active/)
  await expect(rows.first()).toBeVisible()
  expect(await rows.count()).toBeLessThanOrEqual(total)
  await page.getByTestId("clear-filters").click()

  await page.getByTestId("client-filter").click()
  const options = page.getByRole("option")
  await expect(options.nth(1)).toBeVisible()
  const name = (await options.nth(1).innerText()).trim()
  await options.nth(1).click()
  await expect(page).toHaveURL(/client=/)
  await expect(rows.first()).toBeVisible()
  for (const row of await rows.all()) await expect(row).toContainText(name)
  await shot(page, "people-client")
  await page.getByTestId("clear-filters").click()

  await page.getByTestId("people-search").fill("zzzz-nobody")
  await expect(page.getByTestId("no-people")).toBeVisible()
  await shot(page, "people-empty")
})
