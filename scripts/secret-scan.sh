#!/usr/bin/env bash
# secret-scan.sh: look for committed secrets before a push (master plan rule 0.3.5).
# It prints FILE:LINE and the rule name only. It never prints the matching text.
#
# Usage (from anywhere inside the repository):
#   bash scripts/secret-scan.sh            # strict patterns: assigned literal values and key-shaped strings
#   bash scripts/secret-scan.sh --all      # the plan's raw pattern (PRIVATE_KEY|SECRET|ed25519:); lists every
#                                          #   mention, including harmless variable NAMES, so it is long
#   bash scripts/secret-scan.sh --history  # also search every commit on all branches for the strict patterns
#
# Exit code: 0 nothing suspicious, 1 findings (review each FILE:LINE by hand), 2 not a git repository.
# Scans tracked files plus untracked files that are not ignored (so a new file is checked before `git add`).
# Files ignored by .gitignore (for example .env.local) are NOT scanned: they are supposed to hold secrets.
# Lines containing words such as "not-real", "fake", "dummy", "placeholder" or "example" are skipped (test fixtures).
# This is a heuristic, not a guarantee. A secret in a format not listed here is not found.

set -u
mode="strict"
case "${1:-}" in
  "") ;;
  --all) mode="all" ;;
  --history) mode="history" ;;
  -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
  *) echo "unknown argument: $1" >&2; exit 2 ;;
esac

root="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "not a git repository" >&2; exit 2; }
cd "$root" || exit 2

found=0

# Excluded from content scans: lockfiles (hashes), the lists of names in this script and the env checker.
excludes=(':!pnpm-lock.yaml' ':!contracts/caravan/Cargo.lock' ':!scripts/secret-scan.sh')

# Lines that say they are fake (test fixtures) are skipped. A real secret never contains these words.
allow='(not[- _]?a?[- _]?real|should-not-leak|fake|dummy|placeholder|example)'

scan() { # $1 = rule name, $2 = ERE pattern; prints "file:line" only, never the matching text
  local out
  out="$(git grep -nIE --untracked -e "$2" -- . "${excludes[@]}" 2>/dev/null | grep -viE "$allow" | cut -d: -f1,2)"
  if [ -n "$out" ]; then
    found=1
    echo "[$1]"
    echo "$out" | sed 's/^/  /'
  fi
}

# 1. Tracked env files other than the example (names only is fine in .env.example).
tracked_env="$(git ls-files | grep -E '(^|/)\.env($|\.)' | grep -vE '(^|/)\.env\.example$' || true)"
if [ -n "$tracked_env" ]; then
  found=1
  echo "[tracked env file]"
  echo "$tracked_env" | sed 's/^/  /'
fi

if [ "$mode" = "all" ]; then
  scan "plan 0.3.5 raw pattern" '(PRIVATE_KEY|SECRET|ed25519:)'
else
  # 2. NEAR key strings: ed25519: or secp256k1: followed by a long base58 body (real keys are 44+ chars).
  scan "NEAR key string" '(ed25519|secp256k1):[1-9A-HJ-NP-Za-km-z]{40,}'
  # 3. A *_PRIVATE_KEY / *_SECRET / *_TOKEN / *_JWT / *_API_KEY name assigned a long literal value.
  scan "assigned secret literal" '[A-Z0-9_]*(PRIVATE_KEY|SECRET|TOKEN|JWT|API_KEY|PASSWORD)[A-Z0-9_]*[[:space:]]*[=:][[:space:]]*["'"'"']?[A-Za-z0-9+/_.=-]{24,}'
  # 4. Well-known token shapes.
  scan "GitHub token" '(ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{30,}'
  scan "private key block" '-----BEGIN [A-Z ]*PRIVATE KEY-----'
  scan "Google API key" 'AIza[0-9A-Za-z_-]{35}'
  scan "Slack token" 'xox[abprs]-[0-9A-Za-z-]{10,}'
  scan "connection string with password" '(postgres(ql)?|mysql|mongodb(\+srv)?)://[^:/[:space:]@]+:[^@[:space:]]{4,}@'
  # 5. 64 hex characters: the shape of KEY_ENC_SECRET and many other secrets (also matches hashes: check by hand).
  scan "64 hex characters" '(^|[^0-9A-Za-z])[0-9a-fA-F]{64}($|[^0-9A-Za-z])'
fi

if [ "$mode" = "history" ]; then
  echo "[history] searching all commits (this can take a while)"
  revs="$(git rev-list --all 2>/dev/null)"
  for pat in '(ed25519|secp256k1):[1-9A-HJ-NP-Za-km-z]{40,}' '-----BEGIN [A-Z ]*PRIVATE KEY-----' '(ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{30,}'; do
    # list commit:file only, never the matching text
    # shellcheck disable=SC2086
    hits="$(git grep -lIE -e "$pat" $revs 2>/dev/null | head -20)"
    if [ -n "$hits" ]; then
      found=1
      echo "[history match for a key pattern]"
      echo "$hits" | sed 's/^/  /'
    fi
  done
fi

if [ "$found" -eq 0 ]; then
  echo "secret-scan ($mode): nothing suspicious found"
  exit 0
fi
echo "secret-scan ($mode): findings above (file:line only). Open each one and decide; rotate any real secret."
exit 1
