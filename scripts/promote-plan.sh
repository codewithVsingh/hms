#!/usr/bin/env bash
# Promotion gate: decides whether the commit tested on staging may be fast-forwarded onto main
# (= deployed to production) and prints which services that will redeploy.
#
#   scripts/promote-plan.sh <sha> <migrations_applied: true|false>
#
# Environment (defaults suit CI after `git fetch origin`):
#   STAGING_REF  ref of the staging branch   (default origin/staging)
#   MAIN_REF     ref of the production branch (default origin/main)
#
# Exit 0 = safe to push <sha> to main (or nothing to do); non-zero = refuse.
# Writes `promote=true|false` to $GITHUB_OUTPUT when set. Never pushes anything itself.
set -euo pipefail

sha="${1:-}"
migrations_applied="${2:-false}"
staging_ref="${STAGING_REF:-origin/staging}"
main_ref="${MAIN_REF:-origin/main}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

out() { [ -n "${GITHUB_OUTPUT:-}" ] && echo "$1" >> "$GITHUB_OUTPUT" || true; }
summary() { echo "$1"; [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$1" >> "$GITHUB_STEP_SUMMARY" || true; }
fail() { echo "REFUSED: $1" >&2; summary "**Refused:** $1"; out "promote=false"; exit 1; }

[ -n "$sha" ] || fail "usage: promote-plan.sh <sha> <migrations_applied>"
sha="$(git rev-parse --verify "$sha^{commit}" 2>/dev/null)" || fail "unknown commit"
staging_sha="$(git rev-parse --verify "$staging_ref^{commit}" 2>/dev/null)" || fail "cannot resolve $staging_ref"
main_sha="$(git rev-parse --verify "$main_ref^{commit}" 2>/dev/null)" || fail "cannot resolve $main_ref"

[ "$sha" = "$staging_sha" ] ||
  fail "only the current head of staging can be promoted (staging is ${staging_sha:0:9}, requested ${sha:0:9}). Staging moved since you tested; re-test and promote the new head."

if [ "$sha" = "$main_sha" ]; then
  summary "Production already runs ${sha:0:9}. Nothing to promote."
  out "promote=false"
  exit 0
fi

git merge-base --is-ancestor "$main_sha" "$sha" ||
  fail "main has commits that staging does not (main ${main_sha:0:9}). Merge main back into staging through a PR (hotfix back-merge), let CI and staging testing pass, then promote again."

plan="$(bash "$here/ci-changes.sh" "$main_sha")"
get() { echo "$plan" | sed -n "s/^$1=//p"; }
website="$(get website)"; portal="$(get portal)"; shared="$(get shared)"; db="$(get db)"

summary "### Promotion plan: ${main_sha:0:9} -> ${sha:0:9}"
summary "| Service | Will redeploy in production |"
summary "|---|---|"
if [ "$website" = true ] || [ "$shared" = true ]; then w=yes; else w="no (unchanged)"; fi
if [ "$portal" = true ] || [ "$shared" = true ]; then p=yes; else p="no (unchanged)"; fi
summary "| website | $w |"
summary "| portal | $p |"
summary "| database migrations in range | $db |"
summary ""
summary "Commits: $(git rev-list --count "$main_sha..$sha")"

if [ "$db" = true ] && [ "$migrations_applied" != true ]; then
  fail "this range contains database changes. Apply them to the PRODUCTION Supabase project first (backup, then migrations in order, then supabase/tests/verify_*.sql), then run the promotion again with migrations_applied=true."
fi

out "promote=true"
out "sha=$sha"
exit 0
