// @vitest-environment node
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { and, eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { SAMPLE_SECTION1 } from "@/app/dev/forms/samples"
import { SEED_IDS, benefitElections, caseEvents, formSubmissions, generatedDocuments, documentSignatures, caseDocuments, type AppDatabase } from "@/db"
import type { DirectDepositData, IdentityDocumentDraft, IdentityListKind, PersonalDetailsData, W4Data } from "@/domain/forms"

import { rejectTaskAsActor, tasksForCase } from "../tasks"
import { decryptFields } from "../field-crypto"
import { identityDetailsOf } from "../identity-documents"
import { readSignedFile } from "../uploads"
import { verifySignedDocument } from "../documents"
import {
  acceptInvitation,
  outcomeAfter,
  prepareAgreement,
  previewForm,
  requireOwnTask,
  signAgreement,
  submitBenefits,
  submitDocuments,
  submitPersonalDetails,
  submitSignedForm,
  uploadIdentityDocument,
  EmployeeInputError,
} from "../employee-tasks"
import { loadEmployeeCase, loadEmployeeScreen } from "../employee-portal"

import { SAMPLE_IDENTITY_DETAILS, sessionUser, setup, tempDbFactory } from "./helpers"

const openDb = tempDbFactory()

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const NAME = "Casey Nguyen"
const signedAtIso = (clock: Date) => clock.toISOString()

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

/** A case driven until the worker's own tasks are all that is left; the clock is mid-onboarding. */
function onboarding(db: AppDatabase) {
  const ctx = setup(db, { startDate: "2026-03-02" })
  ctx.driver.drive({ stop: ["accept_invitation"] })
  const worker = sessionUser(db, ctx.workerUserId)
  const taskId = (key: string) => {
    const task = tasksForCase(db, ctx.caseId).filter((candidate) => candidate.key === key).at(-1)
    if (!task) throw new Error(`no task ${key}`)
    return task.id
  }
  return { ...ctx, worker, taskId }
}

const dialog = (fieldId: string, typedName: string, now: Date) => ({
  signature: { typedName, consentedAt: signedAtIso(new Date(now.getTime() - 60_000)) },
  fieldValues: { [fieldId]: { kind: "signature", value: typedName, signedAt: signedAtIso(now) } },
})

const PERSONAL: PersonalDetailsData = {
  legalName: NAME,
  dateOfBirth: "1992-03-14",
  ssn: "123-45-6789",
  phone: "(415) 555-0123",
  address: { line1: "12 Pine St", line2: "", city: "Oakland", state: "CA", zip: "94607" },
  emergencyContact: { name: "Jordan Nguyen", relationship: "Sibling", phone: "(415) 555-0199" },
}

const W4: W4Data = {
  firstName: "Casey",
  middleInitial: "",
  lastName: "Nguyen",
  ssn: "123-45-6789",
  address: "12 Pine St",
  city: "Oakland",
  state: "CA",
  zip: "94607",
  filingStatus: "single_or_married_separately",
  multipleJobs: false,
  qualifyingChildren: 0,
  otherDependents: 0,
  otherIncomeCents: 0,
  deductionsCents: 0,
  extraWithholdingCents: 0,
  exemptFromWithholding: false,
}

const DEPOSIT: DirectDepositData = {
  bankName: "First Bank",
  accountHolderName: NAME,
  routingNumber: "021000021",
  accountNumber: "000123456789",
  accountType: "checking",
  allocation: "entire_net_pay",
  fixedAmountCents: 0,
}

const SECTION1 = { ...SAMPLE_SECTION1, firstName: "Casey", middleInitial: "", lastName: "Nguyen", dateOfBirth: "1992-03-14" }

async function sign(
  ctx: ReturnType<typeof onboarding>,
  kind: "w4" | "i9_section1" | "direct_deposit",
  taskKey: string,
  data: unknown,
) {
  const taskId = ctx.taskId(taskKey)
  const preview = await previewForm(ctx.deps, ctx.worker, { kind, taskId, data })
  const field = preview.fields.find((candidate) => candidate.kind === "signature")!
  return submitSignedForm(ctx.deps, ctx.worker, { kind, taskId, data, ...dialog(field.id, NAME, ctx.clock.now) })
}

describe("employee task services: access", () => {
  it("only the case's own employee can open or complete their tasks", () => {
    const db = openDb()
    const ctx = onboarding(db)
    const taskId = ctx.taskId("accept_invitation")

    expect(requireOwnTask(ctx.deps, ctx.worker, taskId, { types: ["accept_invitation"], ready: true }).task.id).toBe(taskId)

    const otherId = SEED_IDS.users.worker
    const other = sessionUser(db, otherId)
    expect(() => acceptInvitation(ctx.deps, other, taskId)).toThrow(/not found/i)

    for (const userId of [SEED_IDS.users.clientHr, SEED_IDS.users.specialist, SEED_IDS.users.finance]) {
      expect(() => acceptInvitation(ctx.deps, sessionUser(db, userId), taskId)).toThrow(expect.objectContaining({ code: "FORBIDDEN_ROLE" }))
    }
    expect(tasksForCase(db, ctx.caseId).find((task) => task.id === taskId)?.status).toBe("ready")
    expect(loadEmployeeScreen(db, otherId, taskId, ctx.clock.now)).toBeNull()
    expect(loadEmployeeScreen(db, ctx.worker.id, taskId, ctx.clock.now)).toMatchObject({ kind: "accept_invitation", canAct: true })
  })

  it("refuses a blocked task and a task of another type", () => {
    const db = openDb()
    const ctx = onboarding(db)
    expect(() =>
      submitPersonalDetails(ctx.deps, ctx.worker, { taskId: ctx.taskId("personal_details"), data: PERSONAL }),
    ).toThrow(expect.objectContaining({ code: "TASK_NOT_READY" }))
    expect(() => acceptInvitation(ctx.deps, ctx.worker, ctx.taskId("personal_details"))).toThrow(/not found/i)
  })
})

describe("employee task services: the full journey", () => {
  it("completes every worker task through the engine and unblocks what follows", async () => {
    const db = openDb()
    const ctx = onboarding(db)

    acceptInvitation(ctx.deps, ctx.worker, ctx.taskId("accept_invitation"))
    const ready = () =>
      tasksForCase(db, ctx.caseId)
        .filter((task) => task.party === "worker" && task.status === "ready")
        .map((task) => task.key)
        .sort()
    expect(ready()).toEqual(["benefits_decision", "direct_deposit", "i9_section1", "personal_details", "sign_agreement", "w4"])
    expect(outcomeAfter(ctx.deps, ctx.worker, ctx.taskId("accept_invitation")).nextHref).toMatch(/^\/worker\/tasks\//)

    // Agreement: regenerated on the server, signed at the generator's rectangle, hash stored.
    const agreementId = ctx.taskId("sign_agreement")
    const prepared = await prepareAgreement(ctx.deps, ctx.worker, agreementId)
    expect(prepared.signer).toEqual({ name: NAME, role: "Employee" })
    const field = prepared.fields.find((candidate) => candidate.kind === "signature")!
    const signed = await signAgreement(ctx.deps, ctx.worker, { taskId: agreementId, ...dialog(field.id, NAME, ctx.clock.now) })
    const agreementRow = db.select().from(generatedDocuments).where(eq(generatedDocuments.id, signed.documentId)).get()!
    expect(agreementRow.storagePath).toBeTruthy()
    expect(JSON.parse(agreementRow.metadataJson)).toMatchObject({ sha256: signed.sha256 })
    const bytes = readSignedFile(agreementRow.storagePath!)!
    expect((await verifySignedDocument(bytes, { expectedSha256: signed.sha256 })).valid).toBe(true)
    const signatures = db.select().from(documentSignatures).where(eq(documentSignatures.documentId, agreementRow.id)).all()
    expect(signatures.map((row) => row.party).sort()).toEqual(["client", "worker"])
    expect(signatures.find((row) => row.party === "worker")).toMatchObject({ typedName: NAME, signerUserId: ctx.worker.id })
    expect(fs.readFileSync(path.resolve(agreementRow.storagePath!)).includes(Buffer.from("%PDF"))).toBe(false)

    // Personal details: stored through form_submissions with the sensitive fields encrypted.
    submitPersonalDetails(ctx.deps, ctx.worker, { taskId: ctx.taskId("personal_details"), data: PERSONAL })
    const details = db.select().from(formSubmissions).where(and(eq(formSubmissions.caseId, ctx.caseId), eq(formSubmissions.formType, "personal_details"))).get()!
    expect(details.dataJson).not.toContain("123-45-6789")
    expect(details.dataJson).not.toContain("1992-03-14")
    expect(JSON.parse(details.dataJson)).toMatchObject({ phone: "415-555-0123", emergencyContact: { name: "Jordan Nguyen" } })
    expect(decryptFields(details.encryptedJson!)).toEqual({ ssn: "123-45-6789", dateOfBirth: "1992-03-14" })

    // I-9 Section 1 unblocks the document upload.
    expect(ready()).not.toContain("upload_documents")
    await sign(ctx, "i9_section1", "i9_section1", SECTION1)
    expect(ready()).toContain("upload_documents")

    // Documents: List A.
    const uploadId = ctx.taskId("upload_documents")
    const uploaded = await uploadIdentityDocument(ctx.deps, ctx.worker, {
      taskId: uploadId,
      kind: "list_a",
      fileName: "passport.png",
      declaredType: "image/png",
      bytes: PNG,
      details: SAMPLE_IDENTITY_DETAILS.list_a,
    })
    expect(uploaded).toMatchObject({ kind: "list_a", status: "uploaded", mime: "image/png" })
    submitDocuments(ctx.deps, ctx.worker, { taskId: uploadId, path: "list_a" })

    // W-4 and direct deposit: encrypted sensitive fields, signed copies stored with their hash.
    const w4 = await sign(ctx, "w4", "w4", W4)
    const dd = await sign(ctx, "direct_deposit", "direct_deposit", DEPOSIT)
    const deposit = db.select().from(formSubmissions).where(and(eq(formSubmissions.caseId, ctx.caseId), eq(formSubmissions.formType, "direct_deposit"))).get()!
    expect(deposit.dataJson).not.toContain("000123456789")
    expect(JSON.parse(deposit.dataJson)).toMatchObject({ last4: "6789", bankName: "First Bank" })
    expect(decryptFields(deposit.encryptedJson!)).toMatchObject({ accountNumber: "000123456789", routingNumber: "021000021" })
    for (const doc of [w4, dd]) {
      const row = db.select().from(generatedDocuments).where(eq(generatedDocuments.id, doc.documentId)).get()!
      expect(JSON.parse(row.metadataJson).sha256).toBe(doc.sha256)
      expect((await verifySignedDocument(readSignedFile(row.storagePath!)!, { expectedSha256: doc.sha256 })).valid).toBe(true)
    }

    const remaining = tasksForCase(db, ctx.caseId).filter((task) => task.party === "worker" && task.key !== "benefits_decision" && task.status !== "done")
    expect(remaining).toEqual([])
    expect(loadEmployeeScreen(db, ctx.worker.id, ctx.taskId("w4"), ctx.clock.now)?.completed?.rows).toEqual([{ label: "Filing status", value: "single or married separately" }])
  })

  it("rejects a typed signature that is not the employee's name, and an unsigned document", async () => {
    const db = openDb()
    const ctx = onboarding(db)
    acceptInvitation(ctx.deps, ctx.worker, ctx.taskId("accept_invitation"))
    const taskId = ctx.taskId("sign_agreement")
    const prepared = await prepareAgreement(ctx.deps, ctx.worker, taskId)
    const field = prepared.fields.find((candidate) => candidate.kind === "signature")!

    await expect(
      signAgreement(ctx.deps, ctx.worker, { taskId, ...dialog(field.id, "Someone Else", ctx.clock.now) }),
    ).rejects.toMatchObject({ code: "TYPED_NAME_MISMATCH" })
    await expect(
      signAgreement(ctx.deps, ctx.worker, { taskId, signature: dialog(field.id, NAME, ctx.clock.now).signature, fieldValues: {} }),
    ).rejects.toMatchObject({ code: "INVALID_FIELD" })
    expect(tasksForCase(db, ctx.caseId).find((task) => task.id === taskId)?.status).toBe("ready")
    expect(fs.existsSync(path.join(uploadsDir, ctx.caseId))).toBe(false)
  })

  it("validates personal details before the engine sees them", () => {
    const db = openDb()
    const ctx = onboarding(db)
    acceptInvitation(ctx.deps, ctx.worker, ctx.taskId("accept_invitation"))
    const taskId = ctx.taskId("personal_details")
    const attempt = () => submitPersonalDetails(ctx.deps, ctx.worker, { taskId, data: { ...PERSONAL, ssn: "000-00-0000", phone: "123" } })
    expect(attempt).toThrow(EmployeeInputError)
    try {
      attempt()
    } catch (error) {
      expect((error as EmployeeInputError).errors).toMatchObject({ ssn: expect.any(String), phone: expect.any(String) })
    }
    expect(tasksForCase(db, ctx.caseId).find((task) => task.id === taskId)?.status).toBe("ready")
  })

  it("forces a whole-pay deposit and reports a bad routing number", async () => {
    const db = openDb()
    const ctx = onboarding(db)
    acceptInvitation(ctx.deps, ctx.worker, ctx.taskId("accept_invitation"))
    await expect(
      previewForm(ctx.deps, ctx.worker, { kind: "direct_deposit", taskId: ctx.taskId("direct_deposit"), data: { ...DEPOSIT, routingNumber: "123456789" } }),
    ).rejects.toBeInstanceOf(EmployeeInputError)
    await sign(ctx, "direct_deposit", "direct_deposit", { ...DEPOSIT, allocation: "fixed_amount", fixedAmountCents: 5000 })
    const deposit = db.select().from(formSubmissions).where(and(eq(formSubmissions.caseId, ctx.caseId), eq(formSubmissions.formType, "direct_deposit"))).get()!
    expect(JSON.parse(deposit.dataJson)).not.toHaveProperty("fixedAmountCents")
  })
})

describe("employee task services: identity documents", () => {
  async function toUploads(db: AppDatabase) {
    const ctx = onboarding(db)
    acceptInvitation(ctx.deps, ctx.worker, ctx.taskId("accept_invitation"))
    await sign(ctx, "i9_section1", "i9_section1", SECTION1)
    return { ...ctx, uploadId: ctx.taskId("upload_documents") }
  }

  const upload = (
    ctx: Awaited<ReturnType<typeof toUploads>>,
    kind: string,
    fileName = "id.png",
    bytes = PNG,
    declaredType = "image/png",
    details: IdentityDocumentDraft = SAMPLE_IDENTITY_DETAILS[kind as IdentityListKind] ?? {},
  ) => uploadIdentityDocument(ctx.deps, ctx.worker, { taskId: ctx.uploadId, kind, fileName, declaredType, bytes, details })

  it("stores what the employee entered with the number encrypted, and shows them only its last four", async () => {
    const db = openDb()
    const ctx = await toUploads(db)
    const passport = SAMPLE_IDENTITY_DETAILS.list_a
    const stored = await upload(ctx, "list_a", "passport.png")

    expect(stored.details).toEqual({
      title: passport.title,
      issuingAuthority: passport.issuingAuthority,
      maskedNumber: "•••• 0174",
      expiresOn: passport.expiresOn,
    })
    expect(JSON.stringify(stored)).not.toContain(passport.number)
    const row = db.select().from(caseDocuments).where(eq(caseDocuments.id, stored.id)).get()!
    expect(row).toMatchObject({ documentTitle: passport.title, issuingAuthority: passport.issuingAuthority, expiresOn: passport.expiresOn })
    expect(row.documentNumberEncrypted).not.toContain(passport.number)
    expect(identityDetailsOf(row)?.number).toBe(passport.number)
    const events = db.select().from(caseEvents).where(eq(caseEvents.caseId, ctx.caseId)).all()
    expect(events.some((event) => event.type === "document_uploaded")).toBe(true)
    expect(events.every((event) => !(event.payloadJson ?? "").includes(passport.number))).toBe(true)

    submitDocuments(ctx.deps, ctx.worker, { taskId: ctx.uploadId, path: "list_a" })
    const done = tasksForCase(db, ctx.caseId).find((task) => task.id === ctx.uploadId)!
    expect(JSON.stringify(done.result)).not.toContain(passport.number)
  })

  it("refuses details that are missing or not acceptable before storing anything", async () => {
    const db = openDb()
    const ctx = await toUploads(db)
    const files = () => fs.readdirSync(uploadsDir, { recursive: true }).length
    const before = files()
    const attempt = upload(ctx, "list_a", "passport.png", PNG, "image/png", {
      title: "U.S. Passport",
      number: "",
      expiresOn: "2026-01-01",
    })
    await expect(attempt).rejects.toBeInstanceOf(EmployeeInputError)
    await attempt.catch((error: EmployeeInputError) => {
      expect(error.errors).toEqual({ number: "Enter the document number.", expiresOn: "This document has expired. Upload a current one." })
    })
    await expect(upload(ctx, "list_c", "card.png", PNG, "image/png", { ...SAMPLE_IDENTITY_DETAILS.list_c, title: "U.S. Passport" }))
      .rejects.toMatchObject({ errors: { title: "Choose a document from the list." } })
    expect(db.select().from(caseDocuments).where(eq(caseDocuments.caseId, ctx.caseId)).all()).toHaveLength(0)
    expect(files()).toBe(before)
  })

  it("asks for an upload made before details were asked for to be uploaded again", async () => {
    const db = openDb()
    const ctx = await toUploads(db)
    ctx.driver.upload("list_a", "old-passport.png", null)
    const screen = loadEmployeeScreen(db, ctx.worker.id, ctx.uploadId, ctx.clock.now)
    expect(screen).toMatchObject({ uploads: [expect.objectContaining({ kind: "list_a", details: null })] })
    expect(() => submitDocuments(ctx.deps, ctx.worker, { taskId: ctx.uploadId, path: "list_a" })).toThrow(
      "Upload old-passport.png again with its document number and expiration date.",
    )
    await upload(ctx, "list_a", "passport.png")
    submitDocuments(ctx.deps, ctx.worker, { taskId: ctx.uploadId, path: "list_a" })
    expect(tasksForCase(db, ctx.caseId).find((task) => task.id === ctx.uploadId)?.status).toBe("done")
  })

  it("checks type, size and content, and stores the file under the uploads root", async () => {
    const db = openDb()
    const ctx = await toUploads(db)
    await expect(upload(ctx, "list_a", "x.exe", PNG, "application/x-msdownload")).rejects.toMatchObject({ code: "type" })
    await expect(upload(ctx, "list_a", "x.png", new Uint8Array(), "image/png")).rejects.toMatchObject({ code: "empty" })
    await expect(upload(ctx, "list_a", "x.png", new Uint8Array(10 * 1024 * 1024 + 1).fill(1), "image/png")).rejects.toMatchObject({ code: "size" })
    await expect(upload(ctx, "list_a", "x.png", new TextEncoder().encode("<script>alert(1)</script>"), "image/png")).rejects.toMatchObject({ code: "content" })
    await expect(upload(ctx, "w4")).rejects.toBeInstanceOf(EmployeeInputError)
    expect(db.select().from(caseDocuments).where(eq(caseDocuments.caseId, ctx.caseId)).all()).toHaveLength(0)

    const stored = await upload(ctx, "list_b", "../../etc/license.png")
    const row = db.select().from(caseDocuments).where(eq(caseDocuments.id, stored.id)).get()!
    expect(path.resolve(row.storagePath).startsWith(uploadsDir)).toBe(true)
    expect(fs.readFileSync(path.resolve(row.storagePath))).toEqual(Buffer.from(PNG))
  })

  it("requires List A, or List B and List C, and enforces the choice server-side", async () => {
    const db = openDb()
    const ctx = await toUploads(db)
    expect(() => submitDocuments(ctx.deps, ctx.worker, { taskId: ctx.uploadId, path: "list_a" })).toThrow(/List A/)
    await upload(ctx, "list_b")
    expect(() => submitDocuments(ctx.deps, ctx.worker, { taskId: ctx.uploadId, path: "list_b_c" })).toThrow(/List C/)
    expect(() => submitDocuments(ctx.deps, ctx.worker, { taskId: ctx.uploadId, path: "everything" })).toThrow(EmployeeInputError)
    await upload(ctx, "list_c", "ssn-card.png")
    submitDocuments(ctx.deps, ctx.worker, { taskId: ctx.uploadId, path: "list_b_c" })
    expect(tasksForCase(db, ctx.caseId).find((task) => task.id === ctx.uploadId)?.result).toMatchObject({ kinds: ["list_b", "list_c"] })
  })

  it("shows what Northwind sent back and takes a replacement through the rework task", async () => {
    const db = openDb()
    const ctx = await toUploads(db)
    await upload(ctx, "list_a", "passport.png")
    submitDocuments(ctx.deps, ctx.worker, { taskId: ctx.uploadId, path: "list_a" })
    ctx.driver.drive({ stop: ["verify_i9_section2"] })
    ctx.clock.advanceHours(1)
    const specialist = sessionUser(db, SEED_IDS.users.specialist)
    const verify = tasksForCase(db, ctx.caseId).find((task) => task.key === "verify_i9_section2" && task.status === "ready")!
    rejectTaskAsActor(ctx.deps, { actor: specialist, taskId: verify.id, reason: { code: "DOC_EXPIRED", note: "Passport expired in 2025." } })

    const fix = tasksForCase(db, ctx.caseId).find((task) => task.key === "fix_documents" && task.status === "ready")!
    const screen = loadEmployeeScreen(db, ctx.worker.id, fix.id, ctx.clock.now)
    expect(screen).toMatchObject({
      kind: "upload_documents",
      rework: { code: "DOC_EXPIRED", note: "Passport expired in 2025." },
      uploads: [expect.objectContaining({ kind: "list_a", status: "rejected" })],
    })

    expect(() => submitDocuments(ctx.deps, ctx.worker, { taskId: fix.id, path: "list_a" })).toThrow(/Replace passport/)
    ctx.clock.advanceHours(1)
    const replacement = await uploadIdentityDocument(ctx.deps, ctx.worker, {
      taskId: fix.id,
      kind: "list_a",
      fileName: "new-passport.png",
      declaredType: "image/png",
      bytes: PNG,
      details: { ...SAMPLE_IDENTITY_DETAILS.list_a, number: "601122334" },
    })
    expect(replacement.status).toBe("uploaded")
    submitDocuments(ctx.deps, ctx.worker, { taskId: fix.id, path: "list_a" })
    expect(tasksForCase(db, ctx.caseId).find((task) => task.id === fix.id)?.status).toBe("done")
  })
})

describe("employee task services: benefits", () => {
  function atBenefits(db: AppDatabase) {
    const ctx = setup(db, { startDate: "2026-03-02", package: "premium" })
    ctx.driver.drive({ stop: ["benefits_decision"] })
    ctx.clock.set("2026-03-04T12:00:00Z")
    return { ...ctx, worker: sessionUser(db, ctx.workerUserId) }
  }
  const election = (db: AppDatabase, caseId: string) =>
    db.select().from(benefitElections).where(eq(benefitElections.caseId, caseId)).get()

  it("records an election through the task and shows it", () => {
    const db = openDb()
    const ctx = atBenefits(db)
    const task = tasksForCase(db, ctx.caseId).find((candidate) => candidate.key === "benefits_decision" && candidate.status === "ready")!
    expect(() => submitBenefits(ctx.deps, ctx.worker, { taskId: task.id, healthTier: "bogus", retirementDeferralPct: 4 })).toThrow(EmployeeInputError)
    expect(() => submitBenefits(ctx.deps, ctx.worker, { taskId: task.id, healthTier: "employee", retirementDeferralPct: 80 })).toThrow(EmployeeInputError)

    submitBenefits(ctx.deps, ctx.worker, { taskId: task.id, healthTier: "family", retirementDeferralPct: 6 })
    expect(election(db, ctx.caseId)).toMatchObject({ enrolled: true, healthTier: "family", retirementDeferralPct: 6 })
    const screen = loadEmployeeScreen(db, ctx.worker.id, task.id, ctx.clock.now)
    expect(screen).toMatchObject({ kind: "benefits_decision", benefits: { election: { healthTier: "family", retirementDeferralPct: 6 } } })
  })

  it("waives benefits when nothing is selected", () => {
    const db = openDb()
    const ctx = atBenefits(db)
    const task = tasksForCase(db, ctx.caseId).find((candidate) => candidate.key === "benefits_decision" && candidate.status === "ready")!
    submitBenefits(ctx.deps, ctx.worker, { taskId: task.id, healthTier: null, retirementDeferralPct: 0 })
    expect(tasksForCase(db, ctx.caseId).find((candidate) => candidate.id === task.id)?.result).toMatchObject({ decision: "decline" })
    expect(election(db, ctx.caseId)).toMatchObject({ enrolled: false })

    expect(loadEmployeeCase(db, SEED_IDS.users.clientHr, ctx.clock.now)).toBeNull()
  })
})
