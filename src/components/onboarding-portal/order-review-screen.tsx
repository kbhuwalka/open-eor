"use client"

import { useId, useState } from "react"
import { CircleCheck } from "lucide-react"

import { SummaryCard, SummaryRow } from "@/components/summary-card"
import { TaskScreenFrame } from "@/components/tasks/task-screen-frame"
import type { TaskScreenProps } from "@/components/tasks/task-screens"
import { useTaskOutcome } from "@/components/tasks/use-task-outcome"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { formatCents, formatDay, formatWage } from "@/lib/format"
import { hasFailingCheck } from "@/lib/onboarding-portal/order-checks"
import { parseDay } from "@/lib/task-view"
import { stateName } from "@/lib/us-states"
import type { OrderReviewData } from "@/server/onboarding-portal/order-review"

import { CheckRow } from "./check-row"

const NOTE_MAX = 500

/**
 * "Review the order" (onboarding-portal.md §2): the order as placed, what it costs, the deposit and
 * agreement (read-only: Finance and the client own them) and the checks to read before approving.
 * Approving sends `{ note? }` through the shared task action. The task has no rework, so there is
 * nothing to send back to: a problem goes to the client through their account manager.
 */
export function OrderReviewScreen({ props, data }: { props: TaskScreenProps; data: OrderReviewData }) {
  const now = new Date(props.nowIso)
  const complete = useTaskOutcome(props.onComplete)
  const [note, setNote] = useState("")
  const noteId = useId()
  const day = (iso: string | null) => (iso ? formatDay(parseDay(iso), now) : "Not set")
  const failing = hasFailingCheck(data.checks)

  return (
    <TaskScreenFrame {...props} description="Check the order against the policy rules, then approve it so Northwind can invite the employee.">
      <section className="flex flex-col gap-3" aria-labelledby="order-heading">
        <h3 id="order-heading" className="text-base font-semibold">Order</h3>
        <SummaryCard data-testid="order-summary">
          <SummaryRow label="Client">{data.client}</SummaryRow>
          <SummaryRow label="Person">{`${data.person.name} · ${data.person.email}`}</SummaryRow>
          <SummaryRow label="Role">{data.role}</SummaryRow>
          <SummaryRow label="Work location">{stateName(data.stateCode)}</SummaryRow>
          <SummaryRow label="Pay">{formatWage(data.wageCents, data.wageUnit)}</SummaryRow>
          <SummaryRow label="Start date">{day(data.startDate)}</SummaryRow>
          <SummaryRow label="End date">{data.endDate ? day(data.endDate) : "Indefinite"}</SummaryRow>
          <SummaryRow label="Benefits package">{data.packageLabel}</SummaryRow>
        </SummaryCard>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="money-heading">
        <h3 id="money-heading" className="text-base font-semibold">Quote, deposit and agreement</h3>
        <SummaryCard data-testid="order-money">
          {data.quote ? (
            <>
              <SummaryRow label="Employer cost, committed">{`${formatCents(data.quote.committedMonthlyCents)} / mo`}</SummaryRow>
              <SummaryRow label="With benefits">{`${formatCents(data.quote.withBenefitsMonthlyCents)} / mo`}</SummaryRow>
              <SummaryRow label="Annual, with benefits">{formatCents(data.quote.withBenefitsAnnualCents)}</SummaryRow>
              <SummaryRow label="Northwind fee">{`${data.quote.markupPct}% of wage`}</SummaryRow>
            </>
          ) : (
            <SummaryRow label="Quote">Not frozen with this order</SummaryRow>
          )}
          <SummaryRow label="Deposit">
            {data.deposit.amountCents === null ? data.deposit.label : `${formatCents(data.deposit.amountCents)} · ${data.deposit.label}`}
          </SummaryRow>
          <SummaryRow label="Client agreement">
            {data.agreement.status === "signed" && data.agreement.signedAt
              ? `Signed ${day(data.agreement.signedAt.slice(0, 10))}`
              : data.agreement.status === "draft"
                ? "Not signed yet"
                : "None"}
          </SummaryRow>
        </SummaryCard>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="checks-heading">
        <h3 id="checks-heading" className="text-base font-semibold">Checks</h3>
        <ul className="overflow-hidden rounded-lg border border-border" data-testid="order-checks">
          {data.checks.map((check) => (
            <CheckRow key={check.id} status={check.status} label={check.label} detail={check.detail} testId={`check-${check.id}`} />
          ))}
        </ul>
      </section>

      {data.done ? (
        <p className="flex items-center gap-2 text-sm" data-testid="order-approved">
          <CircleCheck aria-hidden className="size-4 text-status-success-foreground" />
          Order approved{props.task.completedAt ? ` on ${formatDay(new Date(props.task.completedAt), now)}` : ""}.
          {data.approvalNote ? ` Note: ${data.approvalNote}` : ""}
        </p>
      ) : props.canAct ? (
        <form
          className="flex max-w-xl flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            complete.submit(note.trim() ? { note: note.trim() } : {})
          }}
        >
          <Field className="gap-1.5">
            <FieldLabel htmlFor={noteId} className="font-normal text-muted-foreground">Note (optional)</FieldLabel>
            <Textarea
              id={noteId}
              value={note}
              maxLength={NOTE_MAX}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Anything the team should know about this order"
              data-testid="approve-note"
            />
          </Field>
          {failing ? (
            <p role="note" className="text-xs text-status-danger-foreground" data-testid="approve-warning">
              A check failed. Approve only if you have looked at it.
            </p>
          ) : null}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={complete.pending} data-testid="approve-order">
              {complete.pending ? "Approving…" : "Approve order"}
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
          {props.task.status === "blocked" ? "This step opens once the client has accepted the agreement." : `Waiting on ${props.task.assigneeLabel}.`}
        </p>
      )}
    </TaskScreenFrame>
  )
}
