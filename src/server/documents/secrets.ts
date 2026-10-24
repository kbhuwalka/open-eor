/**
 * Sensitive-field protection: AES-256-GCM for data at rest (SSNs, bank account numbers) and an
 * HMAC key for the signature record seals. Both keys are derived with HKDF from one master secret.
 *
 * `NORTHWIND_DATA_KEY` is the master secret (any string of 32+ characters; use a random one in
 * production). Without it the code falls back to a fixed development key and warns once outside
 * `development` and `test`, because anything encrypted with the dev key is effectively plaintext.
 *
 * Plaintext never reaches a log: nothing here prints a value, and errors carry no input.
 */

import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto"

import { maskSsn } from "@/domain/forms"

export { maskSsn }

const DEV_KEY = "northwind-dev-only-data-key-do-not-use-in-production"
const ENV_NAME = "NORTHWIND_DATA_KEY"
const VERSION = "v1"

let warned = false

function masterSecret(): string {
  const fromEnv = process.env[ENV_NAME]
  if (fromEnv && fromEnv.length >= 32) return fromEnv
  const env = process.env.NODE_ENV
  if (!warned && env !== "development" && env !== "test") {
    warned = true
    console.warn(`${ENV_NAME} is not set (or shorter than 32 characters); using the development key.`)
  }
  return DEV_KEY
}

const derived = new Map<string, Buffer>()

/** A 32-byte key bound to `purpose`, so the encryption and seal keys are independent. */
function deriveKey(purpose: "encrypt" | "seal"): Buffer {
  const secret = masterSecret()
  const cacheKey = `${purpose}:${secret}`
  let key = derived.get(cacheKey)
  if (!key) {
    key = Buffer.from(hkdfSync("sha256", secret, "northwind-eor-documents", `northwind/${purpose}`, 32))
    derived.set(cacheKey, key)
  }
  return key
}

export class SecretError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SecretError"
  }
}

/**
 * Encrypts with a fresh random 96-bit IV. Output is `v1.<iv>.<tag>.<ciphertext>` in base64url, safe
 * for a text column. `aad` binds the ciphertext to a context (e.g. a person id) when given.
 */
export function encryptSecret(plaintext: string, aad?: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", deriveKey("encrypt"), iv)
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"))
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), body.toString("base64url")].join(".")
}

/** Throws `SecretError` when the value is malformed, was tampered with, or used a different `aad`. */
export function decryptSecret(token: string, aad?: string): string {
  const parts = token.split(".")
  if (parts.length !== 4 || parts[0] !== VERSION) throw new SecretError("Unrecognised encrypted value.")
  try {
    const decipher = createDecipheriv("aes-256-gcm", deriveKey("encrypt"), Buffer.from(parts[1], "base64url"))
    decipher.setAuthTag(Buffer.from(parts[2], "base64url"))
    if (aad) decipher.setAAD(Buffer.from(aad, "utf8"))
    return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()]).toString("utf8")
  } catch {
    throw new SecretError("Encrypted value could not be verified.")
  }
}

export function isEncryptedSecret(value: string): boolean {
  return /^v1\.[\w-]+\.[\w-]+\.[\w-]*$/.test(value)
}

/** Masks a stored (encrypted) SSN for display without exposing more than the last four digits. */
export function maskEncryptedSsn(token: string, aad?: string): string {
  return maskSsn(decryptSecret(token, aad))
}

/** HMAC-SHA256 hex used to seal signature records. */
export function sealHmac(message: string): string {
  return createHmac("sha256", deriveKey("seal")).update(message, "utf8").digest("hex")
}
