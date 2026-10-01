#!/usr/bin/env bash
# Tests that every app touches the generated Twenty core client in one place.
#
# The bug these tests pin down: `twenty apply` regenerates the app's
# node_modules/twenty-client-sdk from the workspace schema after every
# successful sync, so the next typecheck runs against a client whose
# query/mutation types are exactly the objects that existed at that moment. A
# plain `as` cast from those types stops being valid and the sync dies with
#
#     src/lib/records.ts(79,20): error TS2352: Conversion of type 'Pick<...>'
#     to type 'Record<string, ...>' may be a mistake ... convert the
#     expression to 'unknown' first
#
# which is what stranded the SMS app mid-install (the Document Generator had
# already been fixed the same way, one app at a time). Every app now reads
# records through its own src/lib/core-client.ts, which casts the client once
# to a loose shape, so records built from runtime names and raw values keep
# typechecking whatever the client was generated from.
#
# Nothing here installs packages or runs tsc: the rules are checked against the
# committed sources, which keeps the test fast and offline.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

problems=0

for app in app docgen/app sms/app; do
  src="$ROOT/$app/src"
  helper="$src/lib/core-client.ts"

  if [[ ! -f "$helper" ]]; then
    printf 'missing %s: each app needs the loose client wrapper\n' "${helper#"$ROOT"/}" >&2
    problems=1
  elif ! grep -q 'as unknown as CoreGraphQlClient' "$helper"; then
    printf '%s must cast the generated client through unknown\n' "${helper#"$ROOT"/}" >&2
    problems=1
  fi

  # Test files may mock the module; app code must go through the wrapper.
  while IFS= read -r file; do
    case "$file" in
      *.test.ts | *.test.tsx) continue ;;
    esac
    if [[ "$file" != "$helper" ]]; then
      printf '%s imports twenty-client-sdk/core directly; use src/lib/core-client instead\n' "${file#"$ROOT"/}" >&2
      problems=1
    fi
  done < <(grep -rl "twenty-client-sdk/core" "$src" --include='*.ts' --include='*.tsx' || true)
done

if (( problems )); then
  printf '\nThe generated client is only safe to touch through src/lib/core-client.ts.\n' >&2
  exit 1
fi

printf 'OK: the generated core client is only used through src/lib/core-client.ts\n'
