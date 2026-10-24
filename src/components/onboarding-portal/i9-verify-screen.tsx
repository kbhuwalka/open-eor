"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { CircleCheck, History } from "lucide-react"
import { cn } from "cn"

import { SummaryCard, SummaryRow } from "@/components/summary-card"
import type { PreparedDocument } from "@/components/signing"
import { TaskScreenFrame } from "@/components/tasks/task-screen-frame"
import type { TaskScreenProps } from "@/components/tasks/task-screens"
import { useTaskOutcome } from "@/components/tasks/use-task-outcome"
import { I9Section2Form } from "@/components/tax-forms"
import { formatDay } from "@/lib/format"
import { REJECT_CODE_LABEL } from "@/lib/onboarding-portal/i9-review"
import { acceptSection2Action, prepareSection2Action, type PreparedSection2Data } from "@/app/onboarding/tasks/actions"
import type { ActionResult } from "@/server/action-result"
import type { I9ReviewData } from "@/server/onboarding-portal/i9-review"

import { DocumentViewer } from "./document-viewer"
import { I9RejectForm } from "./i9-reject-form"

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function toPrepared(data: PreparedSection2Data): PreparedDocument {
  return { document: { pdfBytes: fromBase64(data.pdf) }, fields: data.fields }
}

async function unwrap<T>(result: Promise<ActionResult<T>>): Promise<T> {
  const outcome = await result
  if (!outcome.ok) throw new Error(outcome.message)
  return outcome.data
}

type Decision = "accept" | "reject"

/**
 * "Verify I-9 Section 2" (onboarding-portal.md §3): the uploaded documents on the left, next to
 * the decision on the right. Accept records what the specialist examined, fills the official form,
 * takes the employer representative's typed signature and completes the task. Send back names the
 * problem documents, and the engine opens the employee's fix task and a new verification behind it.
 */
export function I9VerifyScreen({ props, data }: { props: TaskScreenProps; data: I9ReviewData }) {
  const router = useRouter()
  const now = new Date(props.nowIso)
  const reject = useTaskOutcome(props.onReject)
  const [decision, setDecision] = useState<Decision>("accept")
  const open = props.canAct && !data.done

  async function accept(submission: Parameters<NonNullable<React.ComponentProps<typeof I9Section2Form>["onSubmit"]>>[0]) {
    const result = await acceptSection2Action(data.taskId, submission.data, {
      signature: submission.signature,
      fieldValues: submission.fieldValues,
    })
    if (!result.ok) throw new Error(result.message)
    router.push(result.data.nextHref)
  }

  return (
    <TaskScreenFrame {...props} rail={false} description={`Examine ${data.person}'s documents, then complete Section 2 or send them back.`}>
      {data.done ? (
        <p className="flex items-center gap-2 text-sm" data-testid="i9-verified">
          <CircleCheck aria-hidden className="size-4 text-status-success-foreground" />
          Section 2 is complete{data.verifiedAs ? `: ${data.verifiedAs.title} (${data.verifiedAs.authority})` : ""}.
        </p>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <section className="flex flex-col gap-3" aria-labelledby="docs-heading">
            <h3 id="docs-heading" className="text-base font-semibold">Uploaded documents</h3>
            <DocumentViewer documents={data.documents} nowIso={props.nowIso} />
            {data.documents.length > 0 && !data.comboValid ? (
              <p role="note" className="text-xs text-status-danger-foreground" data-testid="combo-warning">
                These uploads are not an acceptable combination. You need one List A document, or one List B and one List C document.
              </p>
            ) : null}
            {data.replaced.length > 0 ? (
              <p className="text-xs text-muted-foreground" data-testid="replaced-note">
                {data.replaced.length} earlier {data.replaced.length === 1 ? "upload was" : "uploads were"} replaced and are not shown.
              </p>
            ) : null}
          </section>

          <section className="flex flex-col gap-3" aria-labelledby="entered-heading">
            <h3 id="entered-heading" className="text-base font-semibold">What {data.person.split(" ")[0]} told us</h3>
            <SummaryCard data-testid="employee-details">
              <SummaryRow label="Legal name">{data.section1.legalName ?? "Not provided"}</SummaryRow>
              <SummaryRow label="Address">{data.section1.address ?? "Not provided"}</SummaryRow>
              <SummaryRow label="Section 1 status">{data.section1.citizenship ?? "Not completed"}</SummaryRow>
              {data.section1.workAuthExpiresOn ? (
                <SummaryRow label="Work authorization expires">{formatDay(new Date(`${data.section1.workAuthExpiresOn}T00:00:00`), now)}</SummaryRow>
              ) : null}
              <SummaryRow label="Signed Section 1">{data.section1.signedCopy ? "On file" : "No stored copy"}</SummaryRow>
            </SummaryCard>
          </section>

          <section className="flex flex-col gap-3" aria-labelledby="checklist-heading">
            <h3 id="checklist-heading" className="text-base font-semibold">Before you decide</h3>
            <ul className="overflow-hidden rounded-lg border border-border" data-testid="i9-checklist">
              {data.checklist.map((item) => (
                <li key={item.id} className="flex flex-col gap-0.5 px-4 py-3 not-first:border-t not-first:border-border">
                  <span className="text-sm font-medium">{item.label}</span>
                  <span className="text-xs text-muted-foreground">{item.rule}</span>
                </li>
              ))}
            </ul>
          </section>

          {data.history.length > 0 ? (
            <section className="flex flex-col gap-3" aria-labelledby="history-heading" data-testid="rejection-history">
              <h3 id="history-heading" className="flex items-center gap-2 text-base font-semibold">
                <History aria-hidden className="size-4 text-muted-foreground" />
                Earlier rejections
              </h3>
              <ul className="overflow-hidden rounded-lg border border-border">
                {data.history.map((entry) => (
                  <li key={entry.taskId} className="flex flex-col gap-0.5 px-4 py-3 not-first:border-t not-first:border-border" data-testid="rejection-entry">
                    <span className="text-sm font-medium">{REJECT_CODE_LABEL[entry.code]}</span>
                    {entry.note ? <span className="text-xs text-muted-foreground">{entry.note}</span> : null}
                    <span className="text-xs text-muted-foreground">
                      {entry.by} · {formatDay(new Date(entry.at), now)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {open ? (
            <>
              <div role="tablist" aria-label="Decision" className="inline-flex w-fit rounded-lg border border-border p-0.5">
                {(["accept", "reject"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={decision === value}
                    onClick={() => setDecision(value)}
                    data-testid={`decision-${value}`}
                    className={cn(
                      "rounded-md px-4 py-1.5 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      decision === value ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {value === "accept" ? "Record and sign" : "Send back"}
                  </button>
                ))}
              </div>

              {decision === "accept" ? (
                <div className="flex flex-col gap-3" data-testid="accept-panel">
                  {data.documents.length === 0 ? (
                    <p className="text-sm text-muted-foreground">There is nothing to verify until the employee uploads their documents.</p>
                  ) : (
                    <I9Section2Form
                      initial={data.prefill}
                      employeeName={data.person}
                      signerName={data.signerName}
                      today={data.today}
                      renderPreview={async (form) => toPrepared(await unwrap(prepareSection2Action(data.taskId, form)))}
                      onSubmit={accept}
                    />
                  )}
                </div>
              ) : props.onReject ? (
                <I9RejectForm
                  documents={data.documents}
                  pending={reject.pending}
                  error={reject.error}
                  onSubmit={(reason) => reject.submit(reason)}
                />
              ) : (
                <p className="text-sm text-muted-foreground">This task cannot be sent back.</p>
              )}
            </>
          ) : !data.done ? (
            <p className="text-sm text-muted-foreground" data-testid="task-waiting-note">
              {props.task.status === "blocked"
                ? "This step opens once the employee has uploaded their documents."
                : `Waiting on ${props.task.assigneeLabel}.`}
            </p>
          ) : null}
        </div>
      </div>
    </TaskScreenFrame>
  )
}
