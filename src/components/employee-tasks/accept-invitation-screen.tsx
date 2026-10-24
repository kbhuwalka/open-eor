"use client"

import { Button } from "@/components/ui/button"
import { SummaryCard, SummaryRow } from "@/components/summary-card"
import { US_2026 } from "@/domain/cost-rates"
import type { EmployeeScreenData } from "@/lib/employee-screen-data"
import { longDay } from "@/lib/employee-view"
import { formatWage } from "@/lib/format"
import { acceptInvitationAction } from "@/app/worker/tasks/actions"

import { CompletedPanel } from "./completed-panel"
import { FormError } from "./form-error"
import { EmployeeTaskFrame } from "./task-frame"
import { useTaskFlow } from "./use-task-flow"

type Data = Extract<EmployeeScreenData, { kind: "accept_invitation" }>

/** The welcome: who employs you, what the job is, what it pays, and what happens next. */
export function AcceptInvitationScreen({ data }: { data: Data }) {
  const flow = useTaskFlow()
  const { order } = data
  return (
    <EmployeeTaskFrame
      data={data}
      description={`${order.employerName} has hired you as ${order.roleTitle}. Northwind is your employer of record: it runs your payroll, taxes and benefits so you can focus on the work.`}
    >
      {data.completed ? (
        <CompletedPanel data={{ ...data, completed: data.completed }} />
      ) : (
        <>
          <SummaryCard data-testid="offer-summary">
            <SummaryRow label="Company">{order.employerName}</SummaryRow>
            <SummaryRow label="Role">{order.roleTitle}</SummaryRow>
            <SummaryRow label="Start date">{longDay(order.startDate)}</SummaryRow>
            <SummaryRow label="Work location">{order.stateName}</SummaryRow>
            <SummaryRow label="Pay">
              <span data-testid="offer-pay">{formatWage(order.wageCents, order.wageUnit)}</span>
            </SummaryRow>
            <SummaryRow label="Benefits">{US_2026.packages[order.benefitPackage].label}</SummaryRow>
          </SummaryCard>

          <section aria-labelledby="expect" className="flex flex-col gap-3">
            <h3 id="expect" className="text-lg font-medium">
              What to expect
            </h3>
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm">
              {data.upcoming.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ol>
            <p className="text-sm text-muted-foreground">
              You can stop and pick it up again whenever you like. Your first paycheck is on {longDay(order.firstPayDate)}.
            </p>
          </section>

          <FormError key={flow.error?.seq} message={flow.error?.message ?? null} />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              disabled={!data.canAct || flow.pending}
              onClick={() => flow.run(() => acceptInvitationAction(data.taskId))}
              data-testid="accept-invitation"
            >
              {flow.pending ? "Accepting…" : "Accept and continue"}
            </Button>
          </div>
        </>
      )}
    </EmployeeTaskFrame>
  )
}
