/**
 * Single owner of the pre-commit unit + e2e run.
 * Invoked by husky and by `pnpm test:precommit`.
 *
 * Uses node_modules/.bin binaries (no pnpm on PATH required), sets CI=true,
 * and runs Playwright against a temp SQLite/uploads tree outside the repo.
 */
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  buildPrecommitEnv,
  defaultPrecommitWorkDir,
  shouldSkipPrecommit,
} from "./precommit-env"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const bin = (...names: string[]) => path.join(root, "node_modules", ".bin", ...names)

function main(): number {
  if (shouldSkipPrecommit(process.env.SKIP)) {
    console.log(`test-precommit: skipped (SKIP=${process.env.SKIP})`)
    return 0
  }

  const workDir = defaultPrecommitWorkDir()
  fs.mkdirSync(workDir, { recursive: true })
  fs.mkdirSync(path.join(workDir, "uploads"), { recursive: true })

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...buildPrecommitEnv({ cwd: root, workDir }),
  }
  // Drop inherited base URL so Playwright starts webServer with our DATABASE_FILE.
  delete env.PLAYWRIGHT_BASE_URL

  const cleanup = () => {
    try {
      fs.rmSync(workDir, { recursive: true, force: true })
    } catch {
      // best-effort
    }
  }

  try {
    console.log(`test-precommit: DATABASE_FILE=${env.DATABASE_FILE} PORT=${env.PORT} CI=${env.CI}`)

    // Cap workers and raise the default timeout so the hook stays reliable on
    // smaller cloud VMs (SQLite-heavy suites otherwise trip the 5s default).
    const vitest = run(
      bin("vitest"),
      ["run", "--maxWorkers=2", "--testTimeout=30000"],
      env,
    )
    if (vitest !== 0) return vitest

    const playwright = run(bin("playwright"), ["test"], env)
    return playwright
  } finally {
    cleanup()
  }
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

process.exit(main())
