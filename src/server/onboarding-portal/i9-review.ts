/**
 * The "Verify I-9 Section 2" task (onboarding-portal.md §3).
 *
 * Reading: the employee's active uploads (one per kind), what they told us in Section 1, the
 * checklist and the earlier rejections. Writing, accepted: the specialist records the documents they
 * examined, the server fills Section 2 on the employee's signed Section 1 (or the blank official
 * form), takes the employer representative's typed e-signature at the generator's own rectangle,
 * verifies the result, stores the bytes encrypted and records the hash, all in the transaction that
 * completes the task. Rejecting goes through the shared `rejectTaskAction` (engine rework).
 */
import { and, desc, eq } from "drizzle-orm"

import type { SessionUser } from "@/auth"
import type { AppDatabase } from "@/db/client"
import { caseDocuments, documentSignatures, generatedDocuments, users } from "@/db/schema"
import { todayIso } from "@/domain/employment-term"
import {
  hasErrors,
  i9ListKinds,
  validateI9Section2,
  type I9Document,
  type I9Section2Data,
  type I9Section2Draft,
  type SignatureField,
} from "@/domain/forms"
import { DomainError, type DocumentKind } from "@/domain/types"
import { isWorkAuthListComboValid, selectActiveIdentityDocuments } from "@/domain/work-auth"
import {
  i9Checklist,
  rejectionHistory,
  type ChecklistItem,
  type RejectionHistoryEntry,
  type UploadedDocumentView,
} from "@/lib/onboarding-portal/i9-review"

import { actorOf, completeTaskInTx } from "../case-engine"
import { idFor, type CaseServiceDeps } from "../deps"
import {
  NORTHWIND_ENTITY,
  SignatureError,
  applyEsignature,
  fillI9Section2,
  verifySignedDocument,
} from "../documents"
import { tasksForCase } from "../tasks"
import { readSignedFile, readStoredFile, removeStoredFile, sniffUploadType, writeSignedFile } from "../uploads"

import { assertSpecialist, latestForm, loadStaffTask, type StaffViewer } from "./core"

export type I9Section1Summary = {
  legalName: string | null
  address: string | null
  phone: string | null
  citizenship: string | null
  workAuthExpiresOn: string | null
  /** Section 1 was signed and a stored copy exists. */
  signedCopy: boolean
}

export type I9ReviewData = {
  taskId: string
  caseId: string
  canAct: boolean
  rejectable: boolean
  done: boolean
  person: string
  /** Active uploads, one per kind, in List A, B, C order. */
  documents: UploadedDocumentView[]
  /** Earlier uploads that a newer one replaced. */
  replaced: UploadedDocumentView[]
  /** The combination the active uploads make is valid (List A, or B with C). */
  comboValid: boolean
  section1: I9Section1Summary
  checklist: ChecklistItem[]
  history: RejectionHistoryEntry[]
  prefill: I9Section2Draft
  signerName: string
  today: string
  /** The recorded Section 2 documents of a done task. */
  verifiedAs: { title: string; authority: string; expiresOn: string | null } | null
}

const CITIZENSHIP_LABEL: Record<string, string> = {
  citizen: "A citizen of the United States",
  noncitizen_national: "A noncitizen national of the United States",
  lawful_permanent_resident: "A lawful permanent resident",
  alien_authorized: "An alien authorized to work",
  authorized_alien: "An alien authorized to work",
}

function uploadView(row: { id: string; kind: DocumentKind; fileName: string; storagePath: string; createdAt: Date }): UploadedDocumentView {
  const bytes = readStoredFile(row.storagePath)
  return {
    id: row.id,
    kind: row.kind,
    fileName: row.fileName,
    uploadedAt: row.createdAt.toISOString(),
    mime: bytes ? sniffUploadType(bytes) : null,
    url: `/api/documents/${row.id}`,
  }
}

function section1Summary(db: AppDatabase, caseId: string): I9Section1Summary {
  const personal = latestForm(db, caseId, "personal_details")?.data ?? {}
  const i9 = latestForm(db, caseId, "i9_section1")?.data ?? {}
  const address = personal.address as { line1?: string; line2?: string; city?: string; state?: string; zip?: string } | undefined
  const doc = db
    .select({ storagePath: generatedDocuments.storagePath })
    .from(generatedDocuments)
    .where(and(eq(generatedDocuments.caseId, caseId), eq(generatedDocuments.kind, "i9_section1")))
    .orderBy(desc(generatedDocuments.createdAt))
    .get()
  const status = typeof i9.citizenshipStatus === "string" ? i9.citizenshipStatus : null
  return {
    legalName: typeof personal.legalName === "string" ? personal.legalName : null,
    address: address?.line1
      ? [address.line1, address.line2, [address.city, address.state].filter(Boolean).join(", "), address.zip].filter(Boolean).join(" · ")
      : null,
    phone: typeof personal.phone === "string" ? personal.phone : null,
    citizenship: status ? (CITIZENSHIP_LABEL[status] ?? status) : null,
    workAuthExpiresOn: typeof i9.workAuthExpiresOn === "string" ? i9.workAuthExpiresOn : null,
    signedCopy: Boolean(doc?.storagePath),
  }
}

function splitName(displayName: string): { first: string; last: string } {
  const parts = displayName.trim().split(/\s+/)
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") || (parts[0] ?? "") }
}

const BLANK_DOCUMENT = { title: "", issuingAuthority: "", number: "", expiresOn: "" }

/** Section 2 defaults that are the same for every hire; the specialist fills in the documents. */
export function section2Prefill(input: { startDate: string | null; signerName: string; kinds?: readonly DocumentKind[] }): I9Section2Draft {
  const { first, last } = splitName(input.signerName)
  const usesListBC = Boolean(input.kinds?.includes("list_b") || input.kinds?.includes("list_c")) && !input.kinds?.includes("list_a")
  return {
    ...(usesListBC ? { listB: BLANK_DOCUMENT, listC: BLANK_DOCUMENT } : {}),
    firstDayOfEmployment: input.startDate ?? "",
    employerRepFirstName: first,
    employerRepLastName: last,
    employerRepTitle: "Onboarding Specialist",
    businessName: NORTHWIND_ENTITY.legalName,
    businessAddress: splitAddress(NORTHWIND_ENTITY.address),
  }
}

/** "500 Harbor Way, Suite 400, San Francisco, CA 94105" into the form's four parts. */
function splitAddress(address: string): { street: string; city: string; state: string; zip: string } {
  const match = /^(.*), ([^,]+), ([A-Z]{2}) (\d{5})$/.exec(address)
  return match
    ? { street: match[1], city: match[2], state: match[3], zip: match[4] }
    : { street: address, city: "", state: "", zip: "" }
}

export function loadI9Review(
  db: AppDatabase,
  viewer: StaffViewer,
  taskId: string,
  now: Date = new Date(),
): I9ReviewData | null {
  const found = loadStaffTask(db, viewer, taskId, ["verify_i9_section2"], now)
  if (!found) return null
  const { basics, page, task } = found

  const rows = db
    .select()
    .from(caseDocuments)
    .where(eq(caseDocuments.caseId, basics.caseId))
    .all()
    .filter((row) => row.kind !== "w4" && row.kind !== "other")
  const withTime = rows.map((row) => ({ ...row, createdAtMs: row.createdAt.getTime() }))
  const active = selectActiveIdentityDocuments(withTime.map((row) => ({ id: row.id, kind: row.kind as DocumentKind, createdAt: row.createdAtMs })))
  const activeIds = new Set(active.map((doc) => doc.id))
  const view = (row: (typeof withTime)[number]) => uploadView({ ...row, kind: row.kind as DocumentKind })
  const documents = active.flatMap((doc) => {
    const row = withTime.find((candidate) => candidate.id === doc.id)
    return row ? [view(row)] : []
  })
  const replaced = withTime
    .filter((row) => !activeIds.has(row.id))
    .sort((a, b) => b.createdAtMs - a.createdAtMs)
    .map(view)

  const allTasks = tasksForCase(db, basics.caseId)
  const names = new Map(
    db
      .select({ id: users.id, name: users.displayName })
      .from(users)
      .all()
      .map((row) => [row.id, row.name]),
  )
  const history = rejectionHistory(
    allTasks.map((candidate) => ({
      id: candidate.id,
      key: candidate.key,
      status: candidate.status,
      completedAt: candidate.completedAt,
      completedByName: candidate.completedByUserId ? (names.get(candidate.completedByUserId) ?? null) : null,
      result: candidate.result,
    })),
  )

  const verified = latestForm(db, basics.caseId, "i9_section2")
  const verifiedAs =
    task.status === "done" && verified
      ? {
          title: String(verified.data.documentTitle ?? ""),
          authority: String(verified.data.issuingAuthority ?? ""),
          expiresOn: typeof verified.data.expiresOn === "string" ? verified.data.expiresOn : null,
        }
      : null

  return {
    taskId,
    caseId: basics.caseId,
    canAct: page.canAct,
    rejectable: page.rejectable,
    done: task.status === "done",
    person: basics.workerName,
    documents,
    replaced,
    comboValid: isWorkAuthListComboValid(documents.map((doc) => doc.kind)),
    section1: section1Summary(db, basics.caseId),
    checklist: i9Checklist(documents.map((doc) => doc.kind)),
    history,
    prefill: section2Prefill({ startDate: basics.startDate, signerName: viewer.displayName, kinds: documents.map((doc) => doc.kind) }),
    signerName: viewer.displayName,
    today: todayIso(now),
    verifiedAs,
  }
}

// ── Accepting: fill, sign, store, complete ──────────────────────────

export type PreparedSection2 = {
  pdf: Uint8Array
  fields: SignatureField[]
  title: string
  signer: { name: string; role: "Employer representative" }
}

export class I9InputError extends Error {
  readonly errors: Record<string, string>
  constructor(message: string, errors: Record<string, string> = {}) {
    super(message)
    this.name = "I9InputError"
    this.errors = errors
  }
}

function section2Title(personName: string) {
  return `Form I-9, Section 2: ${personName}`
}

type Owned = NonNullable<ReturnType<typeof loadStaffTask>>

function requireReadyTask(deps: CaseServiceDeps, user: StaffViewer, taskId: string): Owned {
  assertSpecialist(user)
  const found = loadStaffTask(deps.db, user, taskId, ["verify_i9_section2"], deps.now())
  if (!found) throw new DomainError("TASK_NOT_FOUND", { taskId })
  if (!found.page.canAct) throw new DomainError("TASK_NOT_READY", { taskId })
  return found
}

function activeUploadKinds(db: AppDatabase, caseId: string): DocumentKind[] {
  const rows = db.select().from(caseDocuments).where(eq(caseDocuments.caseId, caseId)).all()
  return selectActiveIdentityDocuments(rows.map((row) => ({ id: row.id, kind: row.kind as DocumentKind, createdAt: row.createdAt.getTime() })))
    .map((doc) => doc.kind)
    .filter((kind) => kind === "list_a" || kind === "list_b" || kind === "list_c")
}

/** The checks that tie what the specialist typed to what the employee uploaded. */
function validateAgainstUploads(db: AppDatabase, caseId: string, data: I9Section2Data, today: string): void {
  const errors = validateI9Section2(data, { today })
  if (hasErrors(errors)) throw new I9InputError("Check the form and try again.", errors)
  const uploaded = [...activeUploadKinds(db, caseId)].sort().join(",")
  const recorded = [...i9ListKinds(data)].sort().join(",")
  if (uploaded !== recorded) {
    throw new I9InputError(
      "The documents recorded do not match the ones the employee uploaded. Record the same lists, or send the documents back.",
      { documents: "Record the same lists the employee uploaded." },
    )
  }
}

async function baseForSection2(db: AppDatabase, caseId: string): Promise<Uint8Array | undefined> {
  const row = db
    .select({ storagePath: generatedDocuments.storagePath })
    .from(generatedDocuments)
    .where(and(eq(generatedDocuments.caseId, caseId), eq(generatedDocuments.kind, "i9_section1")))
    .orderBy(desc(generatedDocuments.createdAt))
    .get()
  return row?.storagePath ? (readSignedFile(row.storagePath) ?? undefined) : undefined
}

async function generateSection2(deps: CaseServiceDeps, owned: Owned, data: I9Section2Data) {
  const today = todayIso(deps.now())
  validateAgainstUploads(deps.db, owned.basics.caseId, data, today)
  const base = await baseForSection2(deps.db, owned.basics.caseId)
  return fillI9Section2(data, { base, today, now: deps.now() })
}

/** The unsigned, filled Section 2 and where to sign it, for the review step of the form. */
export async function prepareSection2(
  deps: CaseServiceDeps,
  user: StaffViewer,
  input: { taskId: string; data: I9Section2Data },
): Promise<PreparedSection2> {
  const owned = requireReadyTask(deps, user, input.taskId)
  const generated = await generateSection2(deps, owned, input.data)
  return {
    pdf: generated.pdf,
    fields: generated.fields,
    title: section2Title(owned.basics.workerName),
    signer: { name: user.displayName, role: "Employer representative" },
  }
}

export type SignatureInput = { typedName: string; consentedAt: string }
export type FieldValuesInput = Record<string, { kind: string; value: string; signedAt: string }>

function parseConsent(raw: unknown, now: Date): Date {
  const at = new Date(typeof raw === "string" ? raw : "")
  if (Number.isNaN(at.getTime())) throw new SignatureError("INVALID_SIGNED_AT", "The consent time is not valid.")
  if (at.getTime() > now.getTime() + 5 * 60_000) throw new SignatureError("INVALID_SIGNED_AT", "The consent time is in the future.")
  return at
}

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`)

/** The engine payload for the handler (`verify_i9_section2`), from the documents the specialist recorded. */
export function handlerPayload(data: I9Section2Data): {
  documentTitle: string
  issuingAuthority: string
  documentNumber: string
  expiresOn?: string
} {
  const docs: I9Document[] = data.listA.length > 0 ? data.listA : [data.listB, data.listC].filter((doc): doc is I9Document => doc !== null)
  const expiries = docs.map((doc) => doc.expiresOn).filter(Boolean).sort()
  return {
    documentTitle: clip(docs.map((doc) => doc.title).join(" + "), 120),
    issuingAuthority: clip(docs.map((doc) => doc.issuingAuthority).join(" + "), 120),
    documentNumber: clip(docs.map((doc) => doc.number || "none").join("; "), 60),
    ...(expiries[0] ? { expiresOn: expiries[0] } : {}),
  }
}

export type AcceptedSection2 = { documentId: string; sha256: string; signedAt: string }

/**
 * Signs Section 2 as the employer representative and completes the task in one transaction. The
 * signature rectangle comes from the generator (never the caller); the document number reaches the
 * database only through the engine's `store_form` effect, encrypted.
 */
export async function acceptSection2(
  deps: CaseServiceDeps,
  user: StaffViewer,
  input: { taskId: string; data: I9Section2Data; signature: SignatureInput; fieldValues: FieldValuesInput },
): Promise<AcceptedSection2> {
  const owned = requireReadyTask(deps, user, input.taskId)
  const { basics, task } = owned
  const generated = await generateSection2(deps, owned, input.data)

  const signedAt = deps.now()
  const consentedAt = parseConsent(input.signature?.consentedAt, signedAt)
  const typedName = typeof input.signature?.typedName === "string" ? input.signature.typedName : ""
  const signatureField = generated.fields.find((field) => field.kind === "signature")
  const dateField = generated.fields.find((field) => field.kind === "date" && field.linkedTo === signatureField?.id)
  if (!signatureField?.fieldKey) throw new Error("Section 2 has no signature field.")
  const entry = input.fieldValues?.[signatureField.id]
  if (!entry || entry.kind !== "signature") {
    throw new SignatureError("INVALID_FIELD", "Sign the document where it is marked before finishing.")
  }
  const title = section2Title(basics.workerName)
  const signed = await applyEsignature(generated.pdf, {
    signerName: user.displayName,
    signerRole: "Employer representative",
    typedSignature: typedName,
    signedAt,
    consent: { consentedAt },
    fieldKey: signatureField.fieldKey,
    fields: { signature: signatureField, ...(dateField ? { date: dateField } : {}) },
    documentTitle: title,
  })
  const check = await verifySignedDocument(signed.pdf, { expectedSha256: signed.sha256, preSignaturePdf: generated.pdf })
  if (!check.valid) throw new Error(`The signed document failed verification: ${check.problems.join(" ")}`)

  const documentId = idFor(deps, "gdoc")
  const storagePath = writeSignedFile({ caseId: basics.caseId, name: `i9-section2-${documentId}`, bytes: signed.pdf })
  try {
    deps.db.transaction((tx) => {
      completeTaskInTx(tx, deps, {
        taskId: task.id,
        actor: actorOf(user as SessionUser),
        payload: handlerPayload(input.data),
      })
      tx.insert(generatedDocuments)
        .values({
          id: documentId,
          caseId: basics.caseId,
          taskId: task.id,
          kind: "i9_section2",
          fileName: `i9-section2-${documentId}.pdf`,
          storagePath,
          metadataJson: JSON.stringify({
            generator: "northwind",
            sha256: signed.sha256,
            preSignatureSha256: signed.preSignatureSha256,
            documentRef: signed.documentId,
            signature: signed.record,
          }),
          createdAt: signedAt,
        })
        .run()
      tx.insert(documentSignatures)
        .values({
          id: idFor(deps, "sig"),
          documentId,
          caseId: basics.caseId,
          taskId: task.id,
          party: "specialist",
          signerUserId: user.id,
          typedName: signed.record.typedSignature,
          signedAt,
        })
        .run()
    })
  } catch (error) {
    removeStoredFile(storagePath)
    throw error
  }
  return { documentId, sha256: signed.sha256, signedAt: signedAt.toISOString() }
}
