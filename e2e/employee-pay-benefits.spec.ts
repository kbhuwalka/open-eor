import path from "node:path"

import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { test, expect, type Locator, type Page, type Response } from "@playwright/test"

import * as schema from "@/db/schema"
import { shortDay } from "@/lib/employee-view"
import { runBilling } from "@/server/billing"

import { addDays, dbFile, download, openLiveDb, signInAs, todayEastern, writeLiveDb } from "./support/live"

/**
 * The Employee portal's pay table, Benefits page, Home details and document links on the REAL
 * pages, against the seeded database. Everything that varies comes out of the database: who the
 * employee is, what they elected, what their pay slips say. The 401(k) test and the document test
 * write (a version row and a billing run; a signed agreement), so run this against a COPY:
 * `DATABASE_FILE=/tmp/copy.sqlite UPLOADS_ROOT=/tmp/uploads pnpm dev`, same variables for the spec.
 * Both put back what they changed.
 */

/** The new headless Chromium, which has the PDF viewer: a document tab has to render, not turn into a download. */
test.use({ channel: "chromium" })

const SHOTS = process.env.SHOTS_DIR
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true })
}

async function signIn(page: Page, baseURL: string, userId: string) {
  await page.context().clearCookies()
  await signInAs(page.context(), baseURL, userId)
}

type Active = { userId: string; caseId: string; hireId: string; name: string; title: string; employer: string; email: string; state: string }

const ACTIVE_SQL = `
  select c.worker_user_id userId, c.id caseId, h.id hireId, u.display_name name, r.name title, co.name employer, u.email email, h.state_code state
  from onboarding_cases c
  join hire_requests h on h.id = c.hire_request_id
  join users u on u.id = c.worker_user_id
  join roles r on r.id = h.role_id
  join client_companies co on co.id = h.client_company_id`

/** Employees whose first pay date has passed (the Home screen shows their details, not a checklist). */
function activeEmployees(db: Database.Database): Active[] {
  return db
    .prepare(
      `${ACTIVE_SQL}
       where c.lifecycle = 'open' and exists (select 1 from payroll_entries p where p.worker_user_id = c.worker_user_id and p.pay_date <= ?)
       order by c.id`,
    )
    .all(todayEastern()) as Active[]
}

test("the pay table has exactly Pay period, Gross pay, Net pay and an icon-only download", async ({ page, baseURL }) => {
  const db = await openLiveDb(page)
  const [employee] = activeEmployees(db)
  db.close()
  await signIn(page, baseURL!, employee.userId)
  await page.goto("/worker/pay")

  const table = page.getByTestId("payslip-table")
  await expect(table.getByRole("columnheader")).toHaveText(["Pay period", "Gross pay", "Net pay", "Download"])
  await expect(table.getByRole("columnheader", { name: "Download" }).locator(".sr-only")).toHaveText("Download")

  const first = page.getByTestId("payslip-row").first()
  const cell = first.locator("td").last()
  expect((await cell.innerText()).trim()).toBe("")
  await expect(cell.locator("svg")).toHaveCount(1)
  const link = cell.getByRole("link")
  await expect(link).toHaveAttribute("aria-label", /^Download pay slip for /)
  const href = (await link.getAttribute("href"))!

  const [saved] = await Promise.all([page.waitForEvent("download"), link.click()])
  expect(saved.suggestedFilename()).toMatch(/\.pdf$/)
  const { response, bytes } = await download(page.request, href)
  expect(response.status()).toBe(200)
  expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-")
  await shot(page, "pay-table")
})

test("Home shows the employee's own details read-only, and never an SSN or anyone else's data", async ({ page, baseURL }) => {
  const db = await openLiveDb(page)
  const [employee, other] = activeEmployees(db)
  const detail = db
    .prepare(
      `select h.start_date startDate, h.wage_cents wage from onboarding_cases c join hire_requests h on h.id = c.hire_request_id where c.id = ?`,
    )
    .get(employee.caseId) as { startDate: string; wage: number }
  db.close()

  await signIn(page, baseURL!, employee.userId)
  await page.goto("/worker")
  const details = page.getByTestId("home-details")
  await expect(details).toBeVisible()
  await expect(page.getByTestId("home-continue")).toHaveCount(0)
  await expect(details.locator("h3")).toHaveText(["Job", "Personal details", "Pay", "Benefits"])

  await expect(page.getByTestId("details-job")).toContainText(employee.title)
  await expect(page.getByTestId("details-job")).toContainText(employee.employer)
  await expect(page.getByTestId("details-job")).toContainText(new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${detail.startDate}T00:00:00Z`)))
  await expect(page.getByTestId("details-personal")).toContainText(employee.name)
  await expect(page.getByTestId("details-personal")).toContainText(employee.email)
  await expect(page.getByTestId("details-pay")).toContainText(/Every two weeks/)
  await expect(page.getByTestId("details-pay")).toContainText(/(Checking|Savings) ••\d{4}|—/)
  await expect(page.getByTestId("details-benefits")).toContainText(/each paycheck|Not enrolled|Not elected/)
  await expect(page.getByTestId("details-benefits-link")).toHaveAttribute("href", "/worker/benefits")

  expect(await details.locator("input, textarea, select, form, button").count()).toBe(0)
  const text = (await page.getByTestId("employee-home").innerText()) ?? ""
  expect(text).not.toMatch(/\b\d{3}-?\d{2}-?\d{4}\b/)
  expect(text).not.toMatch(/SSN|Social Security|Date of birth/i)
  expect(text).not.toContain(other.email)
  expect(text).not.toContain(other.name)
  await shot(page, "home-details")
})

test("an employee still onboarding sees the task checklist, not the details", async ({ page, baseURL }) => {
  const db = await openLiveDb(page)
  const onboarding = db
    .prepare(
      `select c.worker_user_id id from onboarding_cases c join hire_requests h on h.id = c.hire_request_id
       where c.lifecycle = 'open' and h.start_date > ? and c.worker_user_id not in (select worker_user_id from payroll_entries) order by c.id limit 1`,
    )
    .get(todayEastern()) as { id: string }
  db.close()
  await signIn(page, baseURL!, onboarding.id)
  await page.goto("/worker")
  await expect(page.getByTestId("employee-home")).toHaveAttribute("data-status", /.+/)
  await expect(page.getByTestId("home-details")).toHaveCount(0)
  await expect(page.getByRole("heading", { level: 2 })).toContainText(/\d+ of \d+ tasks done|all \d+ tasks done/)
})

test("the nav has Home, Pay, Benefits, Documents", async ({ page, baseURL }) => {
  const db = await openLiveDb(page)
  const [employee] = activeEmployees(db)
  db.close()
  await signIn(page, baseURL!, employee.userId)
  await page.goto("/worker/benefits")
  const nav = page.getByRole("navigation").first()
  await expect(nav.getByRole("link")).toHaveText(["Home", "Pay", "Benefits", "Documents"])
  await expect(nav.getByRole("link", { name: "Benefits" })).toHaveAttribute("aria-current", "page")
})

type Election = { version: number; retirement_deferral_pct: number; effective_from: string | null }

test.describe("changing the 401(k) contribution", () => {
  const created: { invoiceIds: string[]; caseId: string; previous: { pct: number; versions: number } | null } = { invoiceIds: [], caseId: "", previous: null }

  test.afterAll(() => {
    const { caseId, invoiceIds, previous } = created
    if (!caseId || !previous) return
    writeLiveDb((db) => {
      db.pragma("foreign_keys = OFF")
      for (const id of invoiceIds) {
        db.prepare("delete from payroll_entries where invoice_id = ?").run(id)
        db.prepare("delete from invoice_lines where invoice_id = ?").run(id)
        db.prepare("delete from invoices where id = ?").run(id)
      }
      db.prepare("delete from benefit_election_versions where case_id = ? and version > ?").run(caseId, previous.versions)
      db.prepare("update benefit_elections set retirement_deferral_pct = ? where case_id = ?").run(previous.pct, caseId)
      db.prepare("delete from case_events where case_id = ? and type = 'benefit_election_changed' and created_at >= ?").run(caseId, testStartedAt)
    })
  })

  let testStartedAt = 0

  test("the page says when it takes effect, the next payroll uses it, issued slips keep the old figure", async ({ page, baseURL }) => {
    test.setTimeout(120_000)
    testStartedAt = Date.now() - 1000
    const live = await openLiveDb(page)
    const candidate = live
      .prepare(
        `${ACTIVE_SQL}
         join benefit_elections e on e.case_id = c.id and e.enrolled = 1 and e.retirement_deferral_pct is not null
         where c.lifecycle = 'open' and h.end_date is null
           and not exists (select 1 from benefit_election_versions v where v.case_id = c.id and v.effective_from > ?)
           and exists (select 1 from payroll_entries p where p.worker_user_id = c.worker_user_id and p.pay_date <= ?)
         order by c.id desc limit 1`,
      )
      .get(todayEastern(), todayEastern()) as Active
    const before = live.prepare("select retirement_deferral_pct pct from benefit_elections where case_id = ?").get(candidate.caseId) as { pct: number }
    const versions = (live.prepare("select count(*) n from benefit_election_versions where case_id = ?").get(candidate.caseId) as { n: number }).n
    live.close()
    created.caseId = candidate.caseId
    created.previous = { pct: before.pct, versions }
    const next = before.pct >= 10 ? before.pct - 2 : before.pct + 2

    await signIn(page, baseURL!, candidate.userId)
    await page.goto("/worker/benefits")
    await expect(page.getByTestId("benefits-current-pct")).toHaveText(`${before.pct}% of each paycheck`)
    await expect(page.getByTestId("benefits-health-note")).toContainText("Northwind")
    await expect(page.getByTestId("benefits-health-plan")).toBeVisible()
    await expect(page.getByTestId("contribution-save")).toBeDisabled()
    await shot(page, "benefits-before")

    await page.getByTestId("deferral-input").fill(String(next))
    await expect(page.getByTestId("contribution-save")).toBeEnabled()
    const effectiveText = (await page.getByTestId("contribution-effective").innerText()).replace(/\s+/g, " ")
    expect(effectiveText).toMatch(/^Takes effect with the pay period starting \w{3} \d{1,2}, \d{4} \(paid \w{3} \d{1,2}, \d{4}\)\./)
    await page.getByTestId("contribution-save").click()
    await expect(page.getByTestId("contribution-saved")).toContainText(`Your contribution is ${next}%`)

    const reader = await openLiveDb(page)
    const saved = reader
      .prepare("select version, retirement_deferral_pct, effective_from from benefit_election_versions where case_id = ? order by version desc limit 1")
      .get(candidate.caseId) as Election
    const decided = reader.prepare("select decided_by_user_id by, source from benefit_election_versions where case_id = ? and version = ?").get(candidate.caseId, saved.version) as { by: string; source: string }
    reader.close()
    expect(saved.version).toBe(versions + 1)
    expect(saved.retirement_deferral_pct).toBe(next)
    expect(decided).toEqual({ by: candidate.userId, source: "employee_change" })
    const from = saved.effective_from!
    const today = todayEastern()
    expect(from > today && from <= addDays(today, 14)).toBe(true)
    expect(new Date(`${from}T00:00:00Z`).getUTCDay()).toBe(1)
    expect(effectiveText).toContain(shortDay(from))
    await shot(page, "benefits-saved")

    await page.reload()
    await expect(page.getByTestId("benefits-current-pct")).toHaveText(`${before.pct}% of each paycheck`)
    await expect(page.getByTestId("benefits-pending")).toContainText(`${next}%`)
    const history = page.getByTestId("benefits-history-entry")
    await expect(history.first()).toContainText(`${next}% 401(k)`)
    await expect(history.first()).toContainText(shortDay(from))
    await expect(history.first()).toContainText("Starts later")
    await expect(history.last()).toContainText("In force")
    await shot(page, "benefits-after")

    const issuesOn = addDays(from, 11)
    const checker = new Database(dbFile(), { fileMustExist: true, timeout: 10_000 })
    const lastBefore = checker
      .prepare("select i.id, l.amount_cents salary, json_extract(r.inputs_json, '$.deferralCents') deferral, json_extract(r.inputs_json, '$.deferralPct') pct from invoices i join invoice_lines l on l.invoice_id = i.id and l.code = 'SALARY' join invoice_lines r on r.invoice_id = i.id and r.code = 'RETIREMENT' where i.hire_id = ? and i.kind = 'payroll' and i.status <> 'void' order by i.period_index desc limit 1")
      .get(candidate.hireId) as { salary: number; deferral: number; pct: number }
    const known = new Set((checker.prepare("select id from invoices where hire_id = ?").all(candidate.hireId) as { id: string }[]).map((row) => row.id))
    checker.close()
    expect(lastBefore.pct).toBe(before.pct)
    expect(Math.abs(lastBefore.deferral - Math.round((lastBefore.salary * before.pct) / 100))).toBeLessThanOrEqual(1)

    const sqlite = new Database(dbFile(), { fileMustExist: true, timeout: 10_000 })
    sqlite.pragma("foreign_keys = ON")
    const result = runBilling({ db: drizzle(sqlite, { schema }), now: () => new Date(`${issuesOn}T17:00:00Z`) }, { hireIds: [candidate.hireId] })
    sqlite.close()
    const generated = result.invoices.filter((invoice) => !known.has(invoice.id))
    created.invoiceIds = generated.map((invoice) => invoice.id)
    const payroll = generated.find((invoice) => invoice.kind === "payroll" && invoice.period?.start === from)
    expect(payroll, "the billing run for the effective period's issue day issues its payroll invoice").toBeTruthy()

    const verify = new Database(dbFile(), { readonly: true, fileMustExist: true })
    const line = (code: string) =>
      verify.prepare("select amount_cents amount, inputs_json inputs from invoice_lines where invoice_id = ? and code = ?").get(payroll!.id, code) as { amount: number; inputs: string }
    const salary = line("SALARY").amount
    const retirement = JSON.parse(line("RETIREMENT").inputs) as { deferralPct: number; deferralCents: number }
    const health = JSON.parse(line("HEALTHCARE").inputs) as { employeePremiumCents?: number }
    const slip = verify.prepare("select pre_tax_deductions_cents pre from payroll_entries where invoice_id = ?").get(payroll!.id) as { pre: number }
    const oldSlips = verify
      .prepare("select count(*) n from payroll_entries p join invoices i on i.id = p.invoice_id where p.hire_id = ? and p.period_start < ? and json_extract((select inputs_json from invoice_lines where invoice_id = i.id and code = 'RETIREMENT'), '$.deferralPct') <> ?")
      .get(candidate.hireId, from, before.pct) as { n: number }
    verify.close()
    expect(retirement.deferralPct).toBe(next)
    expect(Math.abs(retirement.deferralCents - Math.round((salary * next) / 100))).toBeLessThanOrEqual(1)
    expect(slip.pre).toBe((health.employeePremiumCents ?? 0) + retirement.deferralCents)
    expect(oldSlips.n).toBe(0)
  })

  test("the field never goes above the most the IRS and the package allow", async ({ page, baseURL }) => {
    const db = await openLiveDb(page)
    const [employee] = activeEmployees(db)
    db.close()
    await signIn(page, baseURL!, employee.userId)
    await page.goto("/worker/benefits")
    const max = Number(await page.getByTestId("deferral-input").getAttribute("max"))
    expect(max).toBeGreaterThan(0)
    await page.getByTestId("deferral-input").fill(String(max + 1))
    await expect(page.getByTestId("deferral-input")).toHaveValue(String(max))
  })
})

test.describe("documents open in a new tab", () => {
  async function pdfLink(page: Page): Promise<Locator> {
    await page.goto("/worker/documents")
    return page.getByTestId("view-document").first()
  }

  test("the name opens the signed copy inline in a new tab and the icon downloads it", async ({ page, baseURL, context }) => {
    test.setTimeout(180_000)
    const reader = await openLiveDb(page)
    const fresh = reader
      .prepare(
        `select c.worker_user_id userId, c.id caseId from onboarding_cases c
         join tasks a on a.case_id = c.id and a.key = 'accept_invitation' and a.status = 'ready'
         where c.lifecycle = 'open' order by c.id desc limit 1`,
      )
      .get() as { userId: string; caseId: string } | undefined
    const stored = reader
      .prepare(
        `select c.worker_user_id userId from generated_documents g join onboarding_cases c on c.id = g.case_id
         join document_signatures s on s.document_id = g.id and s.party = 'worker' where g.storage_path is not null limit 1`,
      )
      .get() as { userId: string } | undefined
    reader.close()

    let userId = stored?.userId
    if (!userId) {
      test.skip(!fresh, "no stored signed document and no employee left to sign one in this database")
      userId = fresh!.userId
      await signIn(page, baseURL!, userId)
      await signAgreement(page, fresh!.caseId, userId)
    }

    await signIn(page, baseURL!, userId)
    const link = await pdfLink(page)
    await expect(link).toHaveAttribute("target", "_blank")
    await expect(link).toHaveAttribute("rel", "noopener noreferrer")
    const id = decodeURIComponent((await link.getAttribute("href"))!.split("/").at(-2)!)
    const downloadButton = page.getByTestId("download-document").first()
    expect((await downloadButton.innerText()).trim()).toBe("")
    await expect(downloadButton).toHaveAttribute("href", `/worker/documents/${encodeURIComponent(id)}/download`)

    const responses: Response[] = []
    context.on("response", (response) => {
      if (response.url().includes(`/worker/documents/${encodeURIComponent(id)}/view`)) responses.push(response)
    })
    const [popup] = await Promise.all([context.waitForEvent("page"), link.click()])
    await popup.waitForLoadState("load").catch(() => undefined)
    expect(popup).not.toBe(page)
    expect(popup.url()).toContain(`/worker/documents/${encodeURIComponent(id)}/view`)
    await expect.poll(() => responses.length).toBeGreaterThan(0)
    const view = responses[0]
    expect(view.status()).toBe(200)
    expect(view.headers()["content-type"]).toBe("application/pdf")
    expect(view.headers()["content-disposition"]).toMatch(/^inline/)
    expect(view.headers()["x-content-type-options"]).toBe("nosniff")
    expect(view.headers()["cache-control"]).toBe("private, no-store")
    const { response: fetched, bytes } = await download(page.request, popup.url())
    expect(fetched.status()).toBe(200)
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-")
    expect(page.url()).toContain("/worker/documents")
    await popup.close()

    const attachment = await page.request.get(`/worker/documents/${encodeURIComponent(id)}/download`)
    expect(attachment.status()).toBe(200)
    expect(attachment.headers()["content-disposition"]).toMatch(/^attachment/)
    expect(new Uint8Array(await attachment.body())).toEqual(bytes)
    
  })

  test("the view route answers 401 without a session, 403 for other roles and 404 for another employee's document", async ({ page, baseURL }) => {
    const reader = await openLiveDb(page)
    const doc = reader
      .prepare(
        `select g.id, c.worker_user_id owner from generated_documents g join onboarding_cases c on c.id = g.case_id
         where g.storage_path is not null and g.kind in ('employment_agreement','i9_section1','w4','direct_deposit_authorization') limit 1`,
      )
      .get() as { id: string; owner: string } | undefined
    const stranger = reader.prepare("select id from users where role = 'worker' and id <> ? limit 1").get(doc?.owner ?? "") as { id: string }
    const hr = reader.prepare("select id from users where role = 'client_hr' limit 1").get() as { id: string }
    reader.close()
    test.skip(!doc, "no stored signed document in this database")

    const url = `/worker/documents/${encodeURIComponent(doc!.id)}/view`
    await page.context().clearCookies()
    expect((await page.request.get(url)).status()).toBe(401)
    await signIn(page, baseURL!, hr.id)
    expect((await page.request.get(url)).status()).toBe(403)
    await signIn(page, baseURL!, stranger.id)
    const theirs = await page.request.get(url)
    const unknown = await page.request.get("/worker/documents/doc_does_not_exist/view")
    expect(theirs.status()).toBe(404)
    expect(unknown.status()).toBe(404)
    expect(await theirs.json()).toEqual(await unknown.json())
    await signIn(page, baseURL!, doc!.owner)
    expect((await page.request.get(url)).status()).toBe(200)
  })
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

/** Accepts the invitation and signs the agreement through the real task pages, which stores the signed copy. */
async function signAgreement(page: Page, caseId: string, userId: string) {
  const reader = new Database(dbFile(), { readonly: true, fileMustExist: true })
  const task = (key: string) =>
    reader.prepare("select id from tasks where case_id = ? and key = ? and assignee_user_id = ? order by seq desc limit 1").get(caseId, key, userId) as { id: string }
  const accept = task("accept_invitation").id
  const sign = task("sign_agreement").id
  reader.close()
  await page.goto(`/worker/tasks/${accept}`)
  await page.getByTestId("accept-invitation").click()
  await expect(page.getByTestId("task-notice")).toBeVisible()
  await page.goto(`/worker/tasks/${sign}`)
  await page.getByTestId("sign-agreement").click()
  await signInPopup(page)
  await expect(page.getByTestId("task-notice")).toBeVisible({ timeout: 30_000 })
}
