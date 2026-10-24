// @vitest-environment node
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { SessionUser } from "@/auth"
import { SEED_IDS, formSubmissions, generatedDocuments } from "@/db"
import type { I9Section2Data } from "@/domain/forms"
import { DEFAULT_HANDLERS } from "@/domain/tasks"
import { TASK_UI_REGISTRY } from "@/lib/task-ui-registry"
import { DEDICATED_COMPLETION_TYPES } from "@/server/dedicated-task-types"
import { sessionUser, setup, tempDbFactory } from "@/server/__tests__/helpers"
import { tasksForCase } from "@/server/tasks"

import { acceptSection2, handlerPayload, prepareSection2 } from "../i9-review"

const state = vi.hoisted(() => ({ db: null as unknown, user: null as unknown }))

vi.mock("@/auth", async () => {
  const acl = await vi.importActual<typeof import("@/auth/acl")>("@/auth/acl")
  return { AuthError: acl.AuthError, requireUser: async () => state.user as SessionUser }
})
vi.mock("@/db", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/db")>()), getDb: () => state.db }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/font/local", () => ({ default: () => ({ className: "", style: {} }) }))

import { completeTaskAction } from "@/server/task-actions"

// Signing seals a real PDF, which is slow when the machine is busy.
vi.setConfig({ testTimeout: 30_000 })

const openDb = tempDbFactory()

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

const section2: I9Section2Data = {
  listA: [{ title: "U.S. Passport", issuingAuthority: "U.S. Department of State", number: "123456789", expiresOn: "2031-05-01" }],
  listB: null,
  listC: null,
  additionalInformation: "",
  alternativeProcedure: false,
  firstDayOfEmployment: "2026-03-02",
  employerRepFirstName: "Sam",
  employerRepLastName: "Ortiz",
  employerRepTitle: "Onboarding Specialist",
  businessName: "Northwind EOR, Inc.",
  businessAddress: { street: "500 Harbor Way, Suite 400", city: "San Francisco", state: "CA", zip: "94105" },
}

const HELD_BACK = "Check the details you entered."
const OWN_FORM = /finished from its own form/

function atStart() {
  const db = openDb()
  state.db = db
  const ctx = setup(db, { startDate: "2026-03-02" })
  const specialist = sessionUser(db, SEED_IDS.users.specialist)
  state.user = specialist
  const status = (taskId: string) => tasksForCase(db, ctx.caseId).find((task) => task.id === taskId)!.status
  return { db, ctx, specialist, status }
}

describe("verify_i9_section2 finishes only from the Section 2 screen", () => {
  it("refuses a bare completion and even a well-formed payload through the generic action, storing nothing", async () => {
    const { db, ctx, status } = atStart()
    ctx.driver.drive({ stop: ["verify_i9_section2", "setup_payroll", "go_live", "file_new_hire_report", "submit_benefit_enrollments"] })
    const task = ctx.driver.find("verify_i9_section2")!

    for (const payload of [undefined, {}, handlerPayload(section2)]) {
      const result = await completeTaskAction(task.id, payload)
      expect(result, JSON.stringify(payload)).toMatchObject({ ok: false, code: "validation" })
      expect((result as { message: string }).message).toMatch(OWN_FORM)
    }
    expect(status(task.id)).toBe("ready")
    expect(db.select().from(formSubmissions).where(eq(formSubmissions.taskId, task.id)).all()).toEqual([])
    expect(db.select().from(generatedDocuments).where(eq(generatedDocuments.taskId, task.id)).all()).toEqual([])
  })

  it("is completed by the screen's own service: signed document stored with the task done", async () => {
    const { db, ctx, specialist, status } = atStart()
    ctx.driver.drive({ stop: ["verify_i9_section2", "setup_payroll", "go_live", "file_new_hire_report", "submit_benefit_enrollments"] })
    const task = ctx.driver.find("verify_i9_section2")!

    const prepared = await prepareSection2(ctx.deps, specialist, { taskId: task.id, data: section2 })
    const field = prepared.fields.find((candidate) => candidate.kind === "signature")!
    const now = ctx.clock.now
    await acceptSection2(ctx.deps, specialist, {
      taskId: task.id,
      data: section2,
      signature: { typedName: "Sam Ortiz", consentedAt: new Date(now.getTime() - 60_000).toISOString() },
      fieldValues: { [field.id]: { kind: "signature", value: "Sam Ortiz", signedAt: now.toISOString() } },
    })

    expect(status(task.id)).toBe("done")
    expect(db.select().from(generatedDocuments).where(eq(generatedDocuments.taskId, task.id)).all()).toHaveLength(1)
    expect(db.select().from(formSubmissions).where(eq(formSubmissions.taskId, task.id)).all()).toHaveLength(1)
  })
})

describe("the other specialist tasks need what their screens collect", () => {
  it("refuses a bare completion of setup_payroll, and completes with the screen's payload", async () => {
    const { ctx, specialist, status } = atStart()
    ctx.driver.drive({ stop: ["verify_i9_section2", "setup_payroll", "go_live", "file_new_hire_report", "submit_benefit_enrollments"] })
    const verify = ctx.driver.find("verify_i9_section2")!
    const prepared = await prepareSection2(ctx.deps, specialist, { taskId: verify.id, data: section2 })
    const field = prepared.fields.find((candidate) => candidate.kind === "signature")!
    const now = ctx.clock.now
    await acceptSection2(ctx.deps, specialist, {
      taskId: verify.id,
      data: section2,
      signature: { typedName: "Sam Ortiz", consentedAt: new Date(now.getTime() - 60_000).toISOString() },
      fieldValues: { [field.id]: { kind: "signature", value: "Sam Ortiz", signedAt: now.toISOString() } },
    })
    const payroll = ctx.driver.find("setup_payroll")!

    for (const payload of [undefined, {}, { payFrequency: "" }, { payFrequency: "daily" }]) {
      const result = await completeTaskAction(payroll.id, payload)
      expect(result, JSON.stringify(payload)).toMatchObject({ ok: false, code: "INVALID_TASK_PAYLOAD" })
      expect((result as { message: string }).message).toMatch(HELD_BACK)
    }
    expect(status(payroll.id)).toBe("ready")

    expect(await completeTaskAction(payroll.id, { payFrequency: "biweekly" })).toMatchObject({ ok: true })
    expect(status(payroll.id)).toBe("done")
  })

  it("refuses bare filings, and completes each with a confirmation number", async () => {
    const { ctx, status } = atStart()
    ctx.driver.drive({ stop: ["file_new_hire_report", "submit_benefit_enrollments"] })
    ctx.clock.set("2026-03-10T12:00:00Z")
    ctx.driver.drive({ stop: ["file_new_hire_report", "submit_benefit_enrollments"] })
    const filings = ["file_new_hire_report", "submit_benefit_enrollments"].flatMap((key) => {
      const task = ctx.driver.find(key)
      return task ? [task] : []
    })
    expect(filings.length).toBeGreaterThan(0)

    for (const task of filings) {
      for (const payload of [undefined, {}, { confirmationNumber: "   " }]) {
        const result = await completeTaskAction(task.id, payload)
        expect(result, `${task.key} ${JSON.stringify(payload)}`).toMatchObject({ ok: false, code: "INVALID_TASK_PAYLOAD" })
        expect((result as { message: string }).message).toMatch(HELD_BACK)
      }
      expect(status(task.id)).toBe("ready")
      expect(await completeTaskAction(task.id, { confirmationNumber: "REF-2026-0042" })).toMatchObject({ ok: true })
      expect(status(task.id)).toBe("done")
    }
  })

  it("lets review_order finish with no payload: approving is the whole act, the note is optional", async () => {
    const { db, ctx, status } = atStart()
    const review = tasksForCase(db, ctx.caseId).find((task) => task.key === "review_order")!
    expect(review.status).toBe("ready")
    expect(await completeTaskAction(review.id, undefined)).toMatchObject({ ok: true })
    expect(status(review.id)).toBe("done")
  })
})

describe("every specialist task is either dedicated or needs its screen's input", () => {
  const SPECIALIST_TYPES = Object.entries(TASK_UI_REGISTRY)
    .filter(([, entry]) => entry.portals.includes("onboarding"))
    .map(([type]) => type)

  it("has no specialist task type that a bare payload can complete through the shared action", () => {
    expect(SPECIALIST_TYPES).toEqual(expect.arrayContaining(["verify_i9_section2", "setup_payroll", "file_new_hire_report"]))
    const optionalInput = new Set(["review_order"])
    for (const type of SPECIALIST_TYPES) {
      if (DEDICATED_COMPLETION_TYPES.has(type) || optionalInput.has(type)) continue
      const handler = DEFAULT_HANDLERS[type]
      expect(handler, type).toBeDefined()
      expect(
        () => handler!.parse({}, { task: {} as never, actor: null, env: { documents: [] } as never }),
        `${type} must require input`,
      ).toThrow()
    }
    expect(DEDICATED_COMPLETION_TYPES.has("verify_i9_section2")).toBe(true)
  })
})
