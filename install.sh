#!/usr/bin/env bash
# RED-LINE — instalare pe un VPS Linux, dintr-o singură comandă (spec §17.1):
#
#   curl -fsSL <adresa>/install.sh | sudo GCS_REPO=<repo git> bash
#   sudo ./install.sh --domain forum.exemplu.ro [--dir /opt/redline] [--repo <url git>] [--dry-run]
#
# Pași: verifică sistemul → instalează Docker (dacă lipsește) → clonează proiectul → cere domeniul →
# generează .env cu secrete noi → docker compose up → așteaptă aplicația → afișează adresa și codul de instalare.
# Cu --dry-run doar afișează pașii, fără să schimbe nimic.
set -euo pipefail

DIR="/opt/redline"
DOMAIN=""
REPO="${GCS_REPO:-}"
DRY_RUN=0

usage() {
  echo "Folosire: install.sh [--domain <domeniu>] [--dir <folder>] [--repo <url git>] [--dry-run]" >&2
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; [ -n "$DOMAIN" ] || usage; shift 2 ;;
    --dir) DIR="${2:-}"; [ -n "$DIR" ] || usage; shift 2 ;;
    --repo) REPO="${2:-}"; [ -n "$REPO" ] || usage; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h | --help) usage ;;
    *) usage ;;
  esac
done

step() { echo "==> $*"; }
die() { echo "Eroare: $*" >&2; exit 1; }

# Execută o comandă (sau doar o afișează, cu --dry-run).
run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "    [dry-run] $*"
  else
    "$@"
  fi
}

# 1. Sistemul: Linux pe x86_64 sau arm64, rulat ca root (sau cu sudo).
# În --dry-run, sistemul se poate simula (GCS_DRY_RUN_UNAME_S / _M), ca scriptul să poată fi testat oriunde.
OS="$(uname -s)"
ARCH="$(uname -m)"
if [ "$DRY_RUN" -eq 1 ]; then
  OS="${GCS_DRY_RUN_UNAME_S:-$OS}"
  ARCH="${GCS_DRY_RUN_UNAME_M:-$ARCH}"
fi
step "Verific sistemul ($OS $ARCH)"
[ "$OS" = "Linux" ] || die "RED-LINE se instalează pe Linux (sistem detectat: $OS)"
case "$ARCH" in
  x86_64 | amd64 | aarch64 | arm64) ;;
  *) die "arhitectură nesuportată: $ARCH (sunt suportate x86_64 și arm64)" ;;
esac
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo > /dev/null 2>&1; then SUDO="sudo"; elif [ "$DRY_RUN" -eq 0 ]; then die "rulează ca root sau cu sudo"; fi
fi

# 2. Docker, din repo-ul oficial (scriptul get.docker.com), doar dacă lipsește.
if command -v docker > /dev/null 2>&1 && docker compose version > /dev/null 2>&1; then
  step "Docker e deja instalat"
else
  step "Instalez Docker (repo-ul oficial)"
  run sh -c "curl -fsSL https://get.docker.com | $SUDO sh"
fi

# 3. Proiectul, în $DIR.
if [ -d "$DIR/.git" ]; then
  step "Proiectul există deja în $DIR"
else
  [ -n "$REPO" ] || die "setează adresa repo-ului git: --repo <url> sau GCS_REPO=<url>"
  step "Clonez proiectul în $DIR"
  run $SUDO git clone "$REPO" "$DIR"
fi

# 4. Domeniul.
if [ -z "$DOMAIN" ]; then
  if [ "$DRY_RUN" -eq 1 ]; then
    DOMAIN="forum.exemplu.ro"
  else
    read -r -p "Domeniul site-ului (ex. forum.exemplu.ro): " DOMAIN < /dev/tty
  fi
fi
echo "$DOMAIN" | grep -Eq '^[A-Za-z0-9.-]+$' || die "domeniu invalid: $DOMAIN"
step "Domeniu: $DOMAIN"

# 5. .env cu secrete noi (openssl rand -hex 32). Un .env existent nu se suprascrie.
secret() { openssl rand -hex 32; }
if [ -f "$DIR/.env" ]; then
  step ".env există deja; îl păstrez"
else
  step "Generez $DIR/.env cu secrete noi"
  if [ "$DRY_RUN" -eq 0 ]; then
    PG_PASSWORD="$(secret)"
    umask 077
    $SUDO tee "$DIR/.env" > /dev/null << EOF
GCS_DOMAIN=$DOMAIN
GCS_BASE_URL=https://$DOMAIN
POSTGRES_USER=redline
POSTGRES_PASSWORD=$PG_PASSWORD
POSTGRES_DB=redline
DATABASE_URL=postgresql://redline:$PG_PASSWORD@postgres:5432/redline
REDIS_URL=redis://redis:6379
S3_ENDPOINT=http://minio:9000
S3_ACCESS_KEY=redline
S3_SECRET_KEY=$(secret)
S3_BUCKET=redline
GCS_SECRET=$(secret)
GCS_CONFIG_DIR=/app/config
EOF
  else
    echo "    [dry-run] scrie .env (GCS_DOMAIN=$DOMAIN, secrete: openssl rand -hex 32)"
  fi
fi

# 6. Pornirea serviciilor.
step "Pornesc serviciile (docker compose up -d --build)"
run sh -c "cd '$DIR' && $SUDO docker compose up -d --build"

# 7. Aplicația răspunde?
step "Aștept aplicația (/api/health)"
if [ "$DRY_RUN" -eq 0 ]; then
  for _ in $(seq 1 90); do
    if (cd "$DIR" && $SUDO docker compose exec -T web wget -qO- http://127.0.0.1:3000/api/health > /dev/null 2>&1); then break; fi
    sleep 2
  done
fi

# 8. Comanda `gcs` și codul de instalare.
step "Instalez comanda gcs în /usr/local/bin"
run chmod +x "$DIR/gcs"
run $SUDO ln -sf "$DIR/gcs" /usr/local/bin/gcs
CODE="(vezi: cd $DIR && docker compose logs web | grep 'Cod de instalare')"
if [ "$DRY_RUN" -eq 0 ]; then
  FOUND="$(cd "$DIR" && $SUDO docker compose logs web 2> /dev/null | grep -o 'Cod de instalare: [A-Z0-9-]*' | tail -1 | sed 's/Cod de instalare: //')"
  [ -n "$FOUND" ] && CODE="$FOUND"
fi

echo
echo "RED-LINE rulează. Continuă instalarea în browser:"
echo "  Adresa:            https://$DOMAIN/install"
echo "  Cod de instalare:  $CODE"
echo "Comenzi utile: gcs status · gcs backup · gcs reset-admin-password <nume>"
