#!/usr/bin/env bash
# submit-pr.sh — Watch required Quality Gates checks, then squash-merge.
#
# CI runs automatically on pull_request (no label retrigger). Required checks:
#   Lint / Unit Tests / Production Build / End-to-End Tests
#
# Those four jobs are decided from Actions workflow runs for the PR head SHA
# (`gh run list` / `gh run view` on the Quality Gates workflow). This script
# does not read statusCheckRollup or the Checks API. A 403 from the Actions
# API is fatal: the token cannot read Actions, and that is not pending CI.
#
# The merge gate is (1) a formal approving GitHub review on the current head
# SHA and (2) those CI checks (and a clean merge). Anyone's APPROVED review
# counts (typically the Cursor Automation, login `cursor`). CI green alone
# is not review passed. A first-line comment verdict is not required.
# GH_TOKEN is the PR author and cannot self-approve.
#
# Review predicate (scripts/lib/approving-review.mjs): among APPROVED /
# CHANGES_REQUESTED reviews whose commit.oid equals the head about to merge,
# the latest must be APPROVED. Checked at start and again immediately before
# merge (re-fetch; refuse if head moved).

set -euo pipefail

# Prefer PATH gh; fall back to known local install on this Mac.
if ! command -v gh >/dev/null 2>&1; then
  if [[ -x /Users/kunal/.local/bin/gh ]]; then
    export PATH="/Users/kunal/.local/bin:$PATH"
  else
    echo "error: gh CLI not found on PATH" >&2
    exit 4
  fi
fi

REQUIRED_CHECKS=("Lint" "Unit Tests" "Production Build" "End-to-End Tests")
WORKFLOW_NAME="Quality Gates"

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
  2. Requires a formal GitHub approving review on the current head SHA
     (latest APPROVED/CHANGES_REQUESTED whose commit.oid equals head must
     be APPROVED). Checked again immediately before merge. Does not poll.
  3. Decides the four required jobs from the Quality Gates Actions workflow
     run for the PR head SHA (`gh run list` / `gh run view`). It does not
     read statusCheckRollup or the Checks API.
  4. If those jobs already succeeded, skips watching and squash-merges
     (unless --no-merge).
  5. If they are still running, or the run has not appeared yet, watches
     the workflow run until they complete (or timeout).
  6. Squash-merges the PR when review + those jobs pass, unless --no-merge
     is given.
  7. Closes the linked issue if --issue is provided or the PR body
     contains a "Closes #N" / "Fixes #N" / "Resolves #N" reference.

  Required check names (exact):
    Lint, Unit Tests, Production Build, End-to-End Tests

  There is no label-gated CI. Pushing/updating a PR triggers Quality Gates.
  If the Actions API returns 403, the script exits 4 (gave up) and reports
  that the token cannot read Actions. That failure is not pending CI /
  exit 1.

OPTIONS
  --pr <number>        PR number to submit (required)
  --issue <number>     Issue to close after merge (auto-detected from PR body if omitted)
  --timeout <seconds>  Maximum seconds to wait for CI (default: 900)
  --no-merge           Watch CI but do not merge on success

EXIT CODES
  0  Checks passed (and PR merged unless --no-merge was given)
  1  Quality Gates CI failed on the head (required jobs red)
  2  PR has merge conflicts — CI was not watched for merge
  3  Head moved or approving review missing/gone on the head SHA
  4  Gave up — timeout, Actions 403, no Quality Gates run, merge error, or broken review gate

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
      exit 4 ;;
  esac
done

[[ -n "$PR" ]] || {
  echo "error: --pr is required" >&2
  echo "Run 'bash scripts/submit-pr.sh --help' for usage." >&2
  exit 4
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

# Exit helpers — implement-issue switches on these codes (do not parse stderr).
exit_ci_failed() { exit 1; }
exit_conflict() { exit 2; }
exit_head_or_approval() { exit 3; }
exit_gave_up() { exit 4; }

# Require approving review on headSha. Sets REVIEW_AUTHOR on success.
# stdin unused — takes reviews JSON string as $1 and head as $2.
require_approving_review() {
  local reviews_json=$1
  local head_sha=$2
  local out status=0
  out=$(
    printf '%s\n' "$reviews_json" \
      | node "$(dirname "${BASH_SOURCE[0]}")/lib/approving-review.mjs" --head "$head_sha"
  ) || status=$?
  local state author
  state=$(printf '%s\n' "$out" | cut -f1)
  author=$(printf '%s\n' "$out" | cut -f2)
  # Exit 2 / missing STATE line / node crash = broken gate, not "not approved".
  if [[ $status -eq 2 || -z "$state" ]]; then
    echo "✗ PR #${PR} — approving-review gate failed (module/CLI error)" >&2
    echo "  ${out}" >&2
    exit_gave_up
  fi
  if [[ $status -ne 0 || "$state" != "APPROVED" ]]; then
    echo "✗ PR #${PR} — no approving GitHub review on head ${head_sha:0:7}" >&2
    echo "  Latest decisive review on this head: ${state}${author:+ (from ${author})}" >&2
    echo "  Wait for Automation (or another reviewer) to formally approve this commit," >&2
    echo "  then re-run. CI green alone is not review passed. Stale-SHA approvals do not count." >&2
    exit_head_or_approval
  fi
  REVIEW_AUTHOR="$author"
}

do_merge() {
  echo "PR #${PR} — re-checking head and approving review before merge..."
  local merge_json
  if ! merge_json=$(gh pr view "$PR" --json headRefOid,reviews 2>&1); then
    echo "✗ PR #${PR} — could not re-fetch PR before merge" >&2
    echo "  ${merge_json}" >&2
    exit_gave_up
  fi
  local live_head
  live_head=$(echo "$merge_json" | jq -r '.headRefOid')
  if [[ "$live_head" != "$HEAD_SHA" ]]; then
    echo "✗ PR #${PR} — head moved during CI watch (${HEAD_SHA:0:7} → ${live_head:0:7})" >&2
    echo "  Re-run submit-pr after Automation approves the new head." >&2
    exit_head_or_approval
  fi
  local reviews_json
  reviews_json=$(echo "$merge_json" | jq -c '{reviews: .reviews}')
  require_approving_review "$reviews_json" "$live_head"

  echo "PR #${PR} — merging..."
  local output
  if ! output=$(gh pr merge "$PR" --squash --match-head-commit "$HEAD_SHA" 2>&1); then
    echo "✗ PR #${PR} — merge failed" >&2
    echo "  ${output}" >&2
    echo "  Required: an approving GitHub review on the head SHA and green Quality Gates." >&2
    echo "  Merge uses --match-head-commit ${HEAD_SHA:0:7} so a raced push cannot slip through." >&2
    exit_gave_up
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

# Run a gh command that reads Actions.
# stdout: command output on success.
# return 0 on success, 2 if the token cannot read Actions (403), 1 otherwise.
# Does not exit the shell: callers run in command substitutions and must
# propagate the status themselves. Never maps a 403 onto an empty result.
gh_actions() {
  local err_file out status=0
  err_file=$(mktemp)
  out=$(gh "$@" 2>"$err_file") || status=$?
  if [[ $status -eq 0 ]]; then
    rm -f "$err_file"
    printf '%s\n' "$out"
    return 0
  fi
  if grep -Eqi 'not accessible by personal access token|HTTP 403|"status": *"403"' "$err_file" \
    || grep -Eqi 'not accessible by personal access token|HTTP 403|"status": *"403"' <<<"$out"; then
    echo "error: the token cannot read Actions (GitHub returned 403: Resource not accessible by personal access token)." >&2
    cat "$err_file" >&2
    rm -f "$err_file"
    return 2
  fi
  cat "$err_file" >&2
  rm -f "$err_file"
  return 1
}

# JSON array of Quality Gates runs for HEAD_SHA, newest first.
# return 0 with [] when no run exists yet; 2 on Actions 403; 1 on other errors.
list_quality_gate_runs() {
  local runs status=0 filtered
  runs=$(gh_actions run list \
    --repo "$REPO_NWO" \
    --commit "$HEAD_SHA" \
    --workflow "$WORKFLOW_NAME" \
    --limit 20 \
    --json databaseId,status,conclusion,headSha) || status=$?
  if [[ $status -ne 0 ]]; then
    return "$status"
  fi
  if ! filtered=$(printf '%s\n' "$runs" | jq -c --arg sha "$HEAD_SHA" '[.[] | select(.headSha == $sha)]'); then
    echo "error: could not parse Actions workflow run list." >&2
    return 1
  fi
  printf '%s\n' "$filtered"
}

# stdin: `gh run view --json status,conclusion,jobs`
# stdout: SUCCESS | PENDING | FAILURE
classify_required_jobs() {
  local required_json
  if ! required_json=$(printf '%s\n' "${REQUIRED_CHECKS[@]}" | jq -R . | jq -s -c .); then
    echo "error: could not encode required check names." >&2
    return 1
  fi
  jq -r --argjson required "$required_json" '
    def lc: ascii_downcase;
    def failed_conclusion:
      ((. // "") | lc) as $c
      | (["failure", "cancelled", "timed_out", "error", "action_required", "startup_failure", "skipped"] | index($c)) != null;
    . as $run
    | ($run.jobs // []) as $jobs
    | ($run.status // "" | lc) as $run_status
    | reduce $required[] as $name (
        {failure: false, pending: false, success_count: 0};
        [$jobs[] | select(.name == $name)] as $matches
        | if ($matches | length) == 0 then
            if $run_status == "completed" then .failure = true
            else .pending = true
            end
          elif any($matches[]; (.conclusion | failed_conclusion)) then
            .failure = true
          elif any($matches[]; ((.status // "" | lc) != "completed")) then
            .pending = true
          elif all($matches[]; ((.status // "" | lc) == "completed" and ((.conclusion // "") | lc) == "success")) then
            .success_count += 1
          else
            .failure = true
          end
      )
    | if .failure then "FAILURE"
      elif .pending then "PENDING"
      elif .success_count == ($required | length) then "SUCCESS"
      else "PENDING"
      end
  '
}

# stdout: SUCCESS | PENDING | FAILURE
# PENDING when no run exists yet or required jobs are still running.
# FAILURE when a required job failed, was cancelled/skipped, or is missing
# from a completed run. Does not consult statusCheckRollup or the Checks API.
required_checks_state() {
  local runs status=0 run_id run_json state
  runs=$(list_quality_gate_runs) || status=$?
  if [[ $status -ne 0 ]]; then
    return "$status"
  fi
  if ! run_id=$(printf '%s\n' "$runs" | jq -r '.[0].databaseId // empty'); then
    echo "error: could not parse Actions workflow run list." >&2
    return 1
  fi
  if [[ -z "$run_id" ]]; then
    echo "PENDING"
    return 0
  fi
  status=0
  run_json=$(gh_actions run view "$run_id" --repo "$REPO_NWO" --json status,conclusion,jobs) || status=$?
  if [[ $status -ne 0 ]]; then
    return "$status"
  fi
  if ! state=$(printf '%s\n' "$run_json" | classify_required_jobs); then
    echo "error: could not classify Actions jobs for run ${run_id}." >&2
    return 1
  fi
  printf '%s\n' "$state"
}

find_active_quality_gate_run() {
  local runs status=0
  runs=$(list_quality_gate_runs) || status=$?
  if [[ $status -ne 0 ]]; then
    return "$status"
  fi
  printf '%s\n' "$runs" | jq -r '[.[] | select(.status != "completed") | .databaseId][0] // empty'
}

find_latest_quality_gate_run() {
  local runs status=0
  runs=$(list_quality_gate_runs) || status=$?
  if [[ $status -ne 0 ]]; then
    return "$status"
  fi
  printf '%s\n' "$runs" | jq -r '.[0].databaseId // empty'
}

# Sets CHECK_STATE. Exits 4 (gave up) on Actions 403 or any other read failure.
read_check_state() {
  local status=0
  CHECK_STATE="$(required_checks_state)" || status=$?
  if [[ $status -eq 2 ]]; then
    exit_gave_up
  fi
  if [[ $status -ne 0 ]]; then
    echo "error: could not read Actions workflow runs for PR #${PR} (head ${HEAD_SHA:0:7})." >&2
    exit_gave_up
  fi
  case "$CHECK_STATE" in
    SUCCESS|PENDING|FAILURE) ;;
    *)
      echo "error: unexpected Actions check state '${CHECK_STATE}' for PR #${PR}." >&2
      exit_gave_up
      ;;
  esac
}

# ---------------------------------------------------------------------------
# Step 1: Check mergeability + approving review (one-shot, no poll)
# ---------------------------------------------------------------------------

echo "PR #${PR} — checking for merge conflicts and approving review..."

BRANCH=""
HEAD_SHA=""
MERGEABLE=""
pr_json=""
if ! pr_json=$(gh pr view "$PR" --json mergeable,headRefName,headRefOid,reviews 2>&1); then
  echo "✗ PR #${PR} — could not fetch PR details" >&2
  echo "  ${pr_json}" >&2
  exit_gave_up
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
  exit_conflict
fi

REVIEW_AUTHOR=""
reviews_for_gate=$(echo "$pr_json" | jq -c '{reviews: .reviews}')
require_approving_review "$reviews_for_gate" "$HEAD_SHA"
echo "PR #${PR} — approving review on ${HEAD_SHA:0:7} from ${REVIEW_AUTHOR:-unknown}"

# ---------------------------------------------------------------------------
# Step 2: Already green?
# ---------------------------------------------------------------------------

read_check_state
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
  exit_ci_failed
fi

# ---------------------------------------------------------------------------
# Step 3: Find or wait for a Quality Gates run
# ---------------------------------------------------------------------------

run_lookup_status=0
RUN_ID="$(find_active_quality_gate_run)" || run_lookup_status=$?
if [[ $run_lookup_status -eq 2 ]]; then
  exit_gave_up
fi
if [[ $run_lookup_status -ne 0 ]]; then
  echo "error: could not list Actions workflow runs for PR #${PR} (head ${HEAD_SHA:0:7})." >&2
  exit_gave_up
fi
if [[ -n "$RUN_ID" ]]; then
  echo "PR #${PR} — checks already running on ${BRANCH}; watching run ${RUN_ID}..."
else
  echo "PR #${PR} — waiting for Quality Gates run on ${BRANCH} (head ${HEAD_SHA:0:7})..."
  RUN_ID=""
  for _ in {1..20}; do
    sleep 6
    run_lookup_status=0
    RUN_ID="$(find_active_quality_gate_run)" || run_lookup_status=$?
    if [[ $run_lookup_status -eq 2 ]]; then
      exit_gave_up
    fi
    if [[ $run_lookup_status -ne 0 ]]; then
      echo "error: could not list Actions workflow runs for PR #${PR} (head ${HEAD_SHA:0:7})." >&2
      exit_gave_up
    fi
    if [[ -z "$RUN_ID" ]]; then
      run_lookup_status=0
      RUN_ID="$(find_latest_quality_gate_run)" || run_lookup_status=$?
      if [[ $run_lookup_status -eq 2 ]]; then
        exit_gave_up
      fi
      if [[ $run_lookup_status -ne 0 ]]; then
        echo "error: could not list Actions workflow runs for PR #${PR} (head ${HEAD_SHA:0:7})." >&2
        exit_gave_up
      fi
      # Completed or still queued: watch (or re-read) this run below.
      if [[ -n "$RUN_ID" ]]; then
        break
      fi
    else
      break
    fi
  done

  if [[ -z "$RUN_ID" ]]; then
    # Last chance: required jobs may have finished without a discoverable run id
    read_check_state
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
    exit_gave_up
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
run_lookup_status=0
FINAL="$(gh_actions run view "$RUN_ID" --repo "$REPO_NWO" --json status,conclusion,jobs \
  --jq '{
    status:     .status,
    conclusion: (.conclusion // "unknown"),
    failed:     [.jobs[] | select(.conclusion == "failure") | .name]
  }')" || run_lookup_status=$?
if [[ $run_lookup_status -eq 2 ]]; then
  exit_gave_up
fi
if [[ $run_lookup_status -ne 0 ]]; then
  echo "✗ PR #${PR} — could not fetch final run status" >&2
  echo "  Run: ${RUN_URL}" >&2
  exit_gave_up
fi

CONCLUSION=$(echo "$FINAL" | jq -r '.conclusion')
STATUS=$(echo "$FINAL"     | jq -r '.status')

if [[ "$WATCH_EXIT" -ne 0 && "$STATUS" != "completed" ]]; then
  echo "✗ PR #${PR} — timed out after $(fmt_time "$TIMEOUT")" >&2
  echo "  Run: ${RUN_URL}" >&2
  cancel_run "$RUN_ID" || true
  exit_gave_up
fi

if [[ "$CONCLUSION" != "success" ]]; then
  FAILED_JOBS=$(echo "$FINAL" | jq -r '.failed | join(", ")')
  echo "✗ PR #${PR} — CI failed" >&2
  if [[ -n "$FAILED_JOBS" ]]; then
    echo "  Failed checks: ${FAILED_JOBS}" >&2
  fi
  echo "  Run: ${RUN_URL}" >&2
  exit_ci_failed
fi

# Double-check required job names succeeded (workflow may add extra jobs later).
read_check_state
if [[ "$CHECK_STATE" != "SUCCESS" ]]; then
  echo "✗ PR #${PR} — workflow succeeded but required checks are not all SUCCESS" >&2
  echo "  Required: ${REQUIRED_CHECKS[*]}" >&2
  echo "  State: ${CHECK_STATE}" >&2
  echo "  Run: ${RUN_URL}" >&2
  exit_ci_failed
fi

echo "✓ PR #${PR} — all required checks passed"

if [[ "$MERGE" == false ]]; then
  echo "  Skipping merge (--no-merge)"
  exit 0
fi

do_merge
