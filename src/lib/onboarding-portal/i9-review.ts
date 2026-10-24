/**
 * Pure helpers of the I-9 Section 2 review screen (onboarding-portal.md §3): the checklist the
 * specialist verifies against, the reject reason that names the documents, and the rejection history.
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

export type ChecklistItem = {
  id: string
  label: string
  /** The domain rule behind it, in a sentence. */
  rule: string
}

/** What the specialist confirms against the originals, from `work-auth.ts` and the I-9 instructions. */
export function i9Checklist(kinds: readonly DocumentKind[]): ChecklistItem[] {
  const items: ChecklistItem[] = [
    {
      id: "combo",
      label: "The documents are an acceptable combination",
      rule: "One List A document, or one List B and one List C document. Never a mix.",
    },
    {
      id: "genuine",
      label: "Each document looks genuine and relates to the employee",
      rule: "Examine the original in the employee's presence or, for remote hires, by the authorized procedure.",
    },
    {
      id: "name",
      label: "The name and photo match the employee",
      rule: "Names on the documents must match the name on Section 1 (maiden names and suffixes included).",
    },
    {
      id: "expiry",
      label: "No document has expired",
      rule: "Expired documents are not acceptable, except where the form's instructions say otherwise.",
    },
    {
      id: "legible",
      label: "Every page is legible",
      rule: "Both sides of a card, and every page that carries the number or the expiry date.",
    },
  ]
  if (kinds.includes("list_b") && !kinds.includes("list_c")) {
    items.push({ id: "missing_c", label: "A List C document is still needed", rule: "A List B identity document alone does not prove work authorization." })
  }
  if (kinds.includes("list_c") && !kinds.includes("list_b")) {
    items.push({ id: "missing_b", label: "A List B document is still needed", rule: "A List C document alone does not prove identity." })
  }
  return items
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
