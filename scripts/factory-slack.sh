#!/usr/bin/env bash
# factory-slack.sh — Post one message via the Slack-poster Cursor Automation webhook.
#
# Posts as @Cursor (bot). Requires cloud env secrets (never commit them):
#   FACTORY_SLACK_POSTER_WEBHOOK_URL
#   FACTORY_SLACK_POSTER_WEBHOOK_KEY
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
#   2  Missing secrets in the environment
#   3  Webhook HTTP error or empty response failure

set -euo pipefail

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
  --channel-id <id>      Slack channel ID (default: C0CBESZU7TR)
  --channel <name>       Channel name (e.g. #spacexsi-demo-factory); used only if --channel-id omitted

ENV
  FACTORY_SLACK_POSTER_WEBHOOK_URL   Automation webhook URL
  FACTORY_SLACK_POSTER_WEBHOOK_KEY   Auth header from the Automations UI (full
                                     "Authorization: Bearer …" or the header
                                     value "Bearer …"). Not a bare key — do not
                                     store a key and expect this script to wrap it.

Does not print secret values. Prefer this over user Slack MCP (which posts as Kunal and does not notify him).
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --message)    MESSAGE="$2";    shift 2 ;;
    --channel-id) CHANNEL_ID="$2"; shift 2 ;;
    --channel)    CHANNEL="$2";    shift 2 ;;
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

# Strip CR/LF — trailing newlines in secrets break HTTP/2 Authorization headers.
URL="$(printf '%s' "${FACTORY_SLACK_POSTER_WEBHOOK_URL:-}" | tr -d '\r\n')"
# KEY secret is the Automations UI auth header (not a bare API key).
# Accept:
#   Authorization: Bearer <token>
#   Bearer <token>
# Do not double-prefix Bearer.
AUTH_RAW="$(printf '%s' "${FACTORY_SLACK_POSTER_WEBHOOK_KEY:-}" | tr -d '\r\n')"
AUTH_RAW="${AUTH_RAW#"${AUTH_RAW%%[![:space:]]*}"}"  # ltrim
AUTH_RAW="${AUTH_RAW%"${AUTH_RAW##*[![:space:]]}"}"  # rtrim

if [[ -z "$URL" || -z "$AUTH_RAW" ]]; then
  echo "error: FACTORY_SLACK_POSTER_WEBHOOK_URL and FACTORY_SLACK_POSTER_WEBHOOK_KEY must be set in the cloud environment secrets" >&2
  exit 2
fi

# Build a single curl -H argument: "Authorization: …"
AUTH_HEADER=""
case "$AUTH_RAW" in
  [Aa]uthorization:*)
    AUTH_HEADER="$AUTH_RAW"
    ;;
  [Bb]earer\ *)
    AUTH_HEADER="Authorization: ${AUTH_RAW}"
    ;;
  *)
    echo "error: FACTORY_SLACK_POSTER_WEBHOOK_KEY must be the Automations UI auth header (e.g. 'Bearer …' or 'Authorization: Bearer …'), not a bare key" >&2
    exit 2
    ;;
esac

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required" >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "error: curl is required" >&2
  exit 1
fi

payload=$(
  jq -nc \
    --arg message "$MESSAGE" \
    --arg channelId "$CHANNEL_ID" \
    --arg channel "$CHANNEL" \
    '
      {message: $message}
      + (if $channelId != "" then {channelId: $channelId} else {} end)
      + (if $channel != "" then {channel: $channel} else {} end)
    '
)

# Do not log URL, auth header, or full payload.
http_code=$(
  curl -sS -o /tmp/factory-slack-poster-body.$$ -w "%{http_code}" \
    -X POST "$URL" \
    -H "${AUTH_HEADER}" \
    -H "Content-Type: application/json" \
    --data-binary "$payload"
) || {
  rm -f /tmp/factory-slack-poster-body.$$
  echo "error: curl failed talking to Slack-poster webhook" >&2
  exit 3
}

body_file=/tmp/factory-slack-poster-body.$$
if [[ "$http_code" =~ ^2 ]]; then
  echo "✓ factory-slack — posted (HTTP ${http_code})"
  rm -f "$body_file"
  exit 0
fi

echo "✗ factory-slack — webhook returned HTTP ${http_code}" >&2
# Body may contain automation errors; truncate and avoid echoing secrets.
if [[ -s "$body_file" ]]; then
  head -c 500 "$body_file" >&2 || true
  echo >&2
fi
rm -f "$body_file"
exit 3
