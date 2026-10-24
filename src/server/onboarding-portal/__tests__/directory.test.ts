// @vitest-environment node
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { SEED_IDS, generatedDocuments } from "@/db"
import { DEFAULT_CASES_QUERY, type CasesQuery } from "@/lib/onboarding-portal/cases-query"
import { staffInbox } from "@/server/task-inbox"
import { DEFAULT_TASK_INBOX_QUERY } from "@/lib/task-inbox-view"
import { rejectTaskAsActor, tasksForCase } from "@/server/tasks"
import { writeSignedFile } from "@/server/uploads"

import { sessionUser, setup, tempDbFactory } from "@/server/__tests__/helpers"

import { staffCaseDetail } from "../case-detail"
import { casesDirectory, clientDetail, clientsDirectory, homeSummary } from "../directory"

const openDb = tempDbFactory()
const NOW = new Date()

let uploadsDir: string
let previousRoot: string | undefined

beforeEach(() => {
  uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "eor-uploads-"))
  previousRoot = process.env.UPLOADS_ROOT
  process.env.UPLOADS_ROOT = uploadsDir
})

afterEach(() => {
  if (previousRoot === undefined) delete process.env.UPLOADS_ROOT
  else process.env.UPLOADS_ROOT = previousRoot
  fs.rmSync(uploadsDir, { recursive: true, force: true })
})

const query = (patch: Partial<CasesQuery> = {}): CasesQuery => ({ ...DEFAULT_CASES_QUERY, size: 100, ...patch })

describe("the cases directory", () => {
  it("is only for onboarding specialists", () => {
    const db = openDb()
    for (const userId of [SEED_IDS.users.clientHr, SEED_IDS.users.worker, SEED_IDS.users.finance]) {
      const user = sessionUser(db, userId)
      expect(casesDirectory(db, user, query(), NOW)).toBeNull()
      expect(clientsDirectory(db, user, NOW)).toBeNull()
      expect(clientDetail(db, user, SEED_IDS.client, NOW)).toBeNull()
      expect(homeSummary(db, user, NOW)).toBeNull()
    }
    const specialist = sessionUser(db, SEED_IDS.users.specialist)
    expect(casesDirectory(db, specialist, query(), NOW)!.rows.length).toBeGreaterThan(10)
  })

  it("lists cases of every client", () => {
    const db = openDb()
    const specialist = sessionUser(db, SEED_IDS.users.specialist)
    const page = casesDirectory(db, specialist, query(), NOW)!
    expect(page.total).toBe(page.overall)
    expect(new Set(page.rows.map((row) => row.clientId)).size).toBe(page.clients.length)
    expect(page.clients.length).toBeGreaterThan(1)
  })

  it("orders at-risk first, then onboarding before the rest, then the earliest start date", () => {
    const db = openDb()
    const specialist = sessionUser(db, SEED_IDS.users.specialist)
    const rows = casesDirectory(db, specialist, query(), NOW)!.rows
    const firstSafe = rows.findIndex((row) => row.atRisk === null)
    expect(firstSafe).toBeGreaterThan(0)
    expect(rows.slice(0, firstSafe).every((row) => row.atRisk !== null)).toBe(true)
    expect(rows.slice(firstSafe).every((row) => row.atRisk === null)).toBe(true)

    const rest = rows.slice(firstSafe)
    const rank = { onboarding: 0, active: 1, inactive: 2 } as const
    for (let i = 1; i < rest.length; i += 1) {
      const a = rest[i - 1]
      const b = rest[i]
      expect(rank[a.status]).toBeLessThanOrEqual(rank[b.status])
      if (a.status === b.status && a.startDate && b.startDate) expect(a.startDate <= b.startDate).toBe(true)
    }
  })

  it("filters by status, at risk, stage, client and start date range", () => {
    const db = openDb()
    const specialist = sessionUser(db, SEED_IDS.users.specialist)
    const all = casesDirectory(db, specialist, query(), NOW)!

    const onboarding = casesDirectory(db, specialist, query({ status: "onboarding" }), NOW)!
    expect(onboarding.total).toBeGreaterThan(0)
    expect(onboarding.rows.every((row) => row.status === "onboarding")).toBe(true)
    expect(onboarding.total).toBe(all.rows.filter((row) => row.status === "onboarding").length)

    const risky = casesDirectory(db, specialist, query({ atRisk: true }), NOW)!
    expect(risky.total).toBe(all.rows.filter((row) => row.atRisk !== null).length)
    expect(risky.rows.every((row) => row.atRisk !== null)).toBe(true)

    const stage = all.rows.find((row) => row.stage)!.stage!
    const inStage = casesDirectory(db, specialist, query({ stage: stage.id }), NOW)!
    expect(inStage.total).toBeGreaterThan(0)
    expect(inStage.rows.every((row) => row.stage?.id === stage.id)).toBe(true)

    const client = all.clients[0]
    const ofClient = casesDirectory(db, specialist, query({ client: client.id }), NOW)!
    expect(ofClient.rows.length).toBeGreaterThan(0)
    expect(ofClient.rows.every((row) => row.clientId === client.id)).toBe(true)

    const dated = all.rows.filter((row) => row.startDate).map((row) => row.startDate!).sort()
    const from = dated[Math.floor(dated.length / 3)]
    const to = dated[Math.floor((dated.length * 2) / 3)]
    const ranged = casesDirectory(db, specialist, query({ startFrom: from, startTo: to }), NOW)!
    expect(ranged.total).toBeGreaterThan(0)
    expect(ranged.rows.every((row) => row.startDate! >= from && row.startDate! <= to)).toBe(true)
    expect(casesDirectory(db, specialist, query({ startFrom: "2999-01-01" }), NOW)!.total).toBe(0)
  })

  it("searches the person and the client, case-insensitively, and combines filters", () => {
    const db = openDb()
    const specialist = sessionUser(db, SEED_IDS.users.specialist)
    const all = casesDirectory(db, specialist, query(), NOW)!
    const person = all.rows[0].person
    const byName = casesDirectory(db, specialist, query({ q: person.toUpperCase() }), NOW)!
    expect(byName.rows.map((row) => row.person)).toContain(person)
    expect(byName.rows.every((row) => row.person.toLowerCase().includes(person.toLowerCase().split(" ")[0]))).toBe(true)

    const clientName = all.clients[0].name
    const byClient = casesDirectory(db, specialist, query({ q: clientName.toLowerCase() }), NOW)!
    expect(byClient.total).toBeGreaterThan(0)
    expect(byClient.rows.every((row) => row.clientName === clientName)).toBe(true)

    expect(casesDirectory(db, specialist, query({ q: "zzzz-nobody" }), NOW)!.rows).toEqual([])
    const both = casesDirectory(db, specialist, query({ q: clientName, status: "onboarding" }), NOW)!
    expect(both.rows.every((row) => row.clientName === clientName && row.status === "onboarding")).toBe(true)
  })

  it("pages without overlap and clamps a page past the end", () => {
    const db = openDb()
    const specialist = sessionUser(db, SEED_IDS.users.specialist)
    const first = casesDirectory(db, specialist, query({ size: 10, page: 1 }), NOW)!
    const second = casesDirectory(db, specialist, query({ size: 10, page: 2 }), NOW)!
    expect(first.rows).toHaveLength(10)
    expect(first.totalPages).toBe(Math.ceil(first.total / 10))
    expect(first.rows.map((row) => row.caseId).filter((id) => second.rows.some((row) => row.caseId === id))).toEqual([])
    const last = casesDirectory(db, specialist, query({ size: 10, page: 999 }), NOW)!
    expect(last.page).toBe(first.totalPages)
    expect(last.rows.length).toBeGreaterThan(0)
  })

  it("describes the stage a person is in", () => {
    const db = openDb()
    const specialist = sessionUser(db, SEED_IDS.users.specialist)
    const rows = casesDirectory(db, specialist, query({ status: "onboarding" }), NOW)!.rows
    const staged = rows.filter((row) => row.stage)
    expect(staged.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.stageProgress.total).toBeGreaterThan(0)
      expect(row.stageProgress.done).toBeLessThanOrEqual(row.stageProgress.total)
    }
  })
})

describe("clients and the home summary", () => {
  it("counts people and deposits per client", () => {
    const db = openDb()
    const specialist = sessionUser(db, SEED_IDS.users.specialist)
    const clients = clientsDirectory(db, specialist, NOW)!
    const all = casesDirectory(db, specialist, query(), NOW)!
    expect(clients.length).toBe(all.clients.length)
    for (const client of clients) {
      const rows = all.rows.filter((row) => row.clientId === client.id)
      expect(client.activePeople).toBe(rows.filter((row) => row.status === "active").length)
      expect(client.onboarding).toBe(rows.filter((row) => row.status === "onboarding").length)
      expect(client.deposit).toMatch(/unpaid|processing|All received|None pending/)
      expect(["signed", "draft", "none"]).toContain(client.agreement)
    }
    const detail = clientDetail(db, specialist, clients[0].id, NOW)!
    expect(detail.cases.every((row) => row.clientId === clients[0].id)).toBe(true)
    expect(detail.cases).toHaveLength(all.rows.filter((row) => row.clientId === clients[0].id).length)
    expect(clientDetail(db, specialist, "client_missing", NOW)).toBeNull()
  })

  it("summarises the queue, overdue, at-risk and this week's starts", () => {
    const db = openDb()
    const specialist = sessionUser(db, SEED_IDS.users.specialist)
    const summary = homeSummary(db, specialist, NOW)!
    const home = staffInbox(db, specialist, { ...DEFAULT_TASK_INBOX_QUERY, size: 100 }, NOW)
    expect(summary.open).toBe(home.total)
    expect(summary.overdue).toBe(home.rows.filter((row) => row.overdue).length)
    const all = casesDirectory(db, specialist, query(), NOW)!
    expect(summary.atRisk).toBe(all.rows.filter((row) => row.status === "onboarding" && row.atRisk).length)
    expect(summary.startingThisWeek).toBeGreaterThanOrEqual(0)
  })
})

describe("the case detail", () => {
  it("is for specialists only and a missing case is null", () => {
    const db = openDb()
    const ctx = setup(db, { startDate: "2026-03-02" })
    for (const userId of [SEED_IDS.users.clientHr, SEED_IDS.users.worker, SEED_IDS.users.finance, ctx.workerUserId]) {
      expect(staffCaseDetail(db, sessionUser(db, userId), ctx.caseId, ctx.clock.now)).toBeNull()
    }
    const specialist = sessionUser(db, SEED_IDS.users.specialist)
    expect(staffCaseDetail(db, specialist, "case_missing", ctx.clock.now)).toBeNull()
    const detail = staffCaseDetail(db, specialist, ctx.caseId, ctx.clock.now)!
    expect(detail.person.name).toBe("Casey Nguyen")
    expect(detail.client.name).toBeTruthy()
    expect(detail.status).toBe("onboarding")
  })

  it("lists every task with who finished it, the rework history and the specialist's actions", () => {
    const db = openDb()
    const ctx = setup(db, { startDate: "2026-03-02" })
    ctx.driver.drive({ stop: ["verify_i9_section2", "setup_payroll", "go_live", "file_new_hire_report", "submit_benefit_enrollments"] })
    const specialist = sessionUser(db, SEED_IDS.users.specialist)
    const verify = ctx.driver.find("verify_i9_section2")!
    rejectTaskAsActor(ctx.deps, { actor: specialist, taskId: verify.id, reason: { code: "DOC_EXPIRED", note: "The passport expired in 2024." } })

    const detail = staffCaseDetail(db, specialist, ctx.caseId, ctx.clock.now)!
    const items = detail.stages.flatMap((stage) => stage.items)
    expect(items.some((item) => item.completedBy === "Alex Harper")).toBe(true)
    expect(items.find((item) => item.type === "w4")!.ownerLabel).toBe("Employee")

    const fix = items.find((item) => item.type === "upload_documents" && item.status === "ready")!
    expect(fix.rework).toMatch(/expired/i)
    expect(fix.action).toBeNull()
    const replacement = items.filter((item) => item.type === "verify_i9_section2").at(-1)!
    expect(replacement.sentBack).toHaveLength(1)
    expect(replacement.sentBack[0]).toMatchObject({ by: "Sam Ortiz" })
    expect(replacement.sentBack[0].reason).toMatch(/passport expired/)
    expect(detail.uploads[0].review).toBe("sent_back")
    expect(detail.uploads[0].reviewNote).toMatch(/expired/i)
  })

  it("offers the specialist an action on a ready task of theirs", () => {
    const db = openDb()
    const ctx = setup(db, { startDate: "2026-03-02" })
    ctx.driver.drive({ stop: ["review_order"] })
    const specialist = sessionUser(db, SEED_IDS.users.specialist)
    const items = staffCaseDetail(db, specialist, ctx.caseId, ctx.clock.now)!.stages.flatMap((stage) => stage.items)
    const review = items.find((item) => item.type === "review_order")!
    expect(review.action).toMatchObject({ href: expect.stringContaining(review.id) })
    expect(items.filter((item) => item.action)).toHaveLength(1)
  })

  it("marks uploads and signed documents whose stored file is missing instead of linking to them", () => {
    const db = openDb()
    const ctx = setup(db, { startDate: "2026-03-02" })
    ctx.driver.drive({ stop: ["verify_i9_section2", "setup_payroll", "go_live", "file_new_hire_report", "submit_benefit_enrollments"] })
    const specialist = sessionUser(db, SEED_IDS.users.specialist)

    const first = staffCaseDetail(db, specialist, ctx.caseId, ctx.clock.now)!.documents[0]
    expect(first).toBeTruthy()
    const storagePath = writeSignedFile({ caseId: ctx.caseId, name: "copy.pdf", bytes: new Uint8Array([1, 2, 3]) })
    db.update(generatedDocuments).set({ storagePath }).where(eq(generatedDocuments.id, first.id)).run()
    const before = staffCaseDetail(db, specialist, ctx.caseId, ctx.clock.now)!
    expect(before.documents.find((doc) => doc.id === first.id)!.downloadable).toBe(true)

    fs.rmSync(uploadsDir, { recursive: true, force: true })
    fs.mkdirSync(uploadsDir, { recursive: true })
    const after = staffCaseDetail(db, specialist, ctx.caseId, ctx.clock.now)!
    expect(after.uploads.length).toBeGreaterThan(0)
    expect(after.uploads.every((upload) => upload.mime === null)).toBe(true)
    expect(after.documents.every((doc) => !doc.downloadable)).toBe(true)
  })

  it("shows forms and orders without a single unmasked secret", () => {
    const db = openDb()
    const ctx = setup(db, { startDate: "2026-03-02" })
    ctx.driver.drive({ stop: ["verify_i9_section2", "setup_payroll", "go_live", "file_new_hire_report", "submit_benefit_enrollments"] })
    const specialist = sessionUser(db, SEED_IDS.users.specialist)
    const detail = staffCaseDetail(db, specialist, ctx.caseId, ctx.clock.now)!

    expect(detail.forms.map((form) => form.id)).toEqual(expect.arrayContaining(["personal_details", "w4", "direct_deposit"]))
    const text = JSON.stringify(detail.forms)
    expect(text).not.toMatch(/\d{3}-\d{2}-\d{4}/)
    expect(text).toMatch(/\*\*\*-\*\*-\d{4}/)
    const bank = detail.forms.find((form) => form.id === "direct_deposit")!
    expect(bank.fields.find((field) => field.label === "Account number")!.value).toMatch(/^•+ \d{4}$/)
    expect(bank.fields.map((field) => field.value).join(" ")).not.toMatch(/\d{9}/)

    expect(detail.order.deposit.state).toBe("paid")
    expect(detail.order.invoices.some((invoice) => invoice.kind === "deposit" && invoice.status === "paid")).toBe(true)
    expect(detail.order.quoteTotals).not.toBeNull()
    expect(detail.activity.length).toBeGreaterThan(5)
    expect(detail.activity.some((entry) => entry.actorName === "Alex Harper")).toBe(true)
    expect(detail.documents.some((doc) => doc.kind === "employment_agreement")).toBe(true)
    expect(tasksForCase(db, ctx.caseId).length).toBeGreaterThan(10)
  })
})
