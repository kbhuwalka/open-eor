/**
 * The per-portal configuration of the staff home (task-inbox.md §7). Only the Onboarding home is a
 * task inbox now (the Finance Home is its own page, finance-portal.md §2.6); this record holds what
 * its list says when there is nothing to do. Pure data.
 */
import type { Portal } from "./task-ui-registry"

export type StaffInboxPortal = Extract<Portal, "onboarding">

export type TaskInboxConfig = {
  portal: StaffInboxPortal
  /** The true empty state: the viewer has no open task at all. */
  emptyMessage: string
}

export const TASK_INBOX_CONFIG: Record<StaffInboxPortal, TaskInboxConfig> = {
  onboarding: {
    portal: "onboarding",
    emptyMessage: "Nothing needs you right now. New tasks show up here as orders and documents arrive.",
  },
}
