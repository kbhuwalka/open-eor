import type { PreparedDocument } from "@/components/signing"
import type { ActionResult } from "@/server/action-result"
import type { PreparedDocumentData } from "@/app/worker/tasks/actions"

export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function toPrepared(data: PreparedDocumentData): PreparedDocument {
  return { document: { pdfBytes: fromBase64(data.pdf) }, fields: data.fields }
}

/** The value of a successful action, or an Error carrying the action's message (what the wizards and dialogs display). */
export async function unwrap<T>(result: Promise<ActionResult<T>>): Promise<T> {
  const outcome = await result
  if (!outcome.ok) throw new Error(outcome.message)
  return outcome.data
}
