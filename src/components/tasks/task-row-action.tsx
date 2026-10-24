"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import type { TaskInboxRow } from "@/lib/task-inbox-view"
import { withNotice } from "@/lib/task-notice"
import { completeTaskAction } from "@/server/task-actions"

import { TASK_DIALOGS } from "./task-dialogs"

/**
 * A row's action, by the registry's surface (task-inbox.md §2): an `inline` task completes in place,
 * a `dialog` task opens its registered dialog (`TASK_DIALOGS`) and a `page` task, or a dialog type
 * with no registered dialog, links to the row's `href`. After an in-place completion the page
 * reloads with the `?notice=` success line and the row is gone.
 */
export function TaskRowAction({
  row,
  variant = "outline",
  size = "sm",
  label,
}: {
  row: TaskInboxRow
  variant?: "default" | "outline" | "ghost"
  size?: "default" | "sm"
  /** Overrides the registry's `actionLabel` (the to-do list says "Continue"). */
  label?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const text = label ?? row.actionLabel

  function finished() {
    setOpen(false)
    router.replace(withNotice(pathname, row.id))
    router.refresh()
  }

  if (row.surface === "inline" && row.inlinePayload !== null) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button
          variant={variant}
          size={size}
          disabled={pending}
          data-testid="task-action"
          data-task-type={row.type}
          onClick={() =>
            start(async () => {
              const result = await completeTaskAction(row.id, row.inlinePayload)
              if (result.ok) finished()
              else setError(result.message)
            })
          }
        >
          {pending ? "Saving…" : text}
        </Button>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    )
  }

  if (row.surface === "dialog" && Object.hasOwn(TASK_DIALOGS, row.type)) {
    const Dialog = TASK_DIALOGS[row.type]
    return (
      <>
        <Button variant={variant} size={size} onClick={() => setOpen(true)} data-testid="task-action" data-task-type={row.type}>
          {text}
        </Button>
        <Dialog row={row} open={open} onOpenChange={setOpen} onDone={finished} />
      </>
    )
  }

  return (
    <Button
      variant={variant}
      size={size}
      render={<Link href={row.href} />}
      nativeButton={false}
      data-testid="task-action"
      data-task-type={row.type}
    >
      {text}
    </Button>
  )
}
