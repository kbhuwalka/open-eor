/**
 * Single owner of the local unit + e2e gate (husky pre-push + `pnpm test:precommit`).
 *
 * - `pnpm test:precommit` always runs the suite (SKIP ignored).
 * - husky calls this with `--hook`; only then may SKIP short-circuit.
 *
 * Vitest uses the parent environment (`pnpm test` parity). Playwright gets
 * CI=true and a temp DATABASE_FILE/UPLOADS_ROOT outside the repo.
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

/** Specs that mutate seed rows and need an exclusive DB copy (own work dir). */
const EXCLUSIVE_E2E_SPECS = [
  "e2e/finance-portal.spec.ts",
  "e2e/onboarding-specialist.spec.ts",
  "e2e/task-home-filters.spec.ts",
] as const

function main(argv: string[]): number {
  const asHook = argv.includes("--hook")
  if (asHook && shouldSkipPrecommit(process.env.SKIP)) {
    console.log(`test-precommit: skipped (SKIP=${process.env.SKIP})`)
    return 0
  }

  const workDirs: string[] = []
  const cleanup = () => {
    for (const dir of workDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch {
        /* best-effort */
      }
    }
  }

  try {
    // Same as `pnpm test`: parent env only, plain `vitest run`.
    const vitest = run(bin("vitest"), ["run"], { ...process.env })
    if (vitest !== 0) return vitest

    const sharedWork = defaultPrecommitWorkDir()
    workDirs.push(sharedWork)
    fs.mkdirSync(path.join(sharedWork, "uploads"), { recursive: true })
    const sharedEnv = playwrightEnv(sharedWork)
    console.log(
      `test-precommit: shared DATABASE_FILE=${sharedEnv.DATABASE_FILE} PORT=${sharedEnv.PORT} CI=${sharedEnv.CI}`,
    )

    const sharedSpecs = listSharedSpecs()
    const shared = run(bin("playwright"), ["test", ...sharedSpecs], sharedEnv)
    if (shared !== 0) return shared

    let port = Number(sharedEnv.PORT) + 1
    for (const spec of EXCLUSIVE_E2E_SPECS) {
      const workDir = `${defaultPrecommitWorkDir()}-${path.basename(spec, ".spec.ts")}`
      workDirs.push(workDir)
      fs.mkdirSync(path.join(workDir, "uploads"), { recursive: true })
      const env = playwrightEnv(workDir, port)
      port += 1
      console.log(`test-precommit: exclusive ${spec} DATABASE_FILE=${env.DATABASE_FILE} PORT=${env.PORT}`)
      const code = run(bin("playwright"), ["test", spec], env)
      if (code !== 0) return code
    }

    return 0
  } finally {
    cleanup()
  }
}

function listSharedSpecs(): string[] {
  const dir = path.join(root, "e2e")
  const exclusive = new Set(EXCLUSIVE_E2E_SPECS.map((s) => path.basename(s)))
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".spec.ts") && !exclusive.has(name))
    .map((name) => path.join("e2e", name))
}

function playwrightEnv(workDir: string, port?: number): NodeJS.ProcessEnv {
  const built = buildPrecommitEnv({ cwd: root, workDir, port })
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
