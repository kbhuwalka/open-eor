// @vitest-environment node
import { eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import {
  caseEvents,
  clientAgreements,
  companyDocumentSignatures,
  companyDocuments,
  SEED_IDS,
  type AppDatabase,
} from "@/db"
import { DomainError } from "@/domain/types"

import { devResetAgreement, NotFoundError } from "../cases"
import {
  MASTER_AGREEMENT_SIGNATURE_KEYS,
  SignatureError,
  generateMasterAgreement,
  sha256Hex,
  verifySignedDocument,
} from "../documents"
import { allText, extractPages } from "../documents/__tests__/pdf-text"
import {
  isMasterAgreementSigned,
  prepareMasterAgreement,
  readCompanyDocument,
  signMasterAgreementDocument,
  signedMasterAgreementFor,
  type FieldValuesInput,
} from "../master-agreement"
import { tasksForCase } from "../tasks"

import { alex, makeClock, makeDeps, sessionUser, setup, tempDbFactory } from "./helpers"

const openDb = tempDbFactory()

const brightwaveHr = (db: AppDatabase) => sessionUser(db, SEED_IDS.users.clientHr2)

/** What the signing dialog hands back after one signature tag is signed. */
function dialogResult(fieldId: string, typedName = "Alex Harper") {
  const consentedAt = "2026-02-01T11:59:00.000Z"
  const fieldValues: FieldValuesInput = {
    [fieldId]: { kind: "signature", value: typedName, signedAt: "2026-02-01T12:00:00.000Z" },
  }
  return { signature: { typedName, consentedAt }, fieldValues }
}

async function prepareAndSign(db: AppDatabase, actor = alex, typedName = actor.displayName) {
  const deps = makeDeps(db, makeClock("2026-02-01T12:00:00Z"))
  const prepared = await prepareMasterAgreement(deps, actor)
  const field = prepared.fields.find((f) => f.kind === "signature")!
  const signed = await signMasterAgreementDocument(deps, { actor, ...dialogResult(field.id, typedName) })
  return { deps, prepared, field, signed }
}

function unsign(db: AppDatabase, actor = alex) {
  devResetAgreement(makeDeps(db, makeClock("2026-02-01T12:00:00Z")), { actor })
}

describe("master agreement document", () => {
  it("is generated per company with the signature field from the generator", async () => {
    const db = openDb()
    unsign(db)
    const deps = makeDeps(db, makeClock("2026-02-01T12:00:00Z"))
    const first = await prepareMasterAgreement(deps, alex)
    const again = await prepareMasterAgreement(deps, alex)

    expect(sha256Hex(first.pdf)).toBe(sha256Hex(again.pdf))
    expect(first.signer).toEqual({ name: "Alex Harper", role: "Client" })
    const pages = await extractPages(first.pdf)
    expect(allText(pages)).toContain("Acme Robotics")
    expect(allText(pages)).toContain("15% of each worker")
    expect(pages.length).toBeGreaterThanOrEqual(4)

    const signature = first.fields.find((f) => f.kind === "signature")!
    const date = first.fields.find((f) => f.kind === "date")!
    expect(signature).toMatchObject({ fieldKey: MASTER_AGREEMENT_SIGNATURE_KEYS.client, signerRole: "Client", required: true })
    expect(date.linkedTo).toBe(signature.id)

    const other = await generateMasterAgreement({
      client: { name: "Acme Robotics" },
      markupPct: 15,
      effectiveDate: "2026-01-01",
      signerName: "Alex Harper",
      now: new Date("2026-01-01T00:00:00Z"),
      agreementId: "x",
    })
    expect(other.fields.map((f) => f.id)).toEqual(first.fields.map((f) => f.id))
  })

  it("signing stores a verifiable PDF, its SHA-256 and the signature record, and signs the company", async () => {
    const db = openDb()
    unsign(db)
    expect(isMasterAgreementSigned(db, SEED_IDS.client)).toBe(false)
    const { prepared, field, signed } = await prepareAndSign(db)

    expect(isMasterAgreementSigned(db, SEED_IDS.client)).toBe(true)
    const doc = db.select().from(companyDocuments).where(eq(companyDocuments.id, signed.documentId)).get()!
    expect(doc.clientCompanyId).toBe(SEED_IDS.client)
    expect(doc.kind).toBe("master_agreement")
    expect(doc.sha256).toBe(sha256Hex(new Uint8Array(doc.pdf)))
    expect(doc.sha256).toBe(signed.sha256)
    expect(doc.preSignatureSha256).toBe(sha256Hex(prepared.pdf))

    const check = await verifySignedDocument(new Uint8Array(doc.pdf), { expectedSha256: doc.sha256, preSignaturePdf: prepared.pdf })
    expect(check.valid).toBe(true)
    expect(check.signatures.map((s) => s.signerName)).toEqual(["Northwind EOR", "Alex Harper"])
    expect(check.signatures[1]).toMatchObject({ fieldKey: "sig_client", signerRole: "Client", consentStatementVersion: "esign-ueta-v1" })

    const sig = db.select().from(companyDocumentSignatures).where(eq(companyDocumentSignatures.documentId, doc.id)).get()!
    expect(sig).toMatchObject({
      party: "client",
      signerUserId: alex.id,
      signerName: "Alex Harper",
      typedName: "Alex Harper",
      fieldKey: "sig_client",
      consentStatementVersion: "esign-ueta-v1",
    })
    expect(sig.consentedAt.toISOString()).toBe("2026-02-01T11:59:00.000Z")
    expect(sig.signedAt.toISOString()).toBe("2026-02-01T12:00:00.000Z")
    expect(sig.seal).toBe(check.signatures[1].seal)

    const pages = await extractPages(new Uint8Array(doc.pdf))
    expect(pages[field.page].join(" ")).toContain("Alex Harper")
    expect(pages[field.page].join(" ")).toContain("02/01/2026")
    expect(signedMasterAgreementFor(db, SEED_IDS.client)).toMatchObject({ documentId: doc.id, signerName: "Alex Harper" })
  })

  it("takes the rectangles from the generator: the stamp lands on its signature line whatever the caller sends", async () => {
    const db = openDb()
    unsign(db)
    const deps = makeDeps(db, makeClock("2026-02-01T12:00:00Z"))
    const prepared = await prepareMasterAgreement(deps, alex)
    const field = prepared.fields.find((f) => f.kind === "signature")!
    const input = dialogResult(field.id)
    // A tampered dialog result cannot move the signature: coordinates are not part of the input.
    const hostile = { ...input, fieldValues: { ...input.fieldValues, [field.id]: { ...input.fieldValues[field.id], x: 0, y: 0, page: 0 } } }
    const signed = await signMasterAgreementDocument(deps, { actor: alex, ...hostile })
    const doc = db.select().from(companyDocuments).where(eq(companyDocuments.id, signed.documentId)).get()!
    const pages = await extractPages(new Uint8Array(doc.pdf))
    expect(pages[field.page].join(" ")).toContain("Alex Harper")
    expect(pages[0].join(" ")).not.toContain("Alex Harper")
  })

  it("refuses a name that is not the signer's, a missing signature and a bad consent time, and stores nothing", async () => {
    const db = openDb()
    unsign(db)
    const deps = makeDeps(db, makeClock("2026-02-01T12:00:00Z"))
    const prepared = await prepareMasterAgreement(deps, alex)
    const field = prepared.fields.find((f) => f.kind === "signature")!

    await expect(
      signMasterAgreementDocument(deps, { actor: alex, ...dialogResult(field.id, "Someone Else") })
    ).rejects.toMatchObject({ code: "TYPED_NAME_MISMATCH" })
    await expect(
      signMasterAgreementDocument(deps, { actor: alex, signature: dialogResult(field.id).signature, fieldValues: {} })
    ).rejects.toBeInstanceOf(SignatureError)
    await expect(
      signMasterAgreementDocument(deps, {
        actor: alex,
        ...dialogResult(field.id),
        signature: { typedName: "Alex Harper", consentedAt: "not a date" },
      })
    ).rejects.toMatchObject({ code: "INVALID_SIGNED_AT" })

    expect(isMasterAgreementSigned(db, SEED_IDS.client)).toBe(false)
    expect(db.select().from(companyDocuments).all()).toHaveLength(0)
  })

  it("is signed once: a second signature or a prepare on a signed agreement is refused", async () => {
    const db = openDb()
    unsign(db)
    const { deps, field } = await prepareAndSign(db)
    await expect(signMasterAgreementDocument(deps, { actor: alex, ...dialogResult(field.id) })).rejects.toMatchObject({
      code: "AGREEMENT_ALREADY_SIGNED",
    })
    await expect(prepareMasterAgreement(deps, alex)).rejects.toBeInstanceOf(DomainError)
    expect(db.select().from(companyDocuments).all()).toHaveLength(1)
  })

  it("only a client user can prepare or sign", async () => {
    const db = openDb()
    unsign(db)
    const deps = makeDeps(db, makeClock("2026-02-01T12:00:00Z"))
    for (const id of [SEED_IDS.users.specialist, SEED_IDS.users.finance]) {
      await expect(prepareMasterAgreement(deps, sessionUser(db, id))).rejects.toMatchObject({ code: "FORBIDDEN_ROLE" })
    }
  })
})

describe("accept_agreement task path", () => {
  it("signing from the task completes it through the engine and the company's other open acceptances", async () => {
    const db = openDb()
    unsign(db)
    const first = setup(db)
    const second = setup(db, { email: "dana@worker.example", firstName: "Dana" })
    const task = tasksForCase(db, first.caseId).find((t) => t.key === "accept_agreement")!
    expect(task.status).toBe("ready")

    const deps = makeDeps(db, makeClock("2026-02-01T12:00:00Z"))
    const prepared = await prepareMasterAgreement(deps, alex)
    const field = prepared.fields.find((f) => f.kind === "signature")!
    const signed = await signMasterAgreementDocument(deps, {
      actor: alex,
      ...dialogResult(field.id),
      task: { caseId: first.caseId, taskId: task.id },
    })

    const statusOf = (caseId: string) => tasksForCase(db, caseId).find((t) => t.key === "accept_agreement")!.status
    expect(statusOf(first.caseId)).toBe("done")
    expect(statusOf(second.caseId)).toBe("done")
    expect(tasksForCase(db, first.caseId).find((t) => t.key === "review_order")!.status).toBe("ready")
    expect(isMasterAgreementSigned(db, SEED_IDS.client)).toBe(true)

    const doc = db.select().from(companyDocuments).where(eq(companyDocuments.id, signed.documentId)).get()!
    expect(doc).toMatchObject({ caseId: first.caseId, taskId: task.id })
    const events = db.select().from(caseEvents).where(eq(caseEvents.caseId, first.caseId)).all().map((e) => e.type)
    expect(events).toContain("agreement_signed")
    expect(events).toContain("task_completed")
  })

  it("another company cannot sign from this company's task; nothing changes", async () => {
    const db = openDb()
    unsign(db)
    unsign(db, brightwaveHr(db))
    const order = setup(db)
    const task = tasksForCase(db, order.caseId).find((t) => t.key === "accept_agreement")!
    const intruder = brightwaveHr(db)
    const deps = makeDeps(db, makeClock("2026-02-01T12:00:00Z"))
    const prepared = await prepareMasterAgreement(deps, intruder)
    const field = prepared.fields.find((f) => f.kind === "signature")!

    await expect(
      signMasterAgreementDocument(deps, {
        actor: intruder,
        ...dialogResult(field.id, intruder.displayName),
        task: { caseId: order.caseId, taskId: task.id },
      })
    ).rejects.toBeInstanceOf(NotFoundError)

    expect(tasksForCase(db, order.caseId).find((t) => t.key === "accept_agreement")!.status).toBe("ready")
    expect(isMasterAgreementSigned(db, SEED_IDS.client)).toBe(false)
    expect(isMasterAgreementSigned(db, SEED_IDS.client2)).toBe(false)
    expect(db.select().from(companyDocuments).all()).toHaveLength(0)
  })

  it("a task of the wrong type or case is not found", async () => {
    const db = openDb()
    unsign(db)
    const order = setup(db)
    const other = setup(db, { email: "dana@worker.example", firstName: "Dana" })
    const pay = tasksForCase(db, order.caseId).find((t) => t.key === "pay_deposit")!
    const accept = tasksForCase(db, order.caseId).find((t) => t.key === "accept_agreement")!
    const deps = makeDeps(db, makeClock("2026-02-01T12:00:00Z"))
    const prepared = await prepareMasterAgreement(deps, alex)
    const field = prepared.fields.find((f) => f.kind === "signature")!

    for (const task of [
      { caseId: order.caseId, taskId: pay.id },
      { caseId: other.caseId, taskId: accept.id },
    ]) {
      await expect(
        signMasterAgreementDocument(deps, { actor: alex, ...dialogResult(field.id), task })
      ).rejects.toBeInstanceOf(NotFoundError)
    }
    expect(isMasterAgreementSigned(db, SEED_IDS.client)).toBe(false)
  })
})

describe("signing one company's agreement leaves the others alone", () => {
  it("signs only the actor's own agreement", async () => {
    const db = openDb()
    unsign(db)
    unsign(db, brightwaveHr(db))
    await prepareAndSign(db, brightwaveHr(db))
    expect(isMasterAgreementSigned(db, SEED_IDS.client2)).toBe(true)
    expect(isMasterAgreementSigned(db, SEED_IDS.client)).toBe(false)
    const rows = db.select().from(clientAgreements).all()
    expect(rows.filter((r) => r.status === "draft").map((r) => r.clientCompanyId)).toEqual([SEED_IDS.client])
  })
})

describe("readCompanyDocument", () => {
  async function signedDocument() {
    const db = openDb()
    unsign(db)
    const { signed } = await prepareAndSign(db)
    return { db, id: signed.documentId, sha256: signed.sha256 }
  }

  it("serves the verified bytes to the owning client and to onboarding specialists", async () => {
    const { db, id, sha256 } = await signedDocument()
    for (const user of [alex, sessionUser(db, SEED_IDS.users.specialist)]) {
      const read = await readCompanyDocument(db, user, id)
      expect(read).toMatchObject({ ok: true, sha256, fileName: "northwind-eor-master-services-agreement.pdf" })
      if (read.ok) expect(sha256Hex(read.bytes)).toBe(sha256)
    }
  })

  it("hides another company's document as not found and refuses workers and finance", async () => {
    const { db, id } = await signedDocument()
    expect(await readCompanyDocument(db, brightwaveHr(db), id)).toMatchObject({ ok: false, reason: "not_found" })
    expect(await readCompanyDocument(db, alex, "cdoc_missing")).toMatchObject({ ok: false, reason: "not_found" })
    expect(await readCompanyDocument(db, sessionUser(db, SEED_IDS.users.finance), id)).toMatchObject({
      ok: false,
      reason: "forbidden",
    })
    const worker = { role: "worker" as const, clientCompanyId: SEED_IDS.client }
    expect(await readCompanyDocument(db, worker, id)).toMatchObject({ ok: false, reason: "forbidden" })
  })

  it("refuses bytes that no longer match the stored hash", async () => {
    const { db, id } = await signedDocument()
    const doc = db.select().from(companyDocuments).where(eq(companyDocuments.id, id)).get()!
    const edited = Buffer.from(doc.pdf)
    edited[edited.length - 40] = edited[edited.length - 40] ^ 0xff
    db.update(companyDocuments).set({ pdf: edited }).where(eq(companyDocuments.id, id)).run()
    expect(await readCompanyDocument(db, alex, id)).toMatchObject({ ok: false, reason: "tampered" })

    db.update(companyDocuments).set({ pdf: Buffer.from("not a pdf") }).where(eq(companyDocuments.id, id)).run()
    expect(await readCompanyDocument(db, alex, id)).toMatchObject({ ok: false, reason: "tampered" })
  })

  it("refuses a file replaced together with its hash by a copy that lacks the recorded signature", async () => {
    const { db, id } = await signedDocument()
    const unsignedCopy = (await generateMasterAgreement({ client: { name: "Acme Robotics" }, markupPct: 15, effectiveDate: "2026-01-01" })).pdf
    db.update(companyDocuments)
      .set({ pdf: Buffer.from(unsignedCopy), sha256: sha256Hex(unsignedCopy) })
      .where(eq(companyDocuments.id, id))
      .run()
    expect(await readCompanyDocument(db, alex, id)).toMatchObject({ ok: false, reason: "tampered" })
  })
})
