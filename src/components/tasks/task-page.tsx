import { createElement, Suspense } from "react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"

import { requirePortalUser } from "@/auth"
import { getDb } from "@/db"
import { roleForPortal, type Portal } from "@/lib/task-ui-registry"
import { completeTaskAction, rejectTaskAction } from "@/server/task-actions"
import { loadTaskPage } from "@/server/task-page"

import { TaskNotice } from "./task-notice"
import { TaskPageSkeleton } from "./task-skeletons"
import { screenFor } from "./task-screens"

/** The link back to each portal's inbox home (ui-guidelines L7: a primary back link). */
const BACK_LABEL: Record<Portal, string> = {
  client: "Back to People",
  worker: "Back to your checklist",
  onboarding: "Back to the queue",
  finance: "Back to Finance",
}

type Params = Promise<{ taskId: string }>
type SearchParams = Promise<Record<string, string | string[] | undefined>>

/**
 * The generic task route, shared by `/client/tasks/[taskId]`, `/worker/tasks/[taskId]`,
 * `/onboarding/tasks/[taskId]` (task-inbox.md §4). It loads the task for
 * the session user (`loadTaskPage`: portal, registry and actor/assignee checks; anything that fails is
 * a 404), picks the screen for its type (`screenFor`) and hands it the viewer-scoped data plus
 * Server Actions bound to this task. No portal page re-implements any of this. `searchParams` carries
 * the `?notice=` of the task that was just finished, so the next task's page confirms it.
 */
export function TaskPage({ portal, params, searchParams }: { portal: Portal; params: Params; searchParams: SearchParams }) {
  return (
    <Suspense fallback={<TaskPageSkeleton />}>
      <TaskPageContent portal={portal} params={params} searchParams={searchParams} />
    </Suspense>
  )
}

async function TaskPageContent({ portal, params, searchParams }: { portal: Portal; params: Params; searchParams: SearchParams }) {
  const [{ taskId }, user] = await Promise.all([params, requirePortalUser(roleForPortal(portal))])
  const now = new Date()
  const data = loadTaskPage(getDb(), user, portal, taskId, now)
  if (!data) notFound()

  const screen = screenFor(data.row.type)
  return (
    <div className="flex flex-col gap-8">
      <Link href={`/${portal}`} className="inline-flex w-fit items-center gap-1.5 text-sm text-primary hover:underline">
        <ArrowLeft className="size-3.5" aria-hidden />
        {BACK_LABEL[portal]}
      </Link>
      <TaskNotice portal={portal} searchParams={searchParams} />
      {createElement(screen, {
        portal,
        nowIso: now.toISOString(),
        task: data.row,
        caseSummary: data.caseSummary,
        canAct: data.canAct,
        completeWith: data.completeWith,
        onComplete: completeTaskAction.bind(null, data.row.id),
        onReject: data.rejectable ? rejectTaskAction.bind(null, data.row.id) : undefined,
      })}
    </div>
  )
}
