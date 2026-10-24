"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { formatCents } from "@/lib/format"
import type { OnboardingTaskView } from "@/server/queries"

import { payDepositTask, signAgreementTaskAction } from "../../actions"
import { AgreementSignButton } from "../../agreement-sign-button"

type Run = (caseId: string, taskId: string) => Promise<{ ok: true } | { ok: false; message: string }>

function ActionButton({
  caseId,
  taskId,
  run,
  label,
  pendingLabel,
  testId,
  description,
}: {
  caseId: string
  taskId: string
  run: Run
  label: string
  pendingLabel: string
  testId: string
  description?: string
}) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="flex flex-col items-start gap-2">
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      <Button
        size="sm"
        disabled={pending}
        data-testid={testId}
        onClick={() =>
          start(async () => {
            const result = await run(caseId, taskId)
            setError(result.ok ? null : result.message)
          })
        }
      >
        {pending ? pendingLabel : label}
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** Signs the company's master agreement from the Onboarding tab; the engine completes the task. */
function AcceptAgreement({
  caseId,
  taskId,
  description,
  markupPct,
}: {
  caseId: string
  taskId: string
  description: string
  markupPct: number | null
}) {
  const router = useRouter()
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-xs text-muted-foreground">
        {description}
        {markupPct === null ? "" : ` The service fee is ${markupPct}% of wage.`}
      </p>
      <AgreementSignButton
        size="sm"
        sign={(input) => signAgreementTaskAction(caseId, taskId, input)}
        onSigned={() => router.refresh()}
      />
    </div>
  )
}

/**
 * Inline controls for tasks the client can finish from the Onboarding tab. Anything else the
 * client is a party to has no inline control yet and renders nothing.
 */
export function TaskAction({
  caseId,
  task,
  markupPct,
}: {
  caseId: string
  task: Pick<OnboardingTaskView, "id" | "type" | "description" | "clientCanAct" | "amountCents">
  markupPct: number | null
}) {
  if (!task.clientCanAct) return null
  switch (task.type) {
    case "accept_agreement":
      return <AcceptAgreement caseId={caseId} taskId={task.id} description={task.description} markupPct={markupPct} />
    case "pay_deposit": {
      const amount = task.amountCents === null ? "" : ` ${formatCents(task.amountCents)}`
      return (
        <ActionButton
          caseId={caseId}
          taskId={task.id}
          run={payDepositTask}
          label={`Pay deposit${amount}`}
          pendingLabel="Paying…"
          testId="pay-deposit"
          description={task.description}
        />
      )
    }
    default:
      return null
  }
}
