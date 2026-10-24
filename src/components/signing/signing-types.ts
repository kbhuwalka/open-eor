import type { SignatureField } from "@/domain/forms"

import type { SigningDocumentSource } from "./pdf-loader"

export type { SigningDocumentSource }

/** Who is signing. */
export type SigningSigner = {
  /** Full legal name; prefills the "Adopt your signature" form. */
  name: string
  /** Capacity ("Employee", "Employer representative"); only fields with this `signerRole` are shown. */
  role: string
  /** Names the adopted signature may match (e.g. with and without a middle initial). Defaults to `[name]`. */
  acceptedNames?: readonly string[]
}

/** The signature the signer adopted and consented to use. */
export type SignatureResult = {
  /** The name exactly as typed (trimmed). */
  typedName: string
  initials: string
  /** ISO 8601 UTC: when the electronic-records consent box was ticked. */
  consentedAt: string
}

/** What one field ended up holding. */
export type SignedFieldValue = {
  kind: SignatureField["kind"]
  /** The typed name (signature), initials (initials) or `MM/DD/YYYY` (date). */
  value: string
  /** ISO 8601 UTC: when the field was completed. */
  signedAt: string
}

export type SigningResult = {
  signature: SignatureResult
  /** Keyed by `SignatureField.id`. Date fields are included. */
  fieldValues: Record<string, SignedFieldValue>
}

/** A generated or fetched PDF together with where its next signer signs. */
export type PreparedDocument = {
  document: SigningDocumentSource
  fields: SignatureField[]
}
