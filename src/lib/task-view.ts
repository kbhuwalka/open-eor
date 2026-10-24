/**
 * Client-facing wording for tasks: who acts, why a start is at risk. Pure; shared by server
 * read models and components.
 */
import type { TaskParty, TaskProjection } from "@/domain/tasks"

import { formatDay } from "./format"

export type OwnerLabel = "You" | "Worker" | "Northwind"

/** Specialists, Finance and automation collapse to the provider name (acl I4). */
export function ownerLabel(party: TaskParty): OwnerLabel {
  switch (party) {
    case "client":
      return "You"
    case "worker":
      return "Worker"
    default:
      return "Northwind"
  }
}

/** A `YYYY-MM-DD` day as a local Date. */
export function parseDay(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(y, m - 1, d)
}

/**
 * Why the start is at risk: the earliest overdue blocking task, else the start date passing.
 * Null when the person is not at risk.
 */
export function atRiskMessage(
  projection: Pick<TaskProjection, "atRisk" | "blockingOpen">,
  now: Date,
): string | null {
  if (!projection.atRisk) return null
  const overdue = projection.blockingOpen
    .filter((task) => task.overdue && task.dueDate)
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : a.dueDate! > b.dueDate! ? 1 : a.seq - b.seq))[0]
  if (overdue) return `${overdue.title} was due ${formatDay(parseDay(overdue.dueDate!), now)}.`
  return "The start date has passed and onboarding is not finished."
}

/** Client-facing wording for domain §5 W3 reject codes. */
const REJECT_REASON_LABEL: Record<string, string> = {
  DOC_ILLEGIBLE: "Document not legible",
  DOC_EXPIRED: "Document expired",
  DOC_MISMATCH: "Details don't match",
  WRONG_LIST_COMBO: "Wrong document combination",
  OTHER: "Other",
}

/** "Document expired — note", for a rejection reason as stored on the task or event. */
export function rejectReasonText(reason: { code: string; note?: string }): string {
  const label = REJECT_REASON_LABEL[reason.code] ?? reason.code
  return reason.note ? `${label} — ${reason.note}` : label
}
