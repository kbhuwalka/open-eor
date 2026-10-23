/**
 * I-9 list combination, active-document selection, and reject-reason validation.
 * Readiness uses the active document per kind (greatest `createdAt`; later row wins ties).
 */

import {
  DOCUMENT_KINDS,
  DomainError,
  REJECT_REASON_CODES,
  type DocumentKind,
  type RejectReason,
  type RejectReasonCode,
} from "./types"

const LIST_KINDS = new Set<DocumentKind>(["list_a", "list_b", "list_c"])

export type TimestampedDocument = {
  id: string
  kind: DocumentKind
  createdAt: number
}

/**
 * List A xor (List B and List C). `w4` and `other` do not affect the combination.
 * Valid: `{list_a}`, `{list_b, list_c}`.
 */
export function isWorkAuthListComboValid(kinds: readonly DocumentKind[]): boolean {
  const present = new Set(kinds.filter((kind) => LIST_KINDS.has(kind)))
  const hasListA = present.has("list_a")
  const hasListB = present.has("list_b")
  const hasListC = present.has("list_c")
  const listAOnly = hasListA && !hasListB && !hasListC
  const listBAndC = !hasListA && hasListB && hasListC
  return listAOnly || listBAndC
}

/** One active document per kind, in `DOCUMENT_KINDS` order. */
export function selectActiveDocuments<T extends TimestampedDocument>(
  documents: readonly T[],
): T[] {
  const active = new Map<DocumentKind, T>()
  for (const document of documents) {
    const current = active.get(document.kind)
    if (!current || document.createdAt >= current.createdAt) {
      active.set(document.kind, document)
    }
  }
  return DOCUMENT_KINDS.flatMap((kind) => {
    const document = active.get(kind)
    return document ? [document] : []
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isRejectCode(value: unknown): value is RejectReasonCode {
  return (
    typeof value === "string" &&
    (REJECT_REASON_CODES as readonly string[]).includes(value)
  )
}

/**
 * Accepts each non-`OTHER` code with or without a note.
 * `OTHER` requires a note that is non-empty after trim.
 * Postcondition: returned notes are trimmed; a blank optional note is omitted.
 */
export function assertRejectReason(input: unknown): RejectReason {
  if (!isRecord(input) || !isRejectCode(input.code)) {
    throw new DomainError("INVALID_REJECT_REASON")
  }
  if ("note" in input && input.note !== undefined && typeof input.note !== "string") {
    throw new DomainError("INVALID_REJECT_REASON", { code: input.code })
  }
  const note = typeof input.note === "string" ? input.note.trim() : ""
  if (input.code === "OTHER") {
    if (note === "") throw new DomainError("INVALID_REJECT_REASON", { code: "OTHER" })
    return { code: "OTHER", note }
  }
  if (note === "") return { code: input.code }
  return { code: input.code, note }
}
