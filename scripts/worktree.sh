#!/usr/bin/env bash
#
# Manage git worktrees for agent implementation work.
#
# Creates worktrees under .worktrees/ with a symlink to root node_modules
# so agents can run checks without reinstalling (pnpm at repo root).

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
WORKTREE_DIR="${REPO_ROOT}/.worktrees"
NODE_MODULES="${REPO_ROOT}/node_modules"
DEFAULT_BASE="main"

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------

usage() {
  cat <<'EOF'
worktree.sh — Manage git worktrees for agent implementation work.

USAGE
  bash scripts/worktree.sh create <branch> [base]
  bash scripts/worktree.sh cleanup <branch>
  bash scripts/worktree.sh list
  bash scripts/worktree.sh --help

DESCRIPTION
  Creates worktrees under .worktrees/ with a symlinked root node_modules so
  agents can run pnpm checks without reinstalling dependencies.

  create fetches origin/<base> before creating so the worktree always
  starts from the latest remote commit, not a potentially stale local copy.

COMMANDS
  create <branch> [base]   Create a worktree on a new branch from origin/<base>
                           base defaults to "main"
  cleanup <branch>         Remove the worktree and delete the local/remote branch
  list                     Show all worktrees under .worktrees/ with status

EXIT CODES
  0  Success
  1  Error

EXAMPLES
  bash scripts/worktree.sh create cursor/issue-42-short-title
  bash scripts/worktree.sh create cursor/issue-42-short-title main
  bash scripts/worktree.sh cleanup cursor/issue-42-short-title
  bash scripts/worktree.sh list
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

# ---------------------------------------------------------------------------
# create
# ---------------------------------------------------------------------------

create() {
  local branch="$1"
  local base="${2:-$DEFAULT_BASE}"
  local dir_name="${branch//\//-}"
  local worktree_path="${WORKTREE_DIR}/${dir_name}"

  if [ -d "$worktree_path" ]; then
    echo "error: worktree already exists at ${worktree_path}" >&2
    exit 1
  fi

  if git show-ref --verify --quiet "refs/heads/${branch}" 2>/dev/null; then
    local output
    if ! output=$(git worktree add "$worktree_path" "$branch" 2>&1); then
      echo "error: failed to create worktree for existing branch '${branch}'" >&2
      echo "  ${output}" >&2
      exit 1
    fi
  else
    echo "Fetching origin/${base}..."
    local fetch_output
    if ! fetch_output=$(git fetch origin "$base" 2>&1); then
      echo "error: could not fetch origin/${base}" >&2
      echo "  ${fetch_output}" >&2
      echo "  Check your network connection and authentication." >&2
      exit 1
    fi

    if ! git show-ref --verify --quiet "refs/remotes/origin/${base}" 2>/dev/null; then
      echo "error: base branch 'origin/${base}' not found after fetch" >&2
      echo "  Verify the branch name and try again." >&2
      exit 1
    fi

    if git show-ref --verify --quiet "refs/heads/${base}" 2>/dev/null; then
      local local_head remote_head
      local_head=$(git rev-parse "${base}")
      remote_head=$(git rev-parse "origin/${base}")
      if [[ "$local_head" != "$remote_head" ]]; then
        echo "warning: local '${base}' has commits not yet on 'origin/${base}'" >&2
        echo "  The new worktree will start from origin/${base}, not your local copy." >&2
        echo "  Push '${base}' first if you want those commits included." >&2
      fi
    fi

    local output
    if ! output=$(git worktree add -b "$branch" "$worktree_path" "origin/$base" 2>&1); then
      echo "error: failed to create worktree on branch '${branch}' from 'origin/${base}'" >&2
      echo "  ${output}" >&2
      exit 1
    fi
  fi

  if [ -d "$NODE_MODULES" ]; then
    ln -s "$NODE_MODULES" "${worktree_path}/node_modules"
    echo "Linked node_modules from main repo."
  else
    echo "warning: ${NODE_MODULES} not found — run pnpm install in the main repo first." >&2
  fi

  echo ""
  echo "Worktree ready: ${worktree_path}"
  echo "Branch: ${branch} (based on ${base})"
}

# ---------------------------------------------------------------------------
# cleanup
# ---------------------------------------------------------------------------

cleanup() {
  local branch="$1"
  local dir_name="${branch//\//-}"
  local worktree_path="${WORKTREE_DIR}/${dir_name}"

  if [ -d "$worktree_path" ]; then
    local output
    if ! output=$(git worktree remove --force "$worktree_path" 2>&1); then
      echo "error: git worktree remove failed for ${worktree_path}" >&2
      echo "  ${output}" >&2
      exit 1
    fi
    echo "Removed worktree: ${worktree_path}"

    if [ -d "$worktree_path" ]; then
      case "$worktree_path" in
        "${WORKTREE_DIR}"/*)
          rm -rf -- "$worktree_path"
          echo "Removed leftover directory: ${worktree_path}"
          ;;
        *)
          echo "error: refusing to remove path outside .worktrees/: ${worktree_path}" >&2
          exit 1
          ;;
      esac
    fi
  else
    echo "No worktree directory found at ${worktree_path}"
  fi

  git worktree prune 2>/dev/null || true

  if git show-ref --verify --quiet "refs/heads/${branch}" 2>/dev/null; then
    local output
    if ! output=$(git branch -D "$branch" 2>&1); then
      echo "error: failed to delete local branch '${branch}'" >&2
      echo "  ${output}" >&2
      exit 1
    fi
    echo "Deleted local branch: ${branch}"
  fi

  if git show-ref --verify --quiet "refs/remotes/origin/${branch}" 2>/dev/null; then
    local api_output api_exit
    api_exit=0
    # Prefer PATH gh; fall back to known local install on this Mac.
    local gh_bin
    gh_bin="$(command -v gh || true)"
    if [[ -z "$gh_bin" && -x /Users/kunal/.local/bin/gh ]]; then
      gh_bin=/Users/kunal/.local/bin/gh
    fi
    REPO_NWO="$("$gh_bin" repo view --json nameWithOwner --jq '.nameWithOwner' 2>/dev/null || true)"
    api_output=$("$gh_bin" api "repos/${REPO_NWO}/git/refs/heads/${branch}" -X DELETE 2>&1) || api_exit=$?
    if [[ $api_exit -eq 0 ]]; then
      echo "Deleted remote branch: ${branch}"
    elif echo "$api_output" | grep -qi "404\|not found\|Reference does not exist"; then
      :
    else
      echo "warning: could not delete remote branch '${branch}'" >&2
      echo "  ${api_output}" >&2
    fi
  fi
}

# ---------------------------------------------------------------------------
# list
# ---------------------------------------------------------------------------

list() {
  echo "Worktrees in ${WORKTREE_DIR}:"
  echo ""

  if [ ! -d "$WORKTREE_DIR" ] || [ -z "$(ls -A "$WORKTREE_DIR" 2>/dev/null)" ]; then
    echo "  (none)"
    return
  fi

  for dir in "${WORKTREE_DIR}"/*/; do
    [ -d "$dir" ] || continue
    local name branch node_mod remote_status changes

    name="$(basename "$dir")"
    branch="$(git -C "$dir" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "detached")"

    if [ -L "${dir}node_modules" ]; then
      node_mod="node_modules: linked"
    elif [ -d "${dir}node_modules" ]; then
      node_mod="node_modules: local copy"
    else
      node_mod="node_modules: missing"
    fi

    if [ "$branch" = "detached" ]; then
      remote_status="remote: n/a (detached HEAD)"
    elif git show-ref --verify --quiet "refs/remotes/origin/${branch}" 2>/dev/null; then
      remote_status="remote: yes"
    else
      remote_status="remote: no"
    fi

    changes="$(git -C "$dir" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"

    echo "  ${name}"
    echo "    branch: ${branch}"
    echo "    ${node_mod}"
    echo "    ${remote_status}"
    echo "    changes: ${changes}"
    echo ""
  done

  local orphans
  orphans="$(git worktree list --porcelain \
    | grep "^worktree " \
    | grep -v "^worktree ${REPO_ROOT}$" \
    | grep -v "^worktree ${WORKTREE_DIR}" \
    || true)"
  if [ -n "$orphans" ]; then
    echo "Orphaned worktrees (outside .worktrees/):"
    echo "$orphans" | while IFS= read -r line; do
      echo "  ${line#worktree }"
    done
    echo ""
    echo "Clean up with: git worktree remove <path>"
  fi
}

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

cmd="${1:?$(echo "error: command required"; echo "Run 'bash scripts/worktree.sh --help' for usage.")}"
shift

case "$cmd" in
  create)
    branch="${1:?$(echo "error: branch name required"; echo "Usage: worktree.sh create <branch> [base]")}"
    base="${2:-$DEFAULT_BASE}"
    create "$branch" "$base"
    ;;
  cleanup)
    branch="${1:?$(echo "error: branch name required"; echo "Usage: worktree.sh cleanup <branch>")}"
    cleanup "$branch"
    ;;
  list)
    list
    ;;
  *)
    echo "error: unknown command: ${cmd}" >&2
    echo "Run 'bash scripts/worktree.sh --help' for usage." >&2
    exit 1
    ;;
esac
