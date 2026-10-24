import { CircleCheck } from "lucide-react"

import { requirePortalUser } from "@/auth"
import { Alert, AlertTitle } from "@/components/ui/alert"
import { getDb } from "@/db"
import { noticeTaskId } from "@/lib/task-notice"
import { roleForPortal, type Portal } from "@/lib/task-ui-registry"
import { taskNotice } from "@/server/task-page"

/**
 * The success line on the page a person lands on after finishing a task (`?notice=<taskId>`).
 * Renders nothing without the parameter, or when the viewer may not see that task. Wrap in Suspense:
 * it reads the session.
 */
export async function TaskNotice({
  portal,
  searchParams,
}: {
  portal: Portal
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const taskId = noticeTaskId(await searchParams)
  if (!taskId) return null
  const user = await requirePortalUser(roleForPortal(portal))
  const message = taskNotice(getDb(), user, portal, taskId, new Date())
  if (!message) return null
  return (
    <Alert role="status" data-testid="task-notice">
      <CircleCheck aria-hidden className="text-status-success-foreground" />
      <AlertTitle>{message}</AlertTitle>
    </Alert>
  )
}
