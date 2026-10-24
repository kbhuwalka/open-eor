import Link from "next/link"

import { DetailField } from "@/components/detail-field"
import { longDay } from "@/lib/employee-view"
import { formatWage } from "@/lib/format"
import { formatPayDay } from "@/lib/payslip-view"
import type { EmployeeProfile } from "@/server/employee-profile"

function Group({ title, children, testId }: { title: string; children: React.ReactNode; testId: string }) {
  return (
    <section className="flex flex-col gap-5" data-testid={testId}>
      <h3 className="text-base font-semibold">{title}</h3>
      {children}
    </section>
  )
}

const Pair = ({ children }: { children: React.ReactNode }) => <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>

/**
 * The employee's own facts, read-only, in the visual structure of the client's person Details tab
 * (ui-guidelines C37): grouped `DetailField`s with no edit controls. A value Northwind does not
 * have reads as an em dash. The SSN is never part of the profile.
 */
export function EmployeeProfileDetails({ profile }: { profile: EmployeeProfile }) {
  const { job, personal, pay, benefits } = profile
  return (
    <div className="flex flex-col gap-8" data-testid="home-details">
      <Group title="Job" testId="details-job">
        <Pair>
          <DetailField label="Job title">{job.title}</DetailField>
          <DetailField label="Employment type">{job.employmentType}</DetailField>
        </Pair>
        <Pair>
          <DetailField label="Start date">{longDay(job.startDate)}</DetailField>
          <DetailField label="End date">{job.endDate ? longDay(job.endDate) : "Indefinite"}</DetailField>
        </Pair>
        <Pair>
          <DetailField label="Work state">{job.workState}</DetailField>
          <DetailField label={job.wageUnit === "hourly" ? "Hourly rate" : "Salary"}>
            <span className="tabular-nums">{formatWage(job.wageCents, job.wageUnit)}</span>
          </DetailField>
        </Pair>
        <Pair>
          <DetailField label="Company">{job.employer}</DetailField>
          <DetailField label="Employer contact">{job.employerContact}</DetailField>
        </Pair>
      </Group>

      <Group title="Personal details" testId="details-personal">
        <Pair>
          <DetailField label="Legal name">{personal.legalName}</DetailField>
          <DetailField label="Preferred name">{personal.preferredName}</DetailField>
        </Pair>
        <Pair>
          <DetailField label="Email">{personal.email}</DetailField>
          <DetailField label="Phone">{personal.phone}</DetailField>
        </Pair>
        <DetailField label="Address">{personal.address?.street}</DetailField>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <DetailField label="City">{personal.address?.city}</DetailField>
          <DetailField label="State">{personal.address?.state}</DetailField>
          <DetailField label="ZIP code">{personal.address?.zip}</DetailField>
        </div>
        <DetailField label="Emergency contact">{personal.emergencyContact}</DetailField>
      </Group>

      <Group title="Pay" testId="details-pay">
        <Pair>
          <DetailField label="Pay frequency">{pay.frequency}</DetailField>
          <DetailField label="Next pay date">{pay.nextPayDate ? formatPayDay(pay.nextPayDate) : null}</DetailField>
        </Pair>
        <DetailField label="Direct deposit">{pay.directDeposit}</DetailField>
      </Group>

      <Group title="Benefits" testId="details-benefits">
        <Pair>
          <DetailField label="Coverage">{benefits.coverage}</DetailField>
          <DetailField label="401(k) contribution">
            {benefits.retirementDeferralPct === null ? null : `${benefits.retirementDeferralPct}% of each paycheck`}
          </DetailField>
        </Pair>
        <p className="text-sm text-muted-foreground">
          <Link href="/worker/benefits" className="text-primary hover:underline" data-testid="details-benefits-link">
            Manage your 401(k) on the Benefits page
          </Link>
        </p>
      </Group>
    </div>
  )
}
