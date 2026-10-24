/**
 * Normalize FACTORY_SLACK_POSTER_WEBHOOK_KEY into one Authorization header.
 *
 * Accepts (after trim / CR-LF strip):
 *   - bare token
 *   - "Bearer <token>"
 *   - "Authorization: Bearer <token>"
 *   - "Authorization: <token>" (rare)
 *
 * Always emits: "Authorization: Bearer <token>"
 * Rejects empty remainder or values that look like a URL (contain "://").
 *
 * CLI:
 *   node scripts/lib/factory-slack-auth.mjs --normalize < raw.txt
 *   stdout: Authorization: Bearer …
 *   exit 0 on success, 2 on reject
 */

import path from "node:path"
import { pathToFileURL } from "node:url"

/**
 * @param {string} raw
 * @returns {{ ok: true, header: string, token: string } | { ok: false, reason: string }}
 */
export function normalizeWebhookAuthHeader(raw) {
  let s = String(raw ?? "")
    .replace(/\r/g, "")
    .replace(/\n/g, "")
    .trim()

  if (!s) {
    return { ok: false, reason: "empty auth secret" }
  }

  // Strip one optional "Authorization:" prefix (case-insensitive).
  const authMatch = /^authorization\s*:\s*/i.exec(s)
  if (authMatch) {
    s = s.slice(authMatch[0].length).trim()
  }

  // Strip one optional "Bearer " prefix (case-insensitive).
  const bearerMatch = /^bearer\s+/i.exec(s)
  if (bearerMatch) {
    s = s.slice(bearerMatch[0].length).trim()
  }

  if (!s) {
    return { ok: false, reason: "empty token after stripping Authorization:/Bearer" }
  }

  // URL pasted into the key slot (common misconfig: KEY == WEBHOOK_URL).
  if (s.includes("://")) {
    return {
      ok: false,
      reason: "auth secret looks like a URL — store the webhook API key, not the webhook URL",
    }
  }

  return {
    ok: true,
    token: s,
    header: `Authorization: Bearer ${s}`,
  }
}

function runCli(argv, stdinText) {
  if (!argv.includes("--normalize")) {
    console.error("usage: factory-slack-auth.mjs --normalize < auth.txt")
    process.exit(2)
  }
  const result = normalizeWebhookAuthHeader(stdinText)
  if (!result.ok) {
    console.error(`error: ${result.reason}`)
    process.exit(2)
  }
  process.stdout.write(`${result.header}\n`)
  process.exit(0)
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : ""
const isMain = Boolean(entry) && import.meta.url === pathToFileURL(entry).href

if (isMain) {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  runCli(process.argv.slice(2), Buffer.concat(chunks).toString("utf8"))
}
