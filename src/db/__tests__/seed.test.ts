import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { eq } from "drizzle-orm"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"

import { parsePolicySnapshot } from "@/domain/types"
import { personStatusFor } from "@/domain/person-status"
import { projectTasks, type Task } from "@/domain/tasks"
import { rowToTask } from "@/server/task-store"
import { personDetailForClient } from "@/server/queries"
import { tasksForCase } from "@/server/tasks"
import { readStoredFile, sniffUploadType } from "@/server/uploads"

import { createDb, type AppDatabase } from "../client"
import {
  caseDocuments,
  caseEvents,
  clientAgreements,
  hireRequests,
  invoices,
  onboardingCases,
  roles,
  tasks as tasksTable,
  users,
} from "../schema"
import {
  casesForWorker,
  listPersonas,
  rosterIds,
  SEED_COMPANIES,
  SEED_IDS,
  SEED_NOW,
  SEED_ROSTER,
  seedDate,
  seedIfEmpty,
} from "../seed"

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function openDb(): AppDatabase {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eor-seed-"))
  tempDirs.push(dir)
  return createDb(path.join(dir, "test.sqlite"), { forceSeed: false })
}

describe("seed world", () => {
  it("loads the canonical personas, Jordan waiting on the specialist, and the roster", () => {
    const db = openDb()
    const allUsers = db.select().from(users).all()
    const roleCounts = Object.fromEntries(
      ["client_hr", "worker", "onboarding_specialist", "finance"].map((role) => [
        role,
        allUsers.filter((user) => user.role === role).length,
      ])
    )
    expect(roleCounts).toEqual({
      client_hr: SEED_COMPANIES.length,
      worker: SEED_ROSTER.length + 1,
      onboarding_specialist: 2,
      finance: 2,
    })
    expect(listPersonas(db).map((u) => u.id)).toEqual([
      SEED_IDS.users.clientHr,
      SEED_IDS.users.clientHr2,
      SEED_IDS.users.clientHr3,
      SEED_IDS.users.worker,
      SEED_IDS.users.worker2,
      SEED_IDS.users.specialist,
      SEED_IDS.users.specialist2,
      SEED_IDS.users.finance,
      SEED_IDS.users.finance2,
    ])
    const byId = Object.fromEntries(allUsers.map((user) => [user.id, user]))
    expect(byId[SEED_IDS.users.clientHr]?.displayName).toBe("Alex Harper")
    expect(byId[SEED_IDS.users.worker]?.displayName).toBe("Jordan Lee")
    expect(byId[SEED_IDS.users.worker2]?.displayName).toBe("Taylor Kim")
    expect(byId[SEED_IDS.users.specialist]?.displayName).toBe("Sam Ortiz")
    expect(byId[SEED_IDS.users.specialist2]?.displayName).toBe("Riley Chen")
    for (const user of allUsers) {
      expect(user.clientCompanyId !== null).not.toBe(user.providerId !== null)
    }

    expect(casesForWorker(db, SEED_IDS.users.worker2)).toEqual([])
    expect(db.select().from(onboardingCases).all()).toHaveLength(SEED_ROSTER.length)

    const agreement = db.select().from(clientAgreements).where(eq(clientAgreements.id, SEED_IDS.agreement)).get()
    expect(agreement).toMatchObject({ markupPct: 15, status: "signed" })
    expect(db.select().from(roles).where(eq(roles.id, SEED_IDS.role)).get()).toMatchObject({
      name: "Software Engineer",
      clientCompanyId: SEED_IDS.client,
    })

    const hire = db.select().from(hireRequests).where(eq(hireRequests.id, SEED_IDS.hire)).get()
    expect(hire).toMatchObject({
      workerUserId: SEED_IDS.users.worker,
      createdByUserId: SEED_IDS.users.clientHr,
      package: "standard",
      wageCents: 6500,
      wageUnit: "hourly",
      stateCode: "CA",
      roleId: SEED_IDS.role,
    })
    const frozen = parsePolicySnapshot(hire?.policySnapshotJson ?? "")
    expect(frozen).toMatchObject({ hireId: SEED_IDS.hire, markupPct: 15, eorFeeCents: 975, roleTitle: "Software Engineer" })
    expect(frozen?.quote?.rateSetId).toBeTruthy()

    const docs = db.select().from(caseDocuments).where(eq(caseDocuments.caseId, SEED_IDS.case)).all()
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({ id: SEED_IDS.document, kind: "list_a", uploadedBy: SEED_IDS.users.worker })
    expect(sniffUploadType(new Uint8Array(readStoredFile(docs[0].storagePath)!))).toBe("image/png")

    // Jordan finished everything the worker owns and waits on the specialist; the stage is derived.
    const detail = personDetailForClient(db, { caseId: SEED_IDS.case, clientCompanyId: SEED_IDS.client }, SEED_NOW)
    expect(detail?.status).toBe("onboarding")
    expect(detail?.onboarding.waitingOn).toEqual(["Northwind"])
    expect(detail?.onboarding.tasks.find((t) => t.status === "ready" && t.key !== "go_live")?.key).toBe("verify_i9_section2")
  })

  it("stores every identity document as a real file the upload service would accept", () => {
    const db = openDb()
    const rows = db.select().from(caseDocuments).all()
    expect(rows.length).toBeGreaterThan(30)
    for (const row of rows) {
      const bytes = readStoredFile(row.storagePath)
      expect(bytes, `${row.caseId} ${row.fileName}`).not.toBeNull()
      const type = sniffUploadType(new Uint8Array(bytes!))
      expect(type, row.fileName).toBe(row.fileName.endsWith(".pdf") ? "application/pdf" : "image/png")
    }
    const paths = rows.map((row) => row.storagePath)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it("keeps the documents of people whose I-9 was sent back, so they can be seen and replaced", () => {
    const db = openDb()
    const sentBack = SEED_ROSTER.filter((person) => person.kind === "rejected_awaiting_fix")
    expect(sentBack.length).toBeGreaterThan(0)
    for (const person of sentBack) {
      const caseId = rosterIds(person.key).case
      const fix = tasksForCase(db, caseId).find((task) => task.key === "fix_documents")
      expect(fix?.status, person.name).toBe("ready")
      const docs = db.select().from(caseDocuments).where(eq(caseDocuments.caseId, caseId)).all()
      expect(docs.length, person.name).toBeGreaterThan(0)
      for (const doc of docs) expect(readStoredFile(doc.storagePath), `${person.name} ${doc.fileName}`).not.toBeNull()
    }
  })

  it("has an employee who has started with the benefits choice still open", () => {
    const db = openDb()
    const started = SEED_ROSTER.filter((person) => {
      const open = tasksForCase(db, rosterIds(person.key).case).some((task) => task.key === "benefits_decision" && task.status === "ready")
      if (!open) return false
      const detail = personDetailForClient(db, { caseId: rosterIds(person.key).case, clientCompanyId: SEED_COMPANIES[person.company].id }, SEED_NOW)
      return detail?.status === "active"
    })
    expect(started.length).toBeGreaterThan(0)
  })

  it("is idempotent: a second open does not duplicate, and force reseed restores edits", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eor-seed-"))
    tempDirs.push(dir)
    const first = createDb(path.join(dir, "test.sqlite"), { forceSeed: false })
    const before = first.select().from(users).all().length
    const tasksBefore = first.select().from(tasksTable).all().length
    seedIfEmpty(first, { force: false })
    expect(first.select().from(users).all()).toHaveLength(before)

    first.update(users).set({ displayName: "Changed" }).where(eq(users.id, SEED_IDS.users.worker)).run()
    seedIfEmpty(first, { force: true })
    expect(first.select().from(users).where(eq(users.id, SEED_IDS.users.worker)).get()?.displayName).toBe("Jordan Lee")
    expect(first.select().from(users).all()).toHaveLength(before)
    expect(first.select().from(tasksTable).all()).toHaveLength(tasksBefore)
  })

  it("is deterministic: two seeds produce the same people, tasks and events", () => {
    const shape = (db: AppDatabase) => ({
      users: db.select({ id: users.id, name: users.displayName, email: users.email }).from(users).orderBy(users.id).all(),
      tasks: db
        .select({ id: tasksTable.id, key: tasksTable.key, status: tasksTable.status, due: tasksTable.dueDate })
        .from(tasksTable)
        .orderBy(tasksTable.id)
        .all(),
      events: db.select({ id: caseEvents.id, type: caseEvents.type }).from(caseEvents).orderBy(caseEvents.id).all(),
    })
    expect(shape(openDb())).toEqual(shape(openDb()))
  })
})

describe("seeded states are reachable by the real rules", () => {
  let db: AppDatabase
  let reachDir: string
  let cases: { row: typeof onboardingCases.$inferSelect; hire: typeof hireRequests.$inferSelect; tasks: Task[] }[]

  beforeAll(() => {
    reachDir = fs.mkdtempSync(path.join(os.tmpdir(), "eor-seed-reach-"))
    db = createDb(path.join(reachDir, "test.sqlite"), { forceSeed: false })
    cases = db
      .select({ row: onboardingCases, hire: hireRequests })
      .from(onboardingCases)
      .innerJoin(hireRequests, eq(hireRequests.id, onboardingCases.hireRequestId))
      .all()
      .map(({ row, hire }) => ({ row, hire, tasks: tasksForCase(db, row.id) }))
  })

  afterAll(() => fs.rmSync(reachDir, { recursive: true, force: true }))

  const resolved = (task: Task | undefined) => task !== undefined && (task.status === "done" || task.status === "skipped")
  const latest = (tasks: Task[], key: string) =>
    tasks.filter((t) => t.key === key && t.status !== "cancelled").sort((a, b) => a.seq - b.seq).at(-1)

  it("every task's status agrees with its dependencies (nothing ready early, nothing stuck blocked)", () => {
    for (const { row, tasks } of cases) {
      if (row.lifecycle !== "open") continue
      for (const task of tasks) {
        if (task.status !== "ready" && task.status !== "blocked") continue
        const depsResolved =
          task.dependsOnKeys.every((key) => resolved(latest(tasks, key))) &&
          task.dependsOnTaskIds.every((id) => resolved(tasks.find((t) => t.id === id)))
        if (task.trigger === "go_live") continue
        expect(depsResolved, `${row.id} ${task.key} is ${task.status}`).toBe(task.status === "ready")
      }
    }
  })

  it("the event log matches the tasks: one event per completion and per rejection", () => {
    for (const { row, tasks } of cases) {
      const events = db.select().from(caseEvents).where(eq(caseEvents.caseId, row.id)).all()
      expect(events.filter((e) => e.type === "order_created")).toHaveLength(1)
      const completed = events.filter((e) => e.type === "task_completed").map((e) => (JSON.parse(e.payloadJson!) as { key: string }).key)
      const doneKeys = tasks.filter((t) => t.status === "done").map((t) => t.key)
      expect(completed.slice().sort(), row.id).toEqual(doneKeys.slice().sort())
      expect(events.filter((e) => e.type === "task_rejected")).toHaveLength(tasks.filter((t) => t.status === "rejected").length)
      for (const task of tasks.filter((t) => t.status === "done")) {
        expect(task.completedAt, `${row.id} ${task.key}`).not.toBeNull()
        expect(task.completedAt!.getTime()).toBeGreaterThanOrEqual(task.createdAt.getTime())
        expect(task.completedAt!.getTime()).toBeLessThanOrEqual(SEED_NOW.getTime())
      }
    }
  })

  it("lifecycle matches the lifecycle events, and each case's last change is its updated time", () => {
    for (const { row } of cases) {
      const events = db.select().from(caseEvents).where(eq(caseEvents.caseId, row.id)).all()
      const last = events
        .filter((e) => ["request_cancelled", "terminated", "reactivated"].includes(e.type))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .at(-1)
      const expected = !last || last.type === "reactivated" ? "open" : last.type === "terminated" ? "terminated" : "cancelled"
      expect(row.lifecycle, row.id).toBe(expected)
      const newest = Math.max(...events.map((e) => e.createdAt.getTime()))
      expect(row.updatedAt.getTime()).toBeGreaterThanOrEqual(newest)
    }
  })

  it("every hire has a frozen snapshot, a term that matches the roster, and a deposit that is held or still due", () => {
    for (const person of SEED_ROSTER) {
      const ids = rosterIds(person.key)
      const hire = db.select().from(hireRequests).where(eq(hireRequests.id, ids.hire)).get()!
      const snapshot = parsePolicySnapshot(hire.policySnapshotJson ?? "")
      expect(snapshot?.hireId).toBe(ids.hire)
      if (person.endInDays === undefined) {
        expect(hire.endDate).toBeNull()
        expect(snapshot?.quote?.term).toBeUndefined()
      } else {
        expect(hire.endDate).toBe(seedDate(person.endInDays))
        expect(hire.endDate! > hire.startDate!).toBe(true)
        expect(snapshot?.quote?.term).toMatchObject({ startDate: hire.startDate, endDate: hire.endDate })
      }
      const deposit = db.select().from(invoices).where(eq(invoices.id, `deposit:${ids.hire}`)).all()
      expect(deposit, person.key).toHaveLength(1)
      expect(deposit[0].companyId).toBe(SEED_COMPANIES[person.company].id)
    }
  })

  it("covers the states a demo needs, each derived from tasks", () => {
    const detail = (caseId: string, clientCompanyId: string = SEED_IDS.client) =>
      personDetailForClient(db, { caseId, clientCompanyId }, SEED_NOW)!
    const byKind = (kind: string) =>
      SEED_ROSTER.filter((p) => p.kind === kind).map((p) => detail(rosterIds(p.key).case, SEED_COMPANIES[p.company].id))

    const status = (kind: string) => new Set(byKind(kind).map((d) => d.status))
    expect(status("new_order")).toEqual(new Set(["onboarding"]))
    expect(byKind("new_order").every((d) => d.onboarding.tasks.find((t) => t.status === "ready" && t.clientCanAct)?.key === "pay_deposit")).toBe(true)
    expect(byKind("deposit_overdue").every((d) => d.onboarding.atRisk !== null)).toBe(true)
    expect(byKind("worker_at_risk").every((d) => d.onboarding.atRisk !== null)).toBe(true)
    expect(byKind("awaiting_review").every((d) => d.onboarding.waitingOn.join() === "Northwind")).toBe(true)
    expect(byKind("invited").every((d) => d.onboarding.waitingOn.join() === "Worker")).toBe(true)
    expect(byKind("waiting_for_start").every((d) => d.onboarding.waitingForStart && d.status === "onboarding")).toBe(true)
    for (const kind of ["active", "active_fixed_term"]) expect(status(kind)).toEqual(new Set(["active"]))
    expect(status("term_ended")).toEqual(new Set(["inactive"]))
    expect(byKind("cancelled").every((d) => d.lifecycle === "cancelled" && d.status === "inactive")).toBe(true)
    expect(byKind("terminated").every((d) => d.lifecycle === "terminated" && d.status === "inactive")).toBe(true)
    expect(byKind("terminated_reactivated").every((d) => d.lifecycle === "open" && d.status === "active")).toBe(true)
    expect(byKind("cancelled_reactivated").every((d) => d.lifecycle === "open" && d.status === "onboarding")).toBe(true)

    const rejected = SEED_ROSTER.filter((p) => p.kind === "rejected_awaiting_fix").map((p) => tasksForCase(db, rosterIds(p.key).case))
    expect(rejected.length).toBeGreaterThan(0)
    for (const tasks of rejected) {
      expect(tasks.some((t) => t.key === "verify_i9_section2" && t.status === "rejected")).toBe(true)
      expect(tasks.some((t) => t.key === "fix_documents" && t.status === "ready")).toBe(true)
    }

    const all = SEED_ROSTER.map((p) => detail(rosterIds(p.key).case, SEED_COMPANIES[p.company].id))
    for (const wanted of ["onboarding", "active", "inactive"] as const) {
      expect(all.filter((d) => d.status === wanted).length).toBeGreaterThanOrEqual(3)
    }
  })

  it("person status from the stored tasks equals the one the people list computes", () => {
    for (const { row, hire, tasks } of cases) {
      const projection = projectTasks(tasks, { now: SEED_NOW, startDate: hire.startDate })
      const status = personStatusFor({
        lifecycle: row.lifecycle,
        goLiveReached: projection.goLiveReached,
        endDate: hire.endDate,
        now: SEED_NOW,
      })
      const detail = personDetailForClient(db, { caseId: row.id, clientCompanyId: hire.clientCompanyId }, SEED_NOW)
      expect(detail?.status).toBe(status)
    }
  })

  it("rows for tasks reference only real cases and keep per-case numbering unique", () => {
    const rows = db.select().from(tasksTable).all().map(rowToTask)
    const seen = new Set<string>()
    for (const task of rows) {
      const key = `${task.caseId}:${task.seq}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
    expect(new Set(rows.map((t) => t.caseId))).toEqual(new Set(cases.map((c) => c.row.id)))
  })
})
