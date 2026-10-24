"use client"

import { CircleCheck } from "lucide-react"

import { SummaryCard, SummaryRow } from "@/components/summary-card"
import { Button } from "@/components/ui/button"
import { formatCents, formatWage } from "@/lib/format"
import { hasFailingCheck } from "@/lib/onboarding-portal/order-checks"
import { stateName } from "@/lib/us-states"
import { completeTaskAction } from "@/server/task-actions"
import type { OrderReviewData } from "@/server/onboarding-portal/order-review"

import { CheckRow } from "./check-row"
import { DoneNote, PanelActions, PanelBody, PanelError, WaitingNote, type DrawerAct } from "./drawer-parts"

/**
 * "Review the order" in the drawer: what was ordered in six lines, the policy checks reduced to the
 * ones that need a look, and Approve. The quote, invoices and history are Finance's and the client's,
 * not the reviewer's.
 */
export function OrderPanel({
  data,
  status,
  waitingOn,
  act,
}: {
  data: OrderReviewData
  status: string
  waitingOn: string
  act: DrawerAct
}) {
  const flagged = data.checks.filter((check) => check.status !== "pass")
  const failing = hasFailingCheck(data.checks)
  const deposit =
    data.deposit.amountCents === null ? data.deposit.label : `${formatCents(data.deposit.amountCents)} · ${data.deposit.label}`

  return (
    <>
      <PanelBody>
        <PanelError error={act.error} />
        <SummaryCard data-testid="order-summary">
          <SummaryRow label="Role">{data.role}</SummaryRow>
          <SummaryRow label="Work location">{stateName(data.stateCode)}</SummaryRow>
          <SummaryRow label="Pay">{formatWage(data.wageCents, data.wageUnit)}</SummaryRow>
          <SummaryRow label="Benefits">{data.packageLabel}</SummaryRow>
          <SummaryRow label="Deposit">{deposit}</SummaryRow>
        </SummaryCard>

        {flagged.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="order-checks">
            <CircleCheck aria-hidden className="size-4 shrink-0 text-status-success-foreground" />
            All {data.checks.length} policy checks passed
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <ul className="overflow-hidden rounded-lg border border-border" data-testid="order-checks">
              {flagged.map((check) => (
                <CheckRow key={check.id} status={check.status} label={check.label} detail={check.detail} testId={`check-${check.id}`} />
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              {data.checks.length - flagged.length} other {data.checks.length - flagged.length === 1 ? "check" : "checks"} passed
            </p>
          </div>
        )}

        {failing && data.canAct && !data.done ? (
          <p role="note" className="text-sm text-status-danger-foreground" data-testid="approve-warning">
            A check failed. Approve only if you have looked at it.
          </p>
        ) : null}

        {data.done ? <DoneNote testId="order-approved">Order approved.</DoneNote> : null}
        {!data.done && !data.canAct ? (
          <WaitingNote>
            {status === "blocked" ? "This step opens once the client has accepted the agreement." : `Waiting on ${waitingOn}.`}
          </WaitingNote>
        ) : null}
      </PanelBody>

      {data.canAct && !data.done ? (
        <PanelActions>
          <Button
            disabled={act.pending}
            onClick={() => act.run(() => completeTaskAction(data.taskId, {}), "Order approved")}
            data-testid="approve-order"
          >
            {act.pending ? "Approving…" : "Approve order"}
          </Button>
        </PanelActions>
      ) : null}
    </>
  )
}
