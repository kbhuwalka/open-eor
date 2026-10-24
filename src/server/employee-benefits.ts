/**
 * The employee's Benefits page (employee-portal.md §7): what they have elected, what a 401(k)
 * change costs per paycheck, and the one change they can make themselves, the 401(k) contribution.
 * Everything is scoped to the session user's own case (acl I3). A change is recorded as a new
 * election version that applies from the next pay period that has not started, so invoices and pay
 * slips already issued are never rewritten (billing-and-invoicing.md §13).
 */
import { asc, eq } from "drizzle-orm"

import type { AppDatabase } from "@/db/client"
import { benefitElectionVersions } from "@/db/schema"
import {
  DECLINED_ELECTIONS,
  electionInForce,
  latestElection,
  payPeriodContaining,
  type ElectionVersion,
} from "@/domain/billing"
import { HEALTH_TIER_LABELS, US_2026, type HealthTier } from "@/domain/cost-rates"
import { businessDayOf } from "@/domain/business-time"
import { DomainError, type BenefitPackage, type WageUnit } from "@/domain/types"
import {
  RETIREMENT_DEFERRAL_MAX_PCT,
  benefitEstimate,
  grossPerPeriodCents,
  healthTierOptions,
  retirementRule,
} from "@/lib/employee-benefits"
import { EMPLOYEE_TASK_HREF } from "@/lib/employee-view"

import { insertCaseEvent } from "./case-engine"
import { loadElectionHistory, nextElectionPeriodFor, recordBenefitElection } from "./billing-core"
import { NotFoundError, type CaseServiceDeps } from "./deps"
import { loadEmployeeCase, type EmployeeCase } from "./employee-portal"
import { EmployeeInputError, normalizeBenefitChoice, type EmployeeActor } from "./employee-tasks"

export type BenefitPeriodView = { index: number; start: string; end: string; payDate: string }

export type BenefitHistoryEntry = {
  version: number
  /** `in_force`: applies to the pay period in progress; `pending`: starts later; `superseded`: replaced by a later version for every period. */
  status: "in_force" | "pending" | "superseded"
  decidedAt: string
  decidedBy: string
  source: "onboarding" | "employee_change"
  healthLabel: string | null
  retirementDeferralPct: number
  /** `null`: from the start of employment. */
  effectiveFrom: string | null
}

export type BenefitsPageData = {
  employerName: string
  package: BenefitPackage
  packageLabel: string
  /** The `benefits_decision` task href while the employee has not made the initial election. */
  decisionHref: string | null
  /** The initial election exists. */
  elected: boolean
  health: {
    tier: HealthTier
    label: string
    employeeCents: number
    employerCents: number
    totalCents: number
  } | null
  retirement: {
    /** Percent in force for the pay period in progress. */
    currentPct: number
    pending: { pct: number; effectiveFrom: string; period: BenefitPeriodView } | null
    matchRatePct: number
    matchCapPct: number
    defaultPct: number
    maxPct: number
    annualLimitCents: number
    compensationLimitCents: number
    grossPerPeriodCents: number
    wageCents: number
    wageUnit: WageUnit
    currentPeriod: BenefitPeriodView
    /** Every recorded version's percent, oldest first, for projecting a year as it would be billed. */
    schedule: { version: number; effectiveFrom: string | null; deferralPct: number }[]
    startDate: string
    perPaycheck: { deferralCents: number; matchCents: number }
  }
  /** Where a change made now applies; `allowed` is false with a reason when it cannot be made. */
  change: { allowed: boolean; reason: string | null; period: BenefitPeriodView | null; taxYear: number | null }
  history: BenefitHistoryEntry[]
}

const periodView = (period: BenefitPeriodView): BenefitPeriodView => ({
  index: period.index,
  start: period.start,
  end: period.end,
  payDate: period.payDate,
})

function stateOf(version: ElectionVersion | null) {
  return version ?? { ...DECLINED_ELECTIONS, version: 0, effectiveFrom: null }
}

function percentOf(version: ElectionVersion | null): number {
  const state = stateOf(version)
  return state.enrolled ? (state.retirementDeferralPct ?? 0) : 0
}

function changeAvailability(
  db: AppDatabase,
  employee: EmployeeCase,
  elected: boolean,
  now: Date,
): BenefitsPageData["change"] {
  if (!elected) return { allowed: false, reason: "Make your first benefits choice before changing your contribution.", period: null, taxYear: null }
  if (employee.lifecycle !== "open") {
    return { allowed: false, reason: "Your employment has ended, so your contribution can no longer be changed.", period: null, taxYear: null }
  }
  const period = nextElectionPeriodFor(db, employee.hireId, now)
  if (!period) {
    return { allowed: false, reason: "Your employment ends before the next pay period starts, so a change would not take effect.", period: null, taxYear: null }
  }
  return { allowed: true, reason: null, period: periodView(period), taxYear: period.taxYear }
}

/** The Benefits page of the signed-in employee, or null when they have no employment. */
export function loadBenefitsPage(db: AppDatabase, userId: string, now: Date = new Date()): BenefitsPageData | null {
  const employee = loadEmployeeCase(db, userId, now)
  if (!employee) return null
  const { order } = employee
  const pkg = order.benefitPackage
  const rule = retirementRule(pkg)
  const history = loadElectionHistory(db, employee.caseId)
  const currentPeriod = payPeriodContaining(businessDayOf(now))
  const inForce = electionInForce(history, currentPeriod.start)
  const latest = latestElection(history)
  const elected = history.length > 0

  const tier = inForce?.enrolled ? inForce.healthTier : null
  const option = tier ? healthTierOptions(pkg).find((candidate) => candidate.tier === tier) : undefined
  const currentPct = percentOf(inForce)
  const gross = grossPerPeriodCents(order.wageCents, order.wageUnit)
  const estimate = benefitEstimate({ package: pkg, tier: null, deferralPct: currentPct, grossCents: gross })

  const pendingVersion = latest && latest.effectiveFrom !== null && latest.effectiveFrom > currentPeriod.start ? latest : null
  const pending = pendingVersion
    ? {
        pct: percentOf(pendingVersion),
        effectiveFrom: pendingVersion.effectiveFrom as string,
        period: periodView(payPeriodContaining(pendingVersion.effectiveFrom as string)),
      }
    : null

  const decidedAt = new Map(
    db
      .select({ version: benefitElectionVersions.version, decidedAt: benefitElectionVersions.decidedAt, by: benefitElectionVersions.decidedByUserId, source: benefitElectionVersions.source })
      .from(benefitElectionVersions)
      .where(eq(benefitElectionVersions.caseId, employee.caseId))
      .orderBy(asc(benefitElectionVersions.version))
      .all()
      .map((row) => [row.version, row]),
  )
  const entries: BenefitHistoryEntry[] = history.map((version) => {
    const meta = decidedAt.get(version.version)!
    const replaced = history.some(
      (later) => later.version > version.version && (later.effectiveFrom === null || (version.effectiveFrom !== null && later.effectiveFrom <= version.effectiveFrom)),
    )
    const status: BenefitHistoryEntry["status"] =
      inForce?.version === version.version
        ? "in_force"
        : version.effectiveFrom !== null && version.effectiveFrom > currentPeriod.start && !replaced
          ? "pending"
          : "superseded"
    return {
      version: version.version,
      status,
      decidedAt: meta.decidedAt.toISOString(),
      decidedBy: meta.by === userId ? "You" : "Northwind",
      source: meta.source,
      healthLabel: version.enrolled && version.healthTier ? HEALTH_TIER_LABELS[version.healthTier] : null,
      retirementDeferralPct: percentOf(version),
      effectiveFrom: version.effectiveFrom,
    }
  })

  const decision = employee.tasks.find((task) => task.type === "benefits_decision" && task.actors.includes("worker"))
  return {
    employerName: order.employerName,
    package: pkg,
    packageLabel: US_2026.packages[pkg].label,
    decisionHref: !elected && decision ? EMPLOYEE_TASK_HREF(decision.id) : null,
    elected,
    health: option
      ? { tier: option.tier, label: option.label, employeeCents: option.employeeCents, employerCents: option.employerCents, totalCents: option.totalCents }
      : null,
    retirement: {
      currentPct,
      pending,
      matchRatePct: rule.matchRatePct,
      matchCapPct: rule.matchCapPct,
      defaultPct: rule.defaultPct,
      maxPct: RETIREMENT_DEFERRAL_MAX_PCT,
      annualLimitCents: US_2026.retirement401k.annualElectiveDeferralLimitCents,
      compensationLimitCents: US_2026.retirement401k.annualCompensationLimitCents,
      grossPerPeriodCents: gross,
      wageCents: order.wageCents,
      wageUnit: order.wageUnit,
      currentPeriod: periodView(currentPeriod),
      schedule: history.map((version) => ({ version: version.version, effectiveFrom: version.effectiveFrom, deferralPct: percentOf(version) })),
      startDate: order.startDate,
      perPaycheck: { deferralCents: estimate.retirementCents, matchCents: estimate.matchCents },
    },
    change: changeAvailability(db, employee, elected, now),
    history: entries.reverse(),
  }
}

export type RetirementChange = {
  /** False when the request equals the latest election: nothing was recorded. */
  changed: boolean
  deferralPct: number
  previousPct: number
  period: BenefitPeriodView
}

/**
 * Changes the 401(k) contribution of the signed-in employee from the next pay period that has not
 * started. Records a new election version (the health tier carries over), writes the audit event in
 * the same transaction and returns what was decided. Repeating the same request records nothing.
 */
export function changeRetirementElection(
  deps: CaseServiceDeps,
  user: EmployeeActor,
  input: { deferralPct: unknown },
): RetirementChange {
  if (user.role !== "worker") throw new DomainError("FORBIDDEN_ROLE", { actorRole: user.role })
  const employee = loadEmployeeCase(deps.db, user.id, deps.now())
  if (!employee) throw new NotFoundError("Employment")

  const pct = input.deferralPct
  if (typeof pct !== "number" || !Number.isFinite(pct)) {
    throw new EmployeeInputError("Enter your 401(k) contribution as a whole percent.", { deferralPct: "Enter a whole percent." })
  }
  if (!Number.isInteger(pct) || pct < 0 || pct > RETIREMENT_DEFERRAL_MAX_PCT) {
    const message = `Choose a contribution between 0% and ${RETIREMENT_DEFERRAL_MAX_PCT}% of each paycheck.`
    throw new EmployeeInputError(message, { deferralPct: message })
  }

  return deps.db.transaction((tx) => {
    const history = loadElectionHistory(tx, employee.caseId)
    const latest = latestElection(history)
    if (!latest) throw new EmployeeInputError("Make your first benefits choice before changing your contribution.")
    if (employee.lifecycle !== "open") {
      throw new EmployeeInputError("Your employment has ended, so your contribution can no longer be changed.")
    }
    const now = deps.now()
    const period = nextElectionPeriodFor(tx, employee.hireId, now)
    if (!period) {
      throw new EmployeeInputError("Your employment ends before the next pay period starts, so a change would not take effect.")
    }
    const view = periodView(period)
    const previousPct = percentOf(latest)
    if (previousPct === pct) return { changed: false, deferralPct: pct, previousPct, period: view }

    const choice = normalizeBenefitChoice({ healthTier: latest.enrolled ? latest.healthTier : null, retirementDeferralPct: pct })
    const recorded = recordBenefitElection(tx, {
      caseId: employee.caseId,
      hireId: employee.hireId,
      enrolled: choice.enrolled,
      healthTier: choice.enrolled ? choice.healthTier : null,
      retirementDeferralPct: choice.enrolled ? choice.retirementDeferralPct : null,
      effectiveFrom: period.start,
      source: "employee_change",
      actorUserId: user.id,
      now,
    })
    insertCaseEvent(tx, deps, employee.caseId, user.id, "benefit_election_changed", {
      version: recorded.version,
      effectiveFrom: period.start,
      payDate: period.payDate,
      previousDeferralPct: previousPct,
      retirementDeferralPct: pct,
    })
    return { changed: true, deferralPct: pct, previousPct, period: view }
  })
}
