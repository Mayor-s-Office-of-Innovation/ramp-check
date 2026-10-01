#!/usr/bin/env bash
# Consumer smoke test: pack the tarball, install it into a copy of the example
# site as a real dependency, run the bin, and check the documented findings
# appear. Run before tagging a release.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"; [ -n "${server_pid:-}" ] && kill "$server_pid" 2>/dev/null || true' EXIT

echo "packing..."
tarball="$(cd "$root" && npm pack --silent --pack-destination "$work")"
cp -R "$root/examples/minimal-static-site/." "$work/site"
cd "$work/site"
echo "installing $tarball into a copy of examples/minimal-static-site..."
npm install --silent --no-audit --no-fund "$work/$tarball" @playwright/test@1.63.0 >/dev/null

node serve.js & server_pid=$!
sleep 1
set +e
npx ramp-check --quiet --out "$work/report" > "$work/out.txt" 2>&1
code=$?
set -e
cat "$work/out.txt"
echo "exit code: $code"
[ "$code" -eq 1 ] || { echo "expected exit 1 (seeded findings)"; exit 1; }
grep -q "color-contrast-enhanced" "$work/out.txt" || { echo "expected the enhanced-contrast finding"; exit 1; }
grep -q "skip-link-missing" "$work/out.txt" || { echo "expected the skip-link finding"; exit 1; }
[ -f "$work/report/ramp-check.md" ] || { echo "expected the Markdown report"; exit 1; }
echo "smoke test passed: the packed tarball works as a dependency."
