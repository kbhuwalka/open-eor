"use client"

import { useId, useState } from "react"

import { SummaryCard, SummaryRow } from "@/components/summary-card"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { formatDay } from "@/lib/format"
import { CONFIRMATION_MAX, confirmationProblem } from "@/lib/onboarding-portal/filing"
import { parseDay } from "@/lib/task-view"
import { stateName } from "@/lib/us-states"
import { completeTaskAction } from "@/server/task-actions"
import type { FilingData } from "@/server/onboarding-portal/filings"

import { DoneNote, PanelActions, PanelBody, PanelError, WaitingNote, type DrawerAct } from "./drawer-parts"

/**
 * The new-hire report and the benefit enrollment share one drawer: the details to copy into the
 * state's or the carrier's system, then the confirmation number it gives back.
 */
export function FilingPanel({
  data,
  nowIso,
  status,
  waitingOn,
  act,
}: {
  data: FilingData
  nowIso: string
  status: string
  waitingOn: string
  act: DrawerAct
}) {
  const id = useId()
  const now = new Date(nowIso)
  const [reference, setReference] = useState("")
  const [touched, setTouched] = useState(false)
  const problem = touched ? confirmationProblem(reference) : null
  const isReport = data.kind === "new_hire_report"
  const day = (iso: string | null) => (iso ? formatDay(parseDay(iso), now) : "Not set")
  const submit = () => {
    setTouched(true)
    if (confirmationProblem(reference)) return
    act.run(() => completeTaskAction(data.taskId, { confirmationNumber: reference.trim() }), isReport ? "New-hire report filed" : "Enrollments submitted")
  }

  return (
    <>
      <PanelBody>
        <PanelError error={act.error} />
        {data.report ? (
          <SummaryCard data-testid="filing-summary">
            <SummaryRow label="Address">{data.report.address ?? "Not provided"}</SummaryRow>
            <SummaryRow label="SSN">{data.report.ssnMasked ?? "Not on file"}</SummaryRow>
            <SummaryRow label="Hire date">{day(data.report.hireDate)}</SummaryRow>
            <SummaryRow label="Report to">{stateName(data.report.workState)}</SummaryRow>
          </SummaryCard>
        ) : null}
        {data.enrollment ? (
          <SummaryCard data-testid="filing-summary">
            <SummaryRow label="Health coverage">{data.enrollment.healthLabel ?? "None"}</SummaryRow>
            <SummaryRow label="401(k) deferral">{data.enrollment.deferralPct ? `${data.enrollment.deferralPct}%` : "None"}</SummaryRow>
          </SummaryCard>
        ) : null}

        {data.done ? (
          <DoneNote testId="filing-done">{`${isReport ? "Filed" : "Submitted"}${data.confirmationNumber ? `, confirmation ${data.confirmationNumber}` : ""}.`}</DoneNote>
        ) : data.canAct ? (
          <Field className="gap-1.5" data-invalid={problem ? true : undefined}>
            <FieldLabel htmlFor={id}>{isReport ? "State confirmation number" : "Carrier reference number"}</FieldLabel>
            <Input
              id={id}
              value={reference}
              maxLength={CONFIRMATION_MAX}
              autoComplete="off"
              autoFocus
              onChange={(event) => setReference(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  submit()
                }
              }}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? `${id}-error` : undefined}
              data-testid="confirmation-number"
            />
            {problem ? <FieldError id={`${id}-error`} data-testid="confirmation-error">{problem}</FieldError> : null}
          </Field>
        ) : (
          <WaitingNote>{status === "blocked" ? "This step opens once the steps before it are done." : `Waiting on ${waitingOn}.`}</WaitingNote>
        )}
      </PanelBody>

      {data.canAct && !data.done ? (
        <PanelActions>
          <Button disabled={act.pending} onClick={submit} data-testid="mark-submitted">
            {act.pending ? "Saving…" : isReport ? "Mark filed" : "Mark submitted"}
          </Button>
        </PanelActions>
      ) : null}
    </>
  )
}
