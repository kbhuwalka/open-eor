/**
 * Plain-language wording for the stage projection: the status headline, the one-line summary of
 * a stage and who owns a step, per audience. Pure; shared by server read models and components.
 */
import type { ProjectedStage, StageAudience, StageWaitingOn, TaskParty } from "@/domain/tasks"
import { parseDay } from "./task-view"

export type StageHeadline = {
  text: string
  /** `you`: the viewer has something to do; `waiting`: waiting on someone else; `done`: nothing left. */
  tone: "you" | "waiting" | "done"
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}

/** "Mon, Jan 12". */
export function formatStartDay(iso: string): string {
  return parseDay(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

export function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ""
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
}

/** Who a step belongs to, as the audience should read it. Provider staff collapse to "Northwind" for customers. */
export function ownerText(party: TaskParty, audience: StageAudience, workerName: string): string {
  switch (audience) {
    case "client":
      return party === "client" ? "You" : party === "worker" ? firstName(workerName) : "Northwind"
    case "worker":
      return party === "worker" ? "You" : party === "client" ? "Your employer" : "Northwind"
    case "staff":
      return party === "client"
        ? "Client"
        : party === "worker"
          ? firstName(workerName)
          : party === "specialist"
            ? "Onboarding specialist"
            : party === "finance"
              ? "Finance"
              : "Automatic"
  }
}

function waiterText(waitingOn: StageWaitingOn, audience: StageAudience, workerName: string, short = false): string {
  if (waitingOn === "northwind") return "Northwind"
  if (audience === "worker") return waitingOn === "employee" ? "you" : "your employer"
  if (waitingOn === "client") return audience === "client" ? "you" : "the client"
  return audience === "client" && !short ? workerName : firstName(workerName)
}

/** The mainline stages; after-start work never drives the headline. */
function mainline(stages: ProjectedStage[]): ProjectedStage[] {
  return stages.filter((stage) => !stage.quiet)
}

function startsLater(startDate: string | null, now: Date): startDate is string {
  return startDate !== null && parseDay(startDate).getTime() > now.getTime()
}

/** One sentence of status for the top of the Onboarding tab. */
export function stageHeadline(input: {
  stages: ProjectedStage[]
  audience: StageAudience
  workerName: string
  startDate: string | null
  now: Date
}): StageHeadline {
  const { audience, workerName, startDate, now } = input
  const main = mainline(input.stages)
  const open = main.filter((stage) => stage.status !== "complete")
  const asks = open.flatMap((stage) => stage.needsYou)

  if (audience === "worker") {
    if (asks.length > 0) return { text: `Next up: ${asks[0].label}`, tone: "you" }
    if (open.length === 0) {
      return {
        text: startsLater(startDate, now) ? `You're all set. You start ${formatStartDay(startDate)}.` : "You're all set.",
        tone: "done",
      }
    }
    return { text: "Nothing to do yet. We'll let you know when it's your turn.", tone: "waiting" }
  }

  if (audience === "client" && asks.length > 0) {
    return { text: `Waiting on you: ${joinList(asks.map((item) => lowerFirst(item.label)))}`, tone: "you" }
  }

  const onlyStart = open.length > 0 && open.every((stage) => stage.milestone && stage.status === "current")
  if (open.length === 0 || onlyStart) {
    if (startDate && startsLater(startDate, now)) {
      return { text: `All set — starts ${formatStartDay(startDate)}`, tone: "done" }
    }
    return { text: `All set — ${firstName(workerName)} has started`, tone: "done" }
  }

  if (audience === "staff" && asks.length > 0) {
    return { text: `Waiting on Northwind: ${joinList(asks.map((item) => lowerFirst(item.label)))}`, tone: "waiting" }
  }

  const stage =
    open.find((candidate) => candidate.rework !== null && candidate.waitingOn !== null) ??
    open.find((candidate) => candidate.status === "current" && candidate.waitingOn !== null)
  if (stage?.waitingOn) {
    const what = stage.rework ? lowerFirst(stage.rework.label) : lowerFirst(stage.waitingLabel)
    const counts =
      !stage.rework && stage.visibleProgress.total >= 2
        ? ` — ${stage.visibleProgress.done} of ${stage.visibleProgress.total} done`
        : ""
    return {
      text: `Waiting on ${waiterText(stage.waitingOn, audience, workerName)}: ${what}${counts}`,
      tone: "waiting",
    }
  }
  return { text: `In progress: ${open[0].title}`, tone: "waiting" }
}

/** The muted line under a stage title: counts, who it waits on, or when it starts. */
export function stageSummary(stage: ProjectedStage, audience: StageAudience, workerName: string, now: Date): string {
  if (stage.status === "complete") return "Done"
  if (stage.milestone && stage.dueDate) {
    return parseDay(stage.dueDate).getTime() > now.getTime() ? `Starts ${formatStartDay(stage.dueDate)}` : "Starting now"
  }
  if (stage.status === "upcoming") return "Not started"
  if (stage.status === "blocked") return "Waiting on earlier steps"
  const parts: string[] = []
  if (stage.visibleProgress.total >= 2) {
    parts.push(`${stage.visibleProgress.done} of ${stage.visibleProgress.total} steps done`)
  }
  if (stage.waitingOn) parts.push(`waiting on ${waiterText(stage.waitingOn, audience, workerName, true)}`)
  return parts.join(" · ") || "In progress"
}

/** Complete stages out of the mainline stages: the progress shown in the people list. */
export function stageProgress(stages: ProjectedStage[]): { done: number; total: number } {
  const main = mainline(stages)
  return { done: main.filter((stage) => stage.status === "complete").length, total: main.length }
}
