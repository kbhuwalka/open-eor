/**
 * The "Verify I-9 Section 2" task (onboarding-portal.md §3).
 *
 * Reading: the employee's active uploads (one per kind) with the details they entered at upload,
 * what they told us in Section 1 and the earlier rejections. Writing, accepted: the server fills
 * Section 2 from the employee's stored entries (the specialist reviews them and cannot change
 * them) on the employee's signed Section 1 (or the blank official form), takes the employer
 * representative's typed e-signature at the generator's own rectangle, verifies the result, stores
 * the bytes encrypted and records the hash, all in the transaction that completes the task.
 * Rejecting goes through the shared `rejectTaskAction` (engine rework).
 */
import { and, desc, eq } from "drizzle-orm"

import type { SessionUser } from "@/auth"
import type { AppDatabase } from "@/db/client"
import { caseDocuments, documentSignatures, generatedDocuments, users } from "@/db/schema"
import { todayIso } from "@/domain/employment-term"
import {
  hasErrors,
  reviewedDocumentNumber,
  section2Readiness,
  validateI9Section2,
  type I9Document,
  type I9Section2Data,
  type IdentityListKind,
  type Section2Readiness,
  type SignatureField,
} from "@/domain/forms"
import { DomainError, type DocumentKind } from "@/domain/types"
import { selectActiveIdentityDocuments } from "@/domain/work-auth"
import {
  rejectionHistory,
  type RejectionHistoryEntry,
  type ReviewedDocumentView,
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
import { identityDetailsOf } from "../identity-documents"
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
  /** Active uploads, one per kind, in List A, B, C order, with what the employee entered. */
  documents: ReviewedDocumentView[]
  /** Whether Section 2 can be signed from the employee's entries as they stand; else only Send back. */
  readiness: Section2Readiness["state"]
  section1: I9Section1Summary
  history: RejectionHistoryEntry[]
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

export type Section2EmployerPart = Omit<I9Section2Data, "listA" | "listB" | "listC">

/** The employer half of Section 2: the hire's start date, the signing specialist and Northwind. */
export function section2Employer(input: { startDate: string | null; signerName: string }): Section2EmployerPart {
  const { first, last } = splitName(input.signerName)
  return {
    additionalInformation: "",
    alternativeProcedure: false,
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
  const today = todayIso(now)
  const done = task.status === "done"
  const uploads = activeUploads(db, basics.caseId)
  const canSign = page.canAct && !done
  const documents: ReviewedDocumentView[] = uploads.map(({ row, details }) => ({
    ...uploadView(row),
    details: details && { ...details, number: reviewedDocumentNumber(details, canSign) },
  }))

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
    done && verified
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
    done,
    person: basics.workerName,
    documents,
    readiness: section2Readiness(uploads.map(reviewed), today).state,
    section1: section1Summary(db, basics.caseId),
    history,
    signerName: viewer.displayName,
    today,
    verifiedAs,
  }
}

type ActiveUpload = {
  row: typeof caseDocuments.$inferSelect & { kind: IdentityListKind }
  details: ReturnType<typeof identityDetailsOf>
}

/** The case's active List A/B/C uploads (one per kind, newest wins) with the employee's entries. */
function activeUploads(db: AppDatabase, caseId: string): ActiveUpload[] {
  const rows = db.select().from(caseDocuments).where(eq(caseDocuments.caseId, caseId)).all()
  const active = selectActiveIdentityDocuments(
    rows.map((row) => ({ id: row.id, kind: row.kind as DocumentKind, createdAt: row.createdAt.getTime() })),
  )
  return active.flatMap((doc) => {
    const row = rows.find((candidate) => candidate.id === doc.id)
    if (!row || (row.kind !== "list_a" && row.kind !== "list_b" && row.kind !== "list_c")) return []
    return [{ row: { ...row, kind: row.kind }, details: identityDetailsOf(row) }]
  })
}

const reviewed = ({ row, details }: ActiveUpload) => ({ id: row.id, kind: row.kind, details })

/** The Section 2 document lists from the employee's stored entries, as of `today`. */
export function storedSection2Documents(db: AppDatabase, caseId: string, today: string): Section2Readiness {
  return section2Readiness(activeUploads(db, caseId).map(reviewed), today)
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

const NOT_READY: Record<Exclude<Section2Readiness["state"], "ready">, string> = {
  no_documents: "The employee has not uploaded their documents yet.",
  invalid_combo: "These uploads are not an acceptable combination. Send them back.",
  missing_details: "The employee has not entered the details of every document. Send them back to upload again.",
  expired: "A document has expired. Send it back.",
}

/**
 * Section 2 as it will be signed: the documents exactly as the employee entered them, the employer
 * half from the hire and the signing specialist. Refused when the entries cannot go on the form.
 */
function section2DataFor(deps: CaseServiceDeps, owned: Owned, signerName: string): I9Section2Data {
  const today = todayIso(deps.now())
  const readiness = storedSection2Documents(deps.db, owned.basics.caseId, today)
  if (readiness.state !== "ready") throw new I9InputError(NOT_READY[readiness.state])
  const data: I9Section2Data = {
    listA: readiness.listA,
    listB: readiness.listB,
    listC: readiness.listC,
    ...section2Employer({ startDate: owned.basics.startDate, signerName }),
  }
  const errors = validateI9Section2(data, { today })
  if (hasErrors(errors)) {
    throw new I9InputError("Section 2 cannot be filled from what the employee entered. Send the documents back.", errors)
  }
  return data
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
  const base = await baseForSection2(deps.db, owned.basics.caseId)
  return fillI9Section2(data, { base, today: todayIso(deps.now()), now: deps.now() })
}

/** The unsigned Section 2, filled from the employee's entries, and where to sign it. */
export async function prepareSection2(
  deps: CaseServiceDeps,
  user: StaffViewer,
  input: { taskId: string },
): Promise<PreparedSection2> {
  const owned = requireReadyTask(deps, user, input.taskId)
  const generated = await generateSection2(deps, owned, section2DataFor(deps, owned, user.displayName))
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

/** The engine payload for the handler (`verify_i9_section2`), from the documents on Section 2. */
export function handlerPayload(data: Pick<I9Section2Data, "listA" | "listB" | "listC">): {
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
 * documents come from the employee's stored entries (never the caller), as does the signature
 * rectangle from the generator; the document number reaches the form record only through the
 * engine's `store_form` effect, encrypted.
 */
export async function acceptSection2(
  deps: CaseServiceDeps,
  user: StaffViewer,
  input: { taskId: string; signature: SignatureInput; fieldValues: FieldValuesInput },
): Promise<AcceptedSection2> {
  const owned = requireReadyTask(deps, user, input.taskId)
  const { basics, task } = owned
  const data = section2DataFor(deps, owned, user.displayName)
  const generated = await generateSection2(deps, owned, data)

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
        payload: handlerPayload(data),
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
