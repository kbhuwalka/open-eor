"use client"

import { useId, useState } from "react"
import { CircleCheck, Info } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { OptionSelect } from "@/components/ui/option-select"
import { Textarea } from "@/components/ui/textarea"
import { REJECT_REASON_CODES } from "@/domain/types"
import { formatDay } from "@/lib/format"
import { rejectReasonText } from "@/lib/task-view"

import { TaskScreenFrame } from "./task-screen-frame"
import type { TaskScreenProps } from "./task-screens"
import { useTaskOutcome } from "./use-task-outcome"

const REASON_OPTIONS = REJECT_REASON_CODES.map((code) => ({ value: code, label: rejectReasonText({ code }) }))

/**
 * The screen every task type gets until a portal registers its own (`TASK_SCREENS`): what the task is,
 * who it waits on, when it is due, the person and company it is about, and its state. It offers
 * "Mark complete" only where the registry says the handler needs no input (`completeWith`), and
 * "Reject" only where the viewer may send the task back. Everything else is read-only.
 */
export function TaskDetailFallback(props: TaskScreenProps) {
  const { task, canAct, completeWith, onComplete, onReject, nowIso } = props
  const complete = useTaskOutcome(onComplete)
  const reject = useTaskOutcome(onReject)
  const now = new Date(nowIso)

  return (
    <TaskScreenFrame {...props}>
      {task.detail ? (
        <p className="flex items-start gap-2 rounded-lg border border-border px-4 py-3 text-sm" data-testid="task-detail-note">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          {task.detail}
        </p>
      ) : null}

      {task.status === "done" ? (
        <p className="flex items-center gap-2 text-sm" data-testid="task-done-note">
          <CircleCheck aria-hidden className="size-4 text-status-success-foreground" />
          This step is done{task.completedAt ? ` (${formatDay(new Date(task.completedAt), now)})` : ""}.
        </p>
      ) : null}

      {canAct ? (
        <div className="flex flex-col items-start gap-3">
          {completeWith !== null ? (
            <Button
              disabled={complete.pending}
              onClick={() => complete.submit(completeWith)}
              data-testid="complete-task"
            >
              {complete.pending ? "Saving…" : "Mark complete"}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="task-no-screen">
              This step needs details that its own screen will collect, and that screen is not available yet.
            </p>
          )}
          {complete.error ? (
            <p role="alert" className="text-xs text-destructive">
              {complete.error}
            </p>
          ) : null}
          {onReject ? <RejectDialog title={task.title} run={reject} /> : null}
        </div>
      ) : task.status === "ready" || task.status === "blocked" ? (
        <p className="text-sm text-muted-foreground" data-testid="task-waiting-note">
          {task.status === "blocked"
            ? "This step opens once the steps before it are done."
            : `Waiting on ${task.assigneeLabel}.`}
        </p>
      ) : null}
    </TaskScreenFrame>
  )
}

function RejectDialog({ title, run }: { title: string; run: ReturnType<typeof useTaskOutcome> }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState<string>(REJECT_REASON_CODES[0])
  const [note, setNote] = useState("")
  const needsNote = code === "OTHER"

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) run.clearError()
      }}
    >
      <DialogTrigger render={<Button variant="destructive" />} data-testid="reject-task">
        Reject
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send &ldquo;{title}&rdquo; back?</DialogTitle>
          <DialogDescription>The work is returned for rework. Say why so the right person can fix it.</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor={`${id}-reason`}>Reason *</FieldLabel>
          <OptionSelect id={`${id}-reason`} options={REASON_OPTIONS} value={code} onValueChange={setCode} />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-note`}>{needsNote ? "Note *" : "Note (optional)"}</FieldLabel>
          <Textarea id={`${id}-note`} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          <FieldError>{run.error}</FieldError>
        </Field>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Keep it</DialogClose>
          <Button
            variant="danger"
            disabled={run.pending || (needsNote && note.trim() === "")}
            data-testid="confirm-reject"
            onClick={() => run.submit({ code, ...(note.trim() ? { note: note.trim() } : {}) })}
          >
            {run.pending ? "Sending back…" : "Send back"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
