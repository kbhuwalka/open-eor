/**
 * Client-facing person status (domain §9.2): three statuses derived from the explicit case
 * lifecycle, the go-live milestone of the case's tasks and the employment term. Pure.
 */
import { isTermEnded } from "./employment-term"
import type { CaseLifecycle } from "./types"

export const PERSON_STATUSES = ["onboarding", "active", "inactive"] as const
export type PersonStatus = (typeof PERSON_STATUSES)[number]

export const PERSON_STATUS_LABEL: Record<PersonStatus, string> = {
  onboarding: "Onboarding",
  active: "Active",
  inactive: "Inactive",
}

/**
 * `goLiveReached` comes from `projectTasks` (every blocking task resolved and the start date
 * arrived). A cancelled or terminated case is inactive; an open case is onboarding until
 * go-live, then active through the inclusive end date of a fixed term and inactive after it.
 */
export function personStatusFor(input: {
  lifecycle: CaseLifecycle
  goLiveReached: boolean
  endDate: string | null | undefined
  now: Date
}): PersonStatus {
  if (input.lifecycle !== "open") return "inactive"
  if (!input.goLiveReached) return "onboarding"
  return isTermEnded(input.endDate, input.now) ? "inactive" : "active"
}

export function isPersonStatus(value: unknown): value is PersonStatus {
  return typeof value === "string" && (PERSON_STATUSES as readonly string[]).includes(value)
}
