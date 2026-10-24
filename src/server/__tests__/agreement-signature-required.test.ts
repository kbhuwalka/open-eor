// @vitest-environment node
import { and, eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { SEED_IDS, clientAgreements, companyDocuments, type AppDatabase } from "@/db"

import { devResetAgreement } from "../cases"
import { MASTER_AGREEMENT_KIND } from "../documents"
import { prepareMasterAgreement, signMasterAgreementDocument, signedMasterAgreementFor } from "../master-agreement"
import { completeTaskAsActor, tasksForCase } from "../tasks"

import { alex, makeClock, makeDeps, setup, tempDbFactory } from "./helpers"

const openDb = tempDbFactory()
const SLOW = 30_000

function unsign(db: AppDatabase) {
  devResetAgreement(makeDeps(db, makeClock("2026-02-01T12:00:00Z")), { actor: alex })
}

async function sign(db: AppDatabase, deps: ReturnType<typeof makeDeps>, task?: { caseId: string; taskId: string }) {
  const prepared = await prepareMasterAgreement(deps, alex)
  const field = prepared.fields.find((f) => f.kind === "signature")!
  return signMasterAgreementDocument(deps, {
    actor: alex,
    signature: { typedName: "Alex Harper", consentedAt: "2026-02-01T11:59:00.000Z" },
    fieldValues: { [field.id]: { kind: "signature", value: "Alex Harper", signedAt: "2026-02-01T12:00:00.000Z" } },
    ...(task ? { task } : {}),
  })
}

const status = (db: AppDatabase, caseId: string) => tasksForCase(db, caseId).find((t) => t.key === "accept_agreement")!.status
const agreementStatus = (db: AppDatabase) => db.select().from(clientAgreements).where(eq(clientAgreements.id, SEED_IDS.agreement)).get()?.status

describe("accepting the master agreement needs a stored signature", () => {
  it("is only possible by signing the document: the task completes together with the stored document and signature", async () => {
    const db = openDb()
    unsign(db)
    const first = setup(db)
    const second = setup(db, { email: "dana@worker.example", firstName: "Dana" })
    const task = tasksForCase(db, first.caseId).find((t) => t.key === "accept_agreement")!

    const signed = await sign(db, first.deps, { caseId: first.caseId, taskId: task.id })

    expect(status(db, first.caseId)).toBe("done")
    expect(status(db, second.caseId)).toBe("done")
    expect(agreementStatus(db)).toBe("signed")
    expect(signedMasterAgreementFor(db, SEED_IDS.client)).toMatchObject({ documentId: signed.documentId, signerName: "Alex Harper" })
  }, SLOW)

  it("refuses a bare completion of the task and of its cascade, leaving the agreement unsigned", async () => {
    const db = openDb()
    unsign(db)
    const { caseId, deps } = setup(db)
    const task = tasksForCase(db, caseId).find((t) => t.key === "accept_agreement")!

    expect(() => completeTaskAsActor(deps, { actor: alex, taskId: task.id, payload: { accepted: true } })).toThrowError(
      expect.objectContaining({ code: "INVALID_TASK_PAYLOAD" }),
    )
    expect(status(db, caseId)).toBe("ready")
    expect(agreementStatus(db)).toBe("draft")
  })

  it("does not accept a bare completion after a reset just because the company signed once before", async () => {
    const db = openDb()
    unsign(db)
    const deps = makeDeps(db, makeClock("2026-02-01T12:00:00Z"))
    await sign(db, deps)
    expect(signedMasterAgreementFor(db, SEED_IDS.client)).not.toBeNull()

    unsign(db)
    expect(signedMasterAgreementFor(db, SEED_IDS.client)).toBeNull()
    expect(db.select().from(companyDocuments).where(and(eq(companyDocuments.clientCompanyId, SEED_IDS.client), eq(companyDocuments.kind, MASTER_AGREEMENT_KIND))).all()).toEqual([])

    const { caseId, deps: orderDeps } = setup(db)
    const task = tasksForCase(db, caseId).find((t) => t.key === "accept_agreement")!
    expect(() => completeTaskAsActor(orderDeps, { actor: alex, taskId: task.id, payload: { accepted: true } })).toThrowError(
      expect.objectContaining({ code: "INVALID_TASK_PAYLOAD" }),
    )
  }, SLOW)

  it("lets the next order skip the task once the agreement is signed", async () => {
    const db = openDb()
    unsign(db)
    await sign(db, makeDeps(db, makeClock("2026-02-01T12:00:00Z")))
    const { caseId } = setup(db)
    expect(status(db, caseId)).toBe("skipped")
  }, SLOW)
})
