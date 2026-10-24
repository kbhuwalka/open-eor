"use client"

import { useEffect, useState } from "react"
import { ChevronDown, ChevronUp, CircleCheck } from "lucide-react"
import { cn } from "cn"

import { loadTaskDrawerAction } from "@/app/onboarding/actions"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import type { ActionResult } from "@/server/action-result"
import type { DrawerTask } from "@/server/onboarding-portal/drawer"
import type { StaffHomeRow } from "@/server/task-inbox"

import { daysBetween, plural, shortDay } from "./specialist-home-dates"
import { FilingPanel } from "./drawer-filing"
import { I9Panel } from "./drawer-i9"
import { OrderPanel } from "./drawer-order"
import { ActionsSlot, useDrawerAct } from "./drawer-parts"
import { PayrollPanel } from "./drawer-payroll"

/** The I-9 drawer shows the uploaded document itself above its details, so it is wider than the rest. */
const WIDE_TYPES = new Set(["verify_i9_section2"])

/**
 * The right-hand drawer of the specialist home: where a task is actually done. The header comes from
 * the list row at once; the body loads the task's own read model and shows only what that task needs,
 * with its one action. Finishing moves on to the next task in the list (`onFinished`); Previous and
 * Next step through it without finishing.
 */
export function SpecialistTaskDrawer({
  row,
  today,
  nowIso,
  position,
  notice,
  onClose,
  onStep,
  onFinished,
}: {
  row: StaffHomeRow | null
  today: string
  nowIso: string
  position: { index: number; total: number } | null
  /** What the last finished task said ("Order approved"), shown until the next one is acted on. */
  notice: string | null
  onClose: () => void
  onStep: (delta: -1 | 1) => void
  onFinished: (message: string) => void
}) {
  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        data-testid="task-drawer"
        initialFocus={false}
        className={cn(
          "inset-y-0 top-0 right-0 left-auto flex h-dvh max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0",
          row && WIDE_TYPES.has(row.type) ? "sm:max-w-2xl" : "sm:max-w-md",
        )}
      >
        {row ? (
          <DrawerBody key={row.id} row={row} today={today} nowIso={nowIso} position={position} notice={notice} onStep={onStep} onFinished={onFinished} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

type Loaded = { id: string; result: ActionResult<DrawerTask> }

function DrawerBody({
  row,
  today,
  nowIso,
  position,
  notice,
  onStep,
  onFinished,
}: {
  row: StaffHomeRow
  today: string
  nowIso: string
  position: { index: number; total: number } | null
  notice: string | null
  onStep: (delta: -1 | 1) => void
  onFinished: (message: string) => void
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null)
  const act = useDrawerAct(onFinished)

  useEffect(() => {
    let cancelled = false
    loadTaskDrawerAction(row.id).then((result) => {
      if (!cancelled) setLoaded({ id: `${row.id}:${attempt}`, result })
    })
    return () => {
      cancelled = true
    }
  }, [row.id, attempt])

  const current = loaded?.id === `${row.id}:${attempt}` ? loaded.result : null

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="drawer-body" data-task-type={row.type}>
      <header className="flex shrink-0 flex-col gap-4 border-b border-border px-6 pt-5 pb-4" data-testid="drawer-header">
        {position ? (
          <div className="-mt-1 flex items-center gap-1 pr-8" data-testid="drawer-stepper">
            <span className="mr-1 text-xs text-muted-foreground tabular-nums">
              {position.index + 1} of {position.total}
            </span>
            <Button variant="ghost" size="icon-sm" aria-label="Previous task" disabled={position.index === 0} onClick={() => onStep(-1)}>
              <ChevronUp />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Next task" disabled={position.index >= position.total - 1} onClick={() => onStep(1)}>
              <ChevronDown />
            </Button>
          </div>
        ) : null}

        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <DialogTitle className="text-base">{row.title}</DialogTitle>
            <DialogDescription>
              {row.personName} · {row.clientName}
            </DialogDescription>
            <Timing row={row} today={today} />
          </div>
          <div ref={setActionsSlot} className="flex shrink-0 items-center gap-2" data-testid="drawer-actions" />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {notice ? (
          <p role="status" className="flex items-center gap-2 px-6 pt-5 text-sm" data-testid="drawer-notice">
            <CircleCheck aria-hidden className="size-4 shrink-0 text-status-success-foreground" />
            {notice}
          </p>
        ) : null}

        {current === null ? (
          <div className="flex flex-col gap-3 px-6 py-6" data-testid="drawer-loading">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : current.ok ? (
          <ActionsSlot value={actionsSlot}>
            <Panel task={current.data} nowIso={nowIso} act={act} />
          </ActionsSlot>
        ) : (
          <div className="flex flex-col items-start gap-3 px-6 py-6" data-testid="drawer-error">
            <p className="text-sm text-muted-foreground">{current.message}</p>
            <Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>
              Try again
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function Panel({ task, nowIso, act }: { task: DrawerTask; nowIso: string; act: ReturnType<typeof useDrawerAct> }) {
  const common = { status: task.status, waitingOn: task.waitingOn, act }
  switch (task.body.kind) {
    case "order":
      return <OrderPanel data={task.body.data} {...common} />
    case "i9":
      return <I9Panel data={task.body.data} nowIso={nowIso} {...common} />
    case "payroll":
      return <PayrollPanel data={task.body.data} nowIso={nowIso} waitingOn={task.waitingOn} act={act} />
    case "filing":
      return <FilingPanel data={task.body.data} nowIso={nowIso} {...common} />
  }
}

function Timing({ row, today }: { row: StaffHomeRow; today: string }) {
  const dueIn = row.dueDate ? daysBetween(today, row.dueDate) : null
  return (
    <p className="text-xs text-muted-foreground" data-testid="drawer-timing">
      {row.startDate ? `Starts ${shortDay(row.startDate)}` : "No start date"}
      {row.atRisk ? <span className="font-medium text-foreground"> · at risk</span> : null}
      {dueIn === null ? null : dueIn < 0 ? (
        <>
          {" · "}
          <span className="text-status-danger-foreground">{plural(-dueIn, "day")} overdue</span>
        </>
      ) : dueIn === 0 ? (
        " · due today"
      ) : (
        ` · due ${shortDay(row.dueDate!)}`
      )}
    </p>
  )
}
