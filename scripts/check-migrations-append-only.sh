#!/usr/bin/env bash
# Migration guard: applied migrations are history. Within a change only NEW files may appear in
# supabase/migrations, named YYYYMMDDnnnn_description.sql and sorted after everything that exists.
#
#   scripts/check-migrations-append-only.sh <base-ref>
set -euo pipefail

base="${1:-}"
dir="supabase/migrations"
if [ -z "$base" ] || [[ "$base" =~ ^0+$ ]] || ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  echo "migration guard: no usable base ref, skipping"
  exit 0
fi

fail=0
# Existing files must not be modified, deleted, renamed or copied over.
bad="$(git diff --name-status "$base"...HEAD -- "$dir" | grep -v '^A' || true)"
if [ -n "$bad" ]; then
  echo "ERROR: existing migrations must not be changed (add a new migration instead):"
  echo "$bad"
  fail=1
fi

latest="$(git ls-tree -r --name-only "$base" -- "$dir" | sed 's#.*/##' | sort | tail -1)"
for f in $(git diff --name-only --diff-filter=A "$base"...HEAD -- "$dir"); do
  name="$(basename "$f")"
  if ! [[ "$name" =~ ^[0-9]{12}_[a-z0-9_]+\.sql$ ]]; then
    echo "ERROR: $name does not match YYYYMMDDnnnn_description.sql"
    fail=1
  elif [ -n "$latest" ] && ! [[ "$name" > "$latest" ]]; then
    echo "ERROR: $name must sort after the latest existing migration ($latest)"
    fail=1
  fi
done

[ "$fail" -eq 0 ] && echo "migration guard: ok"
exit "$fail"
