/**
 * Policy for the local pre-push test run (unit then Playwright).
 * Husky `.husky/pre-push` must honor the same SKIP tokens as {@link shouldSkipPrecommit}.
 */
import path from "node:path"
import os from "node:os"

/** Comma-separated SKIP values that skip the husky pre-push hook. */
export const PRECOMMIT_SKIP_TOKENS = ["pre-push", "pre-commit", "tests", "all"] as const

export function shouldSkipPrecommit(skipEnv: string | undefined): boolean {
  if (!skipEnv) return false
  const tokens = new Set(
    skipEnv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  )
  return PRECOMMIT_SKIP_TOKENS.some((t) => tokens.has(t))
}

export type PrecommitEnvInput = {
  cwd: string
  /** Absolute path to a directory outside `cwd` (typically under os.tmpdir()). */
  workDir: string
  port?: number
}

export type PrecommitEnv = {
  CI: "true"
  DATABASE_FILE: string
  UPLOADS_ROOT: string
  E2E_DATABASE_FILE: string
  PORT: string
}

/**
 * Builds the environment Playwright + Next must share for a safe pre-push run:
 * CI semantics (no reuse of an existing dev server) and a SQLite/uploads tree
 * outside the repo (required by `writeLiveDb` / Turbopack WAL rules).
 */
export function buildPrecommitEnv(input: PrecommitEnvInput): PrecommitEnv {
  const workDir = path.resolve(input.workDir)
  const cwd = path.resolve(input.cwd)
  if (isPathInside(workDir, cwd)) {
    throw new Error(
      `precommit workDir must be outside the project: got ${workDir} under ${cwd}`,
    )
  }
  const databaseFile = path.join(workDir, "eor.sqlite")
  const uploadsRoot = path.join(workDir, "uploads")
  if (isPathInside(databaseFile, cwd)) {
    throw new Error(`DATABASE_FILE must be outside the project: ${databaseFile}`)
  }
  return {
    CI: "true",
    DATABASE_FILE: databaseFile,
    UPLOADS_ROOT: uploadsRoot,
    E2E_DATABASE_FILE: databaseFile,
    PORT: String(input.port ?? 3720),
  }
}

export function defaultPrecommitWorkDir(tmpdir: string = os.tmpdir()): string {
  return path.join(tmpdir, `spacexai-precommit-${process.pid}`)
}

function isPathInside(target: string, root: string): boolean {
  const relative = path.relative(root, target)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}
