/**
 * JSON column contracts for persistence (data-model §6).
 *
 * Owns narrowing parsers for stored JSON. Returns null on malformed input so
 * callers treat the step as incomplete instead of throwing.
 *
 * Does not own enum constants (they stay in `src/db/schema.ts` until Issue #20)
 * or domain behavior (checklist, wage, case machine — Issue #24).
 */
export type WageUnit = "hourly" | "salary"
export type BenefitPackage = "standard" | "plus"
export type FilingStatus = "single" | "married" | "head_of_household"
export type I9Status =
  | "citizen"
  | "noncitizen_national"
  | "lawful_permanent_resident"
  | "alien_authorized"

export type PersonalJson = {
  legalName: string
  phone: string
}

export type W4Json = {
  filingStatus: FilingStatus
}

export type BankJson = {
  last4: string
}

export type I9Attestation = {
  status: I9Status
  workAuthExpiresOn?: string
  attestedAt: string
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
  requiredSteps: [
    "personal",
    "i9",
    "w4",
    "bank",
    "benefits_ack",
  ]
}

const FILING_STATUSES: readonly FilingStatus[] = [
  "single",
  "married",
  "head_of_household",
]
const I9_STATUSES: readonly I9Status[] = [
  "citizen",
  "noncitizen_national",
  "lawful_permanent_resident",
  "alien_authorized",
]
const WAGE_UNITS: readonly WageUnit[] = ["hourly", "salary"]
const BENEFIT_PACKAGES: readonly BenefitPackage[] = ["standard", "plus"]
const REQUIRED_STEPS = [
  "personal",
  "i9",
  "w4",
  "bank",
  "benefits_ack",
] as const

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[]
): T | null {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : null
}

/** Personal checklist JSON. Null when either name or phone is missing. */
export function parsePersonalJson(raw: string): PersonalJson | null {
  const record = asRecord(parseJson(raw))
  if (!record) return null
  const legalName = nonEmptyString(record.legalName)
  const phone = nonEmptyString(record.phone)
  if (!legalName || !phone) return null
  return { legalName, phone }
}

/** W-4 filing status. Null unless filingStatus is one of the three literals. */
export function parseW4Json(raw: string): W4Json | null {
  const record = asRecord(parseJson(raw))
  if (!record) return null
  const filingStatus = oneOf(record.filingStatus, FILING_STATUSES)
  if (!filingStatus) return null
  return { filingStatus }
}

/** Bank stub. `last4` must be exactly four digits; full account numbers are rejected. */
export function parseBankJson(raw: string): BankJson | null {
  const record = asRecord(parseJson(raw))
  if (!record) return null
  if (typeof record.last4 !== "string" || !/^\d{4}$/.test(record.last4)) {
    return null
  }
  return { last4: record.last4 }
}

/**
 * I-9 attestation (domain W2).
 * `workAuthExpiresOn` is required only when status is `alien_authorized`.
 */
export function parseI9Attestation(raw: string): I9Attestation | null {
  const record = asRecord(parseJson(raw))
  if (!record) return null
  const status = oneOf(record.status, I9_STATUSES)
  const attestedAt = nonEmptyString(record.attestedAt)
  if (!status || !attestedAt) return null

  const expires = record.workAuthExpiresOn
  if (status === "alien_authorized") {
    const workAuthExpiresOn = nonEmptyString(expires)
    if (!workAuthExpiresOn) return null
    return { status, workAuthExpiresOn, attestedAt }
  }
  if (expires === undefined) return { status, attestedAt }
  const workAuthExpiresOn = nonEmptyString(expires)
  if (!workAuthExpiresOn) return null
  return { status, workAuthExpiresOn, attestedAt }
}

/** Frozen hire terms. Null unless every PolicySnapshotV1 field has the right shape. */
export function parsePolicySnapshot(raw: string): PolicySnapshotV1 | null {
  const record = asRecord(parseJson(raw))
  if (!record || record.version !== 1) return null

  const hireId = nonEmptyString(record.hireId)
  const capturedAt = nonEmptyString(record.capturedAt)
  const roleTitle = nonEmptyString(record.roleTitle)
  const workerType = nonEmptyString(record.workerType)
  const markupPct = integer(record.markupPct)
  const eorFeeCents = integer(record.eorFeeCents)
  const benefitPackage = oneOf(record.package, BENEFIT_PACKAGES)
  if (
    !hireId ||
    !capturedAt ||
    !roleTitle ||
    !workerType ||
    markupPct === null ||
    eorFeeCents === null ||
    !benefitPackage
  ) {
    return null
  }

  const comp = asRecord(record.comp)
  const wageFloor = asRecord(record.wageFloor)
  const benefits = asRecord(record.benefits)
  if (!comp || !wageFloor || !benefits) return null

  const wageCents = integer(comp.wageCents)
  const wageUnit = oneOf(comp.wageUnit, WAGE_UNITS)
  const stateCode = nonEmptyString(comp.stateCode)
  const effectiveHourlyCents = integer(wageFloor.effectiveHourlyCents)
  const source = nonEmptyString(wageFloor.source)
  if (
    wageCents === null ||
    !wageUnit ||
    !stateCode ||
    effectiveHourlyCents === null ||
    !source ||
    benefits.baselineHealth !== true ||
    typeof benefits.electives !== "boolean" ||
    !isRequiredSteps(record.requiredSteps)
  ) {
    return null
  }

  return {
    version: 1,
    hireId,
    capturedAt,
    roleTitle,
    workerType,
    comp: { wageCents, wageUnit, stateCode },
    wageFloor: { effectiveHourlyCents, source },
    package: benefitPackage,
    markupPct,
    eorFeeCents,
    benefits: { baselineHealth: true, electives: benefits.electives },
    requiredSteps: [
      "personal",
      "i9",
      "w4",
      "bank",
      "benefits_ack",
    ],
  }
}

function isRequiredSteps(
  value: unknown
): value is PolicySnapshotV1["requiredSteps"] {
  return (
    Array.isArray(value) &&
    value.length === REQUIRED_STEPS.length &&
    REQUIRED_STEPS.every((step, index) => value[index] === step)
  )
}
