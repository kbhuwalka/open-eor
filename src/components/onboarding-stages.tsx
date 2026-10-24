import type { ReactNode } from "react"
import { cn } from "cn"
import { Check, ChevronRight, Circle, CircleAlert, CircleCheck, CircleDot, Clock } from "lucide-react"

import type { ProjectedStage, StageAudience, StageItem } from "@/domain/tasks"
import { todayIso } from "@/domain/employment-term"
import { formatDay } from "@/lib/format"
import { stageHeadline, stageSummary, ownerText, type StageHeadline } from "@/lib/stage-view"
import { parseDay, rejectReasonText } from "@/lib/task-view"

const DETAILS_SUMMARY =
  "inline-flex w-fit cursor-pointer list-none items-center gap-1 rounded-md text-xs text-muted-foreground transition-colors outline-none select-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden"

/**
 * The Onboarding tab as a short, friendly progress view: one sentence of status, then the
 * template's stages as a single vertical stepper (tasks-and-workflow.md §8.1, ui-guidelines C25).
 *
 * The audience decides the detail: the client sees stages and only the steps they must do
 * (`renderAction` supplies the inline control); an employee sees a to-do stepper of their own
 * tasks; staff see every task. Pure rendering of `ProjectedStage[]`: nothing here names a stage
 * or a task.
 */
export function OnboardingStages({
  stages,
  audience,
  workerName,
  startDate,
  now,
  renderAction,
  showHeadline = true,
}: {
  stages: ProjectedStage[]
  audience: StageAudience
  workerName: string
  startDate: string | null
  now: Date
  renderAction?: (item: StageItem) => ReactNode
  /** Pages that already say what is next (the employee home) turn the one-sentence status off. */
  showHeadline?: boolean
}) {
  if (stages.length === 0) return null
  const headline = stageHeadline({ stages, audience, workerName, startDate, now })
  const note = audience === "client" ? stages.filter((stage) => stage.quiet) : []
  const steps = audience === "client" ? stages.filter((stage) => !stage.quiet) : stages
  const focus = steps.find((stage) => stage.status === "current")

  return (
    <div className="flex flex-col gap-6" data-testid="onboarding-stages" data-audience={audience}>
      {showHeadline ? <Headline headline={headline} /> : null}
      <ol className="flex flex-col" aria-label="Onboarding progress">
        {steps.map((stage, index) => (
          <StageRow
            key={stage.id}
            stage={stage}
            audience={audience}
            workerName={workerName}
            now={now}
            last={index === steps.length - 1}
            focus={stage === focus}
            renderAction={renderAction}
          />
        ))}
      </ol>
      {note.map((stage) => (
        <AfterNote key={stage.id} stage={stage} audience={audience} workerName={workerName} now={now} />
      ))}
    </div>
  )
}

const HEADLINE_ICON = {
  you: { Icon: CircleAlert, tone: "text-status-warning-foreground" },
  waiting: { Icon: Clock, tone: "text-muted-foreground" },
  done: { Icon: CircleCheck, tone: "text-status-success-foreground" },
} as const

function Headline({ headline }: { headline: StageHeadline }) {
  const { Icon, tone } = HEADLINE_ICON[headline.tone]
  return (
    <div
      className="flex items-center gap-3 rounded-lg border border-border px-4 py-3 text-sm"
      data-testid="stage-headline"
      data-tone={headline.tone}
    >
      <Icon aria-hidden className={cn("size-4 shrink-0", tone)} />
      <p className="font-medium">{headline.text}</p>
    </div>
  )
}

function Marker({ status }: { status: ProjectedStage["status"] }) {
  switch (status) {
    case "complete":
      return <CircleCheck aria-hidden className="size-4 text-status-success-foreground" />
    case "current":
      return <CircleDot aria-hidden className="size-4 text-foreground" />
    default:
      return <Circle aria-hidden className="size-4 text-muted-foreground/60" />
  }
}

function dueText(due: string | null, now: Date): { text: string; danger: boolean } | null {
  if (!due) return null
  const day = formatDay(parseDay(due), now)
  return due < todayIso(now) ? { text: `Was due ${day}`, danger: true } : { text: `Due ${day}`, danger: false }
}

function StageRow({
  stage,
  audience,
  workerName,
  now,
  last,
  focus,
  renderAction,
}: {
  stage: ProjectedStage
  audience: StageAudience
  workerName: string
  now: Date
  last: boolean
  focus: boolean
  renderAction?: (item: StageItem) => ReactNode
}) {
  const complete = stage.status === "complete"
  const active = stage.status === "current"
  const muted = stage.status === "upcoming" || stage.status === "blocked"
  const summary = stageSummary(stage, audience, workerName, now)
  const due = active && !stage.milestone ? dueText(stage.dueDate, now) : null
  const detailed = audience !== "client"
  const rest = stage.items.filter((item) => !stage.needsYou.includes(item))

  const title = (
    <span className="flex min-w-0 flex-1 items-baseline justify-between gap-4">
      <span className={cn("text-sm", muted ? "text-muted-foreground" : "font-medium")}>{stage.title}</span>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums" data-testid="stage-summary">
        {complete || muted || stage.milestone ? summary : null}
      </span>
    </span>
  )

  return (
    <li
      className="relative flex gap-3 pb-6 last:pb-0"
      data-testid={`stage-${stage.id}`}
      data-status={stage.status}
      aria-current={focus ? "step" : undefined}
    >
      {!last ? <span aria-hidden className="absolute top-6 bottom-1 left-2 w-px -translate-x-1/2 bg-border" /> : null}
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
        <Marker status={stage.status} />
      </span>

      {complete ? (
        <details className="group min-w-0 flex-1" data-testid={`stage-details-${stage.id}`}>
          <summary className={cn(DETAILS_SUMMARY, "flex w-full text-foreground")}>
            {title}
            <ChevronRight aria-hidden className="size-3.5 shrink-0 transition-transform group-open:rotate-90" />
          </summary>
          <ItemList items={stage.items} audience={audience} workerName={workerName} now={now} className="mt-2" />
        </details>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {title}
          {active ? (
            <>
              <p className="text-xs text-muted-foreground">{stage.description}</p>
              <p className="text-xs text-muted-foreground">
                {stage.milestone ? null : <span data-testid="stage-progress">{summary}</span>}
                {due ? (
                  <>
                    {stage.milestone ? null : " · "}
                    <span className={due.danger ? "text-status-danger-foreground" : undefined} data-testid="stage-due">
                      {due.text}
                    </span>
                  </>
                ) : null}
              </p>
              {stage.rework ? (
                <p className="text-xs text-status-danger-foreground" data-testid="stage-rework">
                  Northwind asked for changes: {rejectReasonText(stage.rework.rework!)}
                </p>
              ) : null}
              {stage.needsYou.map((item) => (
                <NeedsYou key={item.id} item={item} now={now} action={renderAction?.(item)} />
              ))}
              {detailed ? (
                <ItemList items={rest} audience={audience} workerName={workerName} now={now} />
              ) : rest.length > 0 ? (
                <details className="group" data-testid={`stage-details-${stage.id}`}>
                  <summary className={DETAILS_SUMMARY}>
                    <ChevronRight aria-hidden className="size-3.5 transition-transform group-open:rotate-90" />
                    View details
                  </summary>
                  <ItemList items={rest} audience={audience} workerName={workerName} now={now} className="mt-2" />
                </details>
              ) : null}
            </>
          ) : detailed ? (
            <ItemList items={stage.items} audience={audience} workerName={workerName} now={now} />
          ) : null}
        </div>
      )}
    </li>
  )
}

function NeedsYou({ item, now, action }: { item: StageItem; now: Date; action: ReactNode }) {
  const due = dueText(item.dueDate, now)
  return (
    <div
      className="flex flex-col gap-1 rounded-lg border border-border bg-muted/30 p-3"
      data-testid={`task-${item.key}`}
      data-task={item.key}
      data-status="ready"
    >
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm font-medium">{item.label}</span>
        {due ? (
          <span
            className={cn("shrink-0 text-xs tabular-nums", due.danger ? "text-status-danger-foreground" : "text-muted-foreground")}
            data-testid="task-due"
          >
            {due.text}
          </span>
        ) : null}
      </div>
      <span className="text-xs text-status-warning-foreground">Needs you</span>
      {item.rework ? (
        <span className="text-xs text-muted-foreground">{rejectReasonText(item.rework)}</span>
      ) : null}
      {item.reopenNote ? (
        <span className="text-xs text-status-danger-foreground" data-testid="task-reopen-note">
          {item.reopenNote}
        </span>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

function ItemList({
  items,
  audience,
  workerName,
  now,
  className,
}: {
  items: StageItem[]
  audience: StageAudience
  workerName: string
  now: Date
  className?: string
}) {
  if (items.length === 0) return null
  return (
    <ul className={cn("flex flex-col gap-1.5", className)}>
      {items.map((item) => {
        const due = item.status === "ready" ? dueText(item.dueDate, now) : null
        return (
          <li
            key={item.id}
            className="flex items-baseline justify-between gap-4 text-xs"
            data-testid={`item-${item.key}`}
            data-status={item.status}
          >
            <span className={cn("flex min-w-0 items-baseline gap-2", item.status === "done" && "text-muted-foreground")}>
              {item.status === "done" ? (
                <Check aria-hidden className="size-3 shrink-0 self-center" />
              ) : (
                <span aria-hidden className="size-1 shrink-0 self-center rounded-full bg-muted-foreground" />
              )}
              <span className="truncate">{item.label}</span>
            </span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {ownerText(item.party, audience, workerName)}
              {" · "}
              {item.status === "done" ? (
                "Done"
              ) : due ? (
                <span className={due.danger ? "text-status-danger-foreground" : undefined}>{due.text}</span>
              ) : (
                "Not yet"
              )}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** After-start work for the client: one collapsed, read-only note, never part of the stepper. */
function AfterNote({
  stage,
  audience,
  workerName,
  now,
}: {
  stage: ProjectedStage
  audience: StageAudience
  workerName: string
  now: Date
}) {
  return (
    <details className="group" data-testid={`stage-${stage.id}`} data-status={stage.status}>
      <summary className={cn(DETAILS_SUMMARY, "text-sm")}>
        <ChevronRight aria-hidden className="size-3.5 transition-transform group-open:rotate-90" />
        {stage.title}
      </summary>
      <div className="mt-2 flex flex-col gap-2 pl-[1.125rem]">
        <p className="text-xs text-muted-foreground">{stage.description}</p>
        <ItemList items={stage.items} audience={audience} workerName={workerName} now={now} />
      </div>
    </details>
  )
}
