/**
 * Who may act on a task (tasks-and-workflow.md §5.6). Authorization follows the task's
 * `actors` parties, not the assignee, so a colleague at the client can pay the deposit.
 */
import type { CaseParties, Task, TaskActor, TaskParty } from "./types"

function actsAs(party: TaskParty, actor: TaskActor, parties: CaseParties): boolean {
  switch (party) {
    case "client":
      return (
        actor.role === "client_hr" &&
        actor.clientCompanyId !== null &&
        actor.clientCompanyId === parties.clientCompanyId
      )
    case "worker":
      return actor.role === "worker" && actor.userId === parties.workerUserId
    case "specialist":
      return actor.role === "onboarding_specialist"
    case "finance":
      return actor.role === "finance"
    case "system":
      return false
  }
}

export function canActOnTask(
  task: Pick<Task, "actors">,
  actor: TaskActor | null,
  parties: CaseParties,
): boolean {
  if (!actor) return false
  return task.actors.some((party) => actsAs(party, actor, parties))
}
