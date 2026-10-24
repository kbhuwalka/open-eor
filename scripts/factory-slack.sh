#!/usr/bin/env bash
# factory-slack.sh — Post one message via the Slack-poster Cursor Automation webhook.
#
# Posts as @Cursor (bot). Requires cloud env secrets (never commit them):
#   FACTORY_SLACK_POSTER_WEBHOOK_URL   — webhook URL
#   FACTORY_SLACK_POSTER_WEBHOOK_KEY   — webhook API key / Automations auth header
#     (bare key, "Bearer …", or "Authorization: Bearer …" — normalized to one header)
#
# Usage:
#   bash scripts/factory-slack.sh --message "…"
#   bash scripts/factory-slack.sh --channel-id C0CBESZU7TR --message "…"
#   bash scripts/factory-slack.sh --channel '#spacexsi-demo-factory' --message "…"
#
# Defaults --channel-id to C0CBESZU7TR (#spacexsi-demo-factory) when neither
# channel flag is set.
#
# EXIT CODES
#   0  Webhook accepted the request (HTTP 2xx)
#   1  Usage / missing args
#   2  Missing / invalid secrets (incl. URL pasted into KEY)
#   3  Webhook HTTP error or curl failure

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHANNEL_ID=""
CHANNEL=""
MESSAGE=""

usage() {
  cat <<'EOF'
factory-slack.sh — Post one Slack message via the factory Slack-poster Automation.

USAGE
  bash scripts/factory-slack.sh --message <text> [OPTIONS]
  bash scripts/factory-slack.sh --help

OPTIONS
  --message <text>       Message body (required). Markdown OK; include <@U…> mentions as needed.
  --channel-id <id>      Slack channel ID (default: C0CBESZU7TR). Prefer this over --channel.
  --channel <name>       Channel name (e.g. #spacexsi-demo-factory); used only if --channel-id omitted

ENV
  FACTORY_SLACK_POSTER_WEBHOOK_URL   Automation webhook URL
  FACTORY_SLACK_POSTER_WEBHOOK_KEY   Webhook API key or Automations auth header
                                     (bare / Bearer … / Authorization: Bearer …)

Does not print secret values. Prefer this over user Slack MCP (which posts as Kunal and does not notify him).
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --message)
      [[ $# -ge 2 ]] || { echo "error: --message requires a value" >&2; exit 1; }
      MESSAGE="$2"; shift 2 ;;
    --channel-id)
      [[ $# -ge 2 ]] || { echo "error: --channel-id requires a value" >&2; exit 1; }
      CHANNEL_ID="$2"; shift 2 ;;
    --channel)
      [[ $# -ge 2 ]] || { echo "error: --channel requires a value" >&2; exit 1; }
      CHANNEL="$2"; shift 2 ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage >&2
      exit 1 ;;
  esac
done

[[ -n "$MESSAGE" ]] || {
  echo "error: --message is required" >&2
  usage >&2
  exit 1
}

if [[ -z "$CHANNEL_ID" && -z "$CHANNEL" ]]; then
  CHANNEL_ID="C0CBESZU7TR"
fi

URL="$(printf '%s' "${FACTORY_SLACK_POSTER_WEBHOOK_URL:-}" | tr -d '\r\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
KEY_RAW="$(printf '%s' "${FACTORY_SLACK_POSTER_WEBHOOK_KEY:-}")"

if [[ -z "$URL" || -z "${KEY_RAW//[$'\r\n[:space:]]/}" ]]; then
  echo "error: FACTORY_SLACK_POSTER_WEBHOOK_URL and FACTORY_SLACK_POSTER_WEBHOOK_KEY must be set in the cloud environment secrets" >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "error: node is required" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required" >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "error: curl is required" >&2
  exit 1
fi

AUTH_HEADER=""
norm_status=0
AUTH_HEADER="$(
  printf '%s' "$KEY_RAW" | node "${SCRIPT_DIR}/lib/factory-slack-auth.mjs" --normalize
)" || norm_status=$?
if [[ $norm_status -ne 0 || -z "$AUTH_HEADER" ]]; then
  echo "error: could not normalize FACTORY_SLACK_POSTER_WEBHOOK_KEY (need webhook API key, not the webhook URL)" >&2
  exit 2
fi

if [[ -n "$CHANNEL_ID" ]]; then
  payload=$(jq -nc --arg message "$MESSAGE" --arg channelId "$CHANNEL_ID" \
    '{message: $message, channelId: $channelId}')
else
  payload=$(jq -nc --arg message "$MESSAGE" --arg channel "$CHANNEL" \
    '{message: $message, channel: $channel}')
fi

body_file=$(mktemp)
trap 'rm -f "$body_file"' EXIT

http_code=$(
  curl -sS --max-time 30 -o "$body_file" -w "%{http_code}" \
    -X POST "$URL" \
    -H "${AUTH_HEADER}" \
    -H "Content-Type: application/json" \
    --data-binary "$payload"
) || {
  echo "error: curl failed talking to Slack-poster webhook" >&2
  exit 3
}

if [[ "$http_code" =~ ^2 ]]; then
  echo "✓ factory-slack — posted (HTTP ${http_code})"
  exit 0
fi

echo "✗ factory-slack — webhook returned HTTP ${http_code}" >&2
if [[ -s "$body_file" ]]; then
  head -c 500 "$body_file" >&2 || true
  echo >&2
fi
exit 3
