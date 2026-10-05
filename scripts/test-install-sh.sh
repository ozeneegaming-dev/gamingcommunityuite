#!/usr/bin/env bash
# Testează install.sh și wrapper-ul gcs: shellcheck (dacă e instalat) și o rulare --dry-run, care trebuie
# să afișeze toți pașii fără să execute nimic. Rulat în CI (Ubuntu) și local (Git Bash pe Windows).
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "FAIL: $*" >&2; exit 1; }

if command -v shellcheck > /dev/null 2>&1; then
  shellcheck install.sh gcs scripts/test-install-sh.sh
  echo "ok: shellcheck"
else
  echo "atenție: shellcheck nu e instalat; sar peste analiza statică"
fi

target="$(mktemp -d)/redline"
output="$(
  GCS_DRY_RUN_UNAME_S=Linux GCS_DRY_RUN_UNAME_M=x86_64 \
    bash install.sh --dry-run --domain forum.exemplu.ro --dir "$target" --repo https://example.invalid/redline.git
)"
echo "$output"

for expected in \
  "Verific sistemul (Linux x86_64)" \
  "Clonez proiectul în $target" \
  "[dry-run]" \
  "Domeniu: forum.exemplu.ro" \
  "Generez $target/.env" \
  "docker compose up -d --build" \
  "https://forum.exemplu.ro/install"; do
  grep -qF "$expected" <<< "$output" || fail "lipsește din rezultat: $expected"
done
[ ! -e "$target" ] || fail "--dry-run a creat $target"

# Un sistem nesuportat e refuzat (exit 1); un argument greșit → exit 2.
if GCS_DRY_RUN_UNAME_S=Darwin bash install.sh --dry-run --domain x.ro > /dev/null 2>&1; then fail "macOS ar trebui refuzat"; fi
set +e
bash install.sh --necunoscut > /dev/null 2>&1
code=$?
set -e
[ "$code" -eq 2 ] || fail "un argument greșit ar trebui să dea exit 2 (a dat $code)"

echo "ok: install.sh --dry-run"
