"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { PenLine } from "lucide-react"
import { cn } from "cn"

import { SignedBadge } from "@/components/signing/signature-summary"
import { SigningDialog } from "@/components/signing/signing-dialog"
import type { PreparedDocument, SigningResult, SigningSigner } from "@/components/signing/signing-types"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { FieldLegend, FieldSet } from "@/components/ui/field"
import { SummaryCard } from "@/components/summary-card"
import { hasErrors, pickErrors, type FieldErrors } from "@/domain/forms"

/**
 * Produces the filled, still unsigned PDF and the places to sign it (`SignatureField[]`). Called
 * when the review step opens; typically a Server Action wrapper around a generator in
 * `src/server/documents`.
 */
export type RenderPreview<T> = (data: T) => Promise<PreparedDocument>

/** What `onSubmit` receives: the answers, the adopted signature and consent time, and every field's value. */
export type SignedSubmission<T> = {
  data: T
  signature: SigningResult["signature"]
  fieldValues: SigningResult["fieldValues"]
}

/** The signer for `ReviewAndSign`: prefilled with the fullest name, accepting every listed form of it. */
export function signerFrom(names: string | readonly string[], role: string): SigningSigner {
  const accepted = typeof names === "string" ? [names] : [...names]
  return { name: accepted.at(-1) ?? "", role, acceptedNames: accepted }
}

type StepDef = { readonly id: string; readonly label: string; readonly fields: readonly string[] }

/**
 * Step state for a wizard: the current step, per-step validation against the domain validator
 * (errors appear after the first failed Continue and then track the draft live), and focus on the
 * first invalid control. The step after the last one is the review step.
 */
export function useWizard(steps: readonly StepDef[], validateAll: () => FieldErrors) {
  const [index, setIndex] = useState(0)
  const [attempted, setAttempted] = useState(false)
  const [failures, setFailures] = useState(0)
  const [container, setContainer] = useState<HTMLElement | null>(null)

  const step = steps[index] as StepDef | undefined
  const all = validateAll()
  const errors: FieldErrors = attempted && step ? pickErrors(all, step.fields) : {}

  useEffect(() => {
    if (failures === 0) return
    container?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [failures, container])

  function next() {
    if (step && hasErrors(pickErrors(all, step.fields))) {
      setAttempted(true)
      setFailures((n) => n + 1)
      return
    }
    setAttempted(false)
    setIndex((i) => Math.min(i + 1, steps.length))
    window.scrollTo?.({ top: 0 })
  }

  function back() {
    setAttempted(false)
    setIndex((i) => Math.max(i - 1, 0))
    window.scrollTo?.({ top: 0 })
  }

  return { index, step, isReview: index >= steps.length, errors, bindContainer: setContainer, next, back, all }
}

export function StepIndicator({ steps, current }: { steps: readonly { id: string; label: string }[]; current: number }) {
  return (
    <ol aria-label="Progress" className="flex flex-wrap gap-x-5 gap-y-1 text-xs" data-testid="step-indicator">
      {steps.map((s, i) => (
        <li
          key={s.id}
          aria-current={i === current ? "step" : undefined}
          className={cn(i === current ? "font-medium text-foreground" : "text-muted-foreground")}
        >
          {s.label}
        </li>
      ))}
    </ol>
  )
}

export function StepSection({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <FieldSet>
      <FieldLegend variant="label">{title}</FieldLegend>
      {description ? <p className="-mt-2 text-sm text-muted-foreground">{description}</p> : null}
      {children}
    </FieldSet>
  )
}

export function StepActions({
  onBack,
  onContinue,
  continueLabel = "Continue",
  onCancel,
}: {
  onBack?: () => void
  onContinue: () => void
  continueLabel?: string
  onCancel?: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      <Button type="button" onClick={onContinue} data-testid="wizard-continue">
        {continueLabel}
      </Button>
      {onBack ? (
        <Button type="button" variant="outline" onClick={onBack} data-testid="wizard-back">
          Back
        </Button>
      ) : null}
      {onCancel && !onBack ? (
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      ) : null}
    </div>
  )
}

type PreviewState = { status: "loading" } | { status: "ready"; prepared: PreparedDocument } | { status: "error"; message: string }

/**
 * Last step of every wizard: a summary of what was entered and one "Review and sign" button. The
 * filled PDF is built as soon as the step opens; the button opens the `SigningDialog` over it, where
 * the signer clicks the yellow tags. `onSign` runs the caller's `onSubmit`; once it resolves the
 * button gives way to a "signed" confirmation.
 */
export function ReviewAndSign({
  title = "Review and sign",
  summary,
  loadDocument,
  documentTitle,
  signer,
  onSign,
  onBack,
}: {
  title?: string
  summary: ReactNode
  loadDocument: () => Promise<PreparedDocument>
  documentTitle: string
  signer: SigningSigner
  onSign: (result: SigningResult) => void | Promise<void>
  onBack: () => void
}) {
  const [preview, setPreview] = useState<PreviewState>({ status: "loading" })
  const [attempt, setAttempt] = useState(0)
  const [open, setOpen] = useState(false)
  const [signed, setSigned] = useState<{ name: string; at: string } | null>(null)
  const loader = useRef(loadDocument)

  useEffect(() => {
    loader.current = loadDocument
  })

  useEffect(() => {
    let cancelled = false
    loader
      .current()
      .then((prepared) => {
        if (!cancelled) setPreview({ status: "ready", prepared })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setPreview({ status: "error", message: error instanceof Error ? error.message : "Could not build the document." })
        }
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  return (
    <div className="flex flex-col gap-8" data-testid="review-step">
      <StepSection title={title} description="Check your answers. Next, review the completed form and sign it on the page.">
        <SummaryCard data-testid="review-summary">{summary}</SummaryCard>
      </StepSection>

      {preview.status === "error" ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Could not build the document</AlertTitle>
          <AlertDescription>
            {preview.message}{" "}
            <button
              type="button"
              className="underline underline-offset-4"
              onClick={() => {
                setPreview({ status: "loading" })
                setAttempt((n) => n + 1)
              }}
            >
              Try again
            </button>
          </AlertDescription>
        </Alert>
      ) : null}

      {signed ? (
        <div className="flex flex-col gap-3" data-testid="signed-confirmation">
          <SignedBadge signerName={signed.name} signedAt={signed.at} className="self-start" />
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={() => setOpen(true)}
            disabled={preview.status !== "ready"}
            data-testid="review-and-sign"
          >
            <PenLine data-icon="inline-start" />
            {preview.status === "loading" ? "Preparing your document…" : "Review and sign"}
          </Button>
          <Button type="button" variant="outline" onClick={onBack} data-testid="wizard-back">
            Back
          </Button>
        </div>
      )}

      {preview.status === "ready" ? (
        <SigningDialog
          open={open}
          onOpenChange={setOpen}
          title={documentTitle}
          document={preview.prepared.document}
          fields={preview.prepared.fields}
          signer={signer}
          onComplete={async (result) => {
            await onSign(result)
            setSigned({ name: result.signature.typedName, at: new Date().toISOString() })
          }}
        />
      ) : null}
    </div>
  )
}
