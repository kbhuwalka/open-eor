// @vitest-environment node
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { SAMPLE_SECTION1 } from "@/app/dev/forms/samples"
import { SEED_IDS, caseDocuments, generatedDocuments, type AppDatabase } from "@/db"
import type { DirectDepositData, W4Data } from "@/domain/forms"

import {
  acceptInvitation,
  prepareAgreement,
  previewForm,
  signAgreement,
  submitSignedForm,
  uploadIdentityDocument,
} from "../employee-tasks"
import { listEmployeeDocuments, readEmployeeDocument, readIdentityUpload } from "../employee-documents"
import { tasksForCase } from "../tasks"
import { writeSignedFile } from "../uploads"

import { sessionUser, setup, tempDbFactory } from "./helpers"

const openDb = tempDbFactory()

// Each case signs four real PDFs; the first call also warms the font and template caches.
const SLOW = 60_000
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const NAME = "Casey Nguyen"

let uploadsDir: string
let previousRoot: string | undefined

beforeEach(() => {
  uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "eor-docs-"))
  previousRoot = process.env.UPLOADS_ROOT
  process.env.UPLOADS_ROOT = uploadsDir
})

afterEach(() => {
  if (previousRoot === undefined) delete process.env.UPLOADS_ROOT
  else process.env.UPLOADS_ROOT = previousRoot
  fs.rmSync(uploadsDir, { recursive: true, force: true })
})

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

async function signedEmployee(db: AppDatabase) {
  const ctx = setup(db, { startDate: "2026-03-02" })
  ctx.driver.drive({ stop: ["accept_invitation"] })
  const worker = sessionUser(db, ctx.workerUserId)
  const taskId = (key: string) => tasksForCase(db, ctx.caseId).filter((task) => task.key === key).at(-1)!.id
  const dialog = (fieldId: string) => ({
    signature: { typedName: NAME, consentedAt: new Date(ctx.clock.now.getTime() - 60_000).toISOString() },
    fieldValues: { [fieldId]: { kind: "signature", value: NAME, signedAt: ctx.clock.now.toISOString() } },
  })
  acceptInvitation(ctx.deps, worker, taskId("accept_invitation"))
  const agreement = await prepareAgreement(ctx.deps, worker, taskId("sign_agreement"))
  await signAgreement(ctx.deps, worker, {
    taskId: taskId("sign_agreement"),
    ...dialog(agreement.fields.find((field) => field.kind === "signature")!.id),
  })
  for (const [kind, key, data] of [
    ["i9_section1", "i9_section1", SECTION1],
    ["w4", "w4", W4],
    ["direct_deposit", "direct_deposit", DEPOSIT],
  ] as const) {
    const preview = await previewForm(ctx.deps, worker, { kind, taskId: taskId(key), data })
    await submitSignedForm(ctx.deps, worker, {
      kind,
      taskId: taskId(key),
      data,
      ...dialog(preview.fields.find((field) => field.kind === "signature")!.id),
    })
  }
  return { ...ctx, worker, taskId }
}

describe("employee signed documents", () => {
  it("lists the four signed documents with who signed and when, in a fixed order", async () => {
    const db = openDb()
    const ctx = await signedEmployee(db)
    const documents = listEmployeeDocuments(db, ctx.worker.id)
    expect(documents.map((doc) => doc.kind)).toEqual(["employment_agreement", "i9_section1", "w4", "direct_deposit_authorization"])
    expect(documents.map((doc) => doc.title)).toEqual([
      "Employment agreement",
      "Form I-9, Section 1",
      "Form W-4",
      "Direct deposit authorization",
    ])
    for (const doc of documents) {
      expect(doc).toMatchObject({ signedAs: NAME, downloadable: true })
      expect(doc.signedAt).toMatch(/^2026-/)
    }
  }, SLOW)

  it("gives the owner the verified bytes and nobody else anything", async () => {
    const db = openDb()
    const ctx = await signedEmployee(db)
    const [agreement, i9] = listEmployeeDocuments(db, ctx.worker.id)

    const read = await readEmployeeDocument(db, ctx.worker, agreement.id)
    expect(read).toMatchObject({ ok: true, fileName: expect.stringContaining("employment") })
    if (read.ok) {
      const row = db.select().from(generatedDocuments).where(eq(generatedDocuments.id, agreement.id)).get()!
      expect(JSON.parse(row.metadataJson).sha256).toBe(read.sha256)
      expect(Buffer.from(read.bytes.slice(0, 4)).toString()).toBe("%PDF")
    }

    const stranger = sessionUser(db, SEED_IDS.users.worker)
    expect(await readEmployeeDocument(db, stranger, i9.id)).toMatchObject({ ok: false, reason: "not_found" })
    expect(await readEmployeeDocument(db, ctx.worker, "no-such-document")).toMatchObject({ ok: false, reason: "not_found" })
    for (const userId of [SEED_IDS.users.clientHr, SEED_IDS.users.specialist, SEED_IDS.users.finance]) {
      expect(await readEmployeeDocument(db, sessionUser(db, userId), i9.id)).toMatchObject({ ok: false, reason: "forbidden" })
    }
    const theirs = listEmployeeDocuments(db, SEED_IDS.users.worker).map((doc) => doc.id)
    expect(theirs).not.toContain(agreement.id)
    expect(theirs).not.toContain(i9.id)
  }, SLOW)

  it("refuses a stored file that no longer matches the hash recorded at signing", async () => {
    const db = openDb()
    const ctx = await signedEmployee(db)
    const w4 = listEmployeeDocuments(db, ctx.worker.id).find((doc) => doc.kind === "w4")!
    const row = db.select().from(generatedDocuments).where(eq(generatedDocuments.id, w4.id)).get()!
    const read = await readEmployeeDocument(db, ctx.worker, w4.id)
    if (!read.ok) throw new Error("expected a clean read")

    const altered = new Uint8Array(read.bytes)
    altered[altered.length - 20] ^= 0xff
    writeSignedFile({ caseId: ctx.caseId, name: path.basename(row.storagePath!, ".enc"), bytes: altered })
    expect(await readEmployeeDocument(db, ctx.worker, w4.id)).toMatchObject({ ok: false, reason: "tampered" })

    fs.rmSync(path.resolve(row.storagePath!))
    expect(await readEmployeeDocument(db, ctx.worker, w4.id)).toMatchObject({ ok: false, reason: "tampered" })
  }, SLOW)

  it("lists a record with no stored copy without offering a download, and never invents one", async () => {
    const db = openDb()
    const ctx = await signedEmployee(db)
    const w4 = listEmployeeDocuments(db, ctx.worker.id).find((doc) => doc.kind === "w4")!
    db.update(generatedDocuments).set({ storagePath: null }).where(eq(generatedDocuments.id, w4.id)).run()
    expect(listEmployeeDocuments(db, ctx.worker.id).find((doc) => doc.kind === "w4")).toMatchObject({ downloadable: false })
    expect(await readEmployeeDocument(db, ctx.worker, w4.id)).toMatchObject({ ok: false, reason: "not_found" })
  }, SLOW)

  it("shows an uploaded identity document to its owner and to Northwind, never to the client or another employee", async () => {
    const db = openDb()
    const ctx = await signedEmployee(db)
    const stored = await uploadIdentityDocument(ctx.deps, ctx.worker, {
      taskId: ctx.taskId("upload_documents"),
      kind: "list_a",
      fileName: "passport.png",
      declaredType: "image/png",
      bytes: PNG,
    })
    expect(readIdentityUpload(db, ctx.worker, stored.id)).toMatchObject({ ok: true, mime: "image/png", fileName: "passport.png" })
    expect(readIdentityUpload(db, sessionUser(db, SEED_IDS.users.specialist), stored.id)).toMatchObject({ ok: true })
    expect(readIdentityUpload(db, sessionUser(db, SEED_IDS.users.clientHr), stored.id)).toMatchObject({ ok: false, reason: "forbidden" })
    expect(readIdentityUpload(db, sessionUser(db, SEED_IDS.users.finance), stored.id)).toMatchObject({ ok: false, reason: "forbidden" })
    expect(readIdentityUpload(db, sessionUser(db, SEED_IDS.users.worker), stored.id)).toMatchObject({ ok: false, reason: "not_found" })

    const row = db.select().from(caseDocuments).where(eq(caseDocuments.id, stored.id)).get()!
    fs.rmSync(path.resolve(row.storagePath))
    expect(readIdentityUpload(db, ctx.worker, stored.id)).toMatchObject({ ok: false, reason: "not_found" })
  }, SLOW)
})
