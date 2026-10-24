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

export const USER_ROLES = ["client_hr", "onboarding_specialist", "finance", "worker"] as const
export type UserRole = (typeof USER_ROLES)[number]

/**
 * The explicit case lifecycle. Onboarding progress is not a state: it is derived from the case's
 * tasks (tasks-and-workflow.md §8).
 */
export const CASE_LIFECYCLES = ["open", "cancelled", "terminated"] as const
export type CaseLifecycle = (typeof CASE_LIFECYCLES)[number]

export const AGREEMENT_STATUSES = ["draft", "signed"] as const
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number]

export const WAGE_UNITS = ["hourly", "monthly", "annual"] as const
export type WageUnit = (typeof WAGE_UNITS)[number]

export const BENEFIT_PACKAGES = ["standard", "premium"] as const
export type BenefitPackage = (typeof BENEFIT_PACKAGES)[number]

export const DOCUMENT_KINDS = ["list_a", "list_b", "list_c", "w4", "other"] as const
export type DocumentKind = (typeof DOCUMENT_KINDS)[number]

export const CASE_EVENT_TYPES = [
  "order_created",
  "agreement_signed",
  "task_completed",
  "task_rejected",
  "task_reopened",
  "document_uploaded",
  "benefit_election_changed",
  "ops_note",
  "request_cancelled",
  "terminated",
  "reactivated",
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

export type PersonalJson = { legalName: string; phone: string }
export type W4Json = { filingStatus: FilingStatus }
export type BankJson = { last4: string }

export const QUOTE_LINE_CODES = [
  "WAGE",
  "SOCIAL_SECURITY",
  "MEDICARE",
  "FUTA",
  "SUTA",
  "WORKERS_COMP",
  "SERVICE_FEE",
  "HEALTHCARE",
  "RETIREMENT",
] as const
export type QuoteLineCode = (typeof QUOTE_LINE_CODES)[number]

export const QUOTE_LINE_GROUPS = ["wage", "statutory", "service_fee", "benefits"] as const
export type QuoteLineGroup = (typeof QUOTE_LINE_GROUPS)[number]

export type QuoteLine = {
  code: QuoteLineCode
  group: QuoteLineGroup
  label: string
  /** Short human-readable basis, e.g. "6.2% up to $184,500". */
  basis: string
  annualCents: number
  /** `annualCents / 12`, rounded. */
  monthlyCents: number
}

export type QuoteAmount = { annualCents: number; monthlyCents: number }

export type QuoteTerm = {
  /** First and last day of the term, ISO `YYYY-MM-DD` (the last day is inclusive). */
  startDate: string
  endDate: string
  /** Wage + statutory + service fee over the whole term. */
  committedCents: number
  /** Committed plus healthcare and retirement over the whole term. */
  withBenefitsCents: number
}

/**
 * Employer cost estimate for one hire. Wage, statutory and service-fee lines make up the
 * committed cost; benefit lines apply only if the worker enrolls.
 */
export type Quote = {
  rateSetId: string
  package: BenefitPackage
  markupPct: number
  lines: QuoteLine[]
  /**
   * Present for a fixed term. Line and total cents are then annualised rates over the term, so
   * per-hour/month/year display still works; these are the absolute dollars for the term.
   * Absent for an indefinite term (and on older snapshots): the figures are a full year.
   */
  term?: QuoteTerm
  totals: {
    statutory: QuoteAmount
    /** Wage + statutory + service fee. */
    committed: QuoteAmount
    /** Healthcare + retirement if the worker enrolls. */
    benefits: QuoteAmount
    withBenefits: QuoteAmount
  }
}

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
  /** Fixed-term end date (inclusive), or null for an indefinite hire. Absent on older snapshots. */
  endDate?: string | null
  /** Absent on snapshots frozen before quotes existed. */
  quote?: Quote
}

export const DOMAIN_ERROR_CODES = [
  "ILLEGAL_TRANSITION",
  "FORBIDDEN_ROLE",
  "WAGE_BELOW_FLOOR",
  "INVALID_LIST_COMBO",
  "INVALID_REJECT_REASON",
  "AGREEMENT_ALREADY_SIGNED",
  "WORKER_ALREADY_ASSIGNED",
  "ROLE_NAME_TAKEN",
  "EMAIL_TAKEN",
  "START_DATE_TOO_SOON",
  "END_DATE_BEFORE_START",
  "END_DATE_NOT_FUTURE",
  "LAST_DAY_AFTER_END_DATE",
  "TERM_REQUIRED",
  "CASE_NOT_OPEN",
  "TASK_NOT_FOUND",
  "TASK_NOT_READY",
  "TASK_NOT_REJECTABLE",
  "INVALID_TASK_PAYLOAD",
  "INVALID_WORKFLOW_TEMPLATE",
  "INVALID_PAYMENT_SELECTION",
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
  | { type: "order_created"; payload: { hireId: string; snapshotCapturedAt: string } }
  | { type: "agreement_signed"; payload: { agreementId: string; markupPct: number } }
  | {
      type: "task_completed"
      payload: {
        taskId: string
        key: string
        label: string
        party: string
        /** The handler result: never contains sensitive data. */
        result?: Record<string, unknown>
      }
    }
  | {
      type: "task_rejected"
      payload: {
        taskId: string
        key: string
        label: string
        reason: RejectReason
        spawnedTaskIds: string[]
      }
    }
  | {
      type: "task_reopened"
      payload: {
        /** The new instance. */
        taskId: string
        reopenedTaskId: string
        key: string
        label: string
        note: string
      }
    }
  | {
      type: "document_uploaded"
      payload: { documentId: string; kind: DocumentKind; supersededDocumentId?: string; supersededDocumentIds?: string[] }
    }
  | {
      type: "benefit_election_changed"
      payload: {
        version: number
        /** First day of the pay period the change applies from. */
        effectiveFrom: string
        payDate: string
        previousDeferralPct: number
        retirementDeferralPct: number
      }
    }
  | { type: "ops_note"; payload: { note: string } }
  | { type: "request_cancelled"; payload: { note?: string } }
  | { type: "terminated"; payload: { effectiveOn: string; note?: string } }
  | { type: "reactivated"; payload: { note?: string; endDate?: string | null; restarted?: boolean } }

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

function parseAmount(value: unknown): QuoteAmount | null {
  if (!isRecord(value)) return null
  if (!isFiniteNumber(value.annualCents) || !isFiniteNumber(value.monthlyCents)) return null
  return { annualCents: value.annualCents, monthlyCents: value.monthlyCents }
}

function parseQuoteTerm(value: unknown): QuoteTerm | null {
  if (!isRecord(value)) return null
  if (!isNonEmptyString(value.startDate) || !isNonEmptyString(value.endDate)) return null
  if (!isFiniteNumber(value.committedCents) || !isFiniteNumber(value.withBenefitsCents)) return null
  return {
    startDate: value.startDate.trim(),
    endDate: value.endDate.trim(),
    committedCents: value.committedCents,
    withBenefitsCents: value.withBenefitsCents,
  }
}

function parseQuote(value: unknown): Quote | null {
  if (!isRecord(value)) return null
  if (!isNonEmptyString(value.rateSetId) || !isEnumValue(BENEFIT_PACKAGES, value.package)) return null
  if (!isFiniteNumber(value.markupPct) || !Array.isArray(value.lines) || !isRecord(value.totals)) return null
  const lines: QuoteLine[] = []
  for (const line of value.lines) {
    if (!isRecord(line)) return null
    if (!isEnumValue(QUOTE_LINE_CODES, line.code) || !isEnumValue(QUOTE_LINE_GROUPS, line.group)) return null
    if (!isNonEmptyString(line.label) || typeof line.basis !== "string") return null
    if (!isFiniteNumber(line.annualCents) || !isFiniteNumber(line.monthlyCents)) return null
    lines.push({
      code: line.code,
      group: line.group,
      label: line.label,
      basis: line.basis,
      annualCents: line.annualCents,
      monthlyCents: line.monthlyCents,
    })
  }
  const statutory = parseAmount(value.totals.statutory)
  const committed = parseAmount(value.totals.committed)
  const benefits = parseAmount(value.totals.benefits)
  const withBenefits = parseAmount(value.totals.withBenefits)
  if (!statutory || !committed || !benefits || !withBenefits) return null
  const term = parseQuoteTerm(value.term)
  return {
    rateSetId: value.rateSetId,
    package: value.package,
    markupPct: value.markupPct,
    lines,
    ...(term ? { term } : {}),
    totals: { statutory, committed, benefits, withBenefits },
  }
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
  let quote: Quote | undefined
  if (value.quote !== undefined) {
    const parsedQuote = parseQuote(value.quote)
    if (!parsedQuote) return null
    quote = parsedQuote
  }
  let endDate: string | null | undefined
  if (isNonEmptyString(value.endDate)) endDate = value.endDate.trim()
  else if (value.endDate === null) endDate = null
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
    ...(endDate !== undefined ? { endDate } : {}),
    ...(quote ? { quote } : {}),
  }
}
