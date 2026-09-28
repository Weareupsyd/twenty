#!/usr/bin/env bash
# Tests that every app's package-lock.json matches its package.json.
#
# The bug these tests pin down: @hugeicons/react and @hugeicons/core-free-icons
# were added to app/package.json without regenerating app/package-lock.json, so
# the documented install (npm ci, in start.sh and twenty.sh) aborted on a fresh
# VPS with
#
#     `npm ci` can only install packages when your package.json and
#     package-lock.json or npm-shrinkwrap.json are in sync.
#     Missing: @hugeicons/core-free-icons@3.3.0 from lock file
#
# and install.sh stopped there, before the server was ever started. Nothing here
# installs anything or talks to a registry: the rules npm ci applies are checked
# against the committed JSON itself, which also keeps this test fast.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

check_app() {
  local dir="$1"
  APP_DIR="$dir" node - <<'NODE'
const fs = require('fs');
const path = require('path');

const dir = process.env.APP_DIR;
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8'));
const packages = lock.packages || {};
const root = packages[''] || {};
const problems = [];

if (!root.name) {
  problems.push('package-lock.json has no root "" entry: it is not an npm lockfile');
} else {
  // lockfileVersion 3 is what npm 9+ writes and what `npm ci` consumes here.
  if (!(lock.lockfileVersion >= 2)) {
    problems.push(`lockfileVersion is ${lock.lockfileVersion}, expected 2 or 3`);
  }
  if (root.name !== pkg.name) {
    problems.push(`lockfile name is ${root.name}, package.json says ${pkg.name}`);
  }
  if (root.version !== pkg.version) {
    problems.push(`lockfile version is ${root.version}, package.json says ${pkg.version}`);
  }

  for (const field of ['dependencies', 'devDependencies']) {
    const wanted = pkg[field] || {};
    const locked = root[field] || {};

    for (const [name, spec] of Object.entries(wanted)) {
      const entry = packages[`node_modules/${name}`];

      if (!(name in locked)) {
        problems.push(`${field}: ${name}@${spec} is in package.json but not in the lockfile`
          + ` (npm ci: "Missing: ${name}@${spec} from lock file")`);
      } else if (locked[name] !== spec) {
        // npm install writes the range from package.json into the lockfile
        // verbatim, so a difference means the lockfile predates that edit.
        problems.push(`${field}: ${name} is "${spec}" in package.json, "${locked[name]}" in the lockfile:`
          + ' run "npm install" in ' + dir + ' and commit the result');
      }

      // A dependency in the lockfile's root block without its own entry, or an
      // entry npm ci cannot verify, installs nothing.
      if (!entry) {
        problems.push(`${field}: the lockfile has no node_modules/${name} entry`);
      } else if (entry.link !== true) {
        for (const key of ['version', 'resolved', 'integrity']) {
          if (!entry[key]) problems.push(`${field}: node_modules/${name} has no ${key}`);
        }
      }
    }

    for (const name of Object.keys(locked)) {
      if (!(name in wanted)) {
        problems.push(`${field}: ${name} is in the lockfile but no longer in package.json`
          + ' (run "npm install" in ' + dir + ' and commit the result)');
      }
    }
  }
}

if (problems.length) {
  console.error(`FAIL ${dir}/package-lock.json is out of sync with package.json:`);
  for (const problem of problems) console.error(`     - ${problem}`);
  process.exit(1);
}
NODE
}

for app in app docgen/app sms/app; do
  [[ -f "$ROOT/$app/package.json" ]] || { echo "FAIL $app/package.json is missing"; exit 1; }
  [[ -f "$ROOT/$app/package-lock.json" ]] || { echo "FAIL $app/package-lock.json is missing (npm ci installs it)"; exit 1; }
  if ! check_app "$ROOT/$app"; then
    echo "FAIL $app: npm ci would refuse to install this app (details above)" >&2
    exit 1
  fi
  echo "PASS $app: package-lock.json matches package.json"
done

echo 'PASS lockfiles: every app can be installed with npm ci on a clean checkout'
