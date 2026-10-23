#!/usr/bin/env bash
# submit-pr.sh — Validate, watch required Quality Gates checks, and optionally merge a PR.
#
# CI runs automatically on pull_request (no label retrigger). Required checks:
#   Lint / Unit Tests / Production Build / End-to-End Tests

set -euo pipefail

# Prefer PATH gh; fall back to known local install on this Mac.
if ! command -v gh >/dev/null 2>&1; then
  if [[ -x /Users/kunal/.local/bin/gh ]]; then
    export PATH="/Users/kunal/.local/bin:$PATH"
  else
    echo "error: gh CLI not found on PATH" >&2
    exit 1
  fi
fi

REQUIRED_CHECKS=("Lint" "Unit Tests" "Production Build" "End-to-End Tests")

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------

usage() {
  cat <<'EOF'
submit-pr.sh — Watch required Quality Gates checks and optionally merge a PR.

USAGE
  bash scripts/submit-pr.sh --pr <number> [OPTIONS]
  bash scripts/submit-pr.sh --help

DESCRIPTION
  1. Checks the PR for merge conflicts (exits 2 if conflicting).
  2. If all required checks are already green on the current commit,
     skips watching and goes directly to merge (unless --no-merge).
  3. Otherwise watches the Quality Gates workflow run for the PR head
     until required checks complete (or timeout).
  4. Squash-merges the PR on success unless --no-merge is given.
  5. Closes the linked issue if --issue is provided or the PR body
     contains a "Closes #N" / "Fixes #N" / "Resolves #N" reference.

  Required check names (exact):
    Lint, Unit Tests, Production Build, End-to-End Tests

  There is no label-gated CI. Pushing/updating a PR triggers Quality Gates.

OPTIONS
  --pr <number>        PR number to submit (required)
  --issue <number>     Issue to close after merge (auto-detected from PR body if omitted)
  --timeout <seconds>  Maximum seconds to wait for CI (default: 900)
  --no-merge           Watch CI but do not merge on success

EXIT CODES
  0  Checks passed (and PR merged unless --no-merge was given)
  1  CI failed, timed out, run not found, or merge failed
  2  PR has merge conflicts — CI was not watched for merge

EXAMPLES
  bash scripts/submit-pr.sh --pr 7
  bash scripts/submit-pr.sh --pr 7 --issue 3
  bash scripts/submit-pr.sh --pr 7 --timeout 600 --no-merge
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

PR=""
ISSUE=""
TIMEOUT=900
MERGE=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pr)        PR="$2";      shift 2 ;;
    --issue)     ISSUE="$2";   shift 2 ;;
    --timeout)   TIMEOUT="$2"; shift 2 ;;
    --no-merge)  MERGE=false;  shift   ;;
    *)
      echo "error: unknown argument: $1" >&2
      echo "Run 'bash scripts/submit-pr.sh --help' for usage." >&2
      exit 1 ;;
  esac
done

[[ -n "$PR" ]] || {
  echo "error: --pr is required" >&2
  echo "Run 'bash scripts/submit-pr.sh --help' for usage." >&2
  exit 1
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

REPO_JSON="$(gh repo view --json nameWithOwner,url)"
REPO_NWO="$(echo "$REPO_JSON" | jq -r '.nameWithOwner')"
REPO_URL="$(echo "$REPO_JSON" | jq -r '.url')"

fmt_time() {
  local s=$1
  printf "%d:%02d" $((s / 60)) $((s % 60))
}

print_progress() {
  local elapsed=$1
  local jobs_json=$2

  local symbols=""
  while IFS= read -r job; do
    local name conclusion status
    name=$(echo "$job"       | jq -r '.name')
    conclusion=$(echo "$job" | jq -r '.conclusion // ""')
    status=$(echo "$job"     | jq -r '.status')

    local sym
    case "$conclusion" in
      success)                          sym="✓" ;;
      failure|cancelled|timed_out)      sym="✗" ;;
      *)
        case "$status" in
          in_progress)                  sym="↻" ;;
          queued|waiting)               sym="○" ;;
          *)                            sym="?" ;;
        esac ;;
    esac

    symbols+="  ${sym} ${name}"
  done < <(echo "$jobs_json" | jq -c '.[]')

  printf "\r\033[KPR #%s — [%s / %s]%s" \
    "$PR" "$(fmt_time "$elapsed")" "$(fmt_time "$TIMEOUT")" "$symbols"
}

do_merge() {
  echo "PR #${PR} — merging..."
  local output
  if ! output=$(gh pr merge "$PR" --squash 2>&1); then
    echo "✗ PR #${PR} — merge failed" >&2
    echo "  ${output}" >&2
    echo "  Check the PR for branch protection or review requirements." >&2
    exit 1
  fi
  echo "✓ PR #${PR} — merged"

  local issue_to_close="$ISSUE"
  if [[ -z "$issue_to_close" ]]; then
    issue_to_close=$(
      gh pr view "$PR" --json body --jq '.body' 2>/dev/null \
        | grep -oiE '(closes|fixes|resolves) #[0-9]+' \
        | head -1 \
        | grep -oE '[0-9]+' \
        || true
    )
  fi

  if [[ -n "$issue_to_close" ]]; then
    local issue_state
    issue_state=$(gh issue view "$issue_to_close" --json state --jq '.state' 2>/dev/null || true)
    if [[ "$issue_state" == "CLOSED" ]]; then
      echo "✓ Issue #${issue_to_close} — already closed"
    elif gh issue close "$issue_to_close" --comment "Completed in PR #${PR}." 2>/dev/null; then
      echo "✓ Issue #${issue_to_close} — closed"
    fi
  fi
}

cancel_run() {
  local run_id=$1

  echo "PR #${PR} — force-canceling run ${run_id}..."
  if gh api --method POST "/repos/${REPO_NWO}/actions/runs/${run_id}/force-cancel" --silent 2>/dev/null; then
    echo "✓ PR #${PR} — force-cancel requested"
    return 0
  fi

  echo "warning: force-cancel failed; falling back to standard cancellation" >&2
  if gh api --method POST "/repos/${REPO_NWO}/actions/runs/${run_id}/cancel" --silent 2>/dev/null; then
    echo "✓ PR #${PR} — cancel requested"
    return 0
  fi

  echo "warning: could not cancel run ${run_id}" >&2
  return 1
}

# Returns SUCCESS if every required check name is SUCCESS; otherwise prints
# a short status summary and returns non-zero via echo of the rollup state.
required_checks_state() {
  # Outputs one of: SUCCESS | PENDING | FAILURE | UNKNOWN
  local rollup
  rollup=$(gh pr view "$PR" --json statusCheckRollup --jq '.statusCheckRollup // []' 2>/dev/null || echo "[]")

  local all_success=true
  local any_failure=false
  local any_pending=false
  local found_count=0

  for required in "${REQUIRED_CHECKS[@]}"; do
    local match
    match=$(echo "$rollup" | jq -c --arg name "$required" '
      [.[] | select(.name == $name)] | .[0] // empty
    ')

    if [[ -z "$match" || "$match" == "null" ]]; then
      any_pending=true
      all_success=false
      continue
    fi

    found_count=$((found_count + 1))
    local status conclusion
    status=$(echo "$match" | jq -r '.status // empty')
    conclusion=$(echo "$match" | jq -r '.conclusion // .state // empty')

    if [[ "$status" == "COMPLETED" || "$status" == "completed" || -n "$conclusion" ]]; then
      case "$conclusion" in
        SUCCESS|success)
          ;;
        FAILURE|failure|CANCELLED|cancelled|TIMED_OUT|timed_out|ERROR|error|ACTION_REQUIRED)
          any_failure=true
          all_success=false
          ;;
        *)
          # Non-terminal or unknown
          if [[ "$status" == "IN_PROGRESS" || "$status" == "in_progress" || \
                "$status" == "QUEUED" || "$status" == "queued" || \
                "$status" == "PENDING" || "$status" == "pending" || \
                "$status" == "WAITING" || "$status" == "waiting" || \
                -z "$conclusion" ]]; then
            any_pending=true
            all_success=false
          else
            any_pending=true
            all_success=false
          fi
          ;;
      esac
    else
      any_pending=true
      all_success=false
    fi
  done

  if [[ "$any_failure" == true ]]; then
    echo "FAILURE"
  elif [[ "$all_success" == true && "$found_count" -eq "${#REQUIRED_CHECKS[@]}" ]]; then
    echo "SUCCESS"
  elif [[ "$any_pending" == true ]]; then
    echo "PENDING"
  else
    echo "UNKNOWN"
  fi
}

find_active_quality_gate_run() {
  local runs
  runs=$(
    gh run list --branch "$BRANCH" --workflow "Quality Gates" --limit 10 \
      --json databaseId,status,headSha \
      2>/dev/null || echo "[]"
  )

  echo "$runs" | jq -r --arg head_sha "$HEAD_SHA" '
    .[]
    | select(.headSha == $head_sha)
    | select(.status != "completed")
    | .databaseId
  ' | head -1
}

find_latest_quality_gate_run() {
  local runs
  runs=$(
    gh run list --branch "$BRANCH" --workflow "Quality Gates" --limit 10 \
      --json databaseId,status,headSha \
      2>/dev/null || echo "[]"
  )

  echo "$runs" | jq -r --arg head_sha "$HEAD_SHA" '
    .[]
    | select(.headSha == $head_sha)
    | .databaseId
  ' | head -1
}

# ---------------------------------------------------------------------------
# Step 1: Check mergeability
# ---------------------------------------------------------------------------

echo "PR #${PR} — checking for merge conflicts..."

BRANCH=""
HEAD_SHA=""
MERGEABLE=""
pr_json=""
if ! pr_json=$(gh pr view "$PR" --json mergeable,headRefName,headRefOid 2>&1); then
  echo "✗ PR #${PR} — could not fetch PR details" >&2
  echo "  ${pr_json}" >&2
  exit 1
fi

MERGEABLE=$(echo "$pr_json" | jq -r '.mergeable')
BRANCH=$(echo "$pr_json"    | jq -r '.headRefName')
HEAD_SHA=$(echo "$pr_json"  | jq -r '.headRefOid')

if [[ "$MERGEABLE" == "UNKNOWN" ]]; then
  sleep 5
  MERGEABLE=$(gh pr view "$PR" --json mergeable --jq '.mergeable' 2>/dev/null || echo "UNKNOWN")
fi

if [[ "$MERGEABLE" == "CONFLICTING" ]]; then
  echo ""
  echo "✗ PR #${PR} has merge conflicts" >&2
  echo "  Branch: ${BRANCH}" >&2
  echo "  Resolve the conflict and push before re-submitting." >&2
  exit 2
fi

# ---------------------------------------------------------------------------
# Step 2: Already green?
# ---------------------------------------------------------------------------

CHECK_STATE="$(required_checks_state)"
if [[ "$CHECK_STATE" == "SUCCESS" ]]; then
  echo "PR #${PR} — all required checks already green on current commit"
  if [[ "$MERGE" == false ]]; then
    echo "  Skipping merge (--no-merge)"
    exit 0
  fi
  do_merge
  exit 0
fi

if [[ "$CHECK_STATE" == "FAILURE" ]]; then
  echo "✗ PR #${PR} — required checks already failed on current commit" >&2
  echo "  Required: ${REQUIRED_CHECKS[*]}" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Step 3: Find or wait for a Quality Gates run
# ---------------------------------------------------------------------------

RUN_ID="$(find_active_quality_gate_run)"
if [[ -n "$RUN_ID" ]]; then
  echo "PR #${PR} — checks already running on ${BRANCH}; watching run ${RUN_ID}..."
else
  echo "PR #${PR} — waiting for Quality Gates run on ${BRANCH} (head ${HEAD_SHA:0:7})..."
  RUN_ID=""
  for _ in {1..20}; do
    sleep 6
    RUN_ID="$(find_active_quality_gate_run)"
    if [[ -z "$RUN_ID" ]]; then
      RUN_ID="$(find_latest_quality_gate_run)"
      # If latest is already completed, drop into check-state path below via watch skip
      if [[ -n "$RUN_ID" ]]; then
        local_status=$(gh run view "$RUN_ID" --json status --jq '.status' 2>/dev/null || echo "")
        if [[ "$local_status" == "completed" ]]; then
          break
        fi
        # still queued/in_progress — keep as RUN_ID
        break
      fi
    else
      break
    fi
  done

  if [[ -z "$RUN_ID" ]]; then
    # Last chance: required checks may have appeared without a discoverable run id
    CHECK_STATE="$(required_checks_state)"
    if [[ "$CHECK_STATE" == "SUCCESS" ]]; then
      echo "PR #${PR} — required checks became green while waiting"
      if [[ "$MERGE" == false ]]; then
        echo "  Skipping merge (--no-merge)"
        exit 0
      fi
      do_merge
      exit 0
    fi
    echo ""
    echo "✗ PR #${PR} — no Quality Gates run appeared within ~120s" >&2
    echo "  Branch: ${BRANCH}" >&2
    echo "  Ensure the Quality Gates workflow is enabled and the PR targets main." >&2
    exit 1
  fi

  echo "PR #${PR} — found run ${RUN_ID}, watching..."
fi

# ---------------------------------------------------------------------------
# Step 4: Watch run
# ---------------------------------------------------------------------------

gh run watch "$RUN_ID" --exit-status > /dev/null 2>&1 &
WATCH_PID=$!

(sleep "$TIMEOUT" && kill "$WATCH_PID" 2>/dev/null) &
TIMEOUT_PID=$!

progress_loop() {
  local elapsed=0
  while kill -0 "$WATCH_PID" 2>/dev/null; do
    local jobs_json
    jobs_json=$(
      gh run view "$RUN_ID" --json jobs \
        --jq '.jobs | map({name, status, conclusion})' \
        2>/dev/null || echo "[]"
    )
    print_progress "$elapsed" "$jobs_json"
    sleep 15
    elapsed=$((elapsed + 15))
  done
}
progress_loop &
PROGRESS_PID=$!

WATCH_EXIT=0
wait "$WATCH_PID" || WATCH_EXIT=$?

kill "$TIMEOUT_PID" 2>/dev/null || true
kill "$PROGRESS_PID" 2>/dev/null || true
wait "$TIMEOUT_PID" 2>/dev/null || true
wait "$PROGRESS_PID" 2>/dev/null || true

printf "\r\033[K"

# ---------------------------------------------------------------------------
# Step 5: Report + merge
# ---------------------------------------------------------------------------

RUN_URL="${REPO_URL}/actions/runs/${RUN_ID}"

FINAL=""
if ! FINAL=$(gh run view "$RUN_ID" --json status,conclusion,jobs \
  --jq '{
    status:     .status,
    conclusion: (.conclusion // "unknown"),
    failed:     [.jobs[] | select(.conclusion == "failure") | .name]
  }' 2>&1); then
  echo "✗ PR #${PR} — could not fetch final run status" >&2
  echo "  Run: ${RUN_URL}" >&2
  echo "  ${FINAL}" >&2
  exit 1
fi

CONCLUSION=$(echo "$FINAL" | jq -r '.conclusion')
STATUS=$(echo "$FINAL"     | jq -r '.status')

if [[ "$WATCH_EXIT" -ne 0 && "$STATUS" != "completed" ]]; then
  echo "✗ PR #${PR} — timed out after $(fmt_time "$TIMEOUT")" >&2
  echo "  Run: ${RUN_URL}" >&2
  cancel_run "$RUN_ID" || true
  exit 1
fi

if [[ "$CONCLUSION" != "success" ]]; then
  FAILED_JOBS=$(echo "$FINAL" | jq -r '.failed | join(", ")')
  echo "✗ PR #${PR} — CI failed" >&2
  if [[ -n "$FAILED_JOBS" ]]; then
    echo "  Failed checks: ${FAILED_JOBS}" >&2
  fi
  echo "  Run: ${RUN_URL}" >&2
  exit 1
fi

# Double-check required job names succeeded (workflow may add extra jobs later).
CHECK_STATE="$(required_checks_state)"
if [[ "$CHECK_STATE" != "SUCCESS" ]]; then
  echo "✗ PR #${PR} — workflow succeeded but required checks are not all SUCCESS" >&2
  echo "  Required: ${REQUIRED_CHECKS[*]}" >&2
  echo "  State: ${CHECK_STATE}" >&2
  echo "  Run: ${RUN_URL}" >&2
  exit 1
fi

echo "✓ PR #${PR} — all required checks passed"

if [[ "$MERGE" == false ]]; then
  echo "  Skipping merge (--no-merge)"
  exit 0
fi

do_merge
