/**
 * What the employee recorded about an uploaded I-9 identity document, as stored on
 * `case_documents`. The document number is encrypted at rest and bound to the row id, so a token
 * copied onto another row does not decrypt. Never log a decrypted number or put it in an event or
 * task payload.
 */
import type { caseDocuments } from "@/db/schema"
import type { IdentityDocumentDetails } from "@/domain/forms"

import { decryptSecret, encryptSecret } from "./field-crypto"

type DetailColumns = Pick<
  typeof caseDocuments.$inferSelect,
  "documentTitle" | "issuingAuthority" | "documentNumberEncrypted" | "expiresOn"
>

function aadFor(documentId: string): string {
  return `case_documents:${documentId}`
}

export function identityDetailColumns(documentId: string, details: IdentityDocumentDetails | null): DetailColumns {
  if (!details) return { documentTitle: null, issuingAuthority: null, documentNumberEncrypted: null, expiresOn: null }
  return {
    documentTitle: details.title,
    issuingAuthority: details.issuingAuthority,
    documentNumberEncrypted: encryptSecret(details.number, aadFor(documentId)),
    expiresOn: details.expiresOn,
  }
}

/** The stored entry with the number decrypted; null for an upload made before details were asked for. */
export function identityDetailsOf(row: DetailColumns & { id: string }): IdentityDocumentDetails | null {
  if (row.documentTitle === null || row.issuingAuthority === null || row.documentNumberEncrypted === null) return null
  return {
    title: row.documentTitle,
    issuingAuthority: row.issuingAuthority,
    number: decryptSecret(row.documentNumberEncrypted, aadFor(row.id)),
    expiresOn: row.expiresOn,
  }
}
