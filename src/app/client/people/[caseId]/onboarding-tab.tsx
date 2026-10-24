import { ChevronRight } from "lucide-react"

import { CaseTimeline } from "@/components/case-timeline"
import { OnboardingStages } from "@/components/onboarding-stages"
import type { ClientPersonDetail } from "@/server/queries"

import { TaskAction } from "./task-actions"

/**
 * The client's Onboarding tab: the stage stepper, then the case's own activity (order, agreement,
 * notes from Northwind) in a collapsed note. Task completions are not repeated there: they are
 * the stages above.
 */
export function OnboardingTab({ person, now }: { person: ClientPersonDetail; now: Date }) {
  const activity = person.timeline.filter((entry) => entry.type !== "task_completed" && entry.type !== "task_rejected")

  return (
    <div className="flex flex-col gap-8">
      <OnboardingStages
        stages={person.onboarding.stages}
        audience="client"
        workerName={person.worker.displayName}
        startDate={person.startDate}
        now={now}
        renderAction={(item) => (
          <TaskAction
            caseId={person.caseId}
            task={{
              id: item.id,
              type: item.type,
              description: item.description,
              amountCents: item.amountCents,
              clientCanAct: item.canAct,
            }}
            markupPct={person.agreement?.markupPct ?? null}
          />
        )}
      />
      {activity.length > 0 ? (
        <details className="group" data-testid="activity">
          <summary className="inline-flex w-fit cursor-pointer list-none items-center gap-1 rounded-md text-sm text-muted-foreground transition-colors outline-none select-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden className="size-3.5 transition-transform group-open:rotate-90" />
            Activity
          </summary>
          <div className="mt-3 pl-[1.125rem]">
            <CaseTimeline entries={activity} now={now} />
          </div>
        </details>
      ) : null}
    </div>
  )
}
