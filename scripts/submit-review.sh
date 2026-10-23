#!/usr/bin/env bash
# scripts/submit-review.sh — Post a structured code review as a PR comment.
#
# Usage:
#   bash scripts/submit-review.sh --pr <number> \
#     --verdict APPROVED|CHANGES_REQUESTED \
#     [--finding "CRITICAL|IMPORTANT|file:line|what|why it matters|required fix"] \
#     [--followup "#N|description"] \
#     [--strength "file:line|what was done well"]
#
# Rules enforced:
#   - CHANGES_REQUESTED requires at least one --finding
#   - APPROVED with any --finding is rejected
#   - Each --finding must have 5 pipe-separated fields
#   - Each --followup must have 2 pipe-separated fields: issue number and description
#
# Posts exactly one pull-request comment (`gh pr comment`). The verdict is
# text in that comment. This script does not approve, request changes, or
# dismiss reviews, and it does not call `gh pr review` or the pull-request
# review API. Prints VERDICT:<result> to stdout. Exits 0 when the comment
# is posted.

set -euo pipefail

# gh is required only when a comment will be posted. --help and validation
# failures do not need it.
resolve_gh() {
  if command -v gh >/dev/null 2>&1; then
    return 0
  fi
  if [[ -x /Users/kunal/.local/bin/gh ]]; then
    export PATH="/Users/kunal/.local/bin:$PATH"
    return 0
  fi
  echo "error: gh CLI not found on PATH" >&2
  exit 1
}

PR=""
VERDICT=""
FINDINGS=()
FOLLOWUPS=()
STRENGTHS=()

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pr)       PR="$2";               shift 2 ;;
    --verdict)  VERDICT="$2";          shift 2 ;;
    --finding)  FINDINGS+=("$2");      shift 2 ;;
    --followup) FOLLOWUPS+=("$2");     shift 2 ;;
    --strength) STRENGTHS+=("$2");     shift 2 ;;
    --help|-h)
      cat <<'EOF'
submit-review.sh — Post a structured PR review as one comment.

This adds a single pull-request comment and exits 0 when that comment is
posted. The verdict word (APPROVED or CHANGES_REQUESTED) is text in the
comment body. It does not approve, request changes, or dismiss reviews.
It does not call the pull-request review API.

USAGE
  bash scripts/submit-review.sh --pr <number> \
    --verdict APPROVED|CHANGES_REQUESTED \
    [--finding "CRITICAL|IMPORTANT|file:line|what|why it matters|required fix"] \
    [--followup "#N|description"] \
    [--strength "file:line|what was done well"]
EOF
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

die() { printf "error: %s\n" "$*" >&2; exit 1; }

[[ -n "$PR" ]]      || die "--pr is required"
[[ -n "$VERDICT" ]] || die "--verdict is required (APPROVED or CHANGES_REQUESTED)"

[[ "$VERDICT" == "APPROVED" || "$VERDICT" == "CHANGES_REQUESTED" ]] \
  || die "--verdict must be APPROVED or CHANGES_REQUESTED"

[[ "$VERDICT" == "CHANGES_REQUESTED" ]] \
  && [[ "${#FINDINGS[@]}" -eq 0 ]] \
  && die "CHANGES_REQUESTED requires at least one --finding"

[[ "$VERDICT" == "APPROVED" ]] \
  && [[ "${#FINDINGS[@]}" -gt 0 ]] \
  && die "APPROVED cannot have blocking findings — use --followup for non-blocking issues"

for finding in "${FINDINGS[@]+"${FINDINGS[@]}"}"; do
  IFS='|' read -r -a parts <<< "$finding"
  [[ ${#parts[@]} -eq 5 ]] \
    || die "--finding requires 5 fields: SEVERITY|file:line|what|why it matters|required fix"$'\n'"  got: $finding"
  severity="${parts[0]}"
  [[ "$severity" == "CRITICAL" || "$severity" == "IMPORTANT" ]] \
    || die "finding severity must be CRITICAL or IMPORTANT, got: $severity"
done

for followup in "${FOLLOWUPS[@]+"${FOLLOWUPS[@]}"}"; do
  IFS='|' read -r -a parts <<< "$followup"
  [[ ${#parts[@]} -eq 2 ]] \
    || die "--followup requires 2 fields: #issue-number|description"$'\n'"  got: $followup"
done

for strength in "${STRENGTHS[@]+"${STRENGTHS[@]}"}"; do
  IFS='|' read -r -a parts <<< "$strength"
  [[ ${#parts[@]} -eq 2 ]] \
    || die "--strength requires 2 fields: file:line|what was done well"$'\n'"  got: $strength"
done

# ---------------------------------------------------------------------------
# Build Markdown body
# ---------------------------------------------------------------------------

if [[ "$VERDICT" == "APPROVED" ]]; then
  VERDICT_BADGE="✅ **VERDICT: APPROVED**"
else
  VERDICT_BADGE="❌ **VERDICT: CHANGES_REQUESTED**"
fi

BODY="# Code Review

${VERDICT_BADGE}

---
"

BODY+="
## Findings
"
if [[ "${#FINDINGS[@]}" -eq 0 ]]; then
  BODY+="
None.
"
else
  for finding in "${FINDINGS[@]}"; do
    IFS='|' read -r severity location what why fix <<< "$finding"
    if [[ "$severity" == "CRITICAL" ]]; then
      icon="🔴"
    else
      icon="🟠"
    fi
    BODY+="
### ${icon} ${severity}
\`${location}\`

**Issue:** ${what}

**Why it matters:** ${why}

**Required fix:** ${fix}
"
  done
fi

BODY+="
---

## Suggested Follow-ups
"
if [[ ${#FOLLOWUPS[@]} -eq 0 ]]; then
  BODY+="
None.
"
else
  for followup in "${FOLLOWUPS[@]}"; do
    IFS='|' read -r issue description <<< "$followup"
    BODY+="- ${issue} ${description}
"
  done
fi

BODY+="
---

## Strengths
"
if [[ ${#STRENGTHS[@]} -eq 0 ]]; then
  BODY+="
_(none noted)_
"
else
  for strength in "${STRENGTHS[@]}"; do
    IFS='|' read -r location what <<< "$strength"
    BODY+="- \`${location}\` — ${what}
"
  done
fi

# ---------------------------------------------------------------------------
# Post the written verdict as one PR comment. Never approve, request
# changes, or dismiss a review.
# ---------------------------------------------------------------------------

resolve_gh
gh pr comment "$PR" --body "$BODY"

echo "VERDICT:${VERDICT}"
