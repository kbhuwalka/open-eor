"use client"

import type { ComponentProps } from "react"

import { SignDocumentButton, type SigningDocumentSource, type SigningResult } from "@/components/signing"
import { Button } from "@/components/ui/button"
import type { ActionResult } from "@/server/action-result"
import type { SignedMasterAgreement } from "@/server/master-agreement"

import type { AgreementSignatureInput } from "./actions"
import { usePreparedAgreement } from "./use-prepared-agreement"

const EMPTY_DOCUMENT: SigningDocumentSource = { pdfBytes: new Uint8Array() }

/**
 * "Review and sign" for the company's master EOR agreement. The server regenerates the document and
 * its signature rectangles when this mounts; the signing dialog opens over it, and finishing calls
 * `sign` (a Server Action that applies the typed signature and records it through the engine).
 * `onSigned` gets the result, or null when the agreement turned out to be signed already.
 */
export function AgreementSignButton({
  sign,
  onSigned,
  children,
  ...buttonProps
}: {
  sign: (input: AgreementSignatureInput) => Promise<ActionResult<SignedMasterAgreement>>
  onSigned: (signed: SignedMasterAgreement | null) => void
} & Pick<ComponentProps<typeof Button>, "size" | "variant" | "children" | "className">) {
  const { prepared, error, retry } = usePreparedAgreement(true, () => onSigned(null))

  if (error) {
    return (
      <div className="flex flex-col items-end gap-1">
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
        <Button
          type="button"
          variant="outline"
          size={buttonProps.size}
          onClick={retry}
        >
          Try again
        </Button>
      </div>
    )
  }

  async function onComplete(result: SigningResult) {
    const response = await sign({ signature: result.signature, fieldValues: result.fieldValues })
    if (!response.ok) {
      if (response.code === "AGREEMENT_ALREADY_SIGNED") {
        onSigned(null)
        return
      }
      throw new Error(response.message)
    }
    onSigned(response.data)
  }

  return (
    <SignDocumentButton
      title={prepared?.title ?? "Master Services Agreement"}
      document={prepared?.document ?? EMPTY_DOCUMENT}
      fields={prepared?.fields ?? []}
      signer={prepared?.signer ?? { name: "", role: "Client" }}
      onComplete={onComplete}
      disabled={!prepared}
      aria-busy={!prepared}
      data-testid="sign-agreement"
      {...buttonProps}
    >
      {children ?? "Review and sign"}
    </SignDocumentButton>
  )
}
