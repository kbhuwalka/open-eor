// @vitest-environment node
import { eq } from "drizzle-orm"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { SessionUser } from "@/auth"
import { clientAgreements, companyDocuments, hireRequests, onboardingCases, SEED_IDS, type AppDatabase } from "@/db"
import { earliestStartDate } from "@/domain/business-days"
import { devResetAgreement } from "@/server/cases"
import { tasksForCase } from "@/server/tasks"
import { alex, makeClock, makeDeps, sessionUser, tempDbFactory } from "@/server/__tests__/helpers"

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
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { redirectTo: url })
  },
}))

import {
  createPerson,
  prepareMasterAgreement,
  signAgreementTaskAction,
  signMasterAgreementAction,
  type AgreementSignatureInput,
} from "../actions"

const openDb = tempDbFactory("eor-agreement-actions-")

function orderForm(patch: Record<string, string> = {}): FormData {
  const form = new FormData()
  const values: Record<string, string> = {
    firstName: "Casey",
    lastName: "Nguyen",
    email: "casey@worker.example",
    roleId: SEED_IDS.role,
    package: "premium",
    wage: "65",
    wageUnit: "hourly",
    stateCode: "CA",
    startDate: earliestStartDate(new Date()),
    employmentTerm: "indefinite",
    ...patch,
  }
  for (const [key, value] of Object.entries(values)) form.set(key, value)
  return form
}

async function dialogResult(typedName: string): Promise<AgreementSignatureInput> {
  const prepared = await prepareMasterAgreement()
  if (!prepared.ok) throw new Error(prepared.message)
  const field = prepared.data.fields.find((f) => f.kind === "signature")!
  return {
    signature: { typedName, consentedAt: new Date(Date.now() - 1000).toISOString() },
    fieldValues: { [field.id]: { kind: "signature", value: typedName, signedAt: new Date().toISOString() } },
  }
}

let db: AppDatabase

beforeEach(() => {
  db = openDb()
  state.db = db
  state.user = alex
  devResetAgreement(makeDeps(db, makeClock("2026-02-01T12:00:00Z")), { actor: alex })
})

describe("create order requires the signed agreement", () => {
  it("is blocked with the sign wording while the agreement is unsigned, and creates nothing", async () => {
    const before = db.select().from(hireRequests).all().length
    const result = await createPerson(null, orderForm())
    expect(result).toMatchObject({
      ok: false,
      code: "validation",
      message: "Sign the EOR agreement to create this order.",
      details: { field: "agreement" },
    })
    expect(db.select().from(hireRequests).all()).toHaveLength(before)
  })

  it("ignores an acceptAgreement flag in the form: only a stored signature unlocks it", async () => {
    const result = await createPerson(null, orderForm({ acceptAgreement: "on", agreementRequired: "0" }))
    expect(result).toMatchObject({ ok: false, details: { field: "agreement" } })
  })

  it("goes through createOrder once the agreement is signed in the dialog", async () => {
    const signed = await signMasterAgreementAction(await dialogResult("Alex Harper"))
    expect(signed).toMatchObject({ ok: true, data: { signerName: "Alex Harper" } })
    expect(db.select().from(companyDocuments).all()).toHaveLength(1)

    const email = "casey2@worker.example"
    await expect(createPerson(null, orderForm({ email }))).rejects.toMatchObject({ message: "NEXT_REDIRECT" })
    const hire = db.select().from(hireRequests).all().find((h) => h.createdByUserId === alex.id && h.wageCents === 6500)!
    const kase = db.select().from(onboardingCases).where(eq(onboardingCases.hireRequestId, hire.id)).get()!
    expect(JSON.parse(kase.factsJson)["client.agreementSigned"]).toBe(true)
    expect(tasksForCase(db, kase.id).find((t) => t.key === "accept_agreement")!.status).toBe("skipped")
  })
})

describe("signing actions", () => {
  it("rejects a typed name that is not the signer's and signs nothing", async () => {
    const result = await signMasterAgreementAction(await dialogResult("Mallory Intruder"))
    expect(result).toMatchObject({ ok: false, code: "validation" })
    expect(db.select().from(clientAgreements).where(eq(clientAgreements.id, SEED_IDS.agreement)).get()?.status).toBe("draft")
  })

  it("rejects malformed input before touching anything", async () => {
    for (const bad of [null, {}, { signature: { typedName: "", consentedAt: "x" }, fieldValues: {} }, { signature: { typedName: "A", consentedAt: "x" } }]) {
      expect(await signMasterAgreementAction(bad as AgreementSignatureInput)).toMatchObject({ ok: false, code: "validation" })
    }
    expect(db.select().from(companyDocuments).all()).toHaveLength(0)
  })

  it("is refused for other roles, and a signed agreement reports AGREEMENT_ALREADY_SIGNED", async () => {
    state.user = sessionUser(db, SEED_IDS.users.specialist)
    expect(await prepareMasterAgreement()).toMatchObject({ ok: false, code: "forbidden" })
    expect(await signMasterAgreementAction({ signature: { typedName: "x", consentedAt: "x" }, fieldValues: {} })).toMatchObject({
      ok: false,
      code: "forbidden",
    })

    state.user = alex
    const input = await dialogResult("Alex Harper")
    expect(await signMasterAgreementAction(input)).toMatchObject({ ok: true })
    expect(await signMasterAgreementAction(input)).toMatchObject({ ok: false, code: "AGREEMENT_ALREADY_SIGNED" })
    expect(await prepareMasterAgreement()).toMatchObject({ ok: false, code: "AGREEMENT_ALREADY_SIGNED" })
  })

  it("signing from the task completes it; another company's client gets not_found", async () => {
    const { createOrder } = await import("@/server/cases")
    const { orderInput } = await import("@/server/__tests__/helpers")
    const deps = makeDeps(db, makeClock("2026-02-01T12:00:00Z"))
    const order = createOrder(deps, { actor: alex, hire: orderInput() })
    const task = tasksForCase(db, order.caseId).find((t) => t.key === "accept_agreement")!

    const brightwave = sessionUser(db, SEED_IDS.users.clientHr2)
    devResetAgreement(deps, { actor: brightwave })
    state.user = brightwave
    const attempt = await signAgreementTaskAction(order.caseId, task.id, await dialogResult(brightwave.displayName))
    expect(attempt).toMatchObject({ ok: false, code: "not_found" })
    expect(tasksForCase(db, order.caseId).find((t) => t.key === "accept_agreement")!.status).toBe("ready")

    state.user = alex
    const signed = await signAgreementTaskAction(order.caseId, task.id, await dialogResult("Alex Harper"))
    expect(signed).toMatchObject({ ok: true })
    expect(tasksForCase(db, order.caseId).find((t) => t.key === "accept_agreement")!.status).toBe("done")
  })
})
