#!/usr/bin/env bash
# issue.sh — View and manage GitHub issue dependencies.
#
# All relationship operations use the GraphQL API directly; the standard
# gh CLI does not support blocking or sub-issue relationships.

set -euo pipefail

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------

usage() {
  cat <<'EOF'
issue.sh — View and manage GitHub issue dependencies.

USAGE
  bash scripts/issue.sh <number> [COMMAND [targets…]]
  bash scripts/issue.sh --help

DESCRIPTION
  All relationship operations use the GraphQL API directly. The standard
  gh CLI does not support blocking or sub-issue relationships.

  With no command, shows the issue's full dependency graph: blockers,
  issues it blocks, parent, and sub-issues with a ready/blocked summary.

COMMANDS
  (none)                    View dependency graph for the issue
  --add-blocker    <n>…     Mark issues as blockers of <number>
                            (they must close before <number> can start)
  --remove-blocker <n>…     Remove blocking relationships
  --add-subtask    <n>…     Make issues sub-issues of <number>
  --remove-subtask <n>…     Remove sub-issue relationships
  --verify-unblocked        Exit 0 if no open blockers, exit 1 if any remain

EXIT CODES
  0  Success
  1  Error (issue not found, GraphQL failure, open blockers found)

EXAMPLES
  bash scripts/issue.sh 372
  bash scripts/issue.sh 372 --add-blocker 547 374
  bash scripts/issue.sh 372 --remove-blocker 547
  bash scripts/issue.sh 372 --add-subtask 380 381
  bash scripts/issue.sh 372 --remove-subtask 380
  bash scripts/issue.sh 372 --verify-unblocked
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

ISSUE=""
COMMAND="view"
TARGETS=()

if [[ $# -eq 0 ]]; then
  echo "error: issue number is required" >&2
  echo "Run 'bash scripts/issue.sh --help' for usage." >&2
  exit 1
fi

ISSUE="$1"
shift

if [[ $# -gt 0 ]]; then
  case "$1" in
    --add-blocker|--remove-blocker|--add-subtask|--remove-subtask|--verify-unblocked)
      COMMAND="${1#--}"
      shift
      TARGETS=("$@")
      ;;
    *)
      echo "error: unknown flag: $1" >&2
      echo "Run 'bash scripts/issue.sh --help' for usage." >&2
      exit 1
      ;;
  esac
fi

if [[ "$COMMAND" != "view" && "$COMMAND" != "verify-unblocked" && ${#TARGETS[@]} -eq 0 ]]; then
  echo "error: --${COMMAND} requires at least one issue number" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

REPO_NWO="$(gh repo view --json nameWithOwner --jq '.nameWithOwner')"
OWNER="${REPO_NWO%%/*}"
REPO="${REPO_NWO##*/}"
GITHUB_GRAPHQL_PAGE_SIZE=100

# Resolve a GitHub issue number to its GraphQL node ID.
# Distinguishes "not found" from API/auth errors.
get_node_id() {
  local number=$1
  local response
  if ! response=$(gh api graphql \
    -f owner="$OWNER" -f repo="$REPO" -F number="$number" \
    -f query='query($owner:String!,$repo:String!,$number:Int!){
      repository(owner:$owner,name:$repo){issue(number:$number){id}}
    }' 2>&1); then
    echo "error: GraphQL request failed for issue #${number}" >&2
    echo "  ${response}" >&2
    exit 1
  fi

  local id
  id=$(echo "$response" | jq -r '.data.repository.issue.id // empty' 2>/dev/null || true)
  if [[ -z "$id" ]]; then
    # Check for GraphQL-level errors vs simply not found
    local gql_err
    gql_err=$(echo "$response" | jq -r '.errors[0].message // empty' 2>/dev/null || true)
    if [[ -n "$gql_err" ]]; then
      echo "error: issue #${number} — ${gql_err}" >&2
    else
      echo "error: issue #${number} not found in ${REPO_NWO}" >&2
    fi
    exit 1
  fi
  echo "$id"
}

# Run a GraphQL mutation and surface any errors in the response body.
run_mutation() {
  local description="$1"
  local query="$2"

  local response
  if ! response=$(gh api graphql -f query="$query" 2>&1); then
    echo "error: GraphQL request failed — ${description}" >&2
    echo "  ${response}" >&2
    exit 1
  fi

  local gql_err
  gql_err=$(echo "$response" | jq -r '.errors[0].message // empty' 2>/dev/null || true)
  if [[ -n "$gql_err" ]]; then
    echo "error: ${description} — ${gql_err}" >&2
    exit 1
  fi
}

json_string() {
  jq -Rn --arg value "$1" '$value'
}

fetch_issue_relationship_nodes() {
  local field="$1"
  local nodes="[]"
  local cursor=""

  while true; do
    local after
    if [[ -z "$cursor" ]]; then
      after="null"
    else
      after="$(json_string "$cursor")"
    fi

    local response
    if ! response=$(gh api graphql \
      -f owner="$OWNER" -f name="$REPO" -F number="$ISSUE" \
      -f query="
        query(\$owner:String!,\$name:String!,\$number:Int!){
          repository(owner:\$owner,name:\$name){
            issue(number:\$number){
              ${field}(first:${GITHUB_GRAPHQL_PAGE_SIZE}, after:${after}){
                nodes{number title state}
                pageInfo{hasNextPage endCursor}
              }
            }
          }
        }
      " --jq ".data.repository.issue.${field}" 2>&1); then
      echo "error: failed to fetch ${field} for issue #${ISSUE}" >&2
      echo "  ${response}" >&2
      exit 1
    fi

    local page_nodes
    page_nodes="$(echo "$response" | jq -c '.nodes // []')"
    nodes="$(jq -cn --argjson existing "$nodes" --argjson page "$page_nodes" '$existing + $page')"

    local has_next
    has_next="$(echo "$response" | jq -r '.pageInfo.hasNextPage // false')"
    if [[ "$has_next" != "true" ]]; then
      break
    fi

    cursor="$(echo "$response" | jq -r '.pageInfo.endCursor // empty')"
    if [[ -z "$cursor" ]]; then
      echo "error: ${field} pagination did not return a next cursor for issue #${ISSUE}" >&2
      exit 1
    fi
  done

  echo "$nodes"
}

# ---------------------------------------------------------------------------
# view
# ---------------------------------------------------------------------------

if [[ "$COMMAND" == "view" ]]; then
  result=""
  if ! result=$(gh api graphql \
    -f owner="$OWNER" -f name="$REPO" -F number="$ISSUE" \
    -f query='
      query($owner:String!,$name:String!,$number:Int!){
        repository(owner:$owner,name:$name){
          issue(number:$number){
            number title state
            parent{ number title state }
            subIssuesSummary{ completed total percentCompleted }
          }
        }
      }
    ' --jq '.data.repository.issue' 2>&1); then
    echo "error: failed to fetch issue #${ISSUE}" >&2
    echo "  ${result}" >&2
    exit 1
  fi

  if [[ -z "$result" || "$result" == "null" ]]; then
    echo "error: issue #${ISSUE} not found in ${REPO_NWO}" >&2
    exit 1
  fi

  title="$(echo "$result" | jq -r '.title')"
  state="$(echo "$result" | jq -r '.state')"
  echo "#${ISSUE}: ${title} [${state}]"
  echo ""

  blocked_by_nodes="$(fetch_issue_relationship_nodes blockedBy)"
  blocking_nodes="$(fetch_issue_relationship_nodes blocking)"
  sub_issue_nodes="$(fetch_issue_relationship_nodes subIssues)"

  blocked_by="$(echo "$blocked_by_nodes" | jq -r '.[]? | "#\(.number) \(.title) [\(.state)]"')"
  if [[ -n "$blocked_by" ]]; then
    open_blockers="$(echo "$blocked_by_nodes" | jq '[.[]? | select(.state=="OPEN")] | length')"
    echo "Blocked by (${open_blockers} open):"
    echo "$blocked_by" | while IFS= read -r line; do echo "  $line"; done
  else
    echo "Blocked by: none"
  fi
  echo ""

  blocking="$(echo "$blocking_nodes" | jq -r '.[]? | "#\(.number) \(.title) [\(.state)]"')"
  if [[ -n "$blocking" ]]; then
    echo "Blocking:"
    echo "$blocking" | while IFS= read -r line; do echo "  $line"; done
  else
    echo "Blocking: none"
  fi
  echo ""

  parent="$(echo "$result" | jq -r 'if .parent then "#\(.parent.number) \(.parent.title) [\(.parent.state)]" else empty end')"
  if [[ -n "$parent" ]]; then
    echo "Parent: ${parent}"
    echo ""
  fi

  sub_issues="$(echo "$sub_issue_nodes" | jq -r '.[]? | "#\(.number) \(.title) [\(.state)]"')"
  if [[ -n "$sub_issues" ]]; then
    pct="$(echo "$result" | jq -r '.subIssuesSummary.percentCompleted')"
    completed="$(echo "$result" | jq -r '.subIssuesSummary.completed')"
    total="$(echo "$result" | jq -r '.subIssuesSummary.total')"
    echo "Sub-issues (${completed}/${total}, ${pct}% complete):"
    echo "$sub_issues" | while IFS= read -r line; do echo "  $line"; done
    echo ""
  fi

  open_blockers="$(echo "$blocked_by_nodes" | jq '[.[]? | select(.state=="OPEN")] | length')"
  if [[ "$state" == "OPEN" && "$open_blockers" -eq 0 ]]; then
    echo "Ready: yes"
  elif [[ "$state" == "OPEN" ]]; then
    echo "Ready: no (${open_blockers} open blockers)"
  else
    echo "Ready: n/a (${state})"
  fi

  exit 0
fi

# ---------------------------------------------------------------------------
# --verify-unblocked
# ---------------------------------------------------------------------------

if [[ "$COMMAND" == "verify-unblocked" ]]; then
  result=""
  if ! result=$(gh api graphql \
    -f owner="$OWNER" -f name="$REPO" -F number="$ISSUE" \
    -f query='
      query($owner:String!,$name:String!,$number:Int!){
        repository(owner:$owner,name:$name){
          issue(number:$number){
            number title state
          }
        }
      }
    ' --jq '.data.repository.issue' 2>&1); then
    echo "error: failed to fetch issue #${ISSUE}" >&2
    echo "  ${result}" >&2
    exit 1
  fi

  if [[ -z "$result" || "$result" == "null" ]]; then
    echo "error: issue #${ISSUE} not found in ${REPO_NWO}" >&2
    exit 1
  fi

  state="$(echo "$result" | jq -r '.state')"
  if [[ "$state" != "OPEN" ]]; then
    echo "error: #${ISSUE} is ${state} — only open issues need blocker verification" >&2
    exit 1
  fi

  blocked_by_nodes="$(fetch_issue_relationship_nodes blockedBy)"
  open_blockers="$(echo "$blocked_by_nodes" | jq -c '[.[]? | select(.state=="OPEN") | {number, title}]')"
  count="$(echo "$open_blockers" | jq 'length')"

  if [[ "$count" -eq 0 ]]; then
    echo "✓ #${ISSUE} — no open blockers"
    exit 0
  fi

  echo "✗ #${ISSUE} has ${count} open blocker(s):" >&2
  echo "$open_blockers" | jq -r '.[] | "  #\(.number) \(.title)"' >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Relationship mutations
# ---------------------------------------------------------------------------

ISSUE_ID="$(get_node_id "$ISSUE")"

for target in "${TARGETS[@]}"; do
  TARGET_ID="$(get_node_id "$target")"

  case "$COMMAND" in
    add-blocker)
      run_mutation "#${target} blocks #${ISSUE}" \
        "mutation {
          addBlockedBy(input: {issueId: \"${ISSUE_ID}\", blockingIssueId: \"${TARGET_ID}\"}) {
            issue { number }
            blockingIssue { number }
          }
        }"
      echo "✓ #${target} now blocks #${ISSUE}"
      ;;

    remove-blocker)
      run_mutation "remove #${target} as blocker of #${ISSUE}" \
        "mutation {
          removeBlockedBy(input: {issueId: \"${ISSUE_ID}\", blockingIssueId: \"${TARGET_ID}\"}) {
            issue { number }
            blockingIssue { number }
          }
        }"
      echo "✓ #${target} no longer blocks #${ISSUE}"
      ;;

    add-subtask)
      run_mutation "#${target} as sub-issue of #${ISSUE}" \
        "mutation {
          addSubIssue(input: {issueId: \"${ISSUE_ID}\", subIssueId: \"${TARGET_ID}\"}) {
            issue { number }
            subIssue { number }
          }
        }"
      echo "✓ #${target} added as sub-issue of #${ISSUE}"
      ;;

    remove-subtask)
      run_mutation "remove #${target} as sub-issue of #${ISSUE}" \
        "mutation {
          removeSubIssue(input: {issueId: \"${ISSUE_ID}\", subIssueId: \"${TARGET_ID}\"}) {
            issue { number }
            subIssue { number }
          }
        }"
      echo "✓ #${target} removed as sub-issue of #${ISSUE}"
      ;;
  esac
done
