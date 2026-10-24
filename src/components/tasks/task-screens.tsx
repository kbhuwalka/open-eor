import type { ComponentType } from "react"

import type { Json } from "@/domain/tasks"
import type { TaskCaseSummary, TaskInboxRow } from "@/lib/task-inbox-view"
import type { Portal } from "@/lib/task-ui-registry"
import type { ActionResult } from "@/server/action-result"
import type { TaskOutcome } from "@/server/task-actions"

import { EmployeeTaskScreen } from "../employee-tasks/employee-task-screen"
import { DialogTaskScreen } from "./dialog-task-screen"
import { TASK_DIALOGS } from "./task-dialogs"
import { TaskDetailFallback } from "./task-detail-fallback"

/**
 * What every task screen receives from the generic task route (`TaskPage`), already scoped to the
 * signed-in viewer: nothing here needs another authorization check, and nothing is a trusted input
 * for a Server Action (the action re-checks everything from the session).
 */
export type TaskScreenProps = {
  portal: Portal
  /** The server's clock for this render (ISO), so "Due today" and "Was due" agree with the inbox. */
  nowIso: string
  task: TaskInboxRow
  caseSummary: TaskCaseSummary
  /** The task is ready, its case is open and the viewer may complete it. */
  canAct: boolean
  /**
   * Completes this task with `payload` (the task's own payload; the server handler validates it).
   * Use it through `useTaskOutcome`, which navigates to the next task or the inbox home on success.
   */
  onComplete: (payload?: unknown) => Promise<ActionResult<TaskOutcome>>
  /** Present only when the viewer may send the task back; `reason` is `{ code, note? }`. */
  onReject?: (reason: unknown) => Promise<ActionResult<TaskOutcome>>
  /** The registry's one-click payload; null when this type needs input. */
  completeWith: Json | null
}

export type TaskScreen = ComponentType<TaskScreenProps>

/**
 * The screens, by task `type` (the same key as `TASK_UI_REGISTRY` and the server handler registry).
 * Portal agents add their screens here: one import, one line. A type with no entry here renders
 * `DialogTaskScreen` when `TASK_DIALOGS` has a dialog for it, else `TaskDetailFallback`.
 *
 *   import { W4Screen } from "@/app/worker/tasks/w4-screen"
 *   export const TASK_SCREENS = { w4: W4Screen }
 *
 * Keep each screen a thin client or server component over a feature component; it should call
 * `props.onComplete(payload)` through `useTaskOutcome` and show `error` from it.
 */
export const TASK_SCREENS: Readonly<Record<string, TaskScreen>> = {
  accept_invitation: EmployeeTaskScreen,
  sign_agreement: EmployeeTaskScreen,
  personal_details: EmployeeTaskScreen,
  i9_section1: EmployeeTaskScreen,
  upload_documents: EmployeeTaskScreen,
  w4: EmployeeTaskScreen,
  direct_deposit: EmployeeTaskScreen,
  benefits_decision: EmployeeTaskScreen,
}

/** The screen for a task type: registered, else its dialog behind a button, else the read-only fallback. */
export function screenFor(type: string): TaskScreen {
  if (Object.hasOwn(TASK_SCREENS, type)) return TASK_SCREENS[type]
  if (Object.hasOwn(TASK_DIALOGS, type)) return DialogTaskScreen
  return TaskDetailFallback
}
