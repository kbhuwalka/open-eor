// @vitest-environment node
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { and, eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SAMPLE_SECTION1 } from "@/app/dev/forms/samples"
import type { SessionUser } from "@/auth"
import { SEED_IDS, benefitElections, formSubmissions, generatedDocuments, type AppDatabase } from "@/db"
import { earliestStartDate } from "@/domain/business-days"
import type { DirectDepositData, PersonalDetailsData, W4Data } from "@/domain/forms"
import { decryptFields } from "@/server/field-crypto"
import { tasksForCase } from "@/server/tasks"
import { sessionUser, setup, tempDbFactory } from "@/server/__tests__/helpers"

const state = vi.hoisted(() => ({ db: null as unknown, user: null as unknown }))

vi.mock("@/auth", async () => {
  const acl = await vi.importActual<typeof import("@/auth/acl")>("@/auth/acl")
  return {
    AuthError: acl.AuthError,
    requireRole: async (...roles: Parameters<typeof acl.requireRole>[1][]) =>
      acl.requireRole(state.user as SessionUser | null, ...roles),
  }
})
vi.mock("@/db", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/db")>()), getDb: () => state.db }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import {
  acceptInvitationAction,
  prepareAgreementAction,
  previewDirectDepositAction,
  signAgreementAction,
  submitBenefitsAction,
  submitDirectDepositAction,
  submitDocumentsAction,
  submitI9Action,
  submitPersonalDetailsAction,
  submitW4Action,
  uploadDocumentAction,
} from "../actions"

const openDb = tempDbFactory("eor-employee-actions-")
const NAME = "Casey Nguyen"
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const SLOW = 60_000

let uploadsDir: string
let previousRoot: string | undefined
let db: AppDatabase

beforeEach(() => {
  uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "eor-employee-uploads-"))
  previousRoot = process.env.UPLOADS_ROOT
  process.env.UPLOADS_ROOT = uploadsDir
  db = openDb()
  state.db = db
})

afterEach(() => {
  if (previousRoot === undefined) delete process.env.UPLOADS_ROOT
  else process.env.UPLOADS_ROOT = previousRoot
  fs.rmSync(uploadsDir, { recursive: true, force: true })
})

/** A person ordered today whose onboarding waits at the employee's first task; the session is theirs. */
function employee() {
  const now = new Date()
  const ctx = setup(db, { startDate: earliestStartDate(now) }, now.toISOString())
  ctx.driver.drive({ stop: ["accept_invitation"] })
  state.user = sessionUser(db, ctx.workerUserId)
  const taskId = (key: string) => tasksForCase(db, ctx.caseId).filter((task) => task.key === key).at(-1)!.id
  const status = (key: string) => tasksForCase(db, ctx.caseId).filter((task) => task.key === key).at(-1)!.status
  return { ...ctx, taskId, status }
}

async function signature(taskId: string, typedName = NAME) {
  const prepared = await prepareAgreementAction(taskId)
  if (!prepared.ok) throw new Error(prepared.message)
  const field = prepared.data.fields.find((candidate) => candidate.kind === "signature")!
  return {
    signature: { typedName, consentedAt: new Date(Date.now() - 1000).toISOString() },
    fieldValues: { [field.id]: { kind: "signature" as const, value: typedName, signedAt: new Date().toISOString() } },
  }
}

const PERSONAL: PersonalDetailsData = {
  legalName: NAME,
  dateOfBirth: "1992-03-14",
  ssn: "123-45-6789",
  phone: "(415) 555-0123",
  address: { line1: "12 Pine St", line2: "", city: "Oakland", state: "CA", zip: "94607" },
  emergencyContact: { name: "", relationship: "", phone: "" },
}

describe("who may run the employee actions", () => {
  it("answers a signed-out visitor, another role and another employee without doing anything", async () => {
    const ctx = employee()
    const taskId = ctx.taskId("accept_invitation")

    state.user = null
    expect(await acceptInvitationAction(taskId)).toMatchObject({ ok: false, code: "unauthenticated" })
    for (const userId of [SEED_IDS.users.clientHr, SEED_IDS.users.specialist, SEED_IDS.users.finance]) {
      state.user = sessionUser(db, userId)
      expect(await acceptInvitationAction(taskId)).toMatchObject({ ok: false, code: "forbidden" })
    }
    state.user = sessionUser(db, SEED_IDS.users.worker)
    expect(await acceptInvitationAction(taskId)).toMatchObject({ ok: false, code: "not_found" })
    expect(await submitBenefitsAction(taskId, { healthTier: null, retirementDeferralPct: 0 })).toMatchObject({ ok: false, code: "not_found" })
    expect(ctx.status("accept_invitation")).toBe("ready")
  })

  it("takes the task from the session, so a blocked or wrong-type task is refused", async () => {
    const ctx = employee()
    expect(await submitPersonalDetailsAction(ctx.taskId("personal_details"), PERSONAL)).toMatchObject({ ok: false })
    expect(ctx.status("personal_details")).toBe("blocked")
    expect(await acceptInvitationAction(ctx.taskId("w4"))).toMatchObject({ ok: false })
  })
})

describe("completing tasks through the engine", () => {
  it("accepts the invitation and sends the employee to the next task with a notice", async () => {
    const ctx = employee()
    const result = await acceptInvitationAction(ctx.taskId("accept_invitation"))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.nextHref).toMatch(/^\/worker\/tasks\/task_[^?]+\?notice=/)
    expect(ctx.status("accept_invitation")).toBe("done")
    expect(ctx.status("sign_agreement")).toBe("ready")
  })

  it("reports each invalid personal detail and stores the sensitive ones encrypted", async () => {
    const ctx = employee()
    await acceptInvitationAction(ctx.taskId("accept_invitation"))
    await signAgreementAction(ctx.taskId("sign_agreement"), await signature(ctx.taskId("sign_agreement")))

    const bad = await submitPersonalDetailsAction(ctx.taskId("personal_details"), { ...PERSONAL, phone: "abc", dateOfBirth: "", address: { ...PERSONAL.address, zip: "1" } })
    expect(bad).toMatchObject({ ok: false, code: "validation", details: { errors: expect.objectContaining({ phone: expect.any(String), dateOfBirth: expect.any(String), "address.zip": expect.any(String) }) } })
    expect(ctx.status("personal_details")).toBe("ready")

    expect(await submitPersonalDetailsAction(ctx.taskId("personal_details"), PERSONAL)).toMatchObject({ ok: true })
    const row = db.select().from(formSubmissions).where(and(eq(formSubmissions.caseId, ctx.caseId), eq(formSubmissions.formType, "personal_details"))).get()!
    expect(row.dataJson).not.toContain("123-45-6789")
    expect(row.dataJson).not.toContain("1992-03-14")
    expect(decryptFields(row.encryptedJson!)).toEqual({ ssn: "123-45-6789", dateOfBirth: "1992-03-14" })
  }, SLOW)

  it("signs the agreement only with the employee's own typed name at the generator's field, and stores the hash", async () => {
    const ctx = employee()
    await acceptInvitationAction(ctx.taskId("accept_invitation"))
    const taskId = ctx.taskId("sign_agreement")

    expect(await signAgreementAction(taskId, { signature: { typedName: NAME, consentedAt: new Date().toISOString() }, fieldValues: {} })).toMatchObject({ ok: false, code: "validation" })
    expect(await signAgreementAction(taskId, await signature(taskId, "Somebody Else"))).toMatchObject({ ok: false, code: "validation" })
    expect(await signAgreementAction(taskId, undefined as never)).toMatchObject({ ok: false, code: "validation" })
    expect(ctx.status("sign_agreement")).toBe("ready")

    const signed = await signAgreementAction(taskId, await signature(taskId, NAME))
    expect(signed.ok).toBe(true)
    const row = db.select().from(generatedDocuments).where(and(eq(generatedDocuments.caseId, ctx.caseId), eq(generatedDocuments.kind, "employment_agreement"))).get()!
    expect(JSON.parse(row.metadataJson).sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(row.storagePath).toBeTruthy()
  }, SLOW)

  it("signs the I-9, W-4 and direct deposit, keeping the account number out of the stored data", async () => {
    const ctx = employee()
    await acceptInvitationAction(ctx.taskId("accept_invitation"))

    const section1 = { ...SAMPLE_SECTION1, firstName: "Casey", middleInitial: "", lastName: "Nguyen" }
    const w4: W4Data = {
      firstName: "Casey", middleInitial: "", lastName: "Nguyen", ssn: "123-45-6789", address: "12 Pine St", city: "Oakland", state: "CA", zip: "94607",
      filingStatus: "single_or_married_separately", multipleJobs: false, qualifyingChildren: 0, otherDependents: 0, otherIncomeCents: 0,
      deductionsCents: 0, extraWithholdingCents: 0, exemptFromWithholding: false,
    }
    const deposit: DirectDepositData = {
      bankName: "First Bank", accountHolderName: NAME, routingNumber: "021000021", accountNumber: "000123456789",
      accountType: "checking", allocation: "entire_net_pay", fixedAmountCents: 0,
    }

    const signFor = async (preview: (id: string, data: never) => Promise<{ ok: boolean; data?: { fields: { id: string; kind: string }[] } }>, key: string, data: unknown) => {
      const result = await preview(ctx.taskId(key), data as never)
      const field = result.data!.fields.find((candidate) => candidate.kind === "signature")!
      return {
        signature: { typedName: NAME, consentedAt: new Date(Date.now() - 1000).toISOString() },
        fieldValues: { [field.id]: { kind: "signature" as const, value: NAME, signedAt: new Date().toISOString() } },
      }
    }
    const { previewI9Action, previewW4Action } = await import("../actions")

    expect(await submitI9Action(ctx.taskId("i9_section1"), section1 as never, await signFor(previewI9Action as never, "i9_section1", section1))).toMatchObject({ ok: true })
    expect(await submitW4Action(ctx.taskId("w4"), w4, await signFor(previewW4Action as never, "w4", w4))).toMatchObject({ ok: true })

    const asSplit = { ...deposit, allocation: "fixed_amount" as const, fixedAmountCents: 10_000 }
    const preview = await previewDirectDepositAction(ctx.taskId("direct_deposit"), asSplit)
    expect(preview.ok).toBe(true)
    expect(await submitDirectDepositAction(ctx.taskId("direct_deposit"), { ...deposit, routingNumber: "123456789" }, await signFor(previewDirectDepositAction as never, "direct_deposit", deposit))).toMatchObject({ ok: false, code: "validation" })
    expect(await submitDirectDepositAction(ctx.taskId("direct_deposit"), deposit, await signFor(previewDirectDepositAction as never, "direct_deposit", deposit))).toMatchObject({ ok: true })

    const stored = db.select().from(formSubmissions).where(and(eq(formSubmissions.caseId, ctx.caseId), eq(formSubmissions.formType, "direct_deposit"))).get()!
    expect(stored.dataJson).not.toContain("000123456789")
    expect(JSON.parse(stored.dataJson)).toMatchObject({ last4: "6789" })
    expect(decryptFields(stored.encryptedJson!)).toMatchObject({ accountNumber: "000123456789" })
    expect(ctx.status("w4")).toBe("done")
    expect(ctx.status("direct_deposit")).toBe("done")
  }, SLOW)

  it("stores uploads after checking them, then completes the documents task with the chosen path", async () => {
    const ctx = employee()
    await acceptInvitationAction(ctx.taskId("accept_invitation"))
    const section1 = { ...SAMPLE_SECTION1, firstName: "Casey", middleInitial: "", lastName: "Nguyen" }
    const { previewI9Action } = await import("../actions")
    const preview = await previewI9Action(ctx.taskId("i9_section1"), section1 as never)
    if (!preview.ok) throw new Error(preview.message)
    const field = preview.data.fields.find((candidate) => candidate.kind === "signature")!
    await submitI9Action(ctx.taskId("i9_section1"), section1 as never, {
      signature: { typedName: NAME, consentedAt: new Date(Date.now() - 1000).toISOString() },
      fieldValues: { [field.id]: { kind: "signature", value: NAME, signedAt: new Date().toISOString() } },
    })

    const taskId = ctx.taskId("upload_documents")
    const form = (kind: string, file: File) => {
      const data = new FormData()
      data.set("kind", kind)
      data.set("file", file)
      return data
    }
    expect(await uploadDocumentAction(taskId, new FormData())).toMatchObject({ ok: false, code: "validation" })
    expect(await uploadDocumentAction(taskId, form("list_a", new File(["not an image"], "id.png", { type: "image/png" })))).toMatchObject({ ok: false, code: "validation", details: { upload: "content" } })
    expect(await uploadDocumentAction(taskId, form("list_a", new File([PNG], "id.exe", { type: "application/x-msdownload" })))).toMatchObject({ ok: false, details: { upload: "type" } })
    expect(await submitDocumentsAction(taskId, "list_a")).toMatchObject({ ok: false, code: "validation" })

    const stored = await uploadDocumentAction(taskId, form("list_a", new File([PNG], "passport.png", { type: "image/png" })))
    expect(stored).toMatchObject({ ok: true, data: { kind: "list_a", status: "uploaded", href: expect.stringMatching(/^\/api\/documents\//) } })
    expect(await submitDocumentsAction(taskId, "list_a")).toMatchObject({ ok: true })
    expect(ctx.status("upload_documents")).toBe("done")
  }, SLOW)

  it("records the benefits election and validates the choice", async () => {
    const ctx = employee()
    await acceptInvitationAction(ctx.taskId("accept_invitation"))
    const taskId = ctx.taskId("benefits_decision")

    expect(await submitBenefitsAction(taskId, { healthTier: "bogus", retirementDeferralPct: 4 })).toMatchObject({ ok: false, code: "validation" })
    expect(await submitBenefitsAction(taskId, { healthTier: "employee", retirementDeferralPct: 80 })).toMatchObject({ ok: false, code: "validation" })
    expect(await submitBenefitsAction(taskId, null as never)).toMatchObject({ ok: false, code: "validation" })

    expect(await submitBenefitsAction(taskId, { healthTier: "employee_spouse", retirementDeferralPct: 6 })).toMatchObject({ ok: true })
    const election = () => db.select().from(benefitElections).where(eq(benefitElections.caseId, ctx.caseId)).get()
    expect(election()).toMatchObject({ enrolled: true, healthTier: "employee_spouse", retirementDeferralPct: 6 })
  })
})
