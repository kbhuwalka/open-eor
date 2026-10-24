/**
 * Single owner of the local unit + e2e gate (husky pre-push + `pnpm test:precommit`).
 *
 * - `pnpm test:precommit` always runs the suite (SKIP ignored).
 * - husky calls this with `--hook`; only then may SKIP short-circuit.
 *
 * Vitest uses the parent environment (`pnpm test` parity). Playwright gets
 * CI=true and one temp DATABASE_FILE/UPLOADS_ROOT outside the repo, then
 * `playwright test` with no file arguments (Playwright discovers `e2e/`).
 */
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  buildPrecommitEnv,
  defaultPrecommitWorkDir,
  shouldSkipHookRun,
} from "./precommit-env"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const bin = (...names: string[]) => path.join(root, "node_modules", ".bin", ...names)

function main(argv: string[]): number {
  if (shouldSkipHookRun(argv, process.env.SKIP)) {
    console.log(`test-precommit: skipped (SKIP=${process.env.SKIP})`)
    return 0
  }

  const workDir = defaultPrecommitWorkDir()
  fs.mkdirSync(path.join(workDir, "uploads"), { recursive: true })

  const cleanup = () => {
    try {
      fs.rmSync(workDir, { recursive: true, force: true })
    } catch {
      /* best-effort */
    }
  }

  try {
    const vitest = run(bin("vitest"), ["run"], { ...process.env })
    if (vitest !== 0) return vitest

    const env = playwrightEnv(workDir)
    console.log(
      `test-precommit: DATABASE_FILE=${env.DATABASE_FILE} PORT=${env.PORT} CI=${env.CI}`,
    )
    return run(bin("playwright"), ["test"], env)
  } finally {
    cleanup()
  }
}

function playwrightEnv(workDir: string): NodeJS.ProcessEnv {
  const built = buildPrecommitEnv({ cwd: root, workDir })
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...built,
  }
  delete env.PLAYWRIGHT_BASE_URL
  delete env.E2E_DATABASE_FILE
  return env
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): number {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
    shell: false,
  })
  if (result.error) {
    console.error(`test-precommit: failed to start ${command}:`, result.error.message)
    return 1
  }
  return result.status ?? 1
}

process.exit(main(process.argv.slice(2)))
