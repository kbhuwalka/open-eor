import type { FieldErrors } from "@/domain/forms"

/** Thrown when typed form data fails the domain validator. Carries the field-level errors, never values. */
export class DocumentInputError extends Error {
  readonly errors: FieldErrors
  constructor(form: string, errors: FieldErrors) {
    super(`${form} data is not valid: ${Object.keys(errors).join(", ")}`)
    this.name = "DocumentInputError"
    this.errors = errors
  }
}

export type SignatureErrorCode =
  | "CONSENT_REQUIRED"
  | "SIGNER_REQUIRED"
  | "TYPED_NAME_MISMATCH"
  | "SIGNATURE_SLOT_NOT_FOUND"
  | "INVALID_SIGNED_AT"
  | "INVALID_FIELD"

export class SignatureError extends Error {
  readonly code: SignatureErrorCode
  constructor(code: SignatureErrorCode, message: string) {
    super(message)
    this.name = "SignatureError"
    this.code = code
  }
}
