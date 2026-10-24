/** Validation of the reference number a filing is marked submitted with (the handler allows up to 60 characters). */
export const CONFIRMATION_MAX = 60

/** `null` when valid, else the sentence to show under the field. */
export function confirmationProblem(value: string): string | null {
  const text = value.trim()
  if (text === "") return "Enter the confirmation number."
  if (text.length > CONFIRMATION_MAX) return `Use ${CONFIRMATION_MAX} characters or fewer.`
  return null
}
