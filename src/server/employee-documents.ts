/**
 * The employee's signed documents (employee-portal.md §6): the employment agreement, Form I-9,
 * Form W-4 and the direct deposit authorization. Only the employee the case belongs to reads them
 * (acl F5); another person's document is indistinguishable from a missing one (I6). A download is
 * refused when the stored bytes fail the hash and seal checks recorded at signing.
 */
import { and, desc, eq, inArray } from "drizzle-orm"

import type { SessionUser } from "@/auth"
import type { AppDatabase } from "@/db/client"
import { caseDocuments, documentSignatures, generatedDocuments, onboardingCases } from "@/db/schema"
import type { DocumentKind } from "@/domain/types"
import { selectActiveIdentityDocuments } from "@/domain/work-auth"

import { verifySignedDocument } from "./documents"
import { readStoredFile, readSignedFile, sniffUploadType, type UploadMimeType } from "./uploads"

export const EMPLOYEE_DOCUMENT_KINDS = ["employment_agreement", "i9_section1", "w4", "direct_deposit_authorization"] as const
export type EmployeeDocumentKind = (typeof EMPLOYEE_DOCUMENT_KINDS)[number]

const TITLES: Record<EmployeeDocumentKind, { title: string; description: string }> = {
  employment_agreement: {
    title: "Employment agreement",
    description: "Your terms of employment, signed by you and countersigned by Northwind.",
  },
  i9_section1: { title: "Form I-9, Section 1", description: "Your employment eligibility attestation." },
  w4: { title: "Form W-4", description: "Your federal tax withholding." },
  direct_deposit_authorization: {
    title: "Direct deposit authorization",
    description: "Where your pay is deposited. The account number is masked on the document.",
  },
}

export type EmployeeDocumentRow = {
  id: string
  kind: EmployeeDocumentKind
  title: string
  description: string
  signedAt: string
  signedAs: string
  /** A stored, verifiable copy exists. Older records signed before copies were kept have none. */
  downloadable: boolean
  fileName: string
}

const isKind = (kind: string): kind is EmployeeDocumentKind => (EMPLOYEE_DOCUMENT_KINDS as readonly string[]).includes(kind)

/** The employee's signed documents, newest first within each kind's own order. */
export function listEmployeeDocuments(db: AppDatabase, userId: string): EmployeeDocumentRow[] {
  const rows = db
    .select({
      id: generatedDocuments.id,
      kind: generatedDocuments.kind,
      fileName: generatedDocuments.fileName,
      storagePath: generatedDocuments.storagePath,
      createdAt: generatedDocuments.createdAt,
      typedName: documentSignatures.typedName,
      signedAt: documentSignatures.signedAt,
    })
    .from(generatedDocuments)
    .innerJoin(onboardingCases, eq(onboardingCases.id, generatedDocuments.caseId))
    .innerJoin(
      documentSignatures,
      and(eq(documentSignatures.documentId, generatedDocuments.id), eq(documentSignatures.party, "worker")),
    )
    .where(and(eq(onboardingCases.workerUserId, userId), inArray(generatedDocuments.kind, [...EMPLOYEE_DOCUMENT_KINDS])))
    .orderBy(desc(documentSignatures.signedAt))
    .all()

  const latest = new Map<EmployeeDocumentKind, EmployeeDocumentRow>()
  for (const row of rows) {
    if (!isKind(row.kind) || latest.has(row.kind)) continue
    latest.set(row.kind, {
      id: row.id,
      kind: row.kind,
      ...TITLES[row.kind],
      signedAt: row.signedAt.toISOString(),
      signedAs: row.typedName,
      downloadable: row.storagePath !== null,
      fileName: row.fileName,
    })
  }
  return EMPLOYEE_DOCUMENT_KINDS.flatMap((kind) => latest.get(kind) ?? [])
}

export type EmployeeDocumentRead =
  | { ok: true; bytes: Uint8Array; fileName: string; sha256: string }
  | { ok: false; reason: "forbidden" | "not_found" | "tampered"; message: string }

function recordedSeal(metadataJson: string): { sha256: string | null; seal: string | null } {
  try {
    const parsed = JSON.parse(metadataJson) as { sha256?: unknown; signature?: { seal?: unknown } }
    return {
      sha256: typeof parsed.sha256 === "string" ? parsed.sha256 : null,
      seal: typeof parsed.signature?.seal === "string" ? parsed.signature.seal : null,
    }
  } catch {
    return { sha256: null, seal: null }
  }
}

/** Bytes of a signed document for `user`, after the owner check and the integrity check. */
export async function readEmployeeDocument(
  db: AppDatabase,
  user: Pick<SessionUser, "id" | "role">,
  documentId: string,
): Promise<EmployeeDocumentRead> {
  if (user.role !== "worker") {
    return { ok: false, reason: "forbidden", message: "Your role cannot download this document." }
  }
  const row = db
    .select({
      kind: generatedDocuments.kind,
      fileName: generatedDocuments.fileName,
      storagePath: generatedDocuments.storagePath,
      metadataJson: generatedDocuments.metadataJson,
      workerUserId: onboardingCases.workerUserId,
    })
    .from(generatedDocuments)
    .innerJoin(onboardingCases, eq(onboardingCases.id, generatedDocuments.caseId))
    .where(eq(generatedDocuments.id, documentId))
    .get()
  if (!row || row.workerUserId !== user.id || !isKind(row.kind) || row.storagePath === null) {
    return { ok: false, reason: "not_found", message: "Document not found." }
  }

  const bytes = readSignedFile(row.storagePath)
  const recorded = recordedSeal(row.metadataJson)
  const tampered = {
    ok: false,
    reason: "tampered",
    message: "This document failed its integrity check and cannot be downloaded. Contact Northwind.",
  } as const
  if (!bytes || !recorded.sha256) return tampered

  const check = await verifySignedDocument(bytes, { expectedSha256: recorded.sha256 })
  const seals = new Set(check.signatures.map((signature) => signature.seal))
  if (!check.valid || (recorded.seal !== null && !seals.has(recorded.seal))) return tampered
  return { ok: true, bytes, fileName: row.fileName, sha256: check.sha256 }
}

export type IdentityUploadRead =
  | { ok: true; bytes: Uint8Array; fileName: string; mime: UploadMimeType }
  | { ok: false; reason: "forbidden" | "not_found"; message: string }

function isActiveUpload(db: AppDatabase, caseId: string, documentId: string): boolean {
  const rows = db.select().from(caseDocuments).where(eq(caseDocuments.caseId, caseId)).all()
  return selectActiveIdentityDocuments(
    rows.map((row) => ({ id: row.id, kind: row.kind as DocumentKind, createdAt: row.createdAt.getTime() })),
  ).some((doc) => doc.id === documentId)
}

/**
 * An identity document the employee uploaded. The employee it belongs to and Northwind onboarding
 * specialists (who examine it for the I-9) may read it; the client company never may (acl F5).
 */
export function readIdentityUpload(
  db: AppDatabase,
  user: Pick<SessionUser, "id" | "role">,
  documentId: string,
): IdentityUploadRead {
  if (user.role !== "worker" && user.role !== "onboarding_specialist") {
    return { ok: false, reason: "forbidden", message: "Your role cannot view this document." }
  }
  const row = db
    .select({
      fileName: caseDocuments.fileName,
      storagePath: caseDocuments.storagePath,
      caseId: caseDocuments.caseId,
      workerUserId: onboardingCases.workerUserId,
    })
    .from(caseDocuments)
    .innerJoin(onboardingCases, eq(onboardingCases.id, caseDocuments.caseId))
    .where(eq(caseDocuments.id, documentId))
    .get()
  if (!row || (user.role === "worker" && row.workerUserId !== user.id)) {
    return { ok: false, reason: "not_found", message: "Document not found." }
  }
  // Specialists keep access to superseded uploads (the case's history); the employee sees only what counts.
  if (user.role === "worker" && !isActiveUpload(db, row.caseId, documentId)) {
    return { ok: false, reason: "not_found", message: "Document not found." }
  }
  const bytes = readStoredFile(row.storagePath)
  const mime = bytes ? sniffUploadType(bytes) : null
  if (!bytes || !mime) return { ok: false, reason: "not_found", message: "Document not found." }
  return { ok: true, bytes: new Uint8Array(bytes), fileName: row.fileName, mime }
}
