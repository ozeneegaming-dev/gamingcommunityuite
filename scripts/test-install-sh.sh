#!/usr/bin/env bash
# Testează install.sh și wrapper-ul gcs: shellcheck (dacă e instalat) și rulări --dry-run, care trebuie să afișeze
# pașii fără să execute nimic. Acoperă instalarea din git, din pachet (sumele de control), actualizarea și brandingul.
# Rulat în CI (Ubuntu) și local (Git Bash pe Windows).
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "FAIL: $*" >&2; exit 1; }
has() { grep -qF "$1" <<< "$2" || fail "lipsește din rezultat: $1"; }
dry() { GCS_DRY_RUN_UNAME_S=Linux GCS_DRY_RUN_UNAME_M=x86_64 bash install.sh --dry-run "$@"; }
sha() { if command -v sha256sum > /dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

if command -v shellcheck > /dev/null 2>&1; then
  shellcheck install.sh gcs scripts/test-install-sh.sh
  echo "ok: shellcheck"
else
  echo "atenție: shellcheck nu e instalat; sar peste analiza statică"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# 1. Din git, într-un folder ales.
target="$tmp/site"
output="$(dry --domain forum.exemplu.ro --dir "$target" --repo https://example.invalid/gcs.git)"
echo "$output"
for expected in "Verific sistemul (Linux x86_64)" "Clonez proiectul în $target" "[dry-run]" "Domeniu: forum.exemplu.ro" "Generez $target/.env" "docker compose up -d --build" "https://forum.exemplu.ro/install"; do
  has "$expected" "$output"
done
[ ! -e "$target" ] || fail "--dry-run a creat $target"

# 2. Folderul implicit e /opt/gcs; scriptul și consola nu mai poartă alt nume de produs.
has "/opt/gcs" "$(dry --domain forum.exemplu.ro --repo https://example.invalid/gcs.git)"
if grep -qi "red-line\|/opt/redline\|=redline" install.sh gcs; then fail "install.sh / gcs conțin încă vechiul nume"; fi

# 3. Din pachet: suma arhivei (<pachet>.sha256) și CHECKSUMS.sha256 din pachet; un pachet modificat e refuzat.
pkg="$tmp/pkg/gcs-1.2.3"
mkdir -p "$pkg/docs"
echo "1.2.3" > "$pkg/VERSION"
echo "# Instalare" > "$pkg/docs/INSTALL.md"
(cd "$pkg" && find . -type f ! -name CHECKSUMS.sha256 | sed 's|^\./||' | sort | while read -r f; do echo "$(sha "$f")  $f"; done > CHECKSUMS.sha256)
tar -C "$tmp/pkg" -czf "$tmp/gcs-1.2.3.tar.gz" gcs-1.2.3
echo "$(sha "$tmp/gcs-1.2.3.tar.gz")  gcs-1.2.3.tar.gz" > "$tmp/gcs-1.2.3.tar.gz.sha256"
output="$(dry --from "$tmp/gcs-1.2.3.tar.gz" --domain forum.exemplu.ro --dir "$tmp/client")"
echo "$output"
has "Suma de control a pachetului: ok" "$output"
has "Fișierele pachetului: ok (versiunea 1.2.3)" "$output"
has "păstrez .env, config/, backups/ și docker-compose.override.yml" "$output"
[ ! -e "$tmp/client" ] || fail "--dry-run a creat folderul clientului"

if dry --from "$tmp/gcs-1.2.3.tar.gz" --sha256 0000 --domain x.ro --dir "$tmp/c2" > /dev/null 2>&1; then fail "o sumă greșită a arhivei ar trebui refuzată"; fi
echo "modificat" >> "$pkg/docs/INSTALL.md"
tar -C "$tmp/pkg" -czf "$tmp/gcs-bad.tar.gz" gcs-1.2.3
if dry --from "$tmp/gcs-bad.tar.gz" --domain x.ro --dir "$tmp/c3" > /dev/null 2>&1; then fail "un fișier modificat din pachet ar trebui refuzat"; fi

# 4. Actualizarea: backup, codul nou, repornirea; fără un .env nou și fără codul de instalare.
output="$(dry --upgrade --dir "$tmp/existing" --repo https://example.invalid/gcs.git)"
echo "$output"
has "Actualizez instalarea din $tmp/existing" "$output"
has "Fac un backup înainte de actualizare" "$output"
has "docker compose up -d --build" "$output"
if grep -qF "Generez" <<< "$output"; then fail "actualizarea nu generează un .env nou"; fi

# 5. Un sistem nesuportat e refuzat (exit 1); un argument greșit → exit 2.
if GCS_DRY_RUN_UNAME_S=Darwin bash install.sh --dry-run --domain x.ro > /dev/null 2>&1; then fail "macOS ar trebui refuzat"; fi
set +e
bash install.sh --necunoscut > /dev/null 2>&1
code=$?
set -e
[ "$code" -eq 2 ] || fail "un argument greșit ar trebui să dea exit 2 (a dat $code)"

echo "ok: install.sh --dry-run"
