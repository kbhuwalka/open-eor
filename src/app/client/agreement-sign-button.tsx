"use client"

import { useEffect, useState, type ComponentProps } from "react"

import { SignDocumentButton, type SigningDocumentSource, type SigningResult } from "@/components/signing"
import { Button } from "@/components/ui/button"
import type { SignatureField } from "@/domain/forms"
import type { ActionResult } from "@/server/action-result"
import type { SignedMasterAgreement } from "@/server/master-agreement"

import { prepareMasterAgreement, type AgreementSignatureInput } from "./actions"

type Prepared = {
  document: SigningDocumentSource
  fields: SignatureField[]
  title: string
  signer: { name: string; role: string }
}

const EMPTY_DOCUMENT: SigningDocumentSource = { pdfBytes: new Uint8Array() }

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

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
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    void prepareMasterAgreement().then(
      (result) => {
        if (cancelled) return
        if (result.ok) {
          setError(null)
          setPrepared({
            document: { pdfBytes: fromBase64(result.data.pdf) },
            fields: result.data.fields,
            title: result.data.title,
            signer: result.data.signer,
          })
        } else if (result.code === "AGREEMENT_ALREADY_SIGNED") {
          onSigned(null)
        } else {
          setError(result.message)
        }
      },
      () => {
        if (!cancelled) setError("The agreement could not be prepared. Try again.")
      }
    )
    return () => {
      cancelled = true
    }
    // `onSigned` is a fresh closure each render; preparing again for it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt])

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
          onClick={() => {
            setError(null)
            setAttempt((n) => n + 1)
          }}
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
