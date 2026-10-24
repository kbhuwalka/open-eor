"use client"

import { useEffect, useState } from "react"

import type { SigningDocumentSource } from "@/components/signing"
import type { SignatureField } from "@/domain/forms"

import { prepareMasterAgreement } from "./actions"

export type PreparedAgreement = {
  document: SigningDocumentSource
  fields: SignatureField[]
  title: string
  signer: { name: string; role: string }
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Asks the server for the company's master agreement and its signature rectangles once `enabled`
 * is true (the sign button: on mount; the To do dialog: when it opens), and again after `retry`.
 * `onAlreadySigned` runs when the agreement turned out to be signed already (by a colleague, or in
 * another tab). Owns no other state: signing itself is the caller's Server Action.
 */
export function usePreparedAgreement(enabled: boolean, onAlreadySigned: () => void) {
  const [prepared, setPrepared] = useState<PreparedAgreement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!enabled) return
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
          onAlreadySigned()
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
    // `onAlreadySigned` is a fresh closure each render; preparing again for it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, attempt])

  return {
    prepared,
    error,
    retry: () => {
      setError(null)
      setAttempt((n) => n + 1)
    },
  }
}
