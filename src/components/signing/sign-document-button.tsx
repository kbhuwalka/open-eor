"use client"

import { useState, type ComponentProps } from "react"
import { PenLine } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { SignatureField } from "@/domain/forms"

import { SigningDialog } from "./signing-dialog"
import type { SigningDocumentSource, SigningResult, SigningSigner } from "./signing-types"

/**
 * A "Review and sign" button that opens the `SigningDialog` over a document. The caller owns what
 * happens afterwards: `onComplete` receives the adopted signature and field values, and normally
 * calls a Server Action that applies the signature (`applyEsignature`) and stores the result.
 *
 * ```tsx
 * <SignDocumentButton
 *   title="Master services agreement"
 *   document={{ pdfBytes }}            // or { url: "/api/documents/123.pdf" }
 *   fields={fields}                    // SignatureField[] from the generator
 *   signer={{ name: "Dana Whitfield", role: "Client" }}
 *   onComplete={async ({ signature }) => {
 *     await acceptAgreement({ typedName: signature.typedName, consentedAt: signature.consentedAt })
 *   }}
 * />
 * ```
 */
export function SignDocumentButton({
  title,
  document,
  fields,
  signer,
  onComplete,
  onDecline,
  children = "Review and sign",
  ...buttonProps
}: {
  /** Document name shown in the dialog's top bar. */
  title: string
  document: SigningDocumentSource
  fields: readonly SignatureField[]
  signer: SigningSigner
  onComplete: (result: SigningResult) => void | Promise<void>
  onDecline?: () => void
} & Omit<ComponentProps<typeof Button>, "onClick" | "type" | "title">) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} data-testid="sign-document-button" {...buttonProps}>
        <PenLine data-icon="inline-start" />
        {children}
      </Button>
      <SigningDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        document={document}
        signer={signer}
        fields={fields}
        onComplete={onComplete}
        onDecline={onDecline}
      />
    </>
  )
}
