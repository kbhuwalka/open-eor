/**
 * Policy for the local pre-push test run (unit then Playwright).
 * SKIP is honored only when `scripts/test-precommit.ts` is invoked with `--hook`.
 */
import fs from "node:fs"
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

/** Husky passes `--hook`; only then may SKIP short-circuit. Bare `pnpm test:precommit` always runs. */
export function shouldSkipHookRun(
  argv: readonly string[],
  skipEnv: string | undefined,
): boolean {
  return argv.includes("--hook") && shouldSkipPrecommit(skipEnv)
}

export type PrecommitEnvInput = {
  cwd: string
  /** Absolute path to a directory outside `cwd` holding the per-spec `eor.sqlite`. */
  workDir: string
  /**
   * Uploads tree the seed wrote (shared across specs). Must stay the seed's
   * directory: `storage_path` is cwd-relative to those files.
   */
  uploadsRoot: string
  port?: number
}

export type PrecommitEnv = {
  CI: "true"
  DATABASE_FILE: string
  UPLOADS_ROOT: string
  PORT: string
}

/**
 * Builds the environment Playwright + Next must share for a safe pre-push run:
 * CI semantics (no reuse of an existing dev server) and a SQLite/uploads tree
 * outside the repo (required by `writeLiveDb` / Turbopack WAL rules).
 *
 * Does not set `E2E_DATABASE_FILE` — that opts `client-signing.spec.ts` into a
 * destructive private-copy flow and must stay unset for the shared gate.
 */
export function buildPrecommitEnv(input: PrecommitEnvInput): PrecommitEnv {
  const workDir = path.resolve(input.workDir)
  const cwd = path.resolve(input.cwd)
  if (isPathInside(workDir, cwd)) {
    throw new Error(
      `precommit workDir must be outside the project: got ${workDir} under ${cwd}`,
    )
  }
  const uploadsRoot = path.resolve(input.uploadsRoot)
  if (isPathInside(uploadsRoot, cwd)) {
    throw new Error(
      `precommit uploadsRoot must be outside the project: got ${uploadsRoot} under ${cwd}`,
    )
  }
  const databaseFile = path.join(workDir, "eor.sqlite")
  return {
    CI: "true",
    DATABASE_FILE: databaseFile,
    UPLOADS_ROOT: uploadsRoot,
    PORT: String(input.port ?? 3720),
  }
}

/** Unique temp dir outside the project (mkdtemp — safe across pid reuse). */
export function defaultPrecommitWorkDir(tmpdir: string = os.tmpdir()): string {
  return fs.mkdtempSync(path.join(tmpdir, "spacexai-precommit-"))
}

/**
 * Parse `playwright test --list` stdout into unique `e2e/*.spec.ts` paths.
 * Playwright lists paths relative to `testDir` (`e2e/`).
 */
export function specFilesFromPlaywrightList(
  stdout: string,
  testDir = "e2e",
): string[] {
  const files = new Set<string>()
  for (const line of stdout.split("\n")) {
    const match = line.match(/›\s+([^:]+\.spec\.ts):/)
    if (!match) continue
    const listed = match[1]!.replaceAll("\\", "/")
    files.add(
      listed.startsWith(`${testDir}/`) || listed.startsWith("e2e/")
        ? listed
        : path.posix.join(testDir, listed),
    )
  }
  return [...files].sort()
}

function isPathInside(target: string, root: string): boolean {
  const relative = path.relative(root, target)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}
