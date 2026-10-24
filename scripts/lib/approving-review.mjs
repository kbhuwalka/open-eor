/**
 * Pure gate: is there a formal approving review on this exact head SHA?
 *
 * Only APPROVED / CHANGES_REQUESTED count (COMMENTED and DISMISSED ignored).
 * Only reviews whose commit.oid equals headSha count (stale SHA approvals ignored).
 * Among those, the latest by submittedAt must be APPROVED.
 *
 * CLI (for submit-pr.sh):
 *   node scripts/lib/approving-review.mjs --head <sha> < reviews.json
 *   stdin: { "reviews": [ ... ] }  (gh pr view --json reviews shape)
 *   stdout: STATE\tAUTHOR   (STATE is APPROVED | CHANGES_REQUESTED | NONE)
 *   exit 0 iff STATE is APPROVED
 */

import path from "node:path"
import { pathToFileURL } from "node:url"

/**
 * @typedef {{
 *   state?: string,
 *   submittedAt?: string,
 *   author?: { login?: string } | null,
 *   commit?: { oid?: string } | null,
 * }} Review
 */

/**
 * @param {Review[]} reviews
 * @param {string} headSha
 * @returns {Review | null}
 */
export function latestDecisiveReviewOnHead(reviews, headSha) {
  if (!Array.isArray(reviews) || !headSha) return null
  const decisive = reviews.filter(
    (r) =>
      (r.state === "APPROVED" || r.state === "CHANGES_REQUESTED") &&
      r.commit?.oid === headSha,
  )
  if (decisive.length === 0) return null
  decisive.sort((a, b) =>
    String(a.submittedAt ?? "").localeCompare(String(b.submittedAt ?? "")),
  )
  return decisive[decisive.length - 1] ?? null
}

/**
 * @param {Review[]} reviews
 * @param {string} headSha
 * @returns {{ ok: boolean, state: string, author: string }}
 */
export function approvingReviewOnHead(reviews, headSha) {
  const latest = latestDecisiveReviewOnHead(reviews, headSha)
  if (!latest) {
    return { ok: false, state: "NONE", author: "" }
  }
  const author = latest.author?.login ?? ""
  const state = latest.state ?? "NONE"
  return {
    ok: state === "APPROVED",
    state,
    author,
  }
}

function runCli(argv, stdinText) {
  const headIdx = argv.indexOf("--head")
  const headSha = headIdx >= 0 ? argv[headIdx + 1] : ""
  if (!headSha) {
    console.error("usage: approving-review.mjs --head <sha> < reviews.json")
    process.exit(2)
  }
  let payload
  try {
    payload = JSON.parse(stdinText || "{}")
  } catch {
    console.error("error: stdin must be JSON with a reviews array")
    process.exit(2)
  }
  const reviews = payload.reviews ?? payload
  const result = approvingReviewOnHead(
    Array.isArray(reviews) ? reviews : [],
    headSha,
  )
  process.stdout.write(`${result.state}\t${result.author}\n`)
  process.exit(result.ok ? 0 : 1)
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : ""
const isMain = Boolean(entry) && import.meta.url === pathToFileURL(entry).href

if (isMain) {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  runCli(process.argv.slice(2), Buffer.concat(chunks).toString("utf8"))
}
