#!/usr/bin/env bash
# Decide which parts of the monorepo a change touches, so CI and reviewers know what must be
# rebuilt and which deployment(s) a merge will affect.
#
#   scripts/ci-changes.sh <base-ref>     compare <base-ref>...HEAD (needs full git history)
#   scripts/ci-changes.sh --stdin        read changed file paths (one per line) from stdin
#
# Prints key=value lines (website, portal, shared, db, tests); append to $GITHUB_OUTPUT in CI.
# An unknown or all-zero base means "cannot tell": everything is reported as changed (fail safe).
set -euo pipefail

if [ "${1:-}" = "--stdin" ]; then
  files="$(cat)"
else
  base="${1:-}"
  if [ -z "$base" ] || [[ "$base" =~ ^0+$ ]] || ! git cat-file -e "$base^{commit}" 2>/dev/null; then
    printf 'website=true\nportal=true\nshared=true\ndb=true\ntests=true\n'
    exit 0
  fi
  files="$(git diff --name-only "$base"...HEAD)"
fi

has() { printf '%s\n' "$files" | grep -Eq "$1" && echo true || echo false; }

# Anything that both apps consume or that changes how they are built/checked.
shared='^(packages/|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|package\.json$|turbo\.json$|tsconfig\.base\.json$|eslint\.config\.|\.prettier|playwright\.config\.|\.github/|scripts/)'

echo "website=$(has '^apps/website/')"
echo "portal=$(has '^apps/portal/')"
echo "shared=$(has "$shared")"
echo "db=$(has '^supabase/')"
echo "tests=$(has '^tests/')"
