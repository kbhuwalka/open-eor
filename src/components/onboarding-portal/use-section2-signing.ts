"use client"

import { useState, useTransition } from "react"

import type { PreparedSection2Data, SignedSection2Input } from "@/app/onboarding/actions"
import type { PreparedDocument, SigningResult } from "@/components/signing"
import type { ActionResult } from "@/server/action-result"

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export type PreparedSection2 = PreparedDocument & Pick<PreparedSection2Data, "title" | "signer">

export type Section2Signing = {
  /** The filled Section 2 is being built. */
  preparing: boolean
  /** Why Section 2 could not be built; signing failures show inside the dialog instead. */
  error: string | null
  /** Set once built; the dialog shows it while `open`. */
  prepared: PreparedSection2 | null
  open: boolean
  setOpen: (open: boolean) => void
  /** Builds Section 2 from the employee's entries and opens the signing dialog over it. */
  start: () => void
  /** The dialog's `onComplete`: signs on the server, throws the server's message when it refuses. */
  sign: (result: SigningResult) => Promise<void>
}

/**
 * "Verify & sign" for I-9 Section 2. The caller passes the two Server Actions; neither takes
 * document fields, so what gets signed is what the employee entered.
 */
export function useSection2Signing({
  taskId,
  prepare,
  accept,
  onSigned,
}: {
  taskId: string
  prepare: (taskId: string) => Promise<ActionResult<PreparedSection2Data>>
  accept: (taskId: string, input: SignedSection2Input) => Promise<ActionResult<unknown>>
  onSigned: () => void
}): Section2Signing {
  const [preparing, startPreparing] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [prepared, setPrepared] = useState<PreparedSection2 | null>(null)
  const [open, setOpen] = useState(false)

  return {
    preparing,
    error,
    prepared,
    open,
    setOpen,
    start() {
      startPreparing(async () => {
        const result = await prepare(taskId)
        if (!result.ok) {
          setError(result.message)
          return
        }
        setError(null)
        const { pdf, fields, title, signer } = result.data
        setPrepared({ document: { pdfBytes: fromBase64(pdf) }, fields, title, signer })
        setOpen(true)
      })
    },
    async sign({ signature, fieldValues }) {
      const result = await accept(taskId, {
        signature: { typedName: signature.typedName, consentedAt: signature.consentedAt },
        fieldValues,
      })
      if (!result.ok) throw new Error(result.message)
      onSigned()
    },
  }
}
