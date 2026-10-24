"use client"

import { useId, useState } from "react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import { signatureFont } from "./signature-font"
import { adoptionErrors, defaultInitials } from "./signing-utils"

export type AdoptedSignature = { typedName: string; initials: string }

/**
 * "Adopt your signature": full name and initials (prefilled from the signer), a preview card in the
 * script face, and one button. Typed signatures only. Nested inside the signing dialog.
 */
export function AdoptSignatureDialog({
  open,
  onOpenChange,
  signerName,
  expectedNames,
  initial,
  changing,
  onAdopt,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  signerName: string
  /** Names the typed signature may match. */
  expectedNames: readonly string[]
  /** The signature adopted earlier, when the signer is changing it. */
  initial: AdoptedSignature | null
  changing: boolean
  onAdopt: (signature: AdoptedSignature) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <DialogContent className="sm:max-w-lg" showCloseButton={false} data-testid="adopt-dialog">
          <AdoptForm
            signerName={signerName}
            expectedNames={expectedNames}
            initial={initial}
            changing={changing}
            onAdopt={onAdopt}
            onCancel={() => onOpenChange(false)}
          />
        </DialogContent>
      ) : null}
    </Dialog>
  )
}

function AdoptForm({
  signerName,
  expectedNames,
  initial,
  changing,
  onAdopt,
  onCancel,
}: {
  signerName: string
  expectedNames: readonly string[]
  initial: AdoptedSignature | null
  changing: boolean
  onAdopt: (signature: AdoptedSignature) => void
  onCancel: () => void
}) {
  const id = useId()
  const [typedName, setTypedName] = useState(initial?.typedName ?? signerName)
  const [initials, setInitials] = useState(initial?.initials ?? defaultInitials(signerName))
  const [touched, setTouched] = useState(false)

  const errors = adoptionErrors(typedName, initials, expectedNames)
  const valid = Object.keys(errors).length === 0
  const name = typedName.trim()
  const shownInitials = initials.trim()

  function adopt() {
    setTouched(true)
    if (valid) onAdopt({ typedName: name, initials: shownInitials })
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        adopt()
      }}
    >
      <DialogHeader>
        <DialogTitle>{changing ? "Change your signature" : "Adopt your signature"}</DialogTitle>
        <DialogDescription>Confirm your name and initials. They become your electronic signature on this document.</DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
        <Field data-invalid={touched && errors.typedName ? true : undefined}>
          <FieldLabel htmlFor={`${id}-name`}>Full name *</FieldLabel>
          <Input
            id={`${id}-name`}
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            onBlur={() => setTouched(true)}
            autoComplete="off"
            error={touched && Boolean(errors.typedName)}
            data-testid="adopt-name"
          />
          <FieldError>{touched ? errors.typedName : undefined}</FieldError>
        </Field>
        <Field data-invalid={touched && errors.initials ? true : undefined}>
          <FieldLabel htmlFor={`${id}-initials`}>Initials *</FieldLabel>
          <Input
            id={`${id}-initials`}
            value={initials}
            onChange={(e) => setInitials(e.target.value)}
            onBlur={() => setTouched(true)}
            autoComplete="off"
            maxLength={6}
            error={touched && Boolean(errors.initials)}
            data-testid="adopt-initials"
          />
          <FieldError>{touched ? errors.initials : undefined}</FieldError>
        </Field>
      </div>

      <div
        className="grid grid-cols-[1fr_auto] gap-4 rounded-lg border border-border bg-card px-4 py-3"
        role="img"
        aria-label={name ? `Signature preview: ${name}, initials ${shownInitials}` : "Signature preview, empty"}
        data-testid="adopt-preview"
      >
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Signature</p>
          <p className={cn(signatureFont.className, "mt-1 h-12 truncate border-b border-border text-4xl leading-[3rem]")}>{name}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Initials</p>
          <p className={cn(signatureFont.className, "mt-1 h-12 min-w-16 border-b border-border text-3xl leading-[3rem]")}>{shownInitials}</p>
        </div>
      </div>

      <DialogFooter className="-mx-6 -mb-6 p-6">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!valid} data-testid="adopt-submit">
          Adopt and sign
        </Button>
      </DialogFooter>
    </form>
  )
}
