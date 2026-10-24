// @vitest-environment node
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { SEED_IDS, caseEvents, type AppDatabase } from "@/db"
import { loadI9Review } from "../onboarding-portal/i9-review"
import { staffCaseDetail } from "../onboarding-portal/case-detail"

import { readIdentityUpload } from "../employee-documents"
import { loadEmployeeCase, uploadsFor } from "../employee-portal"
import { submitDocuments, uploadIdentityDocument } from "../employee-tasks"
import { completeTaskAsActor, tasksForCase } from "../tasks"

import { SAMPLE_IDENTITY_DETAILS, sessionUser, setup, tempDbFactory } from "./helpers"

const openDb = tempDbFactory()

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

let uploadsDir: string
let previousRoot: string | undefined

beforeEach(() => {
  uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "eor-supersede-"))
  previousRoot = process.env.UPLOADS_ROOT
  process.env.UPLOADS_ROOT = uploadsDir
})

afterEach(() => {
  if (previousRoot === undefined) delete process.env.UPLOADS_ROOT
  else process.env.UPLOADS_ROOT = previousRoot
  fs.rmSync(uploadsDir, { recursive: true, force: true })
})

/** An employee whose every earlier task is done, waiting at the identity-document upload. */
function atUpload(db: AppDatabase) {
  const ctx = setup(db, { startDate: "2026-03-16" })
  ctx.driver.drive({ stop: ["upload_documents"] })
  const worker = sessionUser(db, ctx.workerUserId)
  const specialist = sessionUser(db, SEED_IDS.users.specialist)
  const taskId = tasksForCase(db, ctx.caseId).find((task) => task.key === "upload_documents")!.id
  const upload = async (kind: "list_a" | "list_b" | "list_c") => {
    ctx.clock.advanceHours(1)
    return uploadIdentityDocument(ctx.deps, worker, {
      taskId,
      kind,
      fileName: `${kind}.png`,
      declaredType: "image/png",
      bytes: PNG,
      details: SAMPLE_IDENTITY_DETAILS[kind],
    })
  }
  const activeKinds = () => uploadsFor(db, loadEmployeeCase(db, worker.id, ctx.clock.now)!).map((doc) => doc.kind)
  return { ...ctx, worker, specialist, taskId, upload, activeKinds }
}

describe("switching the I-9 document list supersedes the other list", () => {
  it("shows the employee only the documents of the list they last used", async () => {
    const db = openDb()
    const ctx = atUpload(db)

    const a1 = await ctx.upload("list_a")
    expect(ctx.activeKinds()).toEqual(["list_a"])

    const b = await ctx.upload("list_b")
    expect(ctx.activeKinds()).toEqual(["list_b"])
    const c = await ctx.upload("list_c")
    expect(ctx.activeKinds()).toEqual(["list_b", "list_c"])

    const a2 = await ctx.upload("list_a")
    expect(ctx.activeKinds()).toEqual(["list_a"])

    const events = db.select().from(caseEvents).where(eq(caseEvents.caseId, ctx.caseId)).all().filter((event) => event.type === "document_uploaded")
    const last = JSON.parse(events.at(-1)!.payloadJson!)
    expect(last).toMatchObject({ documentId: a2.id, supersededDocumentId: a1.id })
    expect([...last.supersededDocumentIds].sort()).toEqual([b.id, c.id].sort())
  })

  it("cannot submit a path whose documents were superseded, and submitting the current path completes the task", async () => {
    const db = openDb()
    const ctx = atUpload(db)
    await ctx.upload("list_b")
    await ctx.upload("list_c")
    await ctx.upload("list_a")

    expect(() => submitDocuments(ctx.deps, ctx.worker, { taskId: ctx.taskId, path: "list_b_c" })).toThrow(/Upload a List B document and a List C document/)
    submitDocuments(ctx.deps, ctx.worker, { taskId: ctx.taskId, path: "list_a" })
    expect(tasksForCase(db, ctx.caseId).find((task) => task.id === ctx.taskId)!.status).toBe("done")
  })

  it("makes the engine refuse the superseded documents even when a caller names them", async () => {
    const db = openDb()
    const ctx = atUpload(db)
    const b = await ctx.upload("list_b")
    const c = await ctx.upload("list_c")
    await ctx.upload("list_a")

    expect(() => completeTaskAsActor(ctx.deps, { actor: ctx.worker, taskId: ctx.taskId, payload: { documentIds: [b.id, c.id] } })).toThrow()
    expect(tasksForCase(db, ctx.caseId).find((task) => task.id === ctx.taskId)!.status).toBe("ready")
  })

  it("lets the employee read only the active documents, while Northwind still reads the history", async () => {
    const db = openDb()
    const ctx = atUpload(db)
    const a1 = await ctx.upload("list_a")
    const b = await ctx.upload("list_b")
    const c = await ctx.upload("list_c")

    expect(readIdentityUpload(db, ctx.worker, a1.id)).toMatchObject({ ok: false, reason: "not_found" })
    expect(readIdentityUpload(db, ctx.worker, b.id)).toMatchObject({ ok: true })
    expect(readIdentityUpload(db, ctx.worker, c.id)).toMatchObject({ ok: true })
    expect(readIdentityUpload(db, ctx.specialist, a1.id)).toMatchObject({ ok: true })

    const a2 = await ctx.upload("list_a")
    expect(readIdentityUpload(db, ctx.worker, b.id)).toMatchObject({ ok: false, reason: "not_found" })
    expect(readIdentityUpload(db, ctx.worker, c.id)).toMatchObject({ ok: false, reason: "not_found" })
    expect(readIdentityUpload(db, ctx.worker, a2.id)).toMatchObject({ ok: true })
    expect(readIdentityUpload(db, ctx.specialist, b.id)).toMatchObject({ ok: true })
  })

  it("shows the specialist only the active list to verify, with its details, and marks the rest replaced", async () => {
    const db = openDb()
    const ctx = atUpload(db)
    await ctx.upload("list_b")
    await ctx.upload("list_c")
    const a = await ctx.upload("list_a")
    submitDocuments(ctx.deps, ctx.worker, { taskId: ctx.taskId, path: "list_a" })
    ctx.driver.drive({ stop: ["verify_i9_section2"] })

    const verifyId = tasksForCase(db, ctx.caseId).find((task) => task.key === "verify_i9_section2")!.id
    const review = loadI9Review(db, ctx.specialist, verifyId, ctx.clock.now)!
    expect(review.documents.map((doc) => doc.id)).toEqual([a.id])
    expect(review.readiness).toBe("ready")
    expect(review.documents[0].details).toMatchObject({ title: "U.S. Passport" })

    const detail = staffCaseDetail(db, ctx.specialist, ctx.caseId, ctx.clock.now)
    const reviews = Object.fromEntries((detail?.uploads ?? []).map((upload) => [upload.kind, upload.review]))
    expect(reviews).toMatchObject({ list_b: "replaced", list_c: "replaced" })
    expect(reviews.list_a).not.toBe("replaced")
  })
})
