import { randomUUID } from "node:crypto"

import type { AppDatabase } from "@/db/client"

import type { DocumentGenerator } from "./document-generator"

/** Everything a service function needs, injected; `getDb()` is called only at the action boundary. */
export type CaseServiceDeps = {
  db: AppDatabase
  now: () => Date
  newId?: (prefix: string) => string
  /** Defaults to the placeholder generator, which records metadata only. */
  documentGenerator?: DocumentGenerator
}

export type Tx = Parameters<Parameters<AppDatabase["transaction"]>[0]>[0]

export function defaultNewId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`
}

export function idFor(deps: CaseServiceDeps, prefix: string): string {
  return (deps.newId ?? defaultNewId)(prefix)
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`)
    this.name = "NotFoundError"
  }
}
