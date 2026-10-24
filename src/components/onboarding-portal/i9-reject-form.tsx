"use client"

import { useId, useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { OptionSelect } from "@/components/ui/option-select"
import { Textarea } from "@/components/ui/textarea"
import type { RejectReason, RejectReasonCode } from "@/domain/types"
import {
  REJECT_CODE_OPTIONS,
  buildRejectReason,
  rejectionProblem,
  type UploadedDocumentView,
} from "@/lib/onboarding-portal/i9-review"

import { documentLabel } from "./document-viewer"

/**
 * Sends the identity documents back (onboarding-portal.md §3): choose which documents are the problem,
 * a reason code and, when it helps, a note. The reason names the documents so the employee sees which
 * ones to replace; the engine spawns the "fix documents" task and a new verification behind it.
 */
export function I9RejectForm({
  documents,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  documents: UploadedDocumentView[]
  pending: boolean
  error: string | null
  onSubmit: (reason: RejectReason) => void
  onCancel?: () => void
}) {
  const id = useId()
  const [chosen, setChosen] = useState<string[]>([])
  const [code, setCode] = useState<RejectReasonCode>("DOC_ILLEGIBLE")
  const [note, setNote] = useState("")
  const [touched, setTouched] = useState(false)

  const labels = documents.filter((doc) => chosen.includes(doc.id)).map((doc) => `${documentLabel(doc)} (${doc.fileName})`)
  const problem = touched ? rejectionProblem({ code, note, documents: labels }) : null

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        setTouched(true)
        if (rejectionProblem({ code, note, documents: labels })) return
        onSubmit(buildRejectReason({ code, note, documents: labels }))
      }}
      data-testid="i9-reject-form"
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Which documents are the problem?</legend>
        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">There are no uploaded documents to send back.</p>
        ) : (
          documents.map((doc) => (
            <label key={doc.id} className="flex items-center gap-3 rounded-lg border border-border px-4 py-3 text-sm">
              <input
                type="checkbox"
                className="size-4 shrink-0 accent-primary"
                checked={chosen.includes(doc.id)}
                onChange={(event) => setChosen((list) => (event.target.checked ? [...list, doc.id] : list.filter((item) => item !== doc.id)))}
                data-testid={`reject-doc-${doc.kind}`}
              />
              <span className="flex min-w-0 flex-col">
                <span className="font-medium">{documentLabel(doc)}</span>
                <span className="truncate text-xs text-muted-foreground">{doc.fileName}</span>
              </span>
            </label>
          ))
        )}
      </fieldset>

      <Field className="gap-1.5">
        <FieldLabel className="font-normal text-muted-foreground">Reason</FieldLabel>
        <OptionSelect options={REJECT_CODE_OPTIONS} value={code} onValueChange={(value) => setCode(value as RejectReasonCode)} data-testid="reject-code" />
      </Field>

      <Field className="gap-1.5">
        <FieldLabel htmlFor={`${id}-note`} className="font-normal text-muted-foreground">
          {code === "OTHER" ? "What is wrong" : "Note for the employee (optional)"}
        </FieldLabel>
        <Textarea
          id={`${id}-note`}
          value={note}
          maxLength={400}
          onChange={(event) => setNote(event.target.value)}
          aria-invalid={problem && code === "OTHER" && note.trim() === "" ? true : undefined}
          placeholder="For example: the photo is cut off on the right-hand side"
          data-testid="reject-note"
        />
      </Field>

      {problem ? (
        <p role="alert" className="text-xs text-destructive" data-testid="reject-problem">
          {problem}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive" data-testid="action-error">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="destructive" disabled={pending} data-testid="send-back">
          {pending ? "Sending back…" : "Send back to employee"}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" disabled={pending} onClick={onCancel} data-testid="send-back-cancel">
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  )
}
