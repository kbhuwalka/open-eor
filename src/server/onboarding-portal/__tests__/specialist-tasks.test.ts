// @vitest-environment node
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { and, eq } from "drizzle-orm"
import { PDFDocument } from "pdf-lib"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  SEED_IDS,
  caseDocuments,
  caseEvents,
  documentSignatures,
  formSubmissions,
  generatedDocuments,
  type AppDatabase,
} from "@/db"
import { toI9Document } from "@/domain/forms"
import { uploadCaseDocument } from "@/server/cases"
import { decryptFields } from "@/server/field-crypto"
import { loadEmployeeScreen } from "@/server/employee-portal"
import { completeTaskAsActor, rejectTaskAsActor, tasksForCase } from "@/server/tasks"
import { readSignedFile } from "@/server/uploads"
import { verifySignedDocument } from "@/server/documents"

import { SAMPLE_IDENTITY_DETAILS, sessionUser, setup, tempDbFactory } from "@/server/__tests__/helpers"

import { loadDrawerTask } from "../drawer"
import { loadFiling } from "../filings"
import { readStaffDocument } from "../generated-documents"
import { acceptSection2, handlerPayload, I9InputError, loadI9Review, prepareSection2 } from "../i9-review"

// Signing fills and seals real PDFs, which is slow when the machine is busy.
vi.setConfig({ testTimeout: 30_000 })
import { loadOrderReview } from "../order-review"
import { loadPayrollSetup } from "../payroll-setup"

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

const PASSPORT = SAMPLE_IDENTITY_DETAILS.list_a
const SECTION2_PASSPORT = { listA: [toI9Document(PASSPORT)], listB: null, listC: null }

const dialog = (fieldId: string, typedName: string, now: Date) => ({
  signature: { typedName, consentedAt: new Date(now.getTime() - 60_000).toISOString() },
  fieldValues: { [fieldId]: { kind: "signature", value: typedName, signedAt: now.toISOString() } },
})

/** A case driven until the I-9 Section 2 review is the next thing the specialist sees. */
function atVerify(db: AppDatabase, patch: Parameters<typeof setup>[1] = {}) {
  const ctx = setup(db, { startDate: "2026-03-02", ...patch })
  ctx.driver.drive({ stop: ["verify_i9_section2", "setup_payroll", "go_live", "file_new_hire_report", "submit_benefit_enrollments"] })
  const specialist = sessionUser(db, SEED_IDS.users.specialist)
  const taskId = ctx.driver.find("verify_i9_section2")!.id
  return { ...ctx, specialist, taskId }
}

describe("who can use the specialist task screens", () => {
  it("only an onboarding specialist can read a specialist task's screen data", () => {
    const db = openDb()
    const ctx = atVerify(db)
    const reviewId = tasksForCase(db, ctx.caseId).find((task) => task.key === "review_order")!.id
    const now = ctx.clock.now

    expect(loadI9Review(db, ctx.specialist, ctx.taskId, now)).not.toBeNull()
    expect(loadOrderReview(db, ctx.specialist, reviewId, now)).not.toBeNull()
    for (const userId of [SEED_IDS.users.clientHr, SEED_IDS.users.worker, SEED_IDS.users.finance, ctx.workerUserId]) {
      const user = sessionUser(db, userId)
      expect(loadI9Review(db, user, ctx.taskId, now)).toBeNull()
      expect(loadOrderReview(db, user, reviewId, now)).toBeNull()
      expect(loadPayrollSetup(db, user, ctx.driver.find("setup_payroll", "blocked")!.id, now)).toBeNull()
    }
  })

  it("a screen only loads for its own task type", () => {
    const db = openDb()
    const ctx = atVerify(db)
    expect(loadOrderReview(db, ctx.specialist, ctx.taskId, ctx.clock.now)).toBeNull()
    expect(loadFiling(db, ctx.specialist, ctx.taskId, ctx.clock.now)).toBeNull()
  })

  it("the client, the employee and Finance cannot do specialist tasks", () => {
    const db = openDb()
    const ctx = atVerify(db)
    const body = SECTION2_PASSPORT
    for (const userId of [SEED_IDS.users.clientHr, SEED_IDS.users.finance, ctx.workerUserId]) {
      const user = sessionUser(db, userId)
      expect(() => completeTaskAsActor(ctx.deps, { actor: user, taskId: ctx.taskId, payload: handlerPayload(body) })).toThrow(
        expect.objectContaining({ code: "FORBIDDEN_ROLE" }),
      )
      expect(() => rejectTaskAsActor(ctx.deps, { actor: user, taskId: ctx.taskId, reason: { code: "DOC_ILLEGIBLE" } })).toThrow(
        expect.objectContaining({ code: "FORBIDDEN_ROLE" }),
      )
    }
    return Promise.all(
      [SEED_IDS.users.clientHr, SEED_IDS.users.finance, ctx.workerUserId].map(async (userId) => {
        const user = sessionUser(db, userId)
        await expect(prepareSection2(ctx.deps, user, { taskId: ctx.taskId })).rejects.toMatchObject({ code: "FORBIDDEN_ROLE" })
        await expect(
          acceptSection2(ctx.deps, user, { taskId: ctx.taskId, ...dialog("x", "Sam Ortiz", ctx.clock.now) }),
        ).rejects.toMatchObject({ code: "FORBIDDEN_ROLE" })
      }),
    )
  })
})

describe("review_order", () => {
  it("shows the order and approves through the engine, with an optional note", () => {
    const db = openDb()
    const ctx = setup(db, { startDate: "2026-03-02", stateCode: "TX", wageCents: 148000_00, wageUnit: "annual" })
    ctx.driver.drive({ stop: ["review_order"] })
    const specialist = sessionUser(db, SEED_IDS.users.specialist)
    const task = ctx.driver.find("review_order")!

    const data = loadOrderReview(db, specialist, task.id, ctx.clock.now)!
    expect(data.client).toBeTruthy()
    expect(data.stateCode).toBe("TX")
    expect(data.startDate).toBe("2026-03-02")
    expect(data.canAct).toBe(true)
    expect(data.checks.map((check) => check.id)).toEqual(["location", "wage_floor", "snapshot", "start_date", "agreement"])
    expect(data.checks.find((check) => check.id === "location")!.status).toBe("pass")

    completeTaskAsActor(ctx.deps, { actor: specialist, taskId: task.id, payload: { note: "Looks right" } })
    const after = tasksForCase(db, ctx.caseId).find((candidate) => candidate.id === task.id)!
    expect(after.status).toBe("done")
    expect(after.result).toMatchObject({ note: "Looks right" })
    expect(loadOrderReview(db, specialist, task.id, ctx.clock.now)!.approvalNote).toBe("Looks right")
  })

  it("rejects a note over 500 characters and cannot be sent back", () => {
    const db = openDb()
    const ctx = setup(db, { startDate: "2026-03-02" })
    ctx.driver.drive({ stop: ["review_order"] })
    const specialist = sessionUser(db, SEED_IDS.users.specialist)
    const task = ctx.driver.find("review_order")!
    expect(() => completeTaskAsActor(ctx.deps, { actor: specialist, taskId: task.id, payload: { note: "x".repeat(501) } })).toThrow()
    expect(() => rejectTaskAsActor(ctx.deps, { actor: specialist, taskId: task.id, reason: { code: "OTHER", note: "no" } })).toThrow()
    expect(ctx.driver.find("review_order")).toBeDefined()
  })

  it("flags a start date that has already passed", () => {
    const db = openDb()
    const ctx = setup(db, { startDate: "2026-02-16" })
    ctx.driver.drive({ stop: ["review_order"] })
    ctx.clock.set("2026-02-20T12:00:00Z")
    const specialist = sessionUser(db, SEED_IDS.users.specialist)
    const data = loadOrderReview(db, specialist, ctx.driver.find("review_order")!.id, ctx.clock.now)!
    expect(data.checks.find((check) => check.id === "start_date")!.status).toBe("fail")
  })
})

describe("verify_i9_section2", () => {
  it("lists the uploaded documents with what the employee entered, in full for the specialist who signs", () => {
    const db = openDb()
    const ctx = atVerify(db)
    const data = loadI9Review(db, ctx.specialist, ctx.taskId, ctx.clock.now)!
    expect(data.documents.map((doc) => doc.kind)).toEqual(["list_a"])
    expect(data.documents[0].url).toMatch(/^\/api\/documents\//)
    expect(data.documents[0].details).toEqual(PASSPORT)
    expect(data.readiness).toBe("ready")
    expect(data.history).toEqual([])
    expect(data.signerName).toBe("Sam Ortiz")
    expect(data.canAct).toBe(true)
    expect(data.rejectable).toBe(true)
  })

  it("says an upload without the employee's details cannot be signed, and refuses to sign it", async () => {
    const db = openDb()
    const ctx = atVerify(db)
    ctx.driver.upload("list_a", "old-passport.png", null)
    const data = loadI9Review(db, ctx.specialist, ctx.taskId, ctx.clock.now)!
    expect(data.documents[0].details).toBeNull()
    expect(data.readiness).toBe("missing_details")

    await expect(prepareSection2(ctx.deps, ctx.specialist, { taskId: ctx.taskId })).rejects.toThrow(
      "The employee has not entered the details of every document. Send them back to upload again.",
    )
    await expect(
      acceptSection2(ctx.deps, ctx.specialist, { taskId: ctx.taskId, ...dialog("x", "Sam Ortiz", ctx.clock.now) }),
    ).rejects.toBeInstanceOf(I9InputError)
    expect(tasksForCase(db, ctx.caseId).find((task) => task.id === ctx.taskId)!.status).toBe("ready")
  })

  it("will not sign a document that expired after it was uploaded", async () => {
    const db = openDb()
    const ctx = atVerify(db)
    ctx.clock.set("2034-05-16T12:00:00Z")
    expect(loadI9Review(db, ctx.specialist, ctx.taskId, ctx.clock.now)!.readiness).toBe("expired")
    await expect(prepareSection2(ctx.deps, ctx.specialist, { taskId: ctx.taskId })).rejects.toThrow("A document has expired. Send it back.")
  })

  it("rejecting spawns fix_documents and a replacement verify task; the employee sees the reason", () => {
    const db = openDb()
    const ctx = atVerify(db)
    const reason = { code: "DOC_ILLEGIBLE", note: "List A document: the photo is too dark to read." }
    rejectTaskAsActor(ctx.deps, { actor: ctx.specialist, taskId: ctx.taskId, reason })

    const tasks = tasksForCase(db, ctx.caseId)
    const rejected = tasks.find((task) => task.id === ctx.taskId)!
    expect(rejected.status).toBe("rejected")
    const fix = tasks.filter((task) => task.key === "fix_documents").at(-1)!
    expect(fix.status).toBe("ready")
    expect(fix.party).toBe("worker")
    const replacement = tasks.filter((task) => task.key === "verify_i9_section2").at(-1)!
    expect(replacement.id).not.toBe(ctx.taskId)
    expect(replacement.status).toBe("blocked")
    expect(db.select().from(caseEvents).where(and(eq(caseEvents.caseId, ctx.caseId), eq(caseEvents.type, "task_rejected"))).all()).toHaveLength(1)

    const screen = loadEmployeeScreen(db, ctx.workerUserId, fix.id, ctx.clock.now)
    expect(screen).toMatchObject({ kind: "upload_documents" })
    expect(JSON.stringify(screen)).toContain("too dark to read")

    ctx.driver.complete("fix_documents")
    const again = ctx.driver.find("verify_i9_section2")!
    const review = loadI9Review(db, ctx.specialist, again.id, ctx.clock.now)!
    expect(review.history).toHaveLength(1)
    expect(review.history[0]).toMatchObject({ code: "DOC_ILLEGIBLE", by: "Sam Ortiz" })
    expect(review.history[0].note).toContain("too dark to read")
    expect(review.documents).toHaveLength(1)
  })

  it("requires an OTHER rejection to carry a note", () => {
    const db = openDb()
    const ctx = atVerify(db)
    expect(() => rejectTaskAsActor(ctx.deps, { actor: ctx.specialist, taskId: ctx.taskId, reason: { code: "OTHER" } })).toThrow()
    expect(() => rejectTaskAsActor(ctx.deps, { actor: ctx.specialist, taskId: ctx.taskId, reason: { code: "NOT_A_CODE" } })).toThrow()
    expect(tasksForCase(db, ctx.caseId).find((task) => task.id === ctx.taskId)!.status).toBe("ready")
  })

  it("accepting fills Section 2 from the employee's entries and stores it signed, with an encrypted document number", async () => {
    const db = openDb()
    const ctx = atVerify(db)
    const prepared = await prepareSection2(ctx.deps, ctx.specialist, { taskId: ctx.taskId })
    const field = prepared.fields.find((candidate) => candidate.kind === "signature")!
    expect(prepared.signer.name).toBe("Sam Ortiz")

    const accepted = await acceptSection2(ctx.deps, ctx.specialist, {
      taskId: ctx.taskId,
      ...dialog(field.id, "Sam Ortiz", ctx.clock.now),
    })
    expect(accepted.sha256).toMatch(/^[0-9a-f]{64}$/)

    expect(tasksForCase(db, ctx.caseId).find((task) => task.id === ctx.taskId)!.status).toBe("done")
    const doc = db.select().from(generatedDocuments).where(eq(generatedDocuments.id, accepted.documentId)).get()!
    expect(doc).toMatchObject({ kind: "i9_section2", caseId: ctx.caseId, taskId: ctx.taskId })
    expect(JSON.parse(doc.metadataJson!)).toMatchObject({ generator: "northwind", sha256: accepted.sha256 })
    const signature = db.select().from(documentSignatures).where(eq(documentSignatures.documentId, accepted.documentId)).get()!
    expect(signature).toMatchObject({ party: "specialist", signerUserId: ctx.specialist.id, typedName: "Sam Ortiz" })

    const bytes = readSignedFile(doc.storagePath!)!
    const check = await verifySignedDocument(bytes, { expectedSha256: accepted.sha256 })
    expect(check.valid).toBe(true)

    const form = db.select().from(formSubmissions).where(and(eq(formSubmissions.caseId, ctx.caseId), eq(formSubmissions.formType, "i9_section2"))).get()!
    expect(JSON.parse(form.dataJson)).toMatchObject({ documentTitle: PASSPORT.title, issuingAuthority: PASSPORT.issuingAuthority, expiresOn: PASSPORT.expiresOn })
    expect(form.dataJson).not.toContain(PASSPORT.number)
    expect(decryptFields(form.encryptedJson!)).toMatchObject({ documentNumber: PASSPORT.number })
    const task = tasksForCase(db, ctx.caseId).find((candidate) => candidate.id === ctx.taskId)!
    expect(JSON.stringify(task.result)).not.toContain(PASSPORT.number)
    const events = db.select().from(caseEvents).where(eq(caseEvents.caseId, ctx.caseId)).all()
    expect(events.every((event) => !(event.payloadJson ?? "").includes(PASSPORT.number))).toBe(true)

    const done = loadI9Review(db, ctx.specialist, ctx.taskId, ctx.clock.now)!
    expect(done.verifiedAs).toMatchObject({ title: PASSPORT.title })
    expect(done.documents[0].details?.number).toBe("•••• 0174")

    const read = await readStaffDocument(db, ctx.specialist, accepted.documentId)
    expect(read).toMatchObject({ ok: true, sha256: accepted.sha256 })
  })

  it("serves a signed document only to a specialist and refuses one whose bytes changed", async () => {
    const db = openDb()
    const ctx = atVerify(db)
    const prepared = await prepareSection2(ctx.deps, ctx.specialist, { taskId: ctx.taskId })
    const field = prepared.fields.find((candidate) => candidate.kind === "signature")!
    const accepted = await acceptSection2(ctx.deps, ctx.specialist, { taskId: ctx.taskId, ...dialog(field.id, "Sam Ortiz", ctx.clock.now) })

    for (const userId of [SEED_IDS.users.clientHr, SEED_IDS.users.finance, ctx.workerUserId]) {
      expect(await readStaffDocument(db, sessionUser(db, userId), accepted.documentId)).toMatchObject({ ok: false, reason: "forbidden" })
    }
    expect(await readStaffDocument(db, ctx.specialist, "gdoc_missing")).toMatchObject({ ok: false, reason: "not_found" })

    const doc = db.select().from(generatedDocuments).where(eq(generatedDocuments.id, accepted.documentId)).get()!
    const file = fs.readdirSync(uploadsDir, { recursive: true }).map(String).find((name) => name.includes(`i9-section2-${accepted.documentId}`))!
    const full = path.join(uploadsDir, file)
    const bytes = fs.readFileSync(full)
    bytes[bytes.length - 20] ^= 0xff
    fs.writeFileSync(full, bytes)
    expect(doc.storagePath).toBeTruthy()
    expect(await readStaffDocument(db, ctx.specialist, accepted.documentId)).toMatchObject({ ok: false, reason: "tampered" })
  })

  it("does not complete without the signature", async () => {
    const db = openDb()
    const ctx = atVerify(db)
    await expect(
      acceptSection2(ctx.deps, ctx.specialist, { taskId: ctx.taskId, signature: { typedName: "Sam Ortiz", consentedAt: ctx.clock.now.toISOString() }, fieldValues: {} }),
    ).rejects.toThrow(/Sign the document/)
    expect(tasksForCase(db, ctx.caseId).find((task) => task.id === ctx.taskId)!.status).toBe("ready")
    expect(db.select().from(generatedDocuments).where(eq(generatedDocuments.kind, "i9_section2")).all()).toHaveLength(0)
  })

  it("accepts a List B and List C combination when that is what was uploaded", async () => {
    const db = openDb()
    const ctx = setup(db, { startDate: "2026-03-02" })
    ctx.driver.drive({ stop: ["upload_documents"] })
    const worker = sessionUser(db, ctx.workerUserId)
    for (const kind of ["list_b", "list_c"] as const) {
      uploadCaseDocument(ctx.deps, {
        actor: worker,
        caseId: ctx.caseId,
        kind,
        fileName: `${kind}.png`,
        storagePath: `data/uploads/${kind}.png`,
        details: SAMPLE_IDENTITY_DETAILS[kind],
      })
    }
    const upload = ctx.driver.find("upload_documents")!
    const documentIds = db.select().from(caseDocuments).where(eq(caseDocuments.caseId, ctx.caseId)).all().map((row) => row.id)
    completeTaskAsActor(ctx.deps, { actor: worker, taskId: upload.id, payload: { documentIds } })
    ctx.driver.drive({ stop: ["verify_i9_section2", "setup_payroll", "go_live", "file_new_hire_report", "submit_benefit_enrollments"] })

    const specialist = sessionUser(db, SEED_IDS.users.specialist)
    const taskId = ctx.driver.find("verify_i9_section2")!.id
    const review = loadI9Review(db, specialist, taskId, ctx.clock.now)!
    expect(review.documents.map((doc) => doc.kind)).toEqual(["list_b", "list_c"])
    expect(review.documents.map((doc) => doc.details?.title)).toEqual(["Driver's license", "Social Security Account Number card (unrestricted)"])
    expect(review.canAct).toBe(true)
    expect(review.documents.map((doc) => doc.details?.number)).toEqual(["D4471920", "***-**-6789"])

    const drawer = JSON.stringify(loadDrawerTask(db, specialist, taskId, ctx.clock.now))
    expect(drawer).toContain("***-**-6789")
    expect(drawer).not.toContain("123-45-6789")
    expect(drawer).not.toContain("123456789")

    const prepared = await prepareSection2(ctx.deps, specialist, { taskId })
    const filled = (await PDFDocument.load(prepared.pdf)).getForm()
    expect(filled.getTextField("List C Document Title 1").getText()).toBe("Social Security Account Number card (unrestricted)")
    expect(filled.getTextField("List C Document Number 1").getText()).toBe("123-45-6789")
    const field = prepared.fields.find((candidate) => candidate.kind === "signature")!
    const accepted = await acceptSection2(ctx.deps, specialist, { taskId, ...dialog(field.id, "Sam Ortiz", ctx.clock.now) })
    expect(tasksForCase(db, ctx.caseId).find((task) => task.id === taskId)!.status).toBe("done")
    const doc = db.select().from(generatedDocuments).where(eq(generatedDocuments.id, accepted.documentId)).get()!
    expect((await verifySignedDocument(readSignedFile(doc.storagePath!)!, { expectedSha256: accepted.sha256 })).valid).toBe(true)
    const done = loadI9Review(db, specialist, taskId, ctx.clock.now)!
    expect(done.documents.map((row) => row.details?.number)).toEqual(["•••• 1920", "***-**-6789"])
    const form = db.select().from(formSubmissions).where(and(eq(formSubmissions.caseId, ctx.caseId), eq(formSubmissions.formType, "i9_section2"))).get()!
    expect(JSON.parse(form.dataJson)).toMatchObject({
      documentTitle: "Driver's license + Social Security Account Number card (unrestricted)",
      issuingAuthority: "California DMV + Social Security Administration",
      expiresOn: "2031-01-31",
    })
    expect(decryptFields(form.encryptedJson!)).toMatchObject({ documentNumber: "D4471920; 123-45-6789" })
  })
})

describe("setup_payroll", () => {
  it("is blocked with reasons until the prerequisites are done, then completes", async () => {
    const db = openDb()
    const ctx = atVerify(db)
    const payroll = ctx.driver.find("setup_payroll", "blocked")!
    const blocked = loadPayrollSetup(db, ctx.specialist, payroll.id, ctx.clock.now)!
    expect(blocked.canAct).toBe(false)
    expect(blocked.preflight.find((item) => item.id === "i9")!.done).toBe(false)
    expect(blocked.preflight.filter((item) => item.id !== "i9").every((item) => item.done)).toBe(true)
    expect(blocked.blockers.join(" ")).toMatch(/I-9/)
    expect(() => completeTaskAsActor(ctx.deps, { actor: ctx.specialist, taskId: payroll.id, payload: { payFrequency: "biweekly" } })).toThrow()
    expect(tasksForCase(db, ctx.caseId).find((task) => task.id === payroll.id)!.status).toBe("blocked")

    const prepared = await prepareSection2(ctx.deps, ctx.specialist, { taskId: ctx.taskId })
    const field = prepared.fields.find((candidate) => candidate.kind === "signature")!
    await acceptSection2(ctx.deps, ctx.specialist, { taskId: ctx.taskId, ...dialog(field.id, "Sam Ortiz", ctx.clock.now) })

    const ready = loadPayrollSetup(db, ctx.specialist, payroll.id, ctx.clock.now)!
    expect(ready.canAct).toBe(true)
    expect(ready.blockers).toEqual([])
    expect(ready.preflight.every((item) => item.done)).toBe(true)
    expect(ready.profile.payFrequency).toBe("biweekly")
    expect(ready.estimate!.netCents).toBeGreaterThan(0)
    expect(ready.estimate!.grossCents).toBeGreaterThan(ready.estimate!.netCents)

    expect(() => completeTaskAsActor(ctx.deps, { actor: ctx.specialist, taskId: payroll.id, payload: { payFrequency: "daily" } })).toThrow()
    completeTaskAsActor(ctx.deps, { actor: ctx.specialist, taskId: payroll.id, payload: { payFrequency: "biweekly" } })
    expect(tasksForCase(db, ctx.caseId).find((task) => task.id === payroll.id)!.status).toBe("done")
    expect(loadPayrollSetup(db, ctx.specialist, payroll.id, ctx.clock.now)!.done).toBe(true)
  })
})

describe("filings", () => {
  it("shows the new hire with a masked SSN and completes with a confirmation number", () => {
    const db = openDb()
    const ctx = setup(db, { startDate: "2026-03-02" })
    ctx.driver.drive({ stop: ["file_new_hire_report", "submit_benefit_enrollments"] })
    ctx.clock.set("2026-03-10T12:00:00Z")
    ctx.driver.drive({ stop: ["file_new_hire_report", "submit_benefit_enrollments"] })
    const specialist = sessionUser(db, SEED_IDS.users.specialist)
    const report = ctx.driver.find("file_new_hire_report")
    if (!report) throw new Error("the new-hire report is not ready")

    const data = loadFiling(db, specialist, report.id, ctx.clock.now)!
    expect(data.kind).toBe("new_hire_report")
    expect(data.report!.ssnMasked).toMatch(/^\*{3}-\*{2}-\d{4}$/)
    expect(JSON.stringify(data)).not.toMatch(/\d{3}-\d{2}-\d{4}/)
    expect(data.canAct).toBe(true)

    expect(() => completeTaskAsActor(ctx.deps, { actor: specialist, taskId: report.id, payload: {} })).toThrow()
    expect(() => completeTaskAsActor(ctx.deps, { actor: specialist, taskId: report.id, payload: { confirmationNumber: "x".repeat(61) } })).toThrow()
    completeTaskAsActor(ctx.deps, { actor: specialist, taskId: report.id, payload: { confirmationNumber: "NH-2026-0042" } })
    const done = loadFiling(db, specialist, report.id, ctx.clock.now)!
    expect(done.done).toBe(true)
    expect(done.confirmationNumber).toBe("NH-2026-0042")
    expect(loadFiling(db, sessionUser(db, SEED_IDS.users.clientHr), report.id, ctx.clock.now)).toBeNull()
  })
})
