import { createHash } from "node:crypto"
import path from "node:path"

import type Database from "better-sqlite3"
import { test, expect, type Locator, type Page } from "@playwright/test"

import { openLiveDb, signInAs } from "./support/live"

/**
 * The employee's whole onboarding on the real pages: accept the invitation, sign the agreement,
 * give personal details, attest to the I-9, upload identity documents, fill the W-4 and direct
 * deposit, choose benefits, then read the signed documents back. It completes tasks, so it needs an
 * employee who has not started: run it against a COPY of the seeded database
 * (`DATABASE_FILE=/tmp/copy.sqlite UPLOADS_ROOT=/tmp/uploads pnpm dev`, same variables for the spec),
 * never the one other people are demoing. With no fresh employee left the journey skips itself.
 *
 * The rework test uses an employee whose identity documents Northwind sent back (`fix_documents`).
 */

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
)

const SHOTS = process.env.SHOTS_DIR

test.use({ actionTimeout: 15_000 })

type Fresh = { userId: string; name: string }

function freshEmployee(db: Database.Database): Fresh | null {
  const row = db
    .prepare(
      `select c.worker_user_id userId, u.display_name name from onboarding_cases c
       join users u on u.id = c.worker_user_id
       join tasks a on a.case_id = c.id and a.key = 'accept_invitation' and a.status = 'ready'
       where c.lifecycle = 'open'
         and not exists (select 1 from tasks d where d.case_id = c.id and d.assignee_user_id = c.worker_user_id and d.status = 'done')
       order by c.id limit 1`,
    )
    .get() as Fresh | undefined
  return row ?? null
}

function reworkEmployee(db: Database.Database): Fresh | null {
  const row = db
    .prepare(
      `select c.worker_user_id userId, u.display_name name from onboarding_cases c
       join users u on u.id = c.worker_user_id
       join tasks f on f.case_id = c.id and f.key = 'fix_documents' and f.status = 'ready'
       where c.lifecycle = 'open' order by c.id limit 1`,
    )
    .get() as Fresh | undefined
  return row ?? null
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true })
}

async function fill(page: Page, testId: string, value: string) {
  const input = page.getByTestId(testId)
  await input.fill(value)
}

async function pickState(page: Page, testId: string, state: string) {
  const trigger = page.getByTestId(testId)
  await trigger.click()
  await page.getByRole("option", { name: state }).first().click()
}

/** Enters what the document is before its file is chosen; leave out what the title implies or lacks. */
async function describeDocument(page: Page, kind: string, doc: { title?: string; authority?: string; number: string; expiry?: string }) {
  if (doc.title) await pickState(page, `doc-title-${kind}`, doc.title)
  if (doc.authority) await fill(page, `doc-authority-${kind}`, doc.authority)
  await fill(page, `doc-number-${kind}`, doc.number)
  if (doc.expiry) await page.getByTestId(`doc-expiry-${kind}`).pressSequentially(doc.expiry)
}

/** Signs in the popup: consent, adopt the typed signature on every tag, finish. */
async function signInPopup(page: Page) {
  const dialog = page.getByTestId("signing-dialog")
  await expect(dialog).toBeVisible()
  await expect(page.getByTestId("signature-tag").first()).toBeVisible()
  await page.getByTestId("signing-consent").check()
  const finish = page.getByTestId("signing-finish")
  for (let guard = 0; guard < 8 && (await finish.isDisabled()); guard += 1) {
    await page.getByTestId("signing-next").click()
    const tag: Locator = page.locator('[data-testid="signature-tag"][data-state="unsigned"]:not([data-kind="date"])').first()
    await tag.click()
    const adopt = page.getByTestId("adopt-submit")
    if (await adopt.isVisible().catch(() => false)) await adopt.click()
  }
  await expect(finish).toBeEnabled()
  await finish.click()
}

/** Presses the wizard's Continue until the review step shows. */
async function continueToReview(page: Page) {
  const review = page.getByTestId("review-step")
  for (let step = 0; step < 6 && !(await review.isVisible()); step += 1) {
    await page.getByTestId("wizard-continue").click()
    await page.waitForTimeout(150)
  }
  await expect(review).toBeVisible()
}

async function expectProgress(page: Page, done: number, total: number) {
  await page.goto("/worker")
  await expect(page.getByRole("heading", { level: 2 })).toContainText(done === total ? `all ${total} tasks done` : `${done} of ${total} tasks done`)
}

test.describe("employee onboarding", () => {
  test.describe.configure({ mode: "serial" })

  test("accept, sign, details, I-9, documents, W-4, direct deposit and benefits", async ({ page, baseURL }) => {
    test.setTimeout(240_000)
    const db = await openLiveDb(page)
    const employee = freshEmployee(db)
    test.skip(!employee, "no employee left who has not started onboarding in this database")
    const { userId, name } = employee!
    const caseId = (db.prepare("select id from onboarding_cases where worker_user_id = ?").get(userId) as { id: string }).id
    const status = (key: string) =>
      (db.prepare("select status from tasks where case_id = ? and key = ? and assignee_user_id = ? order by seq desc limit 1").get(caseId, key, userId) as { status: string } | undefined)?.status

    const open = async (key: string) => {
      const row = db.prepare("select id from tasks where case_id = ? and key = ? and assignee_user_id = ? order by seq desc limit 1").get(caseId, key, userId) as { id: string }
      await page.goto(`/worker/tasks/${row.id}`)
    }

    await signInAs(page.context(), baseURL!, userId)
    await page.goto("/worker")
    const first = name.split(" ")[0]
    await expect(page.getByRole("heading", { level: 2 })).toContainText(`Welcome, ${first} — 0 of 8 tasks done`)
    await expect(page.getByTestId("home-continue")).toBeVisible()
    await shot(page, "journey-home-start")
    expect(status("accept_invitation")).toBe("ready")
    expect(status("sign_agreement")).toBe("blocked")

    // 1. Accept the invitation
    await page.getByTestId("continue-button").click()
    await expect(page.getByTestId("employee-task")).toHaveAttribute("data-task-type", "accept_invitation")
    await expect(page.getByTestId("task-position")).toHaveText("Task 1 of 8")
    await expect(page.getByTestId("offer-pay")).toBeVisible()
    await shot(page, "journey-1-accept")
    await page.getByTestId("accept-invitation").click()
    await expect(page.getByTestId("task-notice")).toBeVisible()
    expect(status("accept_invitation")).toBe("done")
    expect(status("sign_agreement")).toBe("ready")

    // 2. Sign the employment agreement
    await open("sign_agreement")
    await expect(page.getByTestId("employee-task")).toHaveAttribute("data-task-type", "sign_agreement")
    await shot(page, "journey-2-agreement")
    await page.getByTestId("sign-agreement").click()
    await signInPopup(page)
    await expect(page.getByTestId("task-notice")).toBeVisible({ timeout: 30_000 })
    expect(status("sign_agreement")).toBe("done")
    const agreement = db
      .prepare("select id, storage_path, metadata_json from generated_documents where case_id = ? and kind = 'employment_agreement' order by created_at desc limit 1")
      .get(caseId) as { id: string; storage_path: string; metadata_json: string }
    expect(agreement.storage_path).toBeTruthy()
    expect(JSON.parse(agreement.metadata_json).sha256).toMatch(/^[0-9a-f]{64}$/)

    // 3. Personal details (the SSN is stored encrypted, never as plain text)
    const type = async () => page.getByTestId("employee-task").getAttribute("data-task-type")
    await expectProgress(page, 2, 8)
    await open("personal_details")
    await expect.poll(type).toBe("personal_details")
    await page.getByTestId("pd-submit").click()
    await expect(page.getByTestId("form-error")).toBeFocused()
    await shot(page, "journey-3-details-errors")
    await fill(page, "pd-name", name)
    await fill(page, "pd-dob", "04/12/1991")
    await fill(page, "pd-ssn", "123-45-6789")
    await fill(page, "pd-phone", "(415) 555-0123")
    await fill(page, "pd-line1", "100 Market Street")
    await fill(page, "pd-city", "San Francisco")
    if (!(await page.getByTestId("pd-state").innerText()).match(/[A-Z]{2}|California/)) await pickState(page, "pd-state", "California")
    await fill(page, "pd-zip", "94105")
    await shot(page, "journey-3-details")
    await page.getByTestId("pd-submit").click()
    await expect(page.getByTestId("task-notice")).toBeVisible()
    expect(status("personal_details")).toBe("done")
    const saved = db.prepare("select data_json, encrypted_json from form_submissions where case_id = ? and form_type = 'personal_details'").get(caseId) as {
      data_json: string
      encrypted_json: string
    }
    expect(saved.data_json).not.toContain("123-45-6789")
    expect(saved.data_json).not.toContain("123456789")
    expect(saved.encrypted_json).not.toContain("6789")

    // 4. I-9 Section 1
    await open("i9_section1")
    await expect.poll(type).toBe("i9_section1")
    await page.getByTestId("wizard-continue").click()
    await expect(page.getByRole("alert").first()).toBeVisible()
    await fill(page, "i9-dob", "04/12/1991")
    await fill(page, "i9-ssn", "123-45-6789")
    await fill(page, "i9-address", "100 Market Street")
    await fill(page, "i9-city", "San Francisco")
    if (!(await page.getByTestId("i9-state").innerText()).match(/[A-Z]{2}|California/)) await pickState(page, "i9-state", "California")
    await fill(page, "i9-zip", "94105")
    await page.getByTestId("wizard-continue").click()
    await page.getByTestId("i9-status-citizen").check()
    await continueToReview(page)
    await shot(page, "journey-4-i9-review")
    await page.getByTestId("review-and-sign").click()
    await signInPopup(page)
    await expect(page.getByTestId("task-notice")).toBeVisible({ timeout: 30_000 })
    expect(status("i9_section1")).toBe("done")
    expect(status("upload_documents")).toBe("ready")

    // 5. Identity documents: List B + List C
    await open("upload_documents")
    await expect.poll(type).toBe("upload_documents")
    await expect(page.getByTestId("submit-documents")).toBeDisabled()
    await page.getByTestId("path-list_b_c").check()
    await page.getByTestId("file-list_b").setInputFiles({ name: "license.png", mimeType: "image/png", buffer: PNG })
    await expect(page.getByTestId("slot-list_b")).toContainText("Choose the document.")
    await expect(page.getByTestId("send-file-list_b")).toContainText("license.png")
    await describeDocument(page, "list_b", { title: "Driver's license", authority: "California DMV", number: "D4471920", expiry: "01312031" })
    await shot(page, "journey-5-documents-details")
    await page.getByTestId("send-file-list_b").click()
    await expect(page.getByTestId("upload-list_b")).toContainText("license.png")
    await expect(page.getByTestId("upload-list_b")).toContainText("•••• 1920")
    await expect(page.getByTestId("upload-list_b")).not.toContainText("D4471920")
    await describeDocument(page, "list_c", { title: "Social Security Account Number card (unrestricted)", number: "123456789" })
    await expect(page.getByTestId("doc-expiry-list_c")).toHaveCount(0)
    await page.getByTestId("file-list_c").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not an image") })
    await expect(page.getByTestId("upload-error-list_c")).toBeVisible()
    await page.getByTestId("file-list_c").setInputFiles({ name: "ssn-card.png", mimeType: "image/png", buffer: PNG })
    await expect(page.getByTestId("upload-list_c")).toContainText("ssn-card.png")
    await shot(page, "journey-5-documents")
    await page.getByTestId("submit-documents").click()
    await expect(page.getByTestId("task-notice")).toBeVisible()
    expect(status("upload_documents")).toBe("done")

    // 6. W-4
    await open("w4")
    await expect.poll(type).toBe("w4")
    await fill(page, "w4-ssn", "123-45-6789")
    await page.getByTestId("wizard-continue").click()
    await page.getByTestId("w4-filing-single_or_married_separately").check()
    await continueToReview(page)
    await shot(page, "journey-6-w4-review")
    await page.getByTestId("review-and-sign").click()
    await signInPopup(page)
    await expect(page.getByTestId("task-notice")).toBeVisible({ timeout: 30_000 })
    expect(status("w4")).toBe("done")

    // 7. Direct deposit (the account number is encrypted and masked)
    await open("direct_deposit")
    await expect.poll(type).toBe("direct_deposit")
    await fill(page, "dd-bank-name", "First Republic")
    await fill(page, "dd-routing", "021000021")
    await fill(page, "dd-account", "000123456789")
    await page.getByTestId("dd-account-type").click()
    await page.getByRole("option", { name: "Checking" }).click()
    await page.getByTestId("wizard-continue").click()
    await expect(page.getByTestId("dd-summary-account")).not.toContainText("000123456789")
    await page.getByTestId("review-and-sign").click()
    await signInPopup(page)
    await expect(page.getByTestId("task-notice")).toBeVisible({ timeout: 30_000 })
    expect(status("direct_deposit")).toBe("done")
    const deposit = db.prepare("select data_json, encrypted_json from form_submissions where case_id = ? and form_type = 'direct_deposit' order by created_at desc limit 1").get(caseId) as {
      data_json: string
      encrypted_json: string
    }
    expect(deposit.data_json).not.toContain("000123456789")
    expect(deposit.encrypted_json).not.toContain("000123456789")

    // 8. Benefits: pick a tier, defer 5%, confirm
    await open("benefits_decision")
    await expect.poll(type).toBe("benefits_decision")
    await page.getByTestId("benefits-continue").click()
    await expect(page.getByTestId("health-error")).toBeVisible()
    await page.getByTestId("health-employee").check()
    await page.getByTestId("deferral-input").fill("5")
    await expect(page.getByTestId("estimate-total")).toBeVisible()
    await shot(page, "journey-8-benefits")
    await page.getByTestId("benefits-continue").click()
    await expect(page.getByTestId("benefits-confirm")).toBeVisible()
    await page.getByTestId("benefits-confirm-button").click()
    await expect(page).toHaveURL(/\/worker\?notice=/)
    await expect(page.getByTestId("task-notice")).toBeVisible()
    await expect(page.getByTestId("home-continue")).toHaveCount(0)
    expect(status("benefits_decision")).toBe("done")
    const election = db.prepare("select enrolled, health_tier, retirement_deferral_pct from benefit_elections where case_id = ?").get(caseId) as {
      enrolled: number
      health_tier: string
      retirement_deferral_pct: number
    }
    expect(election).toMatchObject({ enrolled: 1, health_tier: "employee", retirement_deferral_pct: 5 })

    // The decided task is read-only and points at the Benefits page for later changes
    await open("benefits_decision")
    await expect(page.getByTestId("benefits-election")).toBeVisible()
    await expect(page.getByTestId("benefits-change")).toHaveCount(0)
    await expect(page.getByRole("link", { name: "Benefits page" })).toHaveAttribute("href", "/worker/benefits")

    // Home and documents reflect all of it
    await expectProgress(page, 8, 8)
    await shot(page, "journey-home-done")
    await page.goto("/worker/documents")
    const rows = page.getByTestId("employee-document")
    await expect(rows).toHaveCount(4)
    for (const kind of ["employment_agreement", "i9_section1", "w4", "direct_deposit_authorization"]) {
      await expect(page.locator(`[data-kind="${kind}"]`)).toBeVisible()
    }
    await shot(page, "journey-documents")

    const viewLinks = page.getByTestId("view-document")
    await expect(viewLinks).toHaveCount(4)
    for (const link of await viewLinks.all()) {
      await expect(link).toHaveAttribute("target", "_blank")
      await expect(link).toHaveAttribute("rel", "noopener noreferrer")
      expect((await page.request.get((await link.getAttribute("href"))!)).headers()["content-disposition"]).toMatch(/^inline/)
    }

    const links = await page.getByTestId("download-document").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")!))
    expect(links).toHaveLength(4)
    for (const href of links) {
      const response = await page.request.get(href)
      expect(response.status()).toBe(200)
      expect(response.headers()["content-type"]).toBe("application/pdf")
      const bytes = await response.body()
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(response.headers()["x-document-sha256"])
    }

    // Nobody else can read them
    await signInAs(page.context(), baseURL!, "user_client_hr")
    expect((await page.request.get(links[0], { maxRedirects: 0 })).status()).not.toBe(200)
    const other = (db.prepare("select id from users where role = 'worker' and id <> ? limit 1").get(userId) as { id: string }).id
    await signInAs(page.context(), baseURL!, other)
    expect((await page.request.get(links[0])).status()).toBe(404)
    db.close()
  })

  test("a rejected identity document is replaced from the rework task", async ({ page, baseURL }) => {
    test.setTimeout(120_000)
    const db = await openLiveDb(page)
    const employee = reworkEmployee(db)
    test.skip(!employee, "no employee has identity documents sent back in this database")
    const { userId } = employee!
    const caseId = (db.prepare("select id from onboarding_cases where worker_user_id = ?").get(userId) as { id: string }).id
    const task = db.prepare("select id from tasks where case_id = ? and key = 'fix_documents' and status = 'ready'").get(caseId) as { id: string }

    await signInAs(page.context(), baseURL!, userId)
    await page.goto("/worker")
    await expect(page.getByTestId("home-continue")).toHaveAttribute("data-task-type", "upload_documents")
    await expect(page.getByTestId("home-continue")).toContainText("Upload corrected ID documents")
    await shot(page, "rework-home")

    await page.getByTestId("continue-button").click()
    await expect(page).toHaveURL(new RegExp(`/worker/tasks/${task.id}$`))
    await expect(page.getByTestId("sent-back")).toContainText("Northwind sent this back")
    await shot(page, "rework-screen")
    await expect(page.getByTestId("submit-documents")).toBeDisabled()

    const kinds = await page.locator('[data-testid^="slot-"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid")!.slice(5)))
    for (const kind of kinds) {
      await page.getByTestId(`replace-${kind}`).click()
      await describeDocument(page, kind, { number: kind === "list_c" ? "123456789" : "R7730215" })
      await page.getByTestId(`file-${kind}`).setInputFiles({ name: `${kind}-new.png`, mimeType: "image/png", buffer: PNG })
      await expect(page.getByTestId(`upload-${kind}`)).toContainText(`${kind}-new.png`)
    }
    await page.getByTestId("submit-documents").click()
    await expect(page.getByTestId("task-notice")).toBeVisible()
    const after = db.prepare("select status from tasks where id = ?").get(task.id) as { status: string }
    expect(after.status).toBe("done")
    db.close()
  })

  test("another employee, the client and Northwind cannot open a worker document or task", async ({ page, baseURL }) => {
    const db = await openLiveDb(page)
    const doc = db
      .prepare(
        `select g.id, c.worker_user_id owner from generated_documents g join onboarding_cases c on c.id = g.case_id
         where g.kind = 'w4' and g.storage_path is not null limit 1`,
      )
      .get() as { id: string; owner: string } | undefined
    test.skip(!doc, "no stored signed document in this database")
    const stranger = (db.prepare("select id from users where role = 'worker' and id <> ? limit 1").get(doc!.owner) as { id: string }).id
    const url = `/worker/documents/${doc!.id}/download`

    await signInAs(page.context(), baseURL!, stranger)
    expect((await page.request.get(url)).status()).toBe(404)
    for (const user of ["user_client_hr", "user_specialist_1", "user_finance_1"]) {
      await signInAs(page.context(), baseURL!, user)
      expect([403, 401, 307, 308, 404]).toContain((await page.request.get(url, { maxRedirects: 0 })).status())
    }
    await signInAs(page.context(), baseURL!, doc!.owner)
    expect((await page.request.get(url)).status()).toBe(200)
    db.close()
  })
})
