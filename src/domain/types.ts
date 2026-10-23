/**
 * Domain enums, branded ids, `DomainError`, and JSON column parsers.
 * Values here are the single source for later schema imports (architecture §3.1).
 * Parsers return `null` on malformed input; callers treat that as "absent".
 */

declare const brand: unique symbol

type Brand<TValue, TName extends string> = TValue & { readonly [brand]: TName }

export type UserId = Brand<string, "UserId">
export type ClientCompanyId = Brand<string, "ClientCompanyId">
export type HireId = Brand<string, "HireId">
export type CaseId = Brand<string, "CaseId">
export type AgreementId = Brand<string, "AgreementId">
export type DocumentId = Brand<string, "DocumentId">

function brandString<TName extends string>(value: string): Brand<string, TName> {
  return value as Brand<string, TName>
}

// Operation inputs stay `string` (spec contracts and text primary keys).
// These constructors are the boundary cast so HireId and UserId are not interchangeable.

export const userId = (value: string): UserId => brandString(value)
export const clientCompanyId = (value: string): ClientCompanyId => brandString(value)
export const hireId = (value: string): HireId => brandString(value)
export const caseId = (value: string): CaseId => brandString(value)
export const agreementId = (value: string): AgreementId => brandString(value)
export const documentId = (value: string): DocumentId => brandString(value)

export const USER_ROLES = ["client_hr", "worker", "eor_ops", "eor_reviewer"] as const
export type UserRole = (typeof USER_ROLES)[number]

export const CASE_STATES = [
  "draft_hire",
  "awaiting_agreement",
  "pending_eor_setup",
  "awaiting_worker",
  "pending_review",
  "changes_requested",
  "work_auth_approved",
  "ready_for_payroll",
] as const
export type CaseState = (typeof CASE_STATES)[number]

export const AGREEMENT_STATUSES = ["draft", "signed"] as const
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number]

export const WAGE_UNITS = ["hourly", "salary"] as const
export type WageUnit = (typeof WAGE_UNITS)[number]

export const BENEFIT_PACKAGES = ["standard", "plus"] as const
export type BenefitPackage = (typeof BENEFIT_PACKAGES)[number]

export const HIRE_STATUSES = ["draft", "submitted", "active", "closed"] as const
export type HireStatus = (typeof HIRE_STATUSES)[number]

export const DOCUMENT_KINDS = ["list_a", "list_b", "list_c", "w4", "other"] as const
export type DocumentKind = (typeof DOCUMENT_KINDS)[number]

export const CASE_EVENT_TYPES = [
  "hire_created",
  "hire_submitted",
  "agreement_signed",
  "released_to_worker",
  "document_uploaded",
  "submitted_for_review",
  "work_auth_rejected",
  "work_auth_approved",
  "case_reopened",
  "ready_for_payroll",
  "ops_note",
] as const
export type CaseEventType = (typeof CASE_EVENT_TYPES)[number]

export const REJECT_REASON_CODES = [
  "DOC_ILLEGIBLE",
  "DOC_EXPIRED",
  "DOC_MISMATCH",
  "WRONG_LIST_COMBO",
  "OTHER",
] as const
export type RejectReasonCode = (typeof REJECT_REASON_CODES)[number]

export type RejectReason =
  | { code: Exclude<RejectReasonCode, "OTHER">; note?: string }
  | { code: "OTHER"; note: string }

export const I9_STATUSES = [
  "citizen",
  "noncitizen_national",
  "lawful_permanent_resident",
  "alien_authorized",
] as const
export type I9Status = (typeof I9_STATUSES)[number]

export type I9Attestation = {
  status: I9Status
  workAuthExpiresOn?: string
  attestedAt: string
}

export const FILING_STATUSES = ["single", "married", "head_of_household"] as const
export type FilingStatus = (typeof FILING_STATUSES)[number]

export const CHECKLIST_STEP_IDS = [
  "personal",
  "i9",
  "w4",
  "bank",
  "benefits_ack",
] as const
export type ChecklistStepId = (typeof CHECKLIST_STEP_IDS)[number]

export type PersonalJson = { legalName: string; phone: string }
export type W4Json = { filingStatus: FilingStatus }
export type BankJson = { last4: string }

export type PolicySnapshotV1 = {
  version: 1
  hireId: string
  capturedAt: string
  roleTitle: string
  workerType: string
  comp: { wageCents: number; wageUnit: WageUnit; stateCode: string }
  wageFloor: { effectiveHourlyCents: number; source: string }
  package: BenefitPackage
  markupPct: number
  eorFeeCents: number
  benefits: { baselineHealth: true; electives: boolean }
  requiredSteps: ["personal", "i9", "w4", "bank", "benefits_ack"]
}

export const DOMAIN_ERROR_CODES = [
  "ILLEGAL_TRANSITION",
  "FORBIDDEN_ROLE",
  "WAGE_BELOW_FLOOR",
  "CHECKLIST_INCOMPLETE",
  "INVALID_LIST_COMBO",
  "INVALID_REJECT_REASON",
  "AGREEMENT_ALREADY_SIGNED",
  "WORKER_ALREADY_ASSIGNED",
] as const
export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number]

export class DomainError extends Error {
  readonly code: DomainErrorCode
  readonly details?: Record<string, unknown>

  constructor(code: DomainErrorCode, details?: Record<string, unknown>) {
    super(code)
    this.name = "DomainError"
    this.code = code
    this.details = details
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export type CaseEvent =
  | { type: "hire_created"; payload: { hireId: string } }
  | { type: "hire_submitted"; payload: { hireId: string; snapshotCapturedAt: string } }
  | { type: "agreement_signed"; payload: { agreementId: string; markupPct: number } }
  | { type: "released_to_worker"; payload: { note?: string } }
  | {
      type: "document_uploaded"
      payload: { documentId: string; kind: DocumentKind; supersededDocumentId?: string }
    }
  | { type: "submitted_for_review"; payload: { submissionNo: number; documentIds: string[] } }
  | {
      type: "work_auth_rejected"
      payload: { submissionNo: number; reason: RejectReason; documentIds: string[] }
    }
  | { type: "work_auth_approved"; payload: { submissionNo: number; documentIds: string[] } }
  | { type: "case_reopened"; payload: { note?: string } }
  | { type: "ready_for_payroll"; payload: Record<string, never> }
  | { type: "ops_note"; payload: { note: string } }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readJson(input: unknown): { ok: true; value: unknown } | { ok: false } {
  if (typeof input !== "string") return { ok: true, value: input }
  try {
    return { ok: true, value: JSON.parse(input) as unknown }
  } catch {
    return { ok: false }
  }
}

function isEnumValue<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function sameRequiredSteps(value: unknown): value is PolicySnapshotV1["requiredSteps"] {
  if (!Array.isArray(value) || value.length !== CHECKLIST_STEP_IDS.length) return false
  return CHECKLIST_STEP_IDS.every((step, index) => value[index] === step)
}

export function parsePersonalJson(input: unknown): PersonalJson | null {
  const parsed = readJson(input)
  if (!parsed.ok || !isRecord(parsed.value)) return null
  if (typeof parsed.value.legalName !== "string" || typeof parsed.value.phone !== "string") {
    return null
  }
  return { legalName: parsed.value.legalName, phone: parsed.value.phone }
}

export function parseW4Json(input: unknown): W4Json | null {
  const parsed = readJson(input)
  if (!parsed.ok || !isRecord(parsed.value)) return null
  if (!isEnumValue(FILING_STATUSES, parsed.value.filingStatus)) return null
  return { filingStatus: parsed.value.filingStatus }
}

export function parseBankJson(input: unknown): BankJson | null {
  const parsed = readJson(input)
  if (!parsed.ok || !isRecord(parsed.value)) return null
  if (typeof parsed.value.last4 !== "string") return null
  return { last4: parsed.value.last4 }
}

/**
 * Narrows stored I-9 JSON to `I9Attestation`.
 * `workAuthExpiresOn` is required when `status` is `alien_authorized`.
 */
export function parseI9Attestation(input: unknown): I9Attestation | null {
  const parsed = readJson(input)
  if (!parsed.ok || !isRecord(parsed.value)) return null
  if (!isEnumValue(I9_STATUSES, parsed.value.status)) return null
  if (!isNonEmptyString(parsed.value.attestedAt)) return null
  if (parsed.value.status === "alien_authorized") {
    if (!isNonEmptyString(parsed.value.workAuthExpiresOn)) return null
    return {
      status: parsed.value.status,
      workAuthExpiresOn: parsed.value.workAuthExpiresOn.trim(),
      attestedAt: parsed.value.attestedAt.trim(),
    }
  }
  const attestation: I9Attestation = {
    status: parsed.value.status,
    attestedAt: parsed.value.attestedAt.trim(),
  }
  if (isNonEmptyString(parsed.value.workAuthExpiresOn)) {
    attestation.workAuthExpiresOn = parsed.value.workAuthExpiresOn.trim()
  }
  return attestation
}

/** Narrows `hire_requests.policy_snapshot_json`. Malformed input returns `null`. */
export function parsePolicySnapshot(input: unknown): PolicySnapshotV1 | null {
  const parsed = readJson(input)
  if (!parsed.ok || !isRecord(parsed.value)) return null
  const value = parsed.value
  if (value.version !== 1) return null
  if (!isNonEmptyString(value.hireId) || !isNonEmptyString(value.capturedAt)) return null
  if (!isNonEmptyString(value.roleTitle) || !isNonEmptyString(value.workerType)) return null
  if (!isEnumValue(BENEFIT_PACKAGES, value.package)) return null
  if (!isFiniteNumber(value.markupPct) || !isFiniteNumber(value.eorFeeCents)) return null
  if (!isRecord(value.comp)) return null
  if (!isFiniteNumber(value.comp.wageCents)) return null
  if (!isEnumValue(WAGE_UNITS, value.comp.wageUnit)) return null
  if (!isNonEmptyString(value.comp.stateCode)) return null
  if (!isRecord(value.wageFloor)) return null
  if (!isFiniteNumber(value.wageFloor.effectiveHourlyCents)) return null
  if (!isNonEmptyString(value.wageFloor.source)) return null
  if (!isRecord(value.benefits) || value.benefits.baselineHealth !== true) return null
  if (typeof value.benefits.electives !== "boolean") return null
  if (!sameRequiredSteps(value.requiredSteps)) return null
  return {
    version: 1,
    hireId: value.hireId.trim(),
    capturedAt: value.capturedAt.trim(),
    roleTitle: value.roleTitle.trim(),
    workerType: value.workerType.trim(),
    comp: {
      wageCents: value.comp.wageCents,
      wageUnit: value.comp.wageUnit,
      stateCode: value.comp.stateCode.trim(),
    },
    wageFloor: {
      effectiveHourlyCents: value.wageFloor.effectiveHourlyCents,
      source: value.wageFloor.source.trim(),
    },
    package: value.package,
    markupPct: value.markupPct,
    eorFeeCents: value.eorFeeCents,
    benefits: { baselineHealth: true, electives: value.benefits.electives },
    requiredSteps: [...CHECKLIST_STEP_IDS],
  }
}
