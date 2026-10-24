import type { ComponentType } from "react"

import { PayDepositDialog } from "@/app/client/pay-deposit-dialog"
import type { TaskInboxRow } from "@/lib/task-inbox-view"

/** What a row's dialog receives. The dialog completes the task itself and calls `onDone` on success. */
export type TaskDialogProps = {
  row: TaskInboxRow
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The task is finished: the host closes the dialog and refreshes the page with a notice. */
  onDone: () => void
}

export type TaskDialog = ComponentType<TaskDialogProps>

/**
 * The dialogs, by task `type`, for types whose registry surface is `dialog`. A `dialog` type with no
 * entry here is not broken: its row action simply links to the registry `href` (the page that hosts
 * the action), and the task route shows the generic screen. Register a dialog to let the action open
 * in place from an inbox row:
 *
 *   export const TASK_DIALOGS = { confirm_deposit: ConfirmDepositDialog }
 *
 * A dialog is a client component that calls its own Server Action (or `completeTaskAction`) and then
 * `onDone()`; it never decides where to navigate.
 */
export const TASK_DIALOGS: Readonly<Record<string, TaskDialog>> = {
  pay_deposit: PayDepositDialog,
}
