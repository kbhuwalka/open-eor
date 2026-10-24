/**
 * Server Action contract (acl §6). Actions return this, never throw for
 * expected failures. `message` is user-safe; `details` carries machine data.
 */
import { AuthError } from "@/auth"
import { DomainError, type DomainErrorCode } from "@/domain/types"
import { formatCents } from "@/lib/format"

import { NotFoundError } from "./cases"

export type ActionErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "validation"
  | DomainErrorCode

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | {
      ok: false
      code: ActionErrorCode
      message: string
      details?: Record<string, unknown>
    }

export function fail(
  code: ActionErrorCode,
  message: string,
  details?: Record<string, unknown>
): ActionResult<never> {
  return { ok: false, code, message, details }
}

/** The illegal-transition details name what was attempted (billing: `entity`; the case lifecycle: `reason` or `from`). */
function illegalTransitionMessage(d: Record<string, unknown>): string {
  switch (d.entity) {
    case "payment":
      return "That payment is no longer waiting on Finance: it was already settled or marked failed. Refresh the page."
    case "invoice":
      return d.from === "void"
        ? "That invoice is already void."
        : "That invoice has a payment (processing or paid), so it cannot be voided. Fail the payment first."
    case "deposit":
      return d.to === "not_received"
        ? "This order has no deposit payment in flight, so there is nothing to mark as not received. Refresh the page."
        : "This order has no deposit step waiting for Finance. Refresh the page."
  }
  switch (d.reason) {
    case "no_quote":
      return "This order cannot be priced yet, so it cannot be placed."
    case "already_live":
      return "This person has already started, so the order can no longer be cancelled. End their employment instead."
    case "not_live":
      return "This person has not started yet, so their employment cannot be ended. Cancel the order instead."
    case "term_not_ended":
    case "not_inactive":
      return "This person is still within their current term, so there is nothing to renew."
  }
  if (typeof d.effectiveOn === "string") return "Choose a valid last working day."
  switch (d.from) {
    case "cancelled":
      return "This order was cancelled, so that is no longer possible."
    case "terminated":
      return "This person's employment has ended, so that is no longer possible."
    case "open":
      return "That is not possible while this person's order is open."
  }
  return "That is not possible right now. Refresh the page and try again."
}

function domainMessage(error: DomainError): string {
  const d = error.details ?? {}
  switch (error.code) {
    case "WAGE_BELOW_FLOOR": {
      const floor = typeof d.floorCents === "number" ? formatCents(d.floorCents) : "the floor"
      const eff =
        typeof d.effectiveHourlyCents === "number"
          ? formatCents(d.effectiveHourlyCents)
          : "the wage"
      return `Effective hourly wage ${eff} is below the ${floor} floor for this state.`
    }
    case "WORKER_ALREADY_ASSIGNED":
      return "That worker already has an onboarding case or is not part of your company."
    case "ROLE_NAME_TAKEN":
      return "You already have a role with that name."
    case "EMAIL_TAKEN":
      return "Someone with that email already exists."
    case "START_DATE_TOO_SOON": {
      const earliest = typeof d.earliest === "string" ? ` The earliest desired start date is ${d.earliest}.` : ""
      return `Desired start dates need at least 5 business days of notice.${earliest}`
    }
    case "END_DATE_BEFORE_START":
      return "The end date must be after the start date."
    case "END_DATE_NOT_FUTURE":
      return "The new end date must be after today."
    case "LAST_DAY_AFTER_END_DATE": {
      const end = typeof d.endDate === "string" ? ` (${d.endDate})` : ""
      return `The last working day cannot be after the end date${end}.`
    }
    case "TERM_REQUIRED":
      return "Choose a new employment term: indefinite, or a fixed term with a future end date."
    case "AGREEMENT_ALREADY_SIGNED":
      return "The agreement is already signed."
    case "FORBIDDEN_ROLE":
      return "Your role cannot perform this action."
    case "ILLEGAL_TRANSITION":
      return illegalTransitionMessage(d)
    case "CASE_NOT_OPEN":
      return "This person's order is no longer open."
    case "TASK_NOT_FOUND":
      return "That task no longer exists."
    case "TASK_NOT_READY":
      return "That task is not ready yet, or it was already done."
    case "TASK_NOT_REJECTABLE":
      return "That task cannot be rejected."
    case "INVALID_TASK_PAYLOAD": {
      const message = typeof d.message === "string" ? ` ${d.message}` : ""
      return `Check the details you entered.${message}`
    }
    case "INVALID_WORKFLOW_TEMPLATE":
      return "The onboarding workflow is misconfigured."
    case "INVALID_PAYMENT_SELECTION":
      return "Choose open invoices of your company that are not already paid or being paid."
    case "INVALID_LIST_COMBO":
      return "Upload List A, or both List B and List C."
    case "INVALID_REJECT_REASON":
      return "Choose a reject reason; OTHER needs a note."
  }
}

/** Map expected failures to `ActionResult`; rethrow anything unexpected (R1). */
export function toActionError(error: unknown): ActionResult<never> {
  if (error instanceof DomainError) {
    return fail(error.code, domainMessage(error), error.details)
  }
  if (error instanceof AuthError) {
    return fail(error.code, error.message)
  }
  if (error instanceof NotFoundError) {
    return fail("not_found", error.message)
  }
  throw error
}
