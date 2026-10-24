/**
 * The company's master EOR agreement as a signed document (documents-and-signing.md §7.6): the
 * server builds the PDF and the signature rectangles, the client signs it in the signing dialog,
 * and `signMasterAgreementDocument` regenerates the same document, applies the typed e-signature,
 * and records the result through the engine's `sign_master_agreement` path. Signed bytes and the
 * hash they must keep live in `company_documents`; every download re-verifies them.
 */
import { and, desc, eq } from "drizzle-orm"

import type { SessionUser } from "@/auth"
import {
  clientAgreements,
  clientCompanies,
  companyDocumentSignatures,
  companyDocuments,
  hireRequests,
  onboardingCases,
  tasks as tasksTable,
} from "@/db/schema"
import type { AppDatabase } from "@/db/client"
import type { SignatureField } from "@/domain/forms"
import { DomainError } from "@/domain/types"

import { actorOf, completeTaskInTx, insertCaseEvent, signMasterAgreement } from "./case-engine"
import { idFor, NotFoundError, type CaseServiceDeps } from "./deps"
import {
  MASTER_AGREEMENT_KIND,
  MASTER_AGREEMENT_SIGNER_ROLE,
  MASTER_AGREEMENT_TITLE,
  SignatureError,
  applyEsignature,
  generateMasterAgreement,
  verifySignedDocument,
  type MasterAgreementInput,
} from "./documents"

/** What the signing dialog needs: the PDF, where to sign (from the generator only), and who signs. */
export type PreparedMasterAgreement = {
  pdf: Uint8Array
  fields: SignatureField[]
  signer: { name: string; role: string }
  title: string
}

export type SignatureInput = { typedName: string; consentedAt: string }

/** The shape `SigningResult.fieldValues` has; only the signature field's presence is checked. */
export type FieldValuesInput = Record<string, { kind: string; value: string; signedAt: string }>

export type SignMasterAgreementInput = {
  actor: SessionUser
  signature: SignatureInput
  fieldValues: FieldValuesInput
  /** When signing through an `accept_agreement` task: the task and its case. */
  task?: { caseId: string; taskId: string }
}

export type SignedMasterAgreement = {
  documentId: string
  sha256: string
  signedAt: string
  signerName: string
}

type Context = {
  companyId: string
  companyName: string
  agreement: typeof clientAgreements.$inferSelect
}

function contextFor(db: AppDatabase, actor: Pick<SessionUser, "role" | "clientCompanyId">): Context {
  if (actor.role !== "client_hr" || !actor.clientCompanyId) {
    throw new DomainError("FORBIDDEN_ROLE", { actorRole: actor.role })
  }
  const company = db.select().from(clientCompanies).where(eq(clientCompanies.id, actor.clientCompanyId)).get()
  const agreement = db
    .select()
    .from(clientAgreements)
    .where(eq(clientAgreements.clientCompanyId, actor.clientCompanyId))
    .get()
  if (!company || !agreement) throw new NotFoundError("Client agreement")
  return { companyId: company.id, companyName: company.name, agreement }
}

/**
 * The generator input for this agreement. Everything in it is stable for the life of the draft
 * (the effective date and clock come from the agreement row, not from `now`), so "prepare" and
 * "sign" produce the same pre-signature document for the same signer.
 */
function generatorInput(context: Context, signerName: string): MasterAgreementInput {
  const createdAt = context.agreement.createdAt
  return {
    client: { name: context.companyName },
    markupPct: context.agreement.markupPct,
    effectiveDate: createdAt.toISOString().slice(0, 10),
    signerName,
    now: createdAt,
    agreementId: `NW-MSA-${context.agreement.id.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}`,
  }
}

/** Regenerates the unsigned-by-client agreement for the session client. Rejects a signed agreement. */
export async function prepareMasterAgreement(
  deps: Pick<CaseServiceDeps, "db">,
  actor: SessionUser,
): Promise<PreparedMasterAgreement> {
  const context = contextFor(deps.db, actor)
  if (context.agreement.status === "signed") {
    throw new DomainError("AGREEMENT_ALREADY_SIGNED", { agreementId: context.agreement.id })
  }
  const generated = await generateMasterAgreement(generatorInput(context, actor.displayName))
  return {
    pdf: generated.pdf,
    fields: generated.fields,
    signer: { name: actor.displayName, role: MASTER_AGREEMENT_SIGNER_ROLE },
    title: MASTER_AGREEMENT_TITLE,
  }
}

function parseConsent(raw: string, now: Date): Date {
  const at = new Date(raw)
  if (Number.isNaN(at.getTime())) {
    throw new SignatureError("INVALID_SIGNED_AT", "The consent time is not valid.")
  }
  // The browser clock may run slightly ahead; anything further is not a real consent time.
  if (at.getTime() > now.getTime() + 5 * 60_000) {
    throw new SignatureError("INVALID_SIGNED_AT", "The consent time is in the future.")
  }
  return at
}

/**
 * Applies the client's typed signature to a freshly generated agreement and records it. The
 * rectangles come from the generator, never from the caller. Everything that changes state happens
 * in one transaction, through the engine: the agreement becomes `signed`, and the company's open
 * `accept_agreement` tasks (or the one task this was signed from) complete.
 */
export async function signMasterAgreementDocument(
  deps: CaseServiceDeps,
  input: SignMasterAgreementInput,
): Promise<SignedMasterAgreement> {
  const { actor } = input
  const context = contextFor(deps.db, actor)
  if (context.agreement.status === "signed") {
    throw new DomainError("AGREEMENT_ALREADY_SIGNED", { agreementId: context.agreement.id })
  }
  const signedAt = deps.now()
  const consentedAt = parseConsent(input.signature?.consentedAt ?? "", signedAt)
  const typedName = typeof input.signature?.typedName === "string" ? input.signature.typedName : ""

  const generated = await generateMasterAgreement(generatorInput(context, actor.displayName))
  const signatureField = generated.fields.find((f) => f.kind === "signature")
  const dateField = generated.fields.find((f) => f.kind === "date" && f.linkedTo === signatureField?.id)
  if (!signatureField?.fieldKey) throw new Error("The master agreement has no signature field.")
  const entry = input.fieldValues?.[signatureField.id]
  if (!entry || entry.kind !== "signature") {
    throw new SignatureError("INVALID_FIELD", "Sign the agreement where it is marked before finishing.")
  }

  const signed = await applyEsignature(generated.pdf, {
    signerName: actor.displayName,
    signerRole: MASTER_AGREEMENT_SIGNER_ROLE,
    typedSignature: typedName,
    signedAt,
    consent: { consentedAt },
    fieldKey: signatureField.fieldKey,
    fields: { signature: signatureField, ...(dateField ? { date: dateField } : {}) },
    documentTitle: `${MASTER_AGREEMENT_TITLE}: ${context.companyName}`,
  })
  const check = await verifySignedDocument(signed.pdf, {
    expectedSha256: signed.sha256,
    preSignaturePdf: generated.pdf,
  })
  if (!check.valid) throw new Error(`The signed agreement failed verification: ${check.problems.join(" ")}`)

  const documentId = idFor(deps, "cdoc")
  deps.db.transaction((tx) => {
    const current = tx
      .select({ status: clientAgreements.status })
      .from(clientAgreements)
      .where(eq(clientAgreements.id, context.agreement.id))
      .get()
    if (current?.status === "signed") {
      throw new DomainError("AGREEMENT_ALREADY_SIGNED", { agreementId: context.agreement.id })
    }

    let taskRow: { id: string; caseId: string } | null = null
    if (input.task) {
      const row = tx
        .select({ id: tasksTable.id, caseId: tasksTable.caseId, type: tasksTable.type, companyId: hireRequests.clientCompanyId })
        .from(tasksTable)
        .innerJoin(onboardingCases, eq(onboardingCases.id, tasksTable.caseId))
        .innerJoin(hireRequests, eq(hireRequests.id, onboardingCases.hireRequestId))
        .where(eq(tasksTable.id, input.task.taskId))
        .get()
      if (!row || row.companyId !== context.companyId || row.caseId !== input.task.caseId || row.type !== "accept_agreement") {
        throw new NotFoundError("Task")
      }
      taskRow = { id: row.id, caseId: row.caseId }
    }

    // The signed document and its signature are stored first: accepting the agreement through the
    // engine requires them (`signMasterAgreement`).
    tx.insert(companyDocuments)
      .values({
        id: documentId,
        clientCompanyId: context.companyId,
        kind: MASTER_AGREEMENT_KIND,
        title: MASTER_AGREEMENT_TITLE,
        fileName: `northwind-eor-master-services-agreement.pdf`,
        pdf: Buffer.from(signed.pdf),
        sha256: signed.sha256,
        preSignatureSha256: signed.preSignatureSha256,
        documentRef: signed.documentId,
        caseId: taskRow?.caseId ?? null,
        taskId: taskRow?.id ?? null,
        createdAt: signedAt,
      })
      .run()
    tx.insert(companyDocumentSignatures)
      .values({
        id: idFor(deps, "csig"),
        documentId,
        party: "client",
        signerUserId: actor.id,
        signerName: signed.record.signerName,
        signerRole: signed.record.signerRole,
        typedName: signed.record.typedSignature,
        fieldKey: signed.record.fieldKey,
        consentedAt,
        consentStatementVersion: signed.record.consentStatementVersion,
        signedAt,
        seal: signed.record.seal,
      })
      .run()

    if (taskRow) {
      completeTaskInTx(tx, deps, { taskId: taskRow.id, actor: actorOf(actor), payload: { accepted: true } })
      insertCaseEvent(tx, deps, taskRow.caseId, actor.id, "agreement_signed", {
        agreementId: context.agreement.id,
        markupPct: context.agreement.markupPct,
        documentId,
      })
    } else {
      signMasterAgreement(tx, deps, context.companyId, actorOf(actor))
    }
  })

  return { documentId, sha256: signed.sha256, signedAt: signedAt.toISOString(), signerName: actor.displayName }
}

/** True when the company's master agreement is signed. Order creation requires it. */
export function isMasterAgreementSigned(db: AppDatabase, clientCompanyId: string): boolean {
  const row = db
    .select({ status: clientAgreements.status })
    .from(clientAgreements)
    .where(eq(clientAgreements.clientCompanyId, clientCompanyId))
    .get()
  return row?.status === "signed"
}

export type SignedAgreementSummary = {
  documentId: string
  signedAt: string
  signerName: string
}

/** The company's current signed master agreement document, or null (unsigned, or signed before documents were stored). */
export function signedMasterAgreementFor(db: AppDatabase, clientCompanyId: string): SignedAgreementSummary | null {
  const row = db
    .select({
      documentId: companyDocuments.id,
      signedAt: companyDocumentSignatures.signedAt,
      signerName: companyDocumentSignatures.signerName,
    })
    .from(companyDocuments)
    .innerJoin(companyDocumentSignatures, eq(companyDocumentSignatures.documentId, companyDocuments.id))
    .where(and(eq(companyDocuments.clientCompanyId, clientCompanyId), eq(companyDocuments.kind, MASTER_AGREEMENT_KIND)))
    .orderBy(desc(companyDocuments.createdAt))
    .get()
  return row ? { documentId: row.documentId, signedAt: row.signedAt.toISOString(), signerName: row.signerName } : null
}

export type CompanyDocumentRead =
  | { ok: true; bytes: Uint8Array; fileName: string; sha256: string }
  | { ok: false; reason: "forbidden" | "not_found" | "tampered"; message: string }

/**
 * Bytes of a stored signed document for `user`, after the access check and an integrity check
 * against the hash recorded at signing. The client of the owning company and Northwind onboarding
 * specialists may read; a document of another company is indistinguishable from a missing one
 * (acl I6). Workers and Finance are not parties to the agreement.
 */
export async function readCompanyDocument(
  db: AppDatabase,
  user: Pick<SessionUser, "role" | "clientCompanyId">,
  documentId: string,
): Promise<CompanyDocumentRead> {
  if (user.role !== "client_hr" && user.role !== "onboarding_specialist") {
    return { ok: false, reason: "forbidden", message: "Your role cannot download this document." }
  }
  const row = db.select().from(companyDocuments).where(eq(companyDocuments.id, documentId)).get()
  if (!row || (user.role === "client_hr" && row.clientCompanyId !== user.clientCompanyId)) {
    return { ok: false, reason: "not_found", message: "Document not found." }
  }
  const bytes = new Uint8Array(row.pdf)
  const check = await verifySignedDocument(bytes, { expectedSha256: row.sha256 })
  // A file swapped together with its hash must still carry every signature we recorded for it.
  const seals = new Set(check.signatures.map((signature) => signature.seal))
  const recorded = db
    .select({ seal: companyDocumentSignatures.seal })
    .from(companyDocumentSignatures)
    .where(eq(companyDocumentSignatures.documentId, row.id))
    .all()
  if (!check.valid || recorded.some((signature) => !seals.has(signature.seal))) {
    return {
      ok: false,
      reason: "tampered",
      message: "This document failed its integrity check and cannot be downloaded. Contact Northwind.",
    }
  }
  return { ok: true, bytes, fileName: row.fileName, sha256: row.sha256 }
}
