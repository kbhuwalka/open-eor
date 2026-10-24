"use client"

import { CircleCheck, TriangleAlert } from "lucide-react"

import { SummaryCard, SummaryRow } from "@/components/summary-card"
import { TaskScreenFrame } from "@/components/tasks/task-screen-frame"
import type { TaskScreenProps } from "@/components/tasks/task-screens"
import { useTaskOutcome } from "@/components/tasks/use-task-outcome"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { formatCents, formatDay } from "@/lib/format"
import { parseDay } from "@/lib/task-view"
import { stateName } from "@/lib/us-states"
import type { PayrollSetupData } from "@/server/onboarding-portal/payroll-setup"

import { PreflightChecklist } from "./preflight-checklist"

/** "Set up payroll" (onboarding-portal.md §4): pre-flight, profile, an estimated first paycheck, then create. */
export function PayrollSetupScreen({ props, data }: { props: TaskScreenProps; data: PayrollSetupData }) {
  const now = new Date(props.nowIso)
  const complete = useTaskOutcome(props.onComplete)
  const day = (iso: string | null) => (iso ? formatDay(parseDay(iso), now) : "Not set")
  const blocked = data.blockers.length > 0
  const { profile, estimate, benefits } = data

  return (
    <TaskScreenFrame {...props} description="Check that everything payroll needs is in place, review the profile, then create the payroll record.">
      <section className="flex flex-col gap-3" aria-labelledby="preflight-heading">
        <h3 id="preflight-heading" className="text-base font-semibold">Pre-flight checklist</h3>
        <PreflightChecklist items={data.preflight} />
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="profile-heading">
        <h3 id="profile-heading" className="text-base font-semibold">Payroll profile</h3>
        <SummaryCard data-testid="payroll-profile">
          <SummaryRow label="Person">{profile.person}</SummaryRow>
          <SummaryRow label="Work state">{stateName(profile.workState)}</SummaryRow>
          <SummaryRow label="Pay frequency">Biweekly</SummaryRow>
          <SummaryRow label="Start date">{day(profile.startDate)}</SummaryRow>
          <SummaryRow label="First pay period">
            {profile.firstPeriod ? `${day(profile.firstPeriod.start)} to ${day(profile.firstPeriod.end)}` : "Not set"}
          </SummaryRow>
          <SummaryRow label="First pay date">{day(profile.firstPayDate)}</SummaryRow>
          <SummaryRow label="Annual wage">{formatCents(profile.annualWageCents)}</SummaryRow>
          <SummaryRow label="Benefit elections">
            {!benefits.decided
              ? "Not chosen yet"
              : !benefits.enrolled
                ? "Declined"
                : [benefits.healthLabel, benefits.deferralPct ? `401(k) ${benefits.deferralPct}%` : null].filter(Boolean).join(" · ")}
          </SummaryRow>
        </SummaryCard>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="estimate-heading">
        <h3 id="estimate-heading" className="text-base font-semibold">Estimated first paycheck</h3>
        {estimate ? (
          <>
            <SummaryCard data-testid="payroll-estimate">
              <SummaryRow label="Gross pay">{formatCents(estimate.grossCents)}</SummaryRow>
              {estimate.preTax.map((line) => (
                <SummaryRow key={line.label} label={line.label}>{`−${formatCents(line.cents)}`}</SummaryRow>
              ))}
              {estimate.taxes.map((line) => (
                <SummaryRow key={line.label} label={line.label}>{`−${formatCents(line.cents)}`}</SummaryRow>
              ))}
              <SummaryRow label="Net pay" strong>{formatCents(estimate.netCents)}</SummaryRow>
            </SummaryCard>
            <p className="text-xs text-muted-foreground" data-testid="estimate-basis">
              {estimate.withholdingBasis === "w4" ? "Uses the employee's W-4." : "No W-4 on file yet, so this uses the default (single, no adjustments)."}
              {estimate.prorated ? " The first period is partial, so gross pay is prorated by days worked." : ""}
              {benefits.decided ? "" : " Benefit deductions are not included until the employee chooses benefits."}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">There is no start date yet, so the first paycheck cannot be estimated.</p>
        )}
      </section>

      {data.done ? (
        <p className="flex items-center gap-2 text-sm" data-testid="payroll-done">
          <CircleCheck aria-hidden className="size-4 text-status-success-foreground" />
          Payroll is set up{props.task.completedAt ? ` (${formatDay(new Date(props.task.completedAt), now)})` : ""}.
        </p>
      ) : (
        <div className="flex max-w-xl flex-col gap-3">
          {blocked ? (
            <Alert data-testid="payroll-blockers">
              <TriangleAlert />
              <AlertTitle>Payroll cannot be created yet</AlertTitle>
              <AlertDescription>
                <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4">
                  {data.blockers.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
          {props.canAct || blocked ? (
            <div>
              <Button
                disabled={complete.pending || blocked || !props.canAct}
                onClick={() => complete.submit({ payFrequency: "biweekly" })}
                data-testid="create-payroll"
              >
                {complete.pending ? "Creating…" : "Create payroll"}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="task-waiting-note">{`Waiting on ${props.task.assigneeLabel}.`}</p>
          )}
          {complete.error ? (
            <p role="alert" className="text-xs text-destructive" data-testid="action-error">
              {complete.error}
            </p>
          ) : null}
        </div>
      )}
    </TaskScreenFrame>
  )
}
