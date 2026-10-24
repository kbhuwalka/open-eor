"use client"

import { CircleCheck } from "lucide-react"

import { SummaryCard, SummaryRow } from "@/components/summary-card"
import { Button } from "@/components/ui/button"
import { formatDay, formatWage } from "@/lib/format"
import { parseDay } from "@/lib/task-view"
import { completeTaskAction } from "@/server/task-actions"
import type { PayrollSetupData } from "@/server/onboarding-portal/payroll-setup"

import { DoneNote, PanelActions, PanelBody, PanelError, WaitingNote, type DrawerAct } from "./drawer-parts"
import { PreflightChecklist } from "./preflight-checklist"

/**
 * "Set up payroll" in the drawer: what is still missing (each with a link to where it is fixed), or
 * one line saying nothing is, then the three facts the payroll record is created with.
 */
export function PayrollPanel({
  data,
  nowIso,
  waitingOn,
  act,
}: {
  data: PayrollSetupData
  nowIso: string
  waitingOn: string
  act: DrawerAct
}) {
  const now = new Date(nowIso)
  const day = (iso: string | null) => (iso ? formatDay(parseDay(iso), now) : "Not set")
  const missing = data.preflight.filter((item) => !item.done)
  const blocked = data.blockers.length > 0
  const { profile } = data

  return (
    <>
      <PanelBody>
        <PanelError error={act.error} />
        {missing.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="preflight">
            <CircleCheck aria-hidden className="size-4 shrink-0 text-status-success-foreground" />
            All {data.preflight.length} requirements are in place
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <PreflightChecklist items={missing} />
            {data.preflight.length > missing.length ? (
              <p className="text-xs text-muted-foreground">{data.preflight.length - missing.length} other requirements are in place</p>
            ) : null}
          </div>
        )}

        <SummaryCard data-testid="payroll-profile">
          <SummaryRow label="Pay">{`${formatWage(profile.annualWageCents, "annual")}, biweekly`}</SummaryRow>
          <SummaryRow label="First pay date">{day(profile.firstPayDate)}</SummaryRow>
        </SummaryCard>

        {data.done ? <DoneNote testId="payroll-done">Payroll is set up.</DoneNote> : null}
        {!data.done && !data.canAct && !blocked ? <WaitingNote>{`Waiting on ${waitingOn}.`}</WaitingNote> : null}
      </PanelBody>

      {!data.done && (data.canAct || blocked) ? (
        <PanelActions>
          <Button
            disabled={act.pending || blocked || !data.canAct}
            onClick={() => act.run(() => completeTaskAction(data.taskId, { payFrequency: "biweekly" }), "Payroll created")}
            data-testid="create-payroll"
          >
            {act.pending ? "Creating…" : "Create payroll"}
          </Button>
        </PanelActions>
      ) : null}
    </>
  )
}
