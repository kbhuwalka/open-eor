"use client"

import { useId, useState } from "react"
import { CircleCheck } from "lucide-react"

import { SummaryCard, SummaryRow } from "@/components/summary-card"
import { TaskScreenFrame } from "@/components/tasks/task-screen-frame"
import type { TaskScreenProps } from "@/components/tasks/task-screens"
import { useTaskOutcome } from "@/components/tasks/use-task-outcome"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { formatCents, formatDay } from "@/lib/format"
import { CONFIRMATION_MAX, confirmationProblem } from "@/lib/onboarding-portal/filing"
import { parseDay } from "@/lib/task-view"
import { stateName } from "@/lib/us-states"
import type { FilingData } from "@/server/onboarding-portal/filings"

/**
 * The two confirm screens (onboarding-portal.md §6): what is being sent, then "Mark submitted" with
 * the reference number the agency or carrier gave back. The handler payload is `{ confirmationNumber }`.
 */
export function FilingScreen({ props, data }: { props: TaskScreenProps; data: FilingData }) {
  const now = new Date(props.nowIso)
  const complete = useTaskOutcome(props.onComplete)
  const id = useId()
  const [reference, setReference] = useState("")
  const [touched, setTouched] = useState(false)
  const problem = touched ? confirmationProblem(reference) : null
  const isReport = data.kind === "new_hire_report"
  const day = (iso: string | null) => (iso ? formatDay(parseDay(iso), now) : "Not set")

  return (
    <TaskScreenFrame
      {...props}
      description={
        isReport
          ? "Report this hire to the state, then record the confirmation number it returns."
          : "Send this enrollment to the carriers, then record the reference number they return."
      }
    >
      <section className="flex flex-col gap-3" aria-labelledby="filing-heading">
        <h3 id="filing-heading" className="text-base font-semibold">{isReport ? "What is being reported" : "Enrollment"}</h3>
        {data.report ? (
          <SummaryCard data-testid="filing-summary">
            <SummaryRow label="Employee">{data.report.employeeName}</SummaryRow>
            <SummaryRow label="Address">{data.report.address ?? "Not provided"}</SummaryRow>
            <SummaryRow label="Social Security number">{data.report.ssnMasked ?? "Not on file"}</SummaryRow>
            <SummaryRow label="Hire date">{day(data.report.hireDate)}</SummaryRow>
            <SummaryRow label="Work state">{stateName(data.report.workState)}</SummaryRow>
            <SummaryRow label="Employer">{data.report.employer}</SummaryRow>
          </SummaryCard>
        ) : null}
        {data.enrollment ? (
          <SummaryCard data-testid="filing-summary">
            <SummaryRow label="Employee">{data.person}</SummaryRow>
            <SummaryRow label="Benefits package">{data.enrollment.packageLabel}</SummaryRow>
            <SummaryRow label="Health coverage">{data.enrollment.healthLabel ?? "None"}</SummaryRow>
            <SummaryRow label="Employee premium">{`${formatCents(data.enrollment.healthEmployeeCents)} per paycheck`}</SummaryRow>
            <SummaryRow label="401(k) deferral">
              {data.enrollment.deferralPct ? `${data.enrollment.deferralPct}% (${formatCents(data.enrollment.retirementCents)} per paycheck)` : "None"}
            </SummaryRow>
            <SummaryRow label="Decided">{data.enrollment.decidedAt ? day(data.enrollment.decidedAt.slice(0, 10)) : "Not yet"}</SummaryRow>
          </SummaryCard>
        ) : null}
      </section>

      {data.done ? (
        <p className="flex items-center gap-2 text-sm" data-testid="filing-done">
          <CircleCheck aria-hidden className="size-4 text-status-success-foreground" />
          Submitted{data.confirmationNumber ? `, reference ${data.confirmationNumber}` : ""}.
        </p>
      ) : props.canAct ? (
        <form
          className="flex max-w-md flex-col gap-3"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            setTouched(true)
            if (confirmationProblem(reference)) return
            complete.submit({ confirmationNumber: reference.trim() })
          }}
        >
          <Field className="gap-1.5" data-invalid={problem ? true : undefined}>
            <FieldLabel htmlFor={id} className="font-normal text-muted-foreground">
              {isReport ? "State confirmation number" : "Carrier reference number"}
            </FieldLabel>
            <Input
              id={id}
              value={reference}
              maxLength={CONFIRMATION_MAX}
              onChange={(event) => setReference(event.target.value)}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? `${id}-error` : undefined}
              data-testid="confirmation-number"
            />
            <FieldDescription>The number the {isReport ? "state agency" : "carrier"} gave you when you submitted.</FieldDescription>
            {problem ? <FieldError id={`${id}-error`} data-testid="confirmation-error">{problem}</FieldError> : null}
          </Field>
          <div>
            <Button type="submit" disabled={complete.pending} data-testid="mark-submitted">
              {complete.pending ? "Saving…" : "Mark submitted"}
            </Button>
          </div>
          {complete.error ? (
            <p role="alert" className="text-xs text-destructive" data-testid="action-error">
              {complete.error}
            </p>
          ) : null}
        </form>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="task-waiting-note">
          {props.task.status === "blocked" ? "This step opens once the steps before it are done." : `Waiting on ${props.task.assigneeLabel}.`}
        </p>
      )}
    </TaskScreenFrame>
  )
}
