import type { ReactNode } from "react"

import type { CaseEventType } from "@/domain/types"
import { formatRelative } from "@/lib/format"
import { rejectReasonText } from "@/lib/task-view"
import type { TimelineEntry } from "@/server/queries"

/** Client-facing titles for event types without a label of their own (domain §9). */
const EVENT_LABEL: Record<CaseEventType, string> = {
  order_created: "Order created",
  agreement_signed: "EOR agreement signed",
  task_completed: "Step completed",
  task_rejected: "Changes requested",
  task_reopened: "Step reopened",
  document_uploaded: "Document uploaded",
  benefit_election_changed: "Benefits updated",
  ops_note: "Note from Northwind",
  request_cancelled: "Onboarding cancelled",
  terminated: "Terminated",
  reactivated: "Reactivated",
}

function payloadOf(entry: TimelineEntry): Record<string, unknown> {
  return (entry.payload ?? {}) as Record<string, unknown>
}

/** Completed tasks carry the template's past-tense label in the event, so history reads on its own. */
function eventTitle(entry: TimelineEntry): string {
  const p = payloadOf(entry)
  if (entry.type === "task_reopened" && typeof p.label === "string") return `${p.label}: try again`
  if ((entry.type === "task_completed" || entry.type === "task_rejected") && typeof p.label === "string") {
    return entry.type === "task_rejected" ? `${p.label}: changes requested` : p.label
  }
  return EVENT_LABEL[entry.type]
}

function eventDetail(entry: TimelineEntry): string | null {
  const p = payloadOf(entry)
  switch (entry.type) {
    case "agreement_signed":
      return typeof p.markupPct === "number" ? `EOR fee ${p.markupPct}% of wage` : null
    case "document_uploaded":
      return typeof p.kind === "string" ? `Kind: ${p.kind}` : null
    case "task_rejected": {
      const reason = p.reason as { code?: string; note?: string } | undefined
      if (!reason?.code) return null
      return rejectReasonText({ code: reason.code, note: reason.note })
    }
    case "benefit_election_changed":
      return typeof p.effectiveFrom === "string" ? `Effective ${p.effectiveFrom}` : null
    case "terminated": {
      const when = typeof p.effectiveOn === "string" ? `Effective ${p.effectiveOn}` : null
      const note = typeof p.note === "string" && p.note ? p.note : null
      return [when, note].filter(Boolean).join(" — ") || null
    }
    case "reactivated": {
      const term =
        p.endDate === null
          ? "Indefinite term"
          : typeof p.endDate === "string"
            ? `Fixed term ending ${p.endDate}`
            : null
      const note = typeof p.note === "string" && p.note ? p.note : null
      return [term, note].filter(Boolean).join(" — ") || null
    }
    case "task_reopened":
    case "ops_note":
    case "request_cancelled":
      return typeof p.note === "string" && p.note ? p.note : null
    default:
      return null
  }
}

/** `trailing` is extra `<li>` rows after the events, for example the steps still to come. */
export function CaseTimeline({
  entries,
  now,
  trailing,
}: {
  entries: TimelineEntry[]
  now: Date
  trailing?: ReactNode
}) {
  if (entries.length === 0 && !trailing) {
    return <p className="text-sm text-muted-foreground">No activity yet.</p>
  }
  return (
    <ol className="flex flex-col" data-testid="case-timeline">
      {entries.map((entry, i) => {
        const detail = eventDetail(entry)
        const last = i === entries.length - 1 && !trailing
        return (
          <li key={entry.id} className="relative flex gap-3 pb-5 last:pb-0">
            {!last ? (
              <span
                aria-hidden
                className="absolute top-3 left-[3px] h-full w-px bg-border"
              />
            ) : null}
            <span
              aria-hidden
              className="relative mt-1.5 size-[7px] shrink-0 rounded-full bg-foreground/70"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-sm font-medium">{eventTitle(entry)}</span>
                <time
                  dateTime={entry.createdAt}
                  title={new Date(entry.createdAt).toLocaleString()}
                  className="shrink-0 text-xs text-muted-foreground tabular-nums"
                >
                  {formatRelative(entry.createdAt, now)}
                </time>
              </div>
              <span className="text-xs text-muted-foreground">
                {entry.actorName}
                {detail ? <> · {detail}</> : null}
              </span>
            </div>
          </li>
        )
      })}
      {trailing}
    </ol>
  )
}
