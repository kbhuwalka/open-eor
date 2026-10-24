/**
 * The per-portal configuration of the staff home (task-inbox.md §7): one shared table and one
 * shared read model, told by this small record which columns and filters a portal shows and what it
 * says when there is nothing to do. Pure data, so a server page can name a portal and the client
 * table can look the same record up. A row's destination is not configured here: it is the task
 * UI registry's `href` for the portal, already on every row.
 */
import type { Portal } from "./task-ui-registry"

export const INBOX_COLUMNS = ["task", "person", "client", "due", "status"] as const
export type InboxColumn = (typeof INBOX_COLUMNS)[number]

export const INBOX_FILTERS = ["client", "task", "status"] as const
export type InboxFilter = (typeof INBOX_FILTERS)[number]

export type StaffInboxPortal = Extract<Portal, "onboarding" | "finance">

export type TaskInboxConfig = {
  portal: StaffInboxPortal
  /** The home the URL state is appended to. */
  basePath: string
  columns: readonly InboxColumn[]
  filters: readonly InboxFilter[]
  searchPlaceholder: string
  /** The true empty state: the viewer has no open task at all. */
  emptyMessage: string
}

export const TASK_INBOX_CONFIG: Record<StaffInboxPortal, TaskInboxConfig> = {
  onboarding: {
    portal: "onboarding",
    basePath: "/onboarding",
    columns: ["task", "person", "client", "due", "status"],
    filters: ["client", "task", "status"],
    searchPlaceholder: "Search task, person or client",
    emptyMessage: "Nothing needs you right now. New tasks show up here as orders and documents arrive.",
  },
  finance: {
    portal: "finance",
    basePath: "/finance",
    columns: ["task", "person", "client", "due", "status"],
    filters: ["client", "task", "status"],
    searchPlaceholder: "Search task, person or client",
    emptyMessage: "Nothing needs you right now. New tasks show up here as deposits arrive.",
  },
}
