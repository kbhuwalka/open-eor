import { expect } from "vitest"
import { DomainError, type DomainErrorCode } from "../types"

export function expectDomainError(run: () => unknown, code: DomainErrorCode): DomainError {
  let caught: unknown
  try {
    run()
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(DomainError)
  if (!(caught instanceof DomainError)) {
    throw new Error(`expected DomainError ${code}`)
  }
  expect(caught.code).toBe(code)
  return caught
}
