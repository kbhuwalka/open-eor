/**
 * File storage under the uploads root (architecture §6). Identity documents are stored as they
 * arrive; signed forms hold SSNs and bank numbers, so they are encrypted at rest with the same
 * key as other sensitive fields. Every path is resolved and checked to stay inside the root.
 *
 * `storage_path` stores a path relative to the process working directory (the seed's
 * `data/uploads/seed/...` fixtures follow the same rule), and the root defaults to `data/uploads`.
 */
import fs from "node:fs"
import path from "node:path"

import { decryptSecret, encryptSecret } from "./documents/secrets"

export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024
export const UPLOAD_MIME_TYPES = ["image/png", "image/jpeg", "application/pdf"] as const
export type UploadMimeType = (typeof UPLOAD_MIME_TYPES)[number]

export class UploadError extends Error {
  readonly code: "type" | "size" | "empty" | "content"
  constructor(code: UploadError["code"], message: string) {
    super(message)
    this.name = "UploadError"
    this.code = code
  }
}

export function uploadsRoot(env: Record<string, string | undefined> = process.env): string {
  const configured = env.UPLOADS_ROOT
  if (configured) return path.isAbsolute(configured) ? configured : path.resolve(/*turbopackIgnore: true*/ process.cwd(), configured)
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), "data", "uploads")
}

/** The absolute file for a stored path, or null when it would leave the uploads root. */
export function resolveStoragePath(storagePath: string, root: string = uploadsRoot()): string | null {
  const absolute = path.resolve(/*turbopackIgnore: true*/ process.cwd(), storagePath)
  const relative = path.relative(root, absolute)
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return null
  return absolute
}

export function sanitizeFileName(name: string): string {
  const base = path.basename(name).normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "")
  return (base || "file").slice(-80)
}

const MAGIC: { type: UploadMimeType; matches: (bytes: Uint8Array) => boolean }[] = [
  { type: "image/png", matches: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { type: "image/jpeg", matches: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: "application/pdf", matches: (b) => b.length > 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 },
]

/** The type the bytes actually are, so a renamed file cannot pass for an image or PDF. */
export function sniffUploadType(bytes: Uint8Array): UploadMimeType | null {
  return MAGIC.find((candidate) => candidate.matches(bytes))?.type ?? null
}

export function validateUpload(input: { fileName: string; declaredType: string; bytes: Uint8Array }): UploadMimeType {
  if (input.bytes.length === 0) throw new UploadError("empty", "That file is empty.")
  if (input.bytes.length > UPLOAD_MAX_BYTES) throw new UploadError("size", "Files can be up to 10 MB.")
  if (!(UPLOAD_MIME_TYPES as readonly string[]).includes(input.declaredType)) {
    throw new UploadError("type", "Upload a PNG, JPEG or PDF file.")
  }
  const actual = sniffUploadType(input.bytes)
  if (actual === null || actual !== input.declaredType) {
    throw new UploadError("content", "The file does not look like a PNG, JPEG or PDF.")
  }
  return actual
}

function storedPath(absolute: string): string {
  return path.relative(/*turbopackIgnore: true*/ process.cwd(), absolute)
}

/** Writes an identity document upload; returns the `storage_path` to record. */
export function writeUploadFile(input: { caseId: string; documentId: string; fileName: string; bytes: Uint8Array }): string {
  const root = uploadsRoot()
  const absolute = path.join(root, input.caseId, `${input.documentId}-${sanitizeFileName(input.fileName)}`)
  fs.mkdirSync(path.dirname(absolute), { recursive: true })
  fs.writeFileSync(absolute, input.bytes)
  return storedPath(absolute)
}

export function readStoredFile(storagePath: string): Buffer | null {
  const absolute = resolveStoragePath(storagePath)
  if (!absolute || !fs.existsSync(absolute)) return null
  return fs.readFileSync(absolute)
}

export function removeStoredFile(storagePath: string): void {
  const absolute = resolveStoragePath(storagePath)
  if (!absolute) return
  try {
    fs.rmSync(absolute, { force: true })
  } catch {
    /* best-effort cleanup */
  }
}

/** Writes a signed form encrypted at rest (AES-256-GCM over the base64 text). */
export function writeSignedFile(input: { caseId: string; name: string; bytes: Uint8Array }): string {
  const absolute = path.join(uploadsRoot(), input.caseId, "signed", `${sanitizeFileName(input.name)}.enc`)
  fs.mkdirSync(path.dirname(absolute), { recursive: true })
  fs.writeFileSync(absolute, encryptSecret(Buffer.from(input.bytes).toString("base64")))
  return storedPath(absolute)
}

/** The signed form's bytes, or null when the file is missing, outside the root or cannot be decrypted. */
export function readSignedFile(storagePath: string): Uint8Array | null {
  const raw = readStoredFile(storagePath)
  if (!raw) return null
  try {
    return new Uint8Array(Buffer.from(decryptSecret(raw.toString("utf8")), "base64"))
  } catch {
    return null
  }
}
