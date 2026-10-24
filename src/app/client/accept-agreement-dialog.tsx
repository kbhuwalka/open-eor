"use client"

import { lazy, Suspense } from "react"
import { CircleAlert } from "lucide-react"

import type { SigningResult } from "@/components/signing"
import type { TaskDialogProps } from "@/components/tasks/task-dialogs"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

import { signAgreementTaskAction } from "./actions"
import { usePreparedAgreement } from "./use-prepared-agreement"

/** Loaded on first open: every list with a task row imports this dialog, and signing brings pdf.js and a font. */
const SigningDialog = lazy(() => import("@/components/signing").then((module) => ({ default: module.SigningDialog })))

/**
 * The `accept_agreement` dialog (`TASK_DIALOGS`): the same signing popup the person page opens,
 * over the list it was opened from. The agreement is prepared when the dialog opens; signing runs
 * `signAgreementTaskAction`, which signs for the whole company and completes the task through the
 * engine. An agreement a colleague has signed meanwhile counts as done.
 */
export function AcceptAgreementDialog({ row, open, onOpenChange, onDone }: TaskDialogProps) {
  const { prepared, error, retry } = usePreparedAgreement(open, onDone)

  async function onComplete(result: SigningResult) {
    const response = await signAgreementTaskAction(row.caseId, row.id, {
      signature: result.signature,
      fieldValues: result.fieldValues,
    })
    if (!response.ok && response.code !== "AGREEMENT_ALREADY_SIGNED") throw new Error(response.message)
    onDone()
  }

  if (!open) return null
  const preparing = <PreparingDialog onOpenChange={onOpenChange} error={error} retry={retry} />
  if (!prepared) return preparing
  return (
    <Suspense fallback={preparing}>
      <SigningDialog
        open
        onOpenChange={onOpenChange}
        title={prepared.title}
        document={prepared.document}
        fields={prepared.fields}
        signer={prepared.signer}
        onComplete={onComplete}
      />
    </Suspense>
  )
}

function PreparingDialog({
  onOpenChange,
  error,
  retry,
}: {
  onOpenChange: (open: boolean) => void
  error: string | null
  retry: () => void
}) {
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="agreement-preparing">
        <DialogHeader>
          <DialogTitle>Sign the services agreement</DialogTitle>
          <DialogDescription>{error ? "The agreement could not be opened." : "Preparing the agreement…"}</DialogDescription>
        </DialogHeader>
        {error ? (
          <>
            <Alert variant="destructive">
              <CircleAlert aria-hidden />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <DialogFooter>
              <Button variant="outline" onClick={retry}>
                Try again
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
