/**
 * Pure onboarding case transitions. Named operations check the actor role before
 * the edge, then the edge, then operation preconditions. `assertTransition` checks
 * the edge first, so an unknown pair is `ILLEGAL_TRANSITION` even for a role that
 * would be wrong on a real edge. T4 (submit for review) follows checklist order C2:
 * role and ownership, state, checklist, then list combination.
 */

import { checklistStatus, isWorkerMutableState, type ChecklistInput } from "./checklist"
import { buildPolicySnapshot, type PolicySnapshotInput } from "./policy-snapshot"
import {
  DomainError,
  type AgreementStatus,
  type CaseEvent,
  type CaseState,
  type DocumentKind,
  type HireStatus,
  type PolicySnapshotV1,
  type UserRole,
} from "./types"
import { assertWageAllowed } from "./wage"
import {
  assertRejectReason,
  isWorkAuthListComboValid,
  selectActiveDocuments,
  type TimestampedDocument,
} from "./work-auth"

export type TransitionResult = {
  nextState: CaseState
  event: CaseEvent
}

const LEGAL_EDGES: readonly {
  from: CaseState
  to: CaseState
  actorRole: UserRole
}[] = [
  { from: "draft_hire", to: "awaiting_agreement", actorRole: "client_hr" },
  { from: "draft_hire", to: "pending_eor_setup", actorRole: "client_hr" },
  { from: "awaiting_agreement", to: "pending_eor_setup", actorRole: "client_hr" },
  { from: "pending_eor_setup", to: "awaiting_worker", actorRole: "eor_ops" },
  { from: "awaiting_worker", to: "pending_review", actorRole: "worker" },
  { from: "pending_review", to: "changes_requested", actorRole: "eor_reviewer" },
  { from: "pending_review", to: "work_auth_approved", actorRole: "eor_reviewer" },
  { from: "changes_requested", to: "awaiting_worker", actorRole: "eor_ops" },
  { from: "changes_requested", to: "pending_review", actorRole: "worker" },
  { from: "work_auth_approved", to: "ready_for_payroll", actorRole: "eor_ops" },
]

function assertActorRole(actorRole: UserRole, allowedRole: UserRole): void {
  if (actorRole !== allowedRole) {
    throw new DomainError("FORBIDDEN_ROLE", { actorRole, allowedRole })
  }
}

/**
 * Several operations share a destination and actor (`pending_eor_setup` for T1b/T2,
 * `awaiting_worker` for T3/T7). `assertTransition` accepts any legal edge, so the
 * named operation also pins the source state before it asks the matrix.
 */
function assertSourceState(from: CaseState, allowed: readonly CaseState[]): void {
  if (!allowed.includes(from)) {
    throw new DomainError("ILLEGAL_TRANSITION", { from, allowedFrom: [...allowed] })
  }
}

function optionalNote(note: string | undefined): { note?: string } {
  if (note === undefined) return {}
  const trimmed = note.trim()
  if (trimmed === "") return {}
  return { note: trimmed }
}

function assertLatestSubmission(submissionNo: number, latestSubmissionNo: number): void {
  if (
    !Number.isInteger(submissionNo) ||
    !Number.isInteger(latestSubmissionNo) ||
    submissionNo < 1 ||
    submissionNo !== latestSubmissionNo
  ) {
    throw new DomainError("ILLEGAL_TRANSITION", { submissionNo, latestSubmissionNo })
  }
}

/**
 * Unknown edges throw `ILLEGAL_TRANSITION` before the role is considered.
 * A known edge with the wrong actor throws `FORBIDDEN_ROLE`.
 * Self-transitions and skips are unknown edges.
 */
export function assertTransition(input: {
  from: CaseState
  to: CaseState
  actorRole: UserRole
}): void {
  const edge = LEGAL_EDGES.find(
    (candidate) => candidate.from === input.from && candidate.to === input.to,
  )
  if (!edge) {
    throw new DomainError("ILLEGAL_TRANSITION", {
      from: input.from,
      to: input.to,
      actorRole: input.actorRole,
    })
  }
  if (edge.actorRole !== input.actorRole) {
    throw new DomainError("FORBIDDEN_ROLE", {
      from: input.from,
      to: input.to,
      actorRole: input.actorRole,
      allowedRole: edge.actorRole,
    })
  }
}

/**
 * `closed` is a stored hire status and is unused in the demo.
 * `draft_hire` → `draft`; `ready_for_payroll` → `active`; every other case state → `submitted`.
 */
export function deriveHireStatus(state: CaseState): HireStatus {
  if (state === "draft_hire") return "draft"
  if (state === "ready_for_payroll") return "active"
  return "submitted"
}

/**
 * Preconditions: actor is `client_hr`. The worker's role is `worker`, they share the
 * actor's client company, and `hasCase` is false. Any other worker target throws
 * `WORKER_ALREADY_ASSIGNED` (one worker, at most one case).
 * Postcondition: state is `draft_hire` and the event is `hire_created`.
 */
export function createHire(input: {
  actorRole: UserRole
  hireId: string
  actorClientCompanyId: string
  worker: {
    role: UserRole
    clientCompanyId: string | null
    hasCase: boolean
  }
}): TransitionResult {
  assertActorRole(input.actorRole, "client_hr")
  const sameClient =
    input.worker.clientCompanyId !== null &&
    input.worker.clientCompanyId === input.actorClientCompanyId
  if (input.worker.role !== "worker" || !sameClient || input.worker.hasCase) {
    throw new DomainError("WORKER_ALREADY_ASSIGNED", {
      workerRole: input.worker.role,
      sameClient,
      hasCase: input.worker.hasCase,
    })
  }
  return {
    nextState: "draft_hire",
    event: { type: "hire_created", payload: { hireId: input.hireId } },
  }
}

/**
 * T1a/T1b. Role, wage floor, then "snapshot not yet set", then the edge.
 * A draft agreement targets `awaiting_agreement`; a signed agreement targets
 * `pending_eor_setup`. Both emit `hire_submitted` and a frozen snapshot.
 */
export function submitHire(
  input: {
    actorRole: UserRole
    from: CaseState
    hireId: string
    agreementStatus: AgreementStatus
    snapshotAlreadySet: boolean
    now: Date
  } & PolicySnapshotInput,
): TransitionResult & { snapshot: PolicySnapshotV1 } {
  assertActorRole(input.actorRole, "client_hr")
  assertWageAllowed({
    wageCents: input.wageCents,
    wageUnit: input.wageUnit,
    stateCode: input.stateCode,
  })
  if (input.snapshotAlreadySet) {
    throw new DomainError("ILLEGAL_TRANSITION", { reason: "snapshot_already_set" })
  }
  assertSourceState(input.from, ["draft_hire"])
  const nextState: CaseState =
    input.agreementStatus === "signed" ? "pending_eor_setup" : "awaiting_agreement"
  assertTransition({ from: input.from, to: nextState, actorRole: input.actorRole })
  const snapshot = buildPolicySnapshot(input, input.now)
  return {
    nextState,
    snapshot,
    event: {
      type: "hire_submitted",
      payload: { hireId: input.hireId, snapshotCapturedAt: snapshot.capturedAt },
    },
  }
}

export type SignAgreementResult = {
  agreementStatus: "signed"
  signedAt: string
  transitions: Array<TransitionResult & { caseId: string }>
}

/**
 * T2. Role, then agreement must still be `draft` (`AGREEMENT_ALREADY_SIGNED` emits nothing).
 * Each supplied case must sit in `awaiting_agreement`; an empty list still signs the agreement.
 * One `agreement_signed` event is returned per case.
 */
export function signAgreement(input: {
  actorRole: UserRole
  now: Date
  agreement: { id: string; status: AgreementStatus; markupPct: number }
  cases: readonly { caseId: string; from: CaseState }[]
}): SignAgreementResult {
  assertActorRole(input.actorRole, "client_hr")
  if (input.agreement.status !== "draft") {
    throw new DomainError("AGREEMENT_ALREADY_SIGNED", { agreementId: input.agreement.id })
  }
  const transitions = input.cases.map((caseRow) => {
    assertSourceState(caseRow.from, ["awaiting_agreement"])
    assertTransition({
      from: caseRow.from,
      to: "pending_eor_setup",
      actorRole: input.actorRole,
    })
    return {
      caseId: caseRow.caseId,
      nextState: "pending_eor_setup" as const,
      event: {
        type: "agreement_signed" as const,
        payload: {
          agreementId: input.agreement.id,
          markupPct: input.agreement.markupPct,
        },
      },
    }
  })
  return {
    agreementStatus: "signed",
    signedAt: input.now.toISOString(),
    transitions,
  }
}

/** T3. `eor_ops` releases `pending_eor_setup` to the worker. */
export function opsReleaseToWorker(input: {
  actorRole: UserRole
  from: CaseState
  note?: string
}): TransitionResult {
  assertActorRole(input.actorRole, "eor_ops")
  assertSourceState(input.from, ["pending_eor_setup"])
  assertTransition({
    from: input.from,
    to: "awaiting_worker",
    actorRole: input.actorRole,
  })
  return {
    nextState: "awaiting_worker",
    event: { type: "released_to_worker", payload: optionalNote(input.note) },
  }
}

/**
 * T4. Order is fixed: ownership (`FORBIDDEN_ROLE`), edge (`ILLEGAL_TRANSITION`),
 * checklist (`CHECKLIST_INCOMPLETE`, details `missing`), then active list combo
 * (`INVALID_LIST_COMBO`). `submissionNo` is `previousSubmissionNo + 1` (first submit passes 0).
 * Superseded documents are dropped before the combo check.
 */
export function workerSubmitForReview(input: {
  actorRole: UserRole
  actorUserId: string
  caseWorkerUserId: string
  from: CaseState
  checklist: ChecklistInput
  documents: readonly TimestampedDocument[]
  previousSubmissionNo: number
}): TransitionResult {
  if (input.actorRole !== "worker" || input.actorUserId !== input.caseWorkerUserId) {
    throw new DomainError("FORBIDDEN_ROLE", {
      actorRole: input.actorRole,
      actorUserId: input.actorUserId,
      caseWorkerUserId: input.caseWorkerUserId,
    })
  }
  assertTransition({
    from: input.from,
    to: "pending_review",
    actorRole: input.actorRole,
  })
  const status = checklistStatus(input.checklist)
  if (!status.complete) {
    throw new DomainError("CHECKLIST_INCOMPLETE", { missing: status.missing })
  }
  const active = selectActiveDocuments(input.documents)
  const kinds = active.map((document) => document.kind)
  if (!isWorkAuthListComboValid(kinds)) {
    throw new DomainError("INVALID_LIST_COMBO", { kinds })
  }
  if (!Number.isInteger(input.previousSubmissionNo) || input.previousSubmissionNo < 0) {
    throw new DomainError("ILLEGAL_TRANSITION", {
      previousSubmissionNo: input.previousSubmissionNo,
    })
  }
  return {
    nextState: "pending_review",
    event: {
      type: "submitted_for_review",
      payload: {
        submissionNo: input.previousSubmissionNo + 1,
        documentIds: active.map((document) => document.id),
      },
    },
  }
}

/**
 * T5. Role then edge, then `RejectReason`, then the decision must name the latest
 * `submissionNo` (a stale decision is `ILLEGAL_TRANSITION`).
 */
export function reviewerReject(input: {
  actorRole: UserRole
  from: CaseState
  submissionNo: number
  latestSubmissionNo: number
  reason: unknown
  documentIds: readonly string[]
}): TransitionResult {
  assertActorRole(input.actorRole, "eor_reviewer")
  assertTransition({
    from: input.from,
    to: "changes_requested",
    actorRole: input.actorRole,
  })
  const reason = assertRejectReason(input.reason)
  assertLatestSubmission(input.submissionNo, input.latestSubmissionNo)
  return {
    nextState: "changes_requested",
    event: {
      type: "work_auth_rejected",
      payload: {
        submissionNo: input.submissionNo,
        reason,
        documentIds: [...input.documentIds],
      },
    },
  }
}

/**
 * T6. Role then edge, then the active set must satisfy W1, then the decision must
 * name the latest `submissionNo`.
 */
export function reviewerApprove(input: {
  actorRole: UserRole
  from: CaseState
  submissionNo: number
  latestSubmissionNo: number
  documents: readonly TimestampedDocument[]
}): TransitionResult {
  assertActorRole(input.actorRole, "eor_reviewer")
  assertTransition({
    from: input.from,
    to: "work_auth_approved",
    actorRole: input.actorRole,
  })
  const active = selectActiveDocuments(input.documents)
  const kinds = active.map((document) => document.kind)
  if (!isWorkAuthListComboValid(kinds)) {
    throw new DomainError("INVALID_LIST_COMBO", { kinds })
  }
  assertLatestSubmission(input.submissionNo, input.latestSubmissionNo)
  return {
    nextState: "work_auth_approved",
    event: {
      type: "work_auth_approved",
      payload: {
        submissionNo: input.submissionNo,
        documentIds: active.map((document) => document.id),
      },
    },
  }
}

/** T7. `eor_ops` sends `changes_requested` back to `awaiting_worker`. */
export function opsReopen(input: {
  actorRole: UserRole
  from: CaseState
  note?: string
}): TransitionResult {
  assertActorRole(input.actorRole, "eor_ops")
  assertSourceState(input.from, ["changes_requested"])
  assertTransition({
    from: input.from,
    to: "awaiting_worker",
    actorRole: input.actorRole,
  })
  return {
    nextState: "awaiting_worker",
    event: { type: "case_reopened", payload: optionalNote(input.note) },
  }
}

/** T8. Terminal edge into `ready_for_payroll`. No further transition exists. */
export function opsMarkReadyForPayroll(input: {
  actorRole: UserRole
  from: CaseState
}): TransitionResult {
  assertActorRole(input.actorRole, "eor_ops")
  assertTransition({
    from: input.from,
    to: "ready_for_payroll",
    actorRole: input.actorRole,
  })
  return {
    nextState: "ready_for_payroll",
    event: { type: "ready_for_payroll", payload: {} },
  }
}

/**
 * Does not change state. Actor must be the case's worker, and the case must be
 * `awaiting_worker` or `changes_requested` (W6).
 */
export function uploadDocument(input: {
  actorRole: UserRole
  actorUserId: string
  caseWorkerUserId: string
  from: CaseState
  documentId: string
  kind: DocumentKind
  supersededDocumentId?: string
}): TransitionResult {
  if (input.actorRole !== "worker" || input.actorUserId !== input.caseWorkerUserId) {
    throw new DomainError("FORBIDDEN_ROLE", {
      actorRole: input.actorRole,
      actorUserId: input.actorUserId,
      caseWorkerUserId: input.caseWorkerUserId,
    })
  }
  if (!isWorkerMutableState(input.from)) {
    throw new DomainError("ILLEGAL_TRANSITION", { from: input.from })
  }
  return {
    nextState: input.from,
    event: {
      type: "document_uploaded",
      payload: {
        documentId: input.documentId,
        kind: input.kind,
        ...(input.supersededDocumentId !== undefined
          ? { supersededDocumentId: input.supersededDocumentId }
          : {}),
      },
    },
  }
}

/** Does not change state. Actor must be `eor_ops`. Blank notes are not a domain error code. */
export function addOpsNote(input: {
  actorRole: UserRole
  from: CaseState
  note: string
}): TransitionResult {
  assertActorRole(input.actorRole, "eor_ops")
  return {
    nextState: input.from,
    event: { type: "ops_note", payload: { note: input.note } },
  }
}
