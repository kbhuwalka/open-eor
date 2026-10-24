/**
 * Encryption of sensitive form fields at rest (SSN, bank numbers). The one AES-256-GCM
 * implementation lives in `./documents/secrets` (key from `NORTHWIND_DATA_KEY`, token
 * `v1.<iv>.<tag>.<ciphertext>`); this module re-exports it and adds JSON-record helpers.
 */
import type { JsonRecord } from "@/domain/tasks"

import { decryptSecret, encryptSecret } from "./documents/secrets"

export { decryptSecret, encryptSecret, maskSsn } from "./documents/secrets"

export function encryptFields(fields: JsonRecord): string {
  return encryptSecret(JSON.stringify(fields))
}

export function decryptFields(token: string): JsonRecord {
  return JSON.parse(decryptSecret(token)) as JsonRecord
}
