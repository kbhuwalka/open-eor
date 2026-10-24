"use client"

import { useId, useState, useTransition, type ReactNode } from "react"
import { CircleAlert } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import type { ActionResult } from "@/server/action-result"

export const REASON_MAX = 300

export type ActionDialogProps<T> = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  /** Context shown between the description and the form (what is being changed). */
  children?: ReactNode
  confirmLabel: string
  pendingLabel: string
  /** `danger` is the solid confirm of C4; use it for fail and void. */
  tone?: "default" | "danger"
  /** Present means a reason is asked for; it is required unless `optional`. */
  reason?: { label: string; placeholder: string; help?: string; optional?: boolean }
  /** Runs the server action. The reason is trimmed, and non-empty when `reason` is set and not optional. */
  onConfirm: (reason: string) => Promise<ActionResult<T>>
  /** Called after a successful action, before the dialog closes. */
  onDone?: (data: T) => void
  cancelLabel?: string
  testId: string
}

/**
 * One confirm dialog for every Finance action (C10): the consequence in plain words, an optional
 * required reason, and the server's refusal shown in the dialog so nothing changes silently.
 */
export function ActionDialog<T>({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel,
  pendingLabel,
  tone = "default",
  reason,
  onConfirm,
  onDone,
  cancelLabel = "Cancel",
  testId,
}: ActionDialogProps<T>) {
  const id = useId()
  const [text, setText] = useState("")
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function handleOpenChange(next: boolean) {
    onOpenChange(next)
    if (next) {
      setText("")
      setFieldError(null)
      setError(null)
    }
  }

  function confirm() {
    const trimmed = text.trim()
    if (reason && !reason.optional && trimmed === "") {
      setFieldError("A reason is required.")
      return
    }
    if (trimmed.length > REASON_MAX) {
      setFieldError(`Keep the reason under ${REASON_MAX} characters.`)
      return
    }
    setFieldError(null)
    setError(null)
    start(async () => {
      const result = await onConfirm(trimmed)
      if (result.ok) {
        onDone?.(result.data)
        onOpenChange(false)
      } else {
        setError(result.message)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid={testId} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        {reason ? (
          <Field data-invalid={fieldError ? true : undefined}>
            <FieldLabel htmlFor={`${id}-reason`}>{reason.optional ? `${reason.label} (optional)` : `${reason.label} *`}</FieldLabel>
            <Textarea
              id={`${id}-reason`}
              value={text}
              onChange={(event) => {
                setText(event.target.value)
                if (fieldError) setFieldError(null)
              }}
              rows={3}
              maxLength={REASON_MAX + 50}
              placeholder={reason.placeholder}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? `${id}-reason-error` : undefined}
              data-testid="reason-input"
            />
            {reason.help ? <FieldDescription>{reason.help}</FieldDescription> : null}
            <FieldError id={`${id}-reason-error`} data-testid="reason-error">
              {fieldError}
            </FieldError>
          </Field>
        ) : null}
        {error ? (
          <Alert variant="destructive" data-testid="action-error">
            <CircleAlert aria-hidden />
            <AlertTitle>Nothing was changed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{cancelLabel}</DialogClose>
          <Button
            variant={tone === "danger" ? "danger" : "default"}
            disabled={pending}
            onClick={confirm}
            data-testid="action-confirm"
          >
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
