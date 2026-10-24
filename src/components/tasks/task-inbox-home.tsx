import { Suspense } from "react"

import { requirePortalUser } from "@/auth"
import { getDb } from "@/db"
import type { StaffInboxPortal } from "@/lib/task-inbox-config"
import { parseTaskInboxQuery } from "@/lib/task-inbox-view"
import { roleForPortal } from "@/lib/task-ui-registry"
import { staffInbox } from "@/server/task-inbox"

import { TaskInboxTable } from "./task-inbox-table"
import { TaskNotice } from "./task-notice"
import { TaskInboxSkeleton } from "./task-skeletons"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

async function Inbox({ portal, searchParams }: { portal: StaffInboxPortal; searchParams: SearchParams }) {
  const [user, params] = await Promise.all([requirePortalUser(roleForPortal(portal)), searchParams])
  const query = parseTaskInboxQuery(params)
  const now = new Date()
  return <TaskInboxTable portal={portal} page={staffInbox(getDb(), user, query, now)} query={query} nowIso={now.toISOString()} />
}

/**
 * The inbox half of a staff home (`/onboarding`, `/finance`): the success notice and the task list,
 * behind their own Suspense boundary because both read the session. A portal page renders its
 * header and summary and then this; which columns and filters show is `TASK_INBOX_CONFIG[portal]`.
 */
export function TaskInboxHome({ portal, searchParams }: { portal: StaffInboxPortal; searchParams: SearchParams }) {
  return (
    <Suspense fallback={<TaskInboxSkeleton />}>
      <TaskNotice portal={portal} searchParams={searchParams} />
      <Inbox portal={portal} searchParams={searchParams} />
    </Suspense>
  )
}
