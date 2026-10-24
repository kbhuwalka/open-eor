/**
 * Pure helpers of the I-9 Section 2 review (onboarding-portal.md §3): the shapes the drawer shows,
 * the reject reason that names the documents, and the rejection history.
 *
 * The engine rejects a *task* with `{ code, note? }` (domain §5 W3); it has no per-document reason.
 * "Per document" is therefore encoded in the note, which the employee reads verbatim:
 * "Driver's license (List B): the photo is cut off".
 */
import type { RejectReason, RejectReasonCode } from "@/domain/types"
import { REJECT_REASON_CODES } from "@/domain/types"
import type { DocumentKind } from "@/domain/types"

export const LIST_LABEL: Record<"list_a" | "list_b" | "list_c", string> = {
  list_a: "List A",
  list_b: "List B",
  list_c: "List C",
}

export const REJECT_CODE_LABEL: Record<RejectReasonCode, string> = {
  DOC_ILLEGIBLE: "Document not legible",
  DOC_EXPIRED: "Document expired",
  DOC_MISMATCH: "Details don't match the employee",
  WRONG_LIST_COMBO: "Wrong document combination",
  OTHER: "Other reason",
}

export const REJECT_CODE_OPTIONS = REJECT_REASON_CODES.map((code) => ({ value: code, label: REJECT_CODE_LABEL[code] }))

export type UploadedDocumentView = {
  id: string
  kind: DocumentKind
  fileName: string
  uploadedAt: string
  /** What the viewer renders: an image or a PDF, or null when the stored bytes are missing. */
  mime: "image/png" | "image/jpeg" | "application/pdf" | null
  /** `/api/documents/<id>`. */
  url: string
}

/** What the employee entered about one upload, as the specialist reviews it. */
export type ReviewedDocumentDetails = {
  title: string
  issuingAuthority: string
  /**
   * In full while the specialist can still sign (they attest to it), else `•••• 6789`; a Social
   * Security card's number is always `***-**-6789` (`reviewedDocumentNumber`). Never log it or put
   * it in a list view.
   */
  number: string
  /** `YYYY-MM-DD`, null when the document has no expiration date. */
  expiresOn: string | null
}

export type ReviewedDocumentView = UploadedDocumentView & {
  /** Null for an upload made before employees entered document details. */
  details: ReviewedDocumentDetails | null
}

export type RejectionInput = {
  code: RejectReasonCode
  note: string
  /** Labels of the documents the reason is about, e.g. ["Driver's license (List B)"]. */
  documents: readonly string[]
}

/** `null` when valid; otherwise what to tell the specialist. `OTHER` needs words. */
export function rejectionProblem(input: RejectionInput): string | null {
  if (input.documents.length === 0) return "Choose which document you are rejecting."
  if (input.code === "OTHER" && input.note.trim() === "") return "Describe the problem for the employee."
  return null
}

/** The reason handed to the engine; the employee sees the note as written. */
export function buildRejectReason(input: RejectionInput): RejectReason {
  const problem = rejectionProblem(input)
  if (problem) throw new Error(problem)
  const note = input.note.trim()
  const prefix = input.documents.join(" and ")
  const text = note ? `${prefix}: ${note}` : prefix
  return input.code === "OTHER" ? { code: "OTHER", note: text } : { code: input.code, note: text }
}

export type RejectionHistoryEntry = {
  taskId: string
  at: string
  code: RejectReasonCode
  note: string | null
  by: string
}

/** Earlier rejections of this check, newest first. */
export function rejectionHistory(
  tasks: readonly { id: string; key: string; status: string; completedAt: Date | null; completedByName: string | null; result: unknown }[],
  key = "verify_i9_section2",
): RejectionHistoryEntry[] {
  const entries: RejectionHistoryEntry[] = []
  for (const task of tasks) {
    if (task.key !== key || task.status !== "rejected" || !task.completedAt) continue
    const reason = (task.result as { reason?: { code?: unknown; note?: unknown } } | null)?.reason
    if (!reason || typeof reason.code !== "string" || !(REJECT_REASON_CODES as readonly string[]).includes(reason.code)) continue
    entries.push({
      taskId: task.id,
      at: task.completedAt.toISOString(),
      code: reason.code as RejectReasonCode,
      note: typeof reason.note === "string" ? reason.note : null,
      by: task.completedByName ?? "Northwind",
    })
  }
  return entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
}
