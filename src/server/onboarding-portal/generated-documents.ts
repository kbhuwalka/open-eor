/**
 * A signed document of any case, for the onboarding specialist (onboarding-portal.md §3, acl F5).
 * Same integrity rule as the employee's download: the stored bytes must match the hash and seals
 * recorded at signing, or the answer is "tampered", never the bytes.
 */
import { eq } from "drizzle-orm"

import type { SessionUser } from "@/auth"
import type { AppDatabase } from "@/db/client"
import { generatedDocuments } from "@/db/schema"

import { verifySignedDocument } from "../documents"
import { readSignedFile } from "../uploads"

import { isSpecialist, safeJson } from "./core"

export type StaffDocumentRead =
  | { ok: true; bytes: Uint8Array; fileName: string; sha256: string }
  | { ok: false; reason: "forbidden" | "not_found" | "tampered"; message: string }

export async function readStaffDocument(
  db: AppDatabase,
  user: Pick<SessionUser, "role">,
  documentId: string,
): Promise<StaffDocumentRead> {
  if (!isSpecialist(user)) return { ok: false, reason: "forbidden", message: "Your role cannot download this document." }
  const row = db.select().from(generatedDocuments).where(eq(generatedDocuments.id, documentId)).get()
  if (!row || row.storagePath === null) return { ok: false, reason: "not_found", message: "Document not found." }

  const tampered = {
    ok: false,
    reason: "tampered",
    message: "This document failed its integrity check and cannot be downloaded.",
  } as const
  const bytes = readSignedFile(row.storagePath)
  const meta = safeJson(row.metadataJson) as { sha256?: unknown; signature?: { seal?: unknown } } | null
  const sha256 = typeof meta?.sha256 === "string" ? meta.sha256 : null
  if (!bytes || !sha256) return tampered

  const check = await verifySignedDocument(bytes, { expectedSha256: sha256 })
  const seal = typeof meta?.signature?.seal === "string" ? meta.signature.seal : null
  if (!check.valid || (seal !== null && !check.signatures.some((signature) => signature.seal === seal))) return tampered
  return { ok: true, bytes, fileName: row.fileName, sha256: check.sha256 }
}
