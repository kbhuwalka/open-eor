import { execFile } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const repoRoot = join(import.meta.dirname, "../..")
const script = join(repoRoot, "scripts/submit-review.sh")

type Invocation = { argv: string[] }

function installFakeGh(logPath: string): string {
  const binDir = mkdtempSync(join(tmpdir(), "submit-review-gh-"))
  const ghPath = join(binDir, "gh")
  const logLiteral = JSON.stringify(logPath)
  writeFileSync(
    ghPath,
    `#!${process.execPath}
const fs = require("node:fs")
const entry = { argv: process.argv.slice(2) }
fs.appendFileSync(${logLiteral}, JSON.stringify(entry) + "\\n")
process.exit(Number(process.env.GH_FAKE_EXIT || 0))
`,
    { mode: 0o755 },
  )
  return binDir
}

function readInvocations(logPath: string): Invocation[] {
  const raw = readFileSync(logPath, "utf8").trim()
  if (raw.length === 0) return []
  return raw.split("\n").map((line) => JSON.parse(line) as Invocation)
}

function assertCommentOnly(invocations: Invocation[], pr: string) {
  expect(invocations).toHaveLength(1)
  const argv = invocations[0]?.argv ?? []
  expect(argv.slice(0, 3)).toEqual(["pr", "comment", pr])
  expect(argv).toContain("--body")
  const flags = argv.filter((arg) => arg.startsWith("--"))
  expect(flags).toEqual(["--body"])
  for (const arg of argv) {
    expect(arg).not.toBe("review")
    expect(arg).not.toBe("--approve")
    expect(arg).not.toBe("--request-changes")
    expect(arg).not.toBe("--dismiss")
    expect(arg).not.toMatch(/\/pulls\/[^/]+\/reviews/)
    expect(arg).not.toMatch(/addPullRequestReview/)
  }
}

function runSubmitReview(
  args: string[],
  options: { ghExit?: number; includeGh?: boolean } = {},
) {
  const logPath = join(
    mkdtempSync(join(tmpdir(), "submit-review-log-")),
    "gh.log",
  )
  writeFileSync(logPath, "")
  const includeGh = options.includeGh ?? true
  // Keep the real gh off PATH. A regression that shells out must hit the
  // fake (and be recorded) or fail closed when no fake is installed.
  const binDir = includeGh
    ? installFakeGh(logPath)
    : mkdtempSync(join(tmpdir(), "submit-review-nopath-"))
  const pathPrefix = `${binDir}:/usr/bin:/bin`

  return new Promise<{
    stdout: string
    stderr: string
    code: number
    invocations: Invocation[]
  }>((resolve) => {
    execFile(
      "bash",
      [script, ...args],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          PATH: pathPrefix,
          GH_FAKE_EXIT: String(options.ghExit ?? 0),
        },
      },
      (error, stdout, stderr) => {
        const code =
          error && "code" in error && typeof error.code === "number"
            ? error.code
            : 0
        resolve({
          stdout,
          stderr,
          code,
          invocations: readInvocations(logPath),
        })
      },
    )
  })
}

describe("submit-review.sh", () => {
  it("posts an APPROVED verdict as one PR comment and does not submit a review", async () => {
    const result = await runSubmitReview([
      "--pr",
      "12",
      "--verdict",
      "APPROVED",
      "--strength",
      "scripts/submit-review.sh|posts the verdict as a comment",
    ])

    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe("VERDICT:APPROVED")
    assertCommentOnly(result.invocations, "12")
    const body = result.invocations[0]?.argv.at(-1) ?? ""
    expect(body).toContain("APPROVED")
    expect(body).toContain("posts the verdict as a comment")
  })

  it("posts CHANGES_REQUESTED as comment text and does not request changes", async () => {
    const result = await runSubmitReview([
      "--pr",
      "12",
      "--verdict",
      "CHANGES_REQUESTED",
      "--finding",
      "IMPORTANT|scripts/submit-review.sh:1|calls the review API|that attributes the verdict to the token owner|post a comment only",
    ])

    expect(result.code).toBe(0)
    expect(result.stdout.trim()).toBe("VERDICT:CHANGES_REQUESTED")
    assertCommentOnly(result.invocations, "12")
    const body = result.invocations[0]?.argv.at(-1) ?? ""
    expect(body).toContain("CHANGES_REQUESTED")
    expect(body).toContain("post a comment only")
  })

  it("does not call gh when the verdict is invalid", async () => {
    const approvedWithFinding = await runSubmitReview([
      "--pr",
      "12",
      "--verdict",
      "APPROVED",
      "--finding",
      "IMPORTANT|scripts/submit-review.sh:1|blocking finding|it blocks approval|remove it",
    ])
    expect(approvedWithFinding.code).not.toBe(0)
    expect(approvedWithFinding.invocations).toEqual([])

    const changesWithoutFinding = await runSubmitReview([
      "--pr",
      "12",
      "--verdict",
      "CHANGES_REQUESTED",
    ])
    expect(changesWithoutFinding.code).not.toBe(0)
    expect(changesWithoutFinding.invocations).toEqual([])
  })

  it("exits 0 from --help without calling gh and states the comment-only contract", async () => {
    const result = await runSubmitReview(["--help"], { includeGh: false })

    expect(result.code).toBe(0)
    expect(result.invocations).toEqual([])
    expect(result.stdout).toMatch(/comment/i)
    expect(result.stdout).toMatch(/does not approve/i)
    expect(result.stdout).toMatch(/request changes/i)
    expect(result.stdout).toMatch(/dismiss/i)
    expect(result.stdout).not.toMatch(/--approve/)
    expect(result.stdout).not.toMatch(/--request-changes/)
  })

  it("exits non-zero when the comment post fails and does not fall back to a review", async () => {
    const result = await runSubmitReview(
      ["--pr", "12", "--verdict", "APPROVED"],
      { ghExit: 1 },
    )

    expect(result.code).not.toBe(0)
    assertCommentOnly(result.invocations, "12")
  })
})
