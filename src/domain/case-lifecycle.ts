/**
 * The explicit case lifecycle (case-state-machine.md): create an order, cancel it, terminate an
 * active person, reactivate, renew a term. Onboarding itself is not here; it is the case's tasks
 * (tasks-and-workflow.md). Pure; role checks first, then lifecycle preconditions.
 */
import { assertStartDateAllowed } from "./business-days"
import {
  assertEndDateAfterStart,
  assertEndDateInFuture,
  assertLastDayWithinTerm,
  isIsoDate,
  isTermEnded,
} from "./employment-term"
import { buildPolicySnapshot, type PolicySnapshotInput } from "./policy-snapshot"
import {
  DomainError,
  type CaseEvent,
  type CaseLifecycle,
  type PolicySnapshotV1,
  type Quote,
  type UserRole,
} from "./types"
import { assertWageAllowed } from "./wage"

export type LifecycleResult = {
  nextLifecycle: CaseLifecycle
  event: CaseEvent
}

function assertClient(actorRole: UserRole): void {
  if (actorRole !== "client_hr") {
    throw new DomainError("FORBIDDEN_ROLE", { actorRole, allowedRole: "client_hr" })
  }
}

function assertLifecycle(from: CaseLifecycle, allowed: readonly CaseLifecycle[], extra?: Record<string, unknown>): void {
  if (!allowed.includes(from)) {
    throw new DomainError("ILLEGAL_TRANSITION", { from, allowedFrom: [...allowed], ...extra })
  }
}

function optionalNote(note: string | undefined): { note?: string } {
  const trimmed = note?.trim()
  return trimmed ? { note: trimmed } : {}
}

/** One month of the committed total, capped at the term total of a fixed term (tasks-and-workflow.md §7). */
export function depositCentsFor(quote: Quote): number {
  const month = quote.totals.committed.monthlyCents
  return quote.term ? Math.min(month, quote.term.committedCents) : month
}

export type CreateOrderResult = {
  snapshot: PolicySnapshotV1
  depositCents: number
  event: CaseEvent
}

/**
 * Creating an order is the client's signature on it. Role, wage floor, term, then the frozen
 * snapshot (with its quote) and the deposit; the case starts `open` with its tasks instantiated
 * by the engine.
 */
export function createOrder(
  input: { actorRole: UserRole; hireId: string; now: Date; startDate: string } & Omit<PolicySnapshotInput, "startDate">,
): CreateOrderResult {
  assertClient(input.actorRole)
  assertStartDateAllowed(input.startDate, input.now)
  assertWageAllowed({ wageCents: input.wageCents, wageUnit: input.wageUnit, stateCode: input.stateCode })
  assertEndDateAfterStart(input.startDate, input.endDate ?? null)
  const snapshot = buildPolicySnapshot(input, input.now)
  if (!snapshot.quote) throw new DomainError("ILLEGAL_TRANSITION", { reason: "no_quote" })
  return {
    snapshot,
    depositCents: depositCentsFor(snapshot.quote),
    event: {
      type: "order_created",
      payload: { hireId: input.hireId, snapshotCapturedAt: snapshot.capturedAt },
    },
  }
}

/** T9. The client withdraws an order that has not gone live; the person becomes inactive. */
export function clientCancelOrder(input: {
  actorRole: UserRole
  lifecycle: CaseLifecycle
  goLiveReached: boolean
  note?: string
}): LifecycleResult {
  assertClient(input.actorRole)
  assertLifecycle(input.lifecycle, ["open"])
  if (input.goLiveReached) {
    throw new DomainError("ILLEGAL_TRANSITION", { from: input.lifecycle, reason: "already_live" })
  }
  return { nextLifecycle: "cancelled", event: { type: "request_cancelled", payload: optionalNote(input.note) } }
}

/**
 * T10. The client ends an active person's employment. `effectiveOn` is an ISO date; a fixed-term
 * person's last working day cannot be after the end date, ending early is allowed.
 */
export function clientTerminate(input: {
  actorRole: UserRole
  lifecycle: CaseLifecycle
  goLiveReached: boolean
  effectiveOn: string
  endDate?: string | null
  note?: string
}): LifecycleResult {
  assertClient(input.actorRole)
  assertLifecycle(input.lifecycle, ["open"])
  if (!input.goLiveReached) {
    throw new DomainError("ILLEGAL_TRANSITION", { from: input.lifecycle, reason: "not_live" })
  }
  if (!isIsoDate(input.effectiveOn)) {
    throw new DomainError("ILLEGAL_TRANSITION", { effectiveOn: input.effectiveOn })
  }
  assertLastDayWithinTerm(input.effectiveOn, input.endDate ?? null)
  return {
    nextLifecycle: "terminated",
    event: { type: "terminated", payload: { effectiveOn: input.effectiveOn, ...optionalNote(input.note) } },
  }
}

export type ReactivateResult = LifecycleResult & {
  /** A cancelled onboarding restarts: the case's tasks are instantiated again. */
  restartTasks: boolean
  /** The new term to persist on the hire; absent when unchanged. */
  endDate?: string | null
}

type TermInput = {
  endDate?: string | null
  startDate?: string | null
  now: Date
}

function assertNewTerm(input: TermInput & { newEndDate: string | null }): void {
  assertEndDateInFuture(input.newEndDate, input.now)
  assertEndDateAfterStart(input.startDate, input.newEndDate)
}

function reactivatedEvent(
  note: string | undefined,
  newEndDate: string | null | undefined,
  restarted: boolean,
): CaseEvent {
  return {
    type: "reactivated",
    payload: {
      ...optionalNote(note),
      ...(newEndDate !== undefined ? { endDate: newEndDate } : {}),
      ...(restarted ? { restarted: true } : {}),
    },
  }
}

/**
 * Term renewal, no lifecycle change: an open, live person whose fixed term has ended reads as
 * inactive; reactivating them only chooses a new term (a date after today, or `null`).
 */
export function clientRenewTerm(
  input: TermInput & {
    actorRole: UserRole
    lifecycle: CaseLifecycle
    goLiveReached: boolean
    newEndDate: string | null
    note?: string
  },
): ReactivateResult {
  assertClient(input.actorRole)
  assertLifecycle(input.lifecycle, ["open"])
  if (!input.goLiveReached || !isTermEnded(input.endDate, input.now)) {
    throw new DomainError("ILLEGAL_TRANSITION", { from: input.lifecycle, reason: "term_not_ended" })
  }
  assertNewTerm(input)
  return {
    nextLifecycle: "open",
    restartTasks: false,
    endDate: input.newEndDate,
    event: reactivatedEvent(input.note, input.newEndDate, false),
  }
}

/**
 * T11. `terminated` returns to `open` (onboarding is not repeated). `cancelled` returns to
 * `open` and restarts onboarding. A live person whose term ended is renewed in place. A
 * reactivation never yields an already-ended person: when the end date has passed, `newEndDate`
 * is required (`TERM_REQUIRED`) and must be after today and after the start date.
 */
export function clientReactivate(
  input: TermInput & {
    actorRole: UserRole
    lifecycle: CaseLifecycle
    goLiveReached: boolean
    newEndDate?: string | null
    note?: string
  },
): ReactivateResult {
  assertClient(input.actorRole)
  const ended = isTermEnded(input.endDate, input.now)
  if (input.lifecycle === "open") {
    if (!input.goLiveReached || !ended) {
      throw new DomainError("ILLEGAL_TRANSITION", { from: input.lifecycle, reason: "not_inactive" })
    }
    if (input.newEndDate === undefined) throw new DomainError("TERM_REQUIRED", { endDate: input.endDate ?? null })
    return clientRenewTerm({ ...input, newEndDate: input.newEndDate })
  }
  assertLifecycle(input.lifecycle, ["terminated", "cancelled"])
  if (ended && input.newEndDate === undefined) {
    throw new DomainError("TERM_REQUIRED", { endDate: input.endDate ?? null })
  }
  if (input.newEndDate !== undefined) assertNewTerm({ ...input, newEndDate: input.newEndDate })
  const restart = input.lifecycle === "cancelled"
  return {
    nextLifecycle: "open",
    restartTasks: restart,
    ...(input.newEndDate !== undefined ? { endDate: input.newEndDate } : {}),
    event: reactivatedEvent(input.note, input.newEndDate, restart),
  }
}
