/**
 * The two confirm-and-record tasks (onboarding-portal.md §6): the state new-hire report and the
 * benefit enrollment sent to the carriers. Each screen shows what is being reported, masked where it
 * is sensitive, and the specialist records the confirmation number the agency or carrier gave back.
 */
import { eq } from "drizzle-orm"

import type { AppDatabase } from "@/db/client"
import { benefitElections } from "@/db/schema"
import { HEALTH_TIER_LABELS, US_2026, type HealthTier } from "@/domain/cost-rates"
import { grossPerPeriodCents, benefitEstimate } from "@/lib/employee-benefits"

import { maskSsn } from "../documents"
import { decryptFields } from "../field-crypto"

import { latestForm, loadStaffTask, safeJson, type CaseBasics, type StaffViewer } from "./core"

export type NewHireReport = {
  employeeName: string
  address: string | null
  ssnMasked: string | null
  hireDate: string | null
  workState: string
  employer: string
}

export type EnrollmentSummary = {
  decided: boolean
  enrolled: boolean
  packageLabel: string
  healthLabel: string | null
  healthEmployeeCents: number
  deferralPct: number | null
  retirementCents: number
  decidedAt: string | null
}

export type FilingData = {
  kind: "new_hire_report" | "benefit_enrollment"
  taskId: string
  caseId: string
  canAct: boolean
  done: boolean
  person: string
  /** The reference recorded when this was marked submitted. */
  confirmationNumber: string | null
  report: NewHireReport | null
  enrollment: EnrollmentSummary | null
}

const NORTHWIND = "Northwind EOR, Inc."

function maskedSsnFor(db: AppDatabase, caseId: string): string | null {
  const stored = latestForm(db, caseId, "personal_details")?.encryptedJson
  if (!stored) return null
  try {
    const ssn = decryptFields(stored).ssn
    return typeof ssn === "string" ? maskSsn(ssn) : null
  } catch {
    return null
  }
}

function newHireReport(db: AppDatabase, basics: CaseBasics): NewHireReport {
  const personal = latestForm(db, basics.caseId, "personal_details")?.data ?? {}
  const address = personal.address as { line1?: string; line2?: string; city?: string; state?: string; zip?: string } | undefined
  return {
    employeeName: typeof personal.legalName === "string" ? personal.legalName : basics.workerName,
    address: address?.line1
      ? [address.line1, address.line2, `${address.city ?? ""}, ${address.state ?? ""} ${address.zip ?? ""}`.trim()].filter(Boolean).join(", ")
      : null,
    ssnMasked: maskedSsnFor(db, basics.caseId),
    hireDate: basics.startDate,
    workState: basics.stateCode,
    employer: NORTHWIND,
  }
}

function enrollment(db: AppDatabase, basics: CaseBasics): EnrollmentSummary {
  const row = db.select().from(benefitElections).where(eq(benefitElections.caseId, basics.caseId)).get()
  const base = { packageLabel: US_2026.packages[basics.package].label }
  if (!row) {
    return { ...base, decided: false, enrolled: false, healthLabel: null, healthEmployeeCents: 0, deferralPct: null, retirementCents: 0, decidedAt: null }
  }
  const tier = row.enrolled ? (row.healthTier as HealthTier | null) : null
  const deferral = row.enrolled ? (row.retirementDeferralPct ?? 0) : 0
  const estimate = benefitEstimate({
    package: basics.package,
    tier,
    deferralPct: deferral,
    grossCents: grossPerPeriodCents(basics.wageCents, basics.wageUnit),
  })
  return {
    ...base,
    decided: true,
    enrolled: row.enrolled,
    healthLabel: tier ? HEALTH_TIER_LABELS[tier] : null,
    healthEmployeeCents: estimate.healthCents,
    deferralPct: row.enrolled ? deferral : null,
    retirementCents: estimate.retirementCents,
    decidedAt: row.decidedAt.toISOString(),
  }
}

export function loadFiling(
  db: AppDatabase,
  viewer: StaffViewer,
  taskId: string,
  now: Date = new Date(),
): FilingData | null {
  const found = loadStaffTask(db, viewer, taskId, ["file_new_hire_report", "submit_benefit_enrollments"], now)
  if (!found) return null
  const { basics, page, task } = found
  const result = safeJson(JSON.stringify(task.result ?? {})) as { confirmationNumber?: unknown } | null
  const isReport = task.type === "file_new_hire_report"
  return {
    kind: isReport ? "new_hire_report" : "benefit_enrollment",
    taskId,
    caseId: basics.caseId,
    canAct: page.canAct,
    done: task.status === "done",
    person: basics.workerName,
    confirmationNumber: typeof result?.confirmationNumber === "string" ? result.confirmationNumber : null,
    report: isReport ? newHireReport(db, basics) : null,
    enrollment: isReport ? null : enrollment(db, basics),
  }
}
