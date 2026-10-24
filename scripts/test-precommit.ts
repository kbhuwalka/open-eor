/**
 * Single owner of the local unit + e2e gate (husky pre-push + `pnpm test:precommit`).
 *
 * - `pnpm test:precommit` always runs the suite (SKIP ignored).
 * - husky calls this with `--hook`; only then may SKIP short-circuit.
 *
 * Vitest uses the parent environment (`pnpm test` parity). Playwright: seed one
 * template DB + uploads outside the repo, then for each spec from
 * `playwright test --list` copy only `eor.sqlite` into a fresh work dir (own
 * PORT) while sharing the template `UPLOADS_ROOT` so cwd-relative `storage_path`
 * rows still resolve. Writers cannot consume each other's seed rows.
 */
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { createDb } from "../src/db/client"
import {
  buildPrecommitEnv,
  defaultPrecommitWorkDir,
  shouldSkipHookRun,
  specFilesFromPlaywrightList,
} from "./precommit-env"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const bin = (...names: string[]) => path.join(root, "node_modules", ".bin", ...names)

function main(argv: string[]): number {
  if (shouldSkipHookRun(argv, process.env.SKIP)) {
    console.log(`test-precommit: skipped (SKIP=${process.env.SKIP})`)
    return 0
  }

  const rootWork = defaultPrecommitWorkDir()
  const templateDir = path.join(rootWork, "template")
  const templateUploads = path.join(templateDir, "uploads")
  const cleanup = () => {
    try {
      fs.rmSync(rootWork, { recursive: true, force: true })
    } catch {
      /* best-effort */
    }
  }

  try {
    const vitest = run(bin("vitest"), ["run"], { ...process.env })
    if (vitest !== 0) return vitest

    seedTemplate(templateDir, templateUploads)
    const specs = listSpecFiles()
    if (specs.length === 0) {
      console.error("test-precommit: playwright --list returned no spec files")
      return 1
    }
    console.log(
      `test-precommit: ${specs.length} spec files (per-file sqlite copy; shared UPLOADS_ROOT)`,
    )

    let port = 3720
    for (const spec of specs) {
      const workDir = path.join(rootWork, path.basename(spec, ".spec.ts"))
      fs.mkdirSync(workDir, { recursive: true })
      fs.copyFileSync(path.join(templateDir, "eor.sqlite"), path.join(workDir, "eor.sqlite"))
      const env = playwrightEnv(workDir, templateUploads, port)
      port += 1
      console.log(`test-precommit: ${spec} DATABASE_FILE=${env.DATABASE_FILE} PORT=${env.PORT}`)
      const code = run(bin("playwright"), ["test", spec], env)
      if (code !== 0) return code
    }
    return 0
  } finally {
    cleanup()
  }
}

function seedTemplate(templateDir: string, uploads: string): void {
  const dbFile = path.join(templateDir, "eor.sqlite")
  fs.mkdirSync(uploads, { recursive: true })
  const previousUploads = process.env.UPLOADS_ROOT
  process.env.UPLOADS_ROOT = uploads
  try {
    const db = createDb(dbFile, { forceSeed: false })
    db.$client.pragma("wal_checkpoint(TRUNCATE)")
    db.$client.close()
  } finally {
    if (previousUploads === undefined) delete process.env.UPLOADS_ROOT
    else process.env.UPLOADS_ROOT = previousUploads
  }
}

function listSpecFiles(): string[] {
  const result = spawnSync(bin("playwright"), ["test", "--list"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env },
  })
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || "playwright --list failed")
    return []
  }
  return specFilesFromPlaywrightList(result.stdout ?? "")
}

function playwrightEnv(
  workDir: string,
  uploadsRoot: string,
  port: number,
): NodeJS.ProcessEnv {
  const built = buildPrecommitEnv({ cwd: root, workDir, uploadsRoot, port })
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
