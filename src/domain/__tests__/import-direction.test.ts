import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const DOMAIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

/**
 * Import clauses may span lines. The gap before `from` allows only identifiers,
 * `type`, braces, commas, stars, and whitespace, so a match cannot run through
 * a function body or a string to a later specifier.
 */
const STATIC_FROM =
  /\b(?:import|export)\s+(?:type\s+)?(?:[\w*\s{},]+)\s+from\s*["']([^"']+)["']/g
const SIDE_EFFECT = /\bimport\s+["']([^"']+)["']/g
const DYNAMIC_IMPORT = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g

export function collectImportSpecifiers(source: string): string[] {
  return [STATIC_FROM, SIDE_EFFECT, DYNAMIC_IMPORT].flatMap((pattern) =>
    [...source.matchAll(pattern)].flatMap((match) => (match[1] ? [match[1]] : [])),
  )
}

function listSourceFiles(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory)) {
    if (entry === "__tests__") continue
    const fullPath = path.join(directory, entry)
    if (statSync(fullPath).isDirectory()) {
      files.push(...listSourceFiles(fullPath))
    } else if (entry.endsWith(".ts")) {
      files.push(fullPath)
    }
  }
  return files
}

function isForbiddenPackage(specifier: string): boolean {
  const banned = ["next", "react", "react-dom", "drizzle-orm"]
  if (banned.some((name) => specifier === name || specifier.startsWith(`${name}/`))) return true
  return (
    specifier === "src/db" ||
    specifier.startsWith("src/db/") ||
    specifier === "@/db" ||
    specifier.startsWith("@/db/")
  )
}

function violationsFor(source: string, filePath: string): string[] {
  const violations: string[] = []
  for (const specifier of collectImportSpecifiers(source)) {
    const resolved = specifier.startsWith(".")
      ? path.resolve(path.dirname(filePath), specifier)
      : ""
    const escapesDomain =
      specifier.startsWith(".") &&
      resolved !== DOMAIN_ROOT &&
      !resolved.startsWith(`${DOMAIN_ROOT}${path.sep}`)
    if (isForbiddenPackage(specifier) || !specifier.startsWith(".") || escapesDomain) {
      violations.push(`${path.relative(DOMAIN_ROOT, filePath)} → ${specifier}`)
    }
  }
  if (/Date\.now\s*\(/.test(source)) {
    violations.push(`${path.relative(DOMAIN_ROOT, filePath)} uses Date.now`)
  }
  return violations
}

describe("import specifier scanner", () => {
  it("reads multiline import, export-from, and dynamic import specifiers", () => {
    const source = `
      import {
        useEffect,
      } from "react"

      export {
        schema,
      } from "drizzle-orm"

      import(
        "@/db/schema"
      )

      import { route } from "next/navigation"
      export * from "./types"
    `
    expect(collectImportSpecifiers(source)).toEqual([
      "react",
      "drizzle-orm",
      "next/navigation",
      "./types",
      "@/db/schema",
    ])
  })

  it("flags a multiline banned import and a relative import that leaves src/domain", () => {
    const filePath = path.join(DOMAIN_ROOT, "case-machine.ts")
    const source = `
      import {
        db,
      } from "src/db/schema"
      import { page } from "../app/page"
    `
    expect(violationsFor(source, filePath)).toEqual([
      "case-machine.ts → src/db/schema",
      "case-machine.ts → ../app/page",
    ])
  })

  it("sees the multiline specifiers in the domain sources", () => {
    expect(collectImportSpecifiers(readFileSync(path.join(DOMAIN_ROOT, "checklist.ts"), "utf8"))).toEqual([
      "./types",
    ])
    expect(collectImportSpecifiers(readFileSync(path.join(DOMAIN_ROOT, "work-auth.ts"), "utf8"))).toEqual([
      "./types",
    ])
    expect(collectImportSpecifiers(readFileSync(path.join(DOMAIN_ROOT, "case-machine.ts"), "utf8"))).toEqual([
      "./checklist",
      "./policy-snapshot",
      "./types",
      "./wage",
      "./work-auth",
    ])
    expect(collectImportSpecifiers(readFileSync(path.join(DOMAIN_ROOT, "index.ts"), "utf8"))).toEqual([
      "./types",
      "./wage",
      "./policy-snapshot",
      "./work-auth",
      "./checklist",
      "./case-machine",
    ])
  })
})

describe("domain import direction", () => {
  it("imports nothing from next, react, drizzle-orm, or src/db", () => {
    const files = listSourceFiles(DOMAIN_ROOT)
    expect(files.length).toBeGreaterThan(0)
    const violations = files.flatMap((file) => violationsFor(readFileSync(file, "utf8"), file))
    expect(violations).toEqual([])
  })
})
