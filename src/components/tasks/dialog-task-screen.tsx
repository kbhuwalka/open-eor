"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { withNotice } from "@/lib/task-notice"
import { portalHomeHref } from "@/lib/task-ui-registry"

import { TASK_DIALOGS } from "./task-dialogs"
import { TaskDetailFallback } from "./task-detail-fallback"
import { TaskScreenFrame } from "./task-screen-frame"
import type { TaskScreenProps } from "./task-screens"

/**
 * The task route for a `dialog` type that has a registered dialog: the standard frame with the
 * action as a button that opens the same dialog the inbox row opens. After success the person goes
 * back to their inbox home with the notice.
 */
export function DialogTaskScreen(props: TaskScreenProps) {
  const { task, portal, canAct } = props
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const Dialog = Object.hasOwn(TASK_DIALOGS, task.type) ? TASK_DIALOGS[task.type] : null
  if (!Dialog || !canAct) return <TaskDetailFallback {...props} />

  return (
    <TaskScreenFrame {...props}>
      {task.detail ? <p className="text-sm text-muted-foreground">{task.detail}</p> : null}
      <div>
        <Button onClick={() => setOpen(true)} data-testid="open-task-dialog">
          {task.actionLabel}
        </Button>
      </div>
      <Dialog
        row={task}
        open={open}
        onOpenChange={setOpen}
        onDone={() => {
          setOpen(false)
          router.push(withNotice(portalHomeHref(portal), task.id))
        }}
      />
    </TaskScreenFrame>
  )
}
