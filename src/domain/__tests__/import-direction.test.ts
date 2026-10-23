import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const DOMAIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

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

const SPECIFIER =
  /(?:import|export)\s+(?:type\s+)?(?:[^'"\n]*?\sfrom\s+)?["']([^"']+)["']/g
const DYNAMIC_IMPORT = /import\s*\(\s*["']([^"']+)["']\s*\)/g

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

describe("domain import direction", () => {
  it("imports nothing from next, react, drizzle-orm, or src/db", () => {
    const files = listSourceFiles(DOMAIN_ROOT)
    expect(files.length).toBeGreaterThan(0)
    const violations: string[] = []
    for (const file of files) {
      const source = readFileSync(file, "utf8")
      const specifiers = [...source.matchAll(SPECIFIER), ...source.matchAll(DYNAMIC_IMPORT)]
        .map((match) => match[1])
        .filter((value): value is string => Boolean(value))
      for (const specifier of specifiers) {
        const resolved = specifier.startsWith(".")
          ? path.resolve(path.dirname(file), specifier)
          : ""
        const escapesDomain =
          specifier.startsWith(".") &&
          resolved !== DOMAIN_ROOT &&
          !resolved.startsWith(`${DOMAIN_ROOT}${path.sep}`)
        if (isForbiddenPackage(specifier) || !specifier.startsWith(".") || escapesDomain) {
          violations.push(`${path.relative(DOMAIN_ROOT, file)} → ${specifier}`)
        }
      }
      if (/Date\.now\s*\(/.test(source)) {
        violations.push(`${path.relative(DOMAIN_ROOT, file)} uses Date.now`)
      }
    }
    expect(violations).toEqual([])
  })
})
