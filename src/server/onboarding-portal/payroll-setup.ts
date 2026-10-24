/**
 * The "Set up payroll" task's data (onboarding-portal.md §4): the pre-flight checklist derived from
 * the case's real tasks and stored forms, the payroll profile, and an estimated first paycheck from
 * `computeWithholding` with the employee's own W-4. Completing goes through the shared task action
 * (the engine refuses until every dependency is resolved); this read model says why, in words.
 */
import { eq } from "drizzle-orm"

import type { AppDatabase } from "@/db/client"
import { benefitElections } from "@/db/schema"
import { HEALTH_TIER_LABELS, type HealthTier } from "@/domain/cost-rates"
import {
  DEFAULT_PAY_CALENDAR,
  daysEmployedInPeriod,
  payPeriodContaining,
  periodsForTaxYear,
  scheduledGrossCents,
  type PayPeriod,
} from "@/domain/billing/pay-calendar"
import { DEFAULT_W4, computeWithholding, w4InputsFromForm, type W4FormLike } from "@/domain/payroll"
import { annualizeWageCents } from "@/domain/quote"
import { benefitEstimate, grossPerPeriodCents } from "@/lib/employee-benefits"
import { formatCents } from "@/lib/format"
import { payrollBlockers, preflightItems, type PreflightItem } from "@/lib/onboarding-portal/preflight"

import { tasksForCase } from "../tasks"

import { depositViewFor } from "./order-review"
import { latestForm, loadStaffTask, type CaseBasics, type StaffViewer } from "./core"

export type EstimateLine = { label: string; cents: number }

export type PayrollEstimate = {
  grossCents: number
  taxes: EstimateLine[]
  preTax: EstimateLine[]
  netCents: number
  /** `w4` when it uses the employee's W-4, `default` when none is on file yet. */
  withholdingBasis: "w4" | "default"
  /** Fewer than 14 days of the first period are worked: the gross is prorated. */
  prorated: boolean
}

export type PayrollSetupData = {
  taskId: string
  caseId: string
  canAct: boolean
  done: boolean
  /** The task is ready and the viewer may act (what the form needs besides the pre-flight). */
  preflight: PreflightItem[]
  /** Why "Create payroll" is disabled, one sentence each; empty when nothing blocks. */
  blockers: string[]
  profile: {
    person: string
    workState: string
    payFrequency: "biweekly"
    firstPeriod: { start: string; end: string } | null
    firstPayDate: string | null
    startDate: string | null
    annualWageCents: number
  }
  estimate: PayrollEstimate | null
  benefits: { decided: boolean; enrolled: boolean; healthLabel: string | null; deferralPct: number | null; perPaycheckCents: number }
}

function w4For(db: AppDatabase, caseId: string): W4FormLike | null {
  const form = latestForm(db, caseId, "w4")
  return form ? (form.data as unknown as W4FormLike) : null
}

type Election = { decided: boolean; enrolled: boolean; tier: HealthTier | null; deferralPct: number }

function electionFor(db: AppDatabase, caseId: string): Election {
  const row = db.select().from(benefitElections).where(eq(benefitElections.caseId, caseId)).get()
  if (!row) return { decided: false, enrolled: false, tier: null, deferralPct: 0 }
  return {
    decided: true,
    enrolled: row.enrolled,
    tier: row.enrolled ? (row.healthTier as HealthTier | null) : null,
    deferralPct: row.enrolled ? (row.retirementDeferralPct ?? 0) : 0,
  }
}

/** First paycheck's gross-to-net. Exported for tests. */
export function estimateFirstPaycheck(
  db: AppDatabase,
  basics: CaseBasics,
): { estimate: PayrollEstimate | null; benefits: PayrollSetupData["benefits"]; period: PayPeriod | null } {
  const election = electionFor(db, basics.caseId)
  const view = (perPaycheckCents: number): PayrollSetupData["benefits"] => ({
    decided: election.decided,
    enrolled: election.enrolled,
    healthLabel: election.tier ? HEALTH_TIER_LABELS[election.tier] : null,
    deferralPct: election.enrolled ? election.deferralPct : null,
    perPaycheckCents,
  })
  const forFullPaycheck = benefitEstimate({
    package: basics.package,
    tier: election.tier,
    deferralPct: election.deferralPct,
    grossCents: grossPerPeriodCents(basics.wageCents, basics.wageUnit),
  })
  if (!basics.startDate) return { estimate: null, benefits: view(forFullPaycheck.totalCents), period: null }

  const annual = annualizeWageCents(basics.wageCents, basics.wageUnit)
  const period = payPeriodContaining(basics.startDate)
  const perYear = periodsForTaxYear(period.taxYear).length
  const scheduled = scheduledGrossCents(annual, period.indexInTaxYear, perYear)
  const daysEmployed = daysEmployedInPeriod(period, basics.startDate, basics.endDate)
  const prorated = daysEmployed < DEFAULT_PAY_CALENDAR.periodDays
  const grossCents = prorated ? Math.round((scheduled * daysEmployed) / DEFAULT_PAY_CALENDAR.periodDays) : scheduled

  const benefits = benefitEstimate({ package: basics.package, tier: election.tier, deferralPct: election.deferralPct, grossCents })
  const w4 = w4For(db, basics.caseId)
  const stub = computeWithholding({
    grossCents,
    payPeriodsPerYear: perYear,
    workState: basics.stateCode,
    w4: w4 ? w4InputsFromForm(w4) : DEFAULT_W4,
    preTaxDeductions: { section125HealthCents: benefits.healthCents, traditional401kCents: benefits.retirementCents },
    hoursWorked: Math.round((80 * daysEmployed) / DEFAULT_PAY_CALENDAR.periodDays),
  })
  const lines = (list: { label: string; amountCents: number }[]): EstimateLine[] =>
    list.filter((line) => line.amountCents > 0).map((line) => ({ label: line.label, cents: line.amountCents }))
  return {
    period,
    benefits: view(benefits.totalCents),
    estimate: {
      grossCents: stub.grossCents,
      taxes: lines(stub.taxes),
      preTax: lines(stub.preTaxDeductions),
      netCents: stub.totals.netPayCents,
      withholdingBasis: w4 ? "w4" : "default",
      prorated,
    },
  }
}

export function loadPayrollSetup(
  db: AppDatabase,
  viewer: StaffViewer,
  taskId: string,
  now: Date = new Date(),
): PayrollSetupData | null {
  const found = loadStaffTask(db, viewer, taskId, ["setup_payroll"], now)
  if (!found) return null
  const { basics, page, task } = found

  const deposit = depositViewFor(db, basics.hireId)
  const items = preflightItems({
    caseId: basics.caseId,
    workerName: basics.workerName,
    tasks: tasksForCase(db, basics.caseId),
    deposit: { state: deposit.state, amountLabel: deposit.amountCents === null ? null : formatCents(deposit.amountCents) },
    forms: {
      w4: latestForm(db, basics.caseId, "w4") !== null,
      directDeposit: latestForm(db, basics.caseId, "direct_deposit") !== null,
    },
  })
  const blockers = task.status === "done" ? [] : payrollBlockers(items)
  const { estimate, benefits, period } = estimateFirstPaycheck(db, basics)

  return {
    taskId,
    caseId: basics.caseId,
    canAct: page.canAct,
    done: task.status === "done",
    preflight: items,
    blockers,
    profile: {
      person: basics.workerName,
      workState: basics.stateCode,
      payFrequency: "biweekly",
      firstPeriod: period ? { start: period.start, end: period.end } : null,
      firstPayDate: period?.payDate ?? null,
      startDate: basics.startDate,
      annualWageCents: annualizeWageCents(basics.wageCents, basics.wageUnit),
    },
    estimate,
    benefits,
  }
}
