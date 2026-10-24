/**
 * The employee's read-only profile on Home (employee-portal.md §3.2): job, personal, pay and
 * benefits facts for the signed-in employee's own case, in the sections of the client's person
 * Details tab. Scoped through `loadEmployeeCase` (acl I3, I6): another person's data is never read.
 * The Social Security number and date of birth stay encrypted and are not read at all; direct
 * deposit is only the account type and last four digits.
 */
import { and, desc, eq } from "drizzle-orm"

import type { AppDatabase } from "@/db/client"
import { formSubmissions, hireRequests, users } from "@/db/schema"
import { DEFAULT_PAY_CALENDAR, DECLINED_ELECTIONS, electionInForce, payPeriodContaining, type PayCalendar } from "@/domain/billing"
import { HEALTH_TIER_LABELS } from "@/domain/cost-rates"
import { businessDayOf } from "@/domain/business-time"
import { parsePolicySnapshot, type WageUnit } from "@/domain/types"

import { loadElectionHistory } from "./billing-core"
import { loadEmployeeCase, type EmployeeCase } from "./employee-portal"
import { directDepositLabel, nextPayDateFor } from "./pay-queries"

export type EmployeeProfile = {
  status: EmployeeCase["status"]
  job: {
    title: string
    startDate: string
    endDate: string | null
    workState: string
    employmentType: string
    wageCents: number
    wageUnit: WageUnit
    employer: string
    /** The employer's person who ordered the hire. */
    employerContact: string | null
  }
  personal: {
    legalName: string | null
    preferredName: string
    email: string
    phone: string | null
    address: { street: string; city: string; state: string; zip: string } | null
    emergencyContact: string | null
  }
  pay: {
    frequency: string
    nextPayDate: string | null
    /** "Checking ••1234". */
    directDeposit: string | null
  }
  benefits: {
    /** Null until the first election is made. */
    elected: boolean
    coverage: string | null
    retirementDeferralPct: number | null
  }
}

const EMPLOYMENT_TYPE: Record<string, string> = { w2_employee: "W-2 employee" }

export function payFrequencyLabel(calendar: PayCalendar = DEFAULT_PAY_CALENDAR): string {
  if (calendar.periodDays === 7) return "Weekly"
  if (calendar.periodDays === 14) return "Every two weeks"
  return `Every ${calendar.periodDays} days`
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "")

function latestForm(db: AppDatabase, caseId: string, formType: string): Record<string, unknown> {
  const row = db
    .select({ dataJson: formSubmissions.dataJson })
    .from(formSubmissions)
    .where(and(eq(formSubmissions.caseId, caseId), eq(formSubmissions.formType, formType)))
    .orderBy(desc(formSubmissions.createdAt), desc(formSubmissions.id))
    .get()
  if (!row) return {}
  try {
    return record(JSON.parse(row.dataJson))
  } catch {
    return {}
  }
}

/** The profile of the signed-in employee, or null when they have no employment. */
export function loadEmployeeProfile(db: AppDatabase, userId: string, now: Date = new Date()): EmployeeProfile | null {
  const employee = loadEmployeeCase(db, userId, now)
  if (!employee) return null
  const { order } = employee

  const hire = db
    .select({ snapshotJson: hireRequests.policySnapshotJson, contact: users.displayName })
    .from(hireRequests)
    .leftJoin(users, eq(users.id, hireRequests.createdByUserId))
    .where(eq(hireRequests.id, employee.hireId))
    .get()
  let snapshotWorkerType: string | null = null
  if (hire?.snapshotJson) {
    try {
      snapshotWorkerType = parsePolicySnapshot(JSON.parse(hire.snapshotJson))?.workerType ?? null
    } catch {
      snapshotWorkerType = null
    }
  }
  const workerType = snapshotWorkerType ?? "w2_employee"

  const personal = latestForm(db, employee.caseId, "personal_details")
  const address = record(personal.address)
  const emergency = record(personal.emergencyContact)
  const street = [text(address.line1), text(address.line2)].filter(Boolean).join(", ")
  const emergencyName = text(emergency.name)
  const relationship = text(emergency.relationship)
  const emergencyPhone = text(emergency.phone)

  const history = loadElectionHistory(db, employee.caseId)
  const inForce = electionInForce(history, payPeriodContaining(businessDayOf(now)).start) ?? { ...DECLINED_ELECTIONS }
  const enrolled = history.length > 0 && inForce.enrolled

  return {
    status: employee.status,
    job: {
      title: order.roleTitle,
      startDate: order.startDate,
      endDate: order.endDate,
      workState: order.stateName,
      employmentType: EMPLOYMENT_TYPE[workerType] ?? workerType,
      wageCents: order.wageCents,
      wageUnit: order.wageUnit,
      employer: order.employerName,
      employerContact: hire?.contact ?? null,
    },
    personal: {
      legalName: text(personal.legalName) || null,
      preferredName: employee.displayName,
      email: employee.email,
      phone: text(personal.phone) || null,
      address: street ? { street, city: text(address.city), state: text(address.state), zip: text(address.zip) } : null,
      emergencyContact: emergencyName
        ? `${emergencyName}${relationship ? ` (${relationship})` : ""}${emergencyPhone ? `, ${emergencyPhone}` : ""}`
        : null,
    },
    pay: {
      frequency: payFrequencyLabel(),
      nextPayDate: employee.status === "active" ? nextPayDateFor(db, userId, now).nextPayDate : null,
      directDeposit: directDepositLabel(db, employee.caseId)?.label ?? null,
    },
    benefits: {
      elected: history.length > 0,
      coverage: history.length === 0 ? null : enrolled && inForce.healthTier ? HEALTH_TIER_LABELS[inForce.healthTier] : "Waived",
      retirementDeferralPct: history.length === 0 ? null : enrolled ? (inForce.retirementDeferralPct ?? 0) : 0,
    },
  }
}
