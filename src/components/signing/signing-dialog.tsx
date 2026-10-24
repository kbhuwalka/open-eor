"use client"

import { useId, useMemo, useRef, useState } from "react"
import { X } from "lucide-react"
import { cn } from "cn"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ESIGN_CONSENT_LABEL, ESIGN_DISCLOSURE_SHORT, type SignatureField } from "@/domain/forms"

import { AdoptSignatureDialog, type AdoptedSignature } from "./adopt-signature-dialog"
import { PdfPages } from "./pdf-pages"
import { SignatureTag } from "./signature-tag"
import type { SignedFieldValue, SigningDocumentSource, SigningResult, SigningSigner } from "./signing-types"
import { formatSigningDate, sortFields } from "./signing-utils"

export type SigningDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Shown in the top bar, e.g. "Employment Agreement". */
  title: string
  document: SigningDocumentSource
  signer: SigningSigner
  /** All fields of the document; only those whose `signerRole` is the signer's are shown. */
  fields: readonly SignatureField[]
  /**
   * Called when the signer presses Finish with the adopted signature and every field's value. May
   * return a promise: the dialog stays open with a pending Finish button, shows the error if it
   * rejects and closes itself when it resolves.
   */
  onComplete: (result: SigningResult) => void | Promise<void>
  /** Called when the signer declines (or closes the dialog and confirms). Nothing was signed. */
  onDecline?: () => void
}

/**
 * The DocuSign-style signing experience in one near-full-screen dialog: the real document pages with
 * yellow tags on them, a sticky bar with progress and Start/Next/Finish, a first-use electronic
 * records consent, and a nested "Adopt your signature" dialog. Nothing is stored or sent until
 * `onComplete` runs; the caller then asks its server to apply the signature.
 */
export function SigningDialog(props: SigningDialogProps) {
  const { open, onOpenChange, onDecline } = props
  const [confirmingExit, setConfirmingExit] = useState(false)
  const [busy, setBusy] = useState(false)

  function decline() {
    setConfirmingExit(false)
    onDecline?.()
    onOpenChange(false)
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next) onOpenChange(true)
          else if (!busy) setConfirmingExit(true)
        }}
      >
        {open ? (
          <DialogContent
            showCloseButton={false}
            className="inset-2 top-2 left-2 h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-none translate-x-0 translate-y-0 grid-rows-[auto_1fr] gap-0 overflow-hidden p-0 sm:max-w-none"
            data-testid="signing-dialog"
          >
            <SigningSession {...props} onBusyChange={setBusy} onRequestExit={() => setConfirmingExit(true)} />
            <Dialog open={confirmingExit} onOpenChange={setConfirmingExit}>
              {confirmingExit ? (
                <DialogContent className="sm:max-w-md" showCloseButton={false} data-testid="exit-dialog">
                  <DialogHeader>
                    <DialogTitle>Decline to sign?</DialogTitle>
                    <DialogDescription>
                      Nothing has been signed. You can come back and review and sign this document whenever you are ready.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter className="-mx-6 -mb-6 p-6">
                    <Button type="button" variant="outline" onClick={() => setConfirmingExit(false)} data-testid="exit-keep">
                      Keep signing
                    </Button>
                    <Button type="button" variant="danger" onClick={decline} data-testid="exit-confirm">
                      Decline to sign
                    </Button>
                  </DialogFooter>
                </DialogContent>
              ) : null}
            </Dialog>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  )
}

function SigningSession({
  onOpenChange,
  title,
  document,
  signer,
  fields,
  onComplete,
  onBusyChange,
  onRequestExit,
}: SigningDialogProps & { onBusyChange: (busy: boolean) => void; onRequestExit: () => void }) {
  const consentId = useId()
  const scroller = useRef<HTMLDivElement>(null)
  const consentBox = useRef<HTMLInputElement>(null)

  const [consentedAt, setConsentedAt] = useState<string | null>(null)
  const [adopted, setAdopted] = useState<AdoptedSignature | null>(null)
  const [values, setValues] = useState<Record<string, SignedFieldValue>>({})
  const [activeId, setActiveId] = useState<string | null>(null)
  const [started, setStarted] = useState(false)
  const [adoptFor, setAdoptFor] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const mine = useMemo(() => sortFields(fields.filter((f) => f.signerRole === signer.role)), [fields, signer.role])
  const interactive = mine.filter((f) => f.kind !== "date")
  const required = interactive.filter((f) => f.required)
  const completed = required.filter((f) => values[f.id] !== undefined).length
  const allDone = completed === required.length
  const expectedNames = signer.acceptedNames ?? (signer.name ? [signer.name] : [])
  const consented = consentedAt !== null

  function focusTag(id: string) {
    const tag = Array.from(scroller.current?.querySelectorAll<HTMLElement>("[data-field-id]") ?? []).find((el) => el.dataset.fieldId === id)
    if (!tag) return
    setActiveId(id)
    tag.scrollIntoView?.({ block: "center", behavior: "smooth" })
    tag.focus({ preventScroll: true })
  }

  function focusConsent() {
    const box = consentBox.current
    box?.scrollIntoView?.({ block: "center", behavior: "smooth" })
    box?.focus({ preventScroll: true })
  }

  function startOrNext() {
    if (!consented) {
      focusConsent()
      return
    }
    setStarted(true)
    const remaining = required.filter((f) => values[f.id] === undefined)
    if (remaining.length === 0) return
    const after = interactive.findIndex((f) => f.id === activeId)
    const target = remaining.find((f) => interactive.indexOf(f) > after) ?? remaining[0]
    focusTag(target.id)
  }

  function complete(field: SignatureField, signature: AdoptedSignature, now: Date, previous: Record<string, SignedFieldValue>) {
    const iso = now.toISOString()
    const next = { ...previous }
    next[field.id] = { kind: field.kind, value: field.kind === "initials" ? signature.initials : signature.typedName, signedAt: iso }
    if (field.kind === "signature") {
      const date = formatSigningDate(now)
      for (const d of mine) {
        if (d.kind === "date" && (d.linkedTo === field.id || (!d.linkedTo && !next[d.id]))) {
          next[d.id] = { kind: "date", value: date, signedAt: iso }
        }
      }
    }
    return next
  }

  function activate(field: SignatureField) {
    if (!consented) {
      focusConsent()
      return
    }
    setActiveId(field.id)
    if (values[field.id] === undefined && adopted) {
      setValues((prev) => complete(field, adopted, new Date(), prev))
      return
    }
    setAdoptFor(field.id)
  }

  function adopt(signature: AdoptedSignature) {
    const field = mine.find((f) => f.id === adoptFor)
    setAdopted(signature)
    setAdoptFor(null)
    if (!field) return
    setValues((prev) => {
      if (prev[field.id] === undefined) return complete(field, signature, new Date(), prev)
      const changed = { ...prev }
      for (const f of interactive) {
        const existing = changed[f.id]
        if (existing) changed[f.id] = { ...existing, value: f.kind === "initials" ? signature.initials : signature.typedName }
      }
      return changed
    })
  }

  async function finish() {
    if (!allDone || !adopted || !consentedAt || pending) return
    setPending(true)
    onBusyChange(true)
    setFailure(null)
    try {
      await onComplete({
        signature: { typedName: adopted.typedName, initials: adopted.initials, consentedAt },
        fieldValues: values,
      })
      onOpenChange(false)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Your signature could not be recorded. Try again.")
      setPending(false)
      onBusyChange(false)
    }
  }

  const adoptingField = mine.find((f) => f.id === adoptFor)
  const adoptingSigned = adoptingField !== undefined && values[adoptingField.id] !== undefined

  return (
    <>
      <header
        className="z-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-background px-4 py-3"
        data-testid="signing-bar"
      >
        <div className="min-w-0 flex-1 basis-48">
          <DialogTitle className="truncate text-base">{title}</DialogTitle>
          <DialogDescription className="truncate text-xs">
            Signing as {signer.name || signer.role} · {signer.role}
          </DialogDescription>
        </div>

        <div className="flex items-center gap-3" aria-live="polite" data-testid="signing-progress">
          <span className="text-sm font-medium">
            Required: {completed} of {required.length} completed
          </span>
          <span className="hidden h-1.5 w-28 overflow-hidden rounded-full bg-muted sm:block" aria-hidden>
            <span
              className="block h-full rounded-full bg-primary transition-all"
              style={{ width: `${required.length === 0 ? 100 : (completed / required.length) * 100}%` }}
            />
          </span>
        </div>

        <div className="flex items-center gap-2">
          {!allDone ? (
            <Button
              type="button"
              size="lg"
              className="bg-signing px-6 font-semibold text-signing-foreground hover:bg-signing/80"
              onClick={startOrNext}
              data-testid="signing-next"
            >
              {started ? "Next" : "Start"}
            </Button>
          ) : null}
          <Button
            type="button"
            size="lg"
            onClick={() => void finish()}
            disabled={!allDone || !consented || !adopted || pending}
            data-testid="signing-finish"
          >
            {pending ? "Finishing…" : "Finish"}
          </Button>
          <Button type="button" variant="ghost" onClick={onRequestExit} disabled={pending} data-testid="signing-decline">
            Decline to sign
          </Button>
          <Button type="button" variant="ghost" size="icon" onClick={onRequestExit} disabled={pending} data-testid="signing-close">
            <X />
            <span className="sr-only">Close</span>
          </Button>
        </div>
      </header>

      <div ref={scroller} className="min-h-0 overflow-y-auto bg-muted px-3 py-6 sm:px-6" data-testid="signing-scroll">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
          <section
            className={cn("rounded-lg border bg-card p-4", consented ? "border-border" : "border-signing ring-2 ring-signing/60")}
            aria-label="Electronic records and signatures"
            data-testid="consent-card"
          >
            <label htmlFor={consentId} className="flex cursor-pointer items-start gap-3">
              <input
                id={consentId}
                ref={consentBox}
                type="checkbox"
                checked={consented}
                onChange={(e) => setConsentedAt(e.target.checked ? new Date().toISOString() : null)}
                className="mt-0.5 size-4 shrink-0 accent-primary"
                data-testid="signing-consent"
              />
              <span className="flex flex-col gap-1">
                <span className="text-sm font-medium">{ESIGN_CONSENT_LABEL}</span>
                <span className="text-sm text-muted-foreground">{ESIGN_DISCLOSURE_SHORT}</span>
              </span>
            </label>
          </section>

          {failure ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          ) : null}

          {mine.length === 0 ? (
            <Alert role="status">
              <AlertDescription>There is nothing for {signer.role} to sign on this document.</AlertDescription>
            </Alert>
          ) : null}

          <PdfPages
            source={document}
            renderOverlay={(pageIndex, size) =>
              mine
                .filter((f) => f.page === pageIndex)
                .map((field) => (
                  <SignatureTag
                    key={field.id}
                    field={field}
                    page={size}
                    value={values[field.id]?.value}
                    active={activeId === field.id}
                    locked={!consented}
                    onActivate={activate}
                  />
                ))
            }
          />
        </div>
      </div>

      <AdoptSignatureDialog
        open={adoptFor !== null}
        onOpenChange={(next) => !next && setAdoptFor(null)}
        signerName={signer.name}
        expectedNames={expectedNames}
        initial={adopted}
        changing={adoptingSigned}
        onAdopt={adopt}
      />

    </>
  )
}
