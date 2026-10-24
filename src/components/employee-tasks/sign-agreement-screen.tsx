"use client"

import { useEffect, useState } from "react"
import { FileText } from "lucide-react"

import { SignDocumentButton, type SigningResult } from "@/components/signing"
import { SummaryCard, SummaryRow } from "@/components/summary-card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { EmployeeScreenData } from "@/lib/employee-screen-data"
import { longDay } from "@/lib/employee-view"
import { formatWage } from "@/lib/format"
import { prepareAgreementAction, signAgreementAction, type PreparedDocumentData } from "@/app/worker/tasks/actions"

import { CompletedPanel } from "./completed-panel"
import { FormError } from "./form-error"
import { toPrepared } from "./prepared-document"
import { EmployeeTaskFrame } from "./task-frame"
import { useTaskFlow } from "./use-task-flow"

type Data = Extract<EmployeeScreenData, { kind: "sign_agreement" }>

/**
 * Review and sign the employment agreement. The server regenerates the document (already
 * countersigned by Northwind) and says where you sign; the signing dialog opens over the real pages.
 */
export function SignAgreementScreen({ data }: { data: Data }) {
  const flow = useTaskFlow()
  const [prepared, setPrepared] = useState<PreparedDocumentData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const { order } = data
  const canSign = data.canAct && !data.completed

  useEffect(() => {
    if (!canSign) return
    let cancelled = false
    prepareAgreementAction(data.taskId).then(
      (result) => {
        if (cancelled) return
        if (result.ok) setPrepared(result.data)
        else setLoadError(result.message)
      },
      () => !cancelled && setLoadError("The agreement could not be prepared. Try again."),
    )
    return () => {
      cancelled = true
    }
  }, [canSign, data.taskId, attempt])

  async function onComplete(result: SigningResult) {
    await flow.settle(() => signAgreementAction(data.taskId, { signature: result.signature, fieldValues: result.fieldValues }))
  }

  const document = prepared ? toPrepared(prepared) : null

  return (
    <EmployeeTaskFrame
      data={data}
      description="Read your agreement with Northwind, then sign it. Northwind has already countersigned, so yours is the last signature."
    >
      {data.completed ? (
        <CompletedPanel data={{ ...data, completed: data.completed }} />
      ) : (
        <>
          <SummaryCard>
            <SummaryRow label="Employer of record">Northwind EOR, Inc.</SummaryRow>
            <SummaryRow label="Placed with">{order.employerName}</SummaryRow>
            <SummaryRow label="Position">{order.roleTitle}</SummaryRow>
            <SummaryRow label="Start date">{longDay(order.startDate)}</SummaryRow>
            <SummaryRow label="Pay">{formatWage(order.wageCents, order.wageUnit)}, paid every two weeks</SummaryRow>
            <SummaryRow label="Work state">{order.stateName}</SummaryRow>
          </SummaryCard>

          <FormError key={flow.error?.seq} message={flow.error?.message ?? loadError} />

          {loadError ? (
            <div>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setLoadError(null)
                  setAttempt((n) => n + 1)
                }}
              >
                Try again
              </Button>
            </div>
          ) : !document ? (
            <Skeleton className="h-10 w-44" aria-label="Preparing your agreement" />
          ) : (
            <div className="flex items-center gap-3">
              <SignDocumentButton
                title={prepared!.title}
                document={document.document}
                fields={document.fields}
                signer={prepared!.signer}
                onComplete={onComplete}
                disabled={!data.canAct}
                data-testid="sign-agreement"
              >
                Review and sign
              </SignDocumentButton>
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <FileText aria-hidden className="size-3.5" />
                Opens the full agreement
              </span>
            </div>
          )}
        </>
      )}
    </EmployeeTaskFrame>
  )
}
