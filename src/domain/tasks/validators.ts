/**
 * Tiny payload-shape validators for task handlers. Handlers compose these today; the forms
 * library can replace any one `parse` with a stricter schema without touching the engine.
 */
import { isIsoDate } from "../employment-term"
import { DomainError } from "../types"

export type Parser<T> = (value: unknown, path: string) => T

export function invalidPayload(path: string, message: string): never {
  throw new DomainError("INVALID_TASK_PAYLOAD", { field: path, message })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export const string =
  (options: { min?: number; max?: number; pattern?: RegExp; message?: string } = {}): Parser<string> =>
  (value, path) => {
    if (typeof value !== "string") return invalidPayload(path, "Enter text.")
    const text = value.trim()
    if (text.length < (options.min ?? 1)) return invalidPayload(path, options.message ?? "This is required.")
    if (options.max !== undefined && text.length > options.max) {
      return invalidPayload(path, options.message ?? "This is too long.")
    }
    if (options.pattern && !options.pattern.test(text)) {
      return invalidPayload(path, options.message ?? "This is not valid.")
    }
    return text
  }

export const isoDate = (): Parser<string> => (value, path) => {
  if (!isIsoDate(value)) return invalidPayload(path, "Enter a date as YYYY-MM-DD.")
  return value
}

export const integer =
  (options: { min?: number; max?: number } = {}): Parser<number> =>
  (value, path) => {
    if (typeof value !== "number" || !Number.isInteger(value)) return invalidPayload(path, "Enter a whole number.")
    if (options.min !== undefined && value < options.min) return invalidPayload(path, "This is too small.")
    if (options.max !== undefined && value > options.max) return invalidPayload(path, "This is too large.")
    return value
  }

export const literalTrue = (): Parser<true> => (value, path) =>
  value === true ? true : invalidPayload(path, "This must be confirmed.")

export const boolean = (): Parser<boolean> => (value, path) =>
  typeof value === "boolean" ? value : invalidPayload(path, "Choose yes or no.")

export const oneOf =
  <const T extends readonly string[]>(values: T): Parser<T[number]> =>
  (value, path) =>
    typeof value === "string" && (values as readonly string[]).includes(value)
      ? (value as T[number])
      : invalidPayload(path, `Choose one of: ${values.join(", ")}.`)

export const optional =
  <T>(parser: Parser<T>): Parser<T | undefined> =>
  (value, path) =>
    value === undefined || value === null || value === "" ? undefined : parser(value, path)

export const arrayOf =
  <T>(parser: Parser<T>, options: { min?: number } = {}): Parser<T[]> =>
  (value, path) => {
    if (!Array.isArray(value)) return invalidPayload(path, "Expected a list.")
    if (value.length < (options.min ?? 0)) return invalidPayload(path, "Add at least one item.")
    return value.map((item, index) => parser(item, `${path}[${index}]`))
  }

type Shape = Record<string, Parser<unknown>>
type Parsed<S extends Shape> = { [K in keyof S]: ReturnType<S[K]> }

export const object =
  <S extends Shape>(shape: S): Parser<Parsed<S>> =>
  (value, path) => {
    if (!isRecord(value)) return invalidPayload(path || "payload", "Expected an object.")
    const out: Record<string, unknown> = {}
    for (const [key, parser] of Object.entries(shape)) {
      out[key] = parser(value[key], path ? `${path}.${key}` : key)
    }
    return out as Parsed<S>
  }

/** Parses `raw` with `parser`; the root path is empty so field paths read `legalName`, `address.city`. */
export function parseWith<T>(parser: Parser<T>, raw: unknown): T {
  return parser(raw ?? {}, "")
}
