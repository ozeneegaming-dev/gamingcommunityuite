#!/usr/bin/env bash
# GamingCommunitySuite — instalare și actualizare pe un VPS Linux, dintr-o singură comandă.
#
#   Din pachetul descărcat (clienți):
#     sudo ./install.sh --from gcs-<versiune>.tar.gz --domain forum.exemplu.ro
#     sudo ./install.sh --from https://<adresa>/gcs-<versiune>.tar.gz --domain forum.exemplu.ro
#   Din git (dezvoltare / serverele noastre):
#     sudo ./install.sh --repo <url git> --domain forum.exemplu.ro [--dir /opt/gcs]
#   Actualizare (backup → cod nou → repornire; migrațiile rulează la pornire, datele rămân):
#     sudo ./install.sh --upgrade [--from <pachet>] [--dir /opt/gcs]
#
# Folderul implicit e /opt/gcs; o instalare existentă în alt loc se folosește cu --dir (ex. --dir /srv/forum).
# Un .env existent nu se suprascrie niciodată. Secretele se generează aici și nu se afișează.
# Cu --dry-run doar afișează pașii, fără să schimbe nimic (suma de control a unui pachet local se verifică oricum).
set -euo pipefail

DIR="/opt/gcs"
DOMAIN=""
REPO="${GCS_REPO:-}"
FROM=""
SHA256=""
UPGRADE=0
DRY_RUN=0

usage() {
  echo "Folosire: install.sh [--from <fișier|url>] [--sha256 <sumă>] [--repo <url git>] [--domain <domeniu>] [--dir <folder>] [--upgrade] [--dry-run]" >&2
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; [ -n "$DOMAIN" ] || usage; shift 2 ;;
    --dir) DIR="${2:-}"; [ -n "$DIR" ] || usage; shift 2 ;;
    --repo) REPO="${2:-}"; [ -n "$REPO" ] || usage; shift 2 ;;
    --from) FROM="${2:-}"; [ -n "$FROM" ] || usage; shift 2 ;;
    --sha256) SHA256="${2:-}"; [ -n "$SHA256" ] || usage; shift 2 ;;
    --upgrade) UPGRADE=1; shift ;;
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

sha256_of() {
  if command -v sha256sum > /dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
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
[ "$OS" = "Linux" ] || die "GamingCommunitySuite se instalează pe Linux (sistem detectat: $OS)"
case "$ARCH" in
  x86_64 | amd64 | aarch64 | arm64) ;;
  *) die "arhitectură nesuportată: $ARCH (sunt suportate x86_64 și arm64)" ;;
esac
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo > /dev/null 2>&1; then SUDO="sudo"; elif [ "$DRY_RUN" -eq 0 ]; then die "rulează ca root sau cu sudo"; fi
fi

if [ "$UPGRADE" -eq 1 ]; then
  [ -f "$DIR/.env" ] || [ "$DRY_RUN" -eq 1 ] || die "nu găsesc o instalare în $DIR (lipsește .env); folosește --dir"
  step "Actualizez instalarea din $DIR"
fi

# 2. Pachetul (--from): descărcat dacă e o adresă, verificat (suma arhivei, apoi CHECKSUMS.sha256 din pachet), dezarhivat.
PACKAGE=""
STAGE=""
if [ -n "$FROM" ]; then
  case "$FROM" in
    http://* | https://*)
      PACKAGE="$(mktemp -d)/$(basename "${FROM%%\?*}")"
      step "Descarc pachetul ($FROM)"
      run curl -fsSL "$FROM" -o "$PACKAGE"
      # Suma publicată lângă pachet (<pachet>.sha256), dacă nu a fost dată cu --sha256.
      if [ -z "$SHA256" ] && [ "$DRY_RUN" -eq 0 ]; then SHA256="$(curl -fsSL "$FROM.sha256" 2> /dev/null | cut -d' ' -f1 || true)"; fi
      ;;
    *)
      [ -f "$FROM" ] || die "pachetul nu există: $FROM"
      PACKAGE="$FROM"
      if [ -z "$SHA256" ] && [ -f "$FROM.sha256" ]; then SHA256="$(cut -d' ' -f1 < "$FROM.sha256")"; fi
      ;;
  esac
  if [ -f "$PACKAGE" ]; then
    if [ -n "$SHA256" ]; then
      [ "$(sha256_of "$PACKAGE")" = "$SHA256" ] || die "suma de control a pachetului nu se potrivește (pachet modificat sau descărcat incomplet)"
      step "Suma de control a pachetului: ok"
    else
      echo "    atenție: fără sumă de control pentru arhivă (--sha256 sau <pachet>.sha256); verific doar fișierele din pachet"
    fi
    STAGE="$(mktemp -d)"
    # Arhiva vine pe stdin: o cale ca `C:/…` nu e confundată cu un server la distanță.
    case "$PACKAGE" in
      *.zip) unzip -q "$PACKAGE" -d "$STAGE" || die "pachetul nu se poate dezarhiva" ;;
      *) tar -xzf - -C "$STAGE" < "$PACKAGE" || die "pachetul nu se poate dezarhiva" ;;
    esac
    # Pachetul are un singur folder la rădăcină (gcs-<versiune>/).
    ROOT="$(find "$STAGE" -mindepth 1 -maxdepth 1 -type d | head -1)"
    [ -n "$ROOT" ] && [ -f "$ROOT/CHECKSUMS.sha256" ] || die "pachet invalid: lipsește CHECKSUMS.sha256"
    (cd "$ROOT" && sha256sum --quiet -c CHECKSUMS.sha256) || die "fișierele din pachet nu corespund sumelor de control"
    step "Fișierele pachetului: ok (versiunea $(cat "$ROOT/VERSION" 2> /dev/null || echo necunoscută))"
    STAGE="$ROOT"
  fi
fi

# 3. Docker, din repo-ul oficial (scriptul get.docker.com), doar dacă lipsește.
if command -v docker > /dev/null 2>&1 && docker compose version > /dev/null 2>&1; then
  step "Docker e deja instalat"
else
  step "Instalez Docker (repo-ul oficial)"
  run sh -c "curl -fsSL https://get.docker.com | $SUDO sh"
fi

# 4. Backup înainte de actualizare (baza de date, fișierele, configurarea).
if [ "$UPGRADE" -eq 1 ]; then
  step "Fac un backup înainte de actualizare"
  run sh -c "cd '$DIR' && $SUDO ./gcs backup"
fi

# 5. Codul: din pachet (fișierele locale ale instalării rămân), din git sau deja existent.
# Ce nu se atinge niciodată: .env, config/, backups/, docker-compose.override.yml.
if [ -n "$STAGE" ] || { [ -n "$FROM" ] && [ "$DRY_RUN" -eq 1 ]; }; then
  step "Copiez fișierele pachetului în $DIR (păstrez .env, config/, backups/ și docker-compose.override.yml)"
  run $SUDO mkdir -p "$DIR"
  run $SUDO tar -C "${STAGE:-.}" --exclude=./.env --exclude=./config --exclude=./backups --exclude=./docker-compose.override.yml -cf - . \
    | if [ "$DRY_RUN" -eq 1 ]; then cat > /dev/null; else $SUDO tar -C "$DIR" -xf -; fi
elif [ -d "$DIR/.git" ]; then
  if [ "$UPGRADE" -eq 1 ]; then
    step "Actualizez codul din git ($DIR)"
    run sh -c "cd '$DIR' && $SUDO git pull --ff-only"
  else
    step "Proiectul există deja în $DIR"
  fi
elif [ "$UPGRADE" -eq 1 ]; then
  [ "$DRY_RUN" -eq 1 ] || die "pentru actualizare dă pachetul nou cu --from (instalarea din $DIR nu e din git)"
else
  [ -n "$REPO" ] || die "dă pachetul cu --from <fișier|url> (sau, din git: --repo <url> / GCS_REPO=<url>)"
  step "Clonez proiectul în $DIR"
  run $SUDO git clone "$REPO" "$DIR"
fi

# 6. Domeniul și .env (doar la o instalare nouă; un .env existent nu se suprascrie).
if [ "$UPGRADE" -eq 0 ]; then
  if [ -z "$DOMAIN" ]; then
    if [ "$DRY_RUN" -eq 1 ]; then
      DOMAIN="forum.exemplu.ro"
    else
      read -r -p "Domeniul site-ului (ex. forum.exemplu.ro): " DOMAIN < /dev/tty
    fi
  fi
  echo "$DOMAIN" | grep -Eq '^[A-Za-z0-9.-]+$' || die "domeniu invalid: $DOMAIN"
  step "Domeniu: $DOMAIN"

  secret() { openssl rand -hex 32; }
  if [ -f "$DIR/.env" ]; then
    step ".env există deja; îl păstrez"
  else
    step "Generez $DIR/.env cu secrete noi"
    if [ "$DRY_RUN" -eq 0 ]; then
      PG_PASSWORD="$(secret)"
      VERSION_LINE=""
      [ -f "$DIR/VERSION" ] && VERSION_LINE="GCS_VERSION=$(cat "$DIR/VERSION")"
      umask 077
      $SUDO tee "$DIR/.env" > /dev/null << EOF
GCS_DOMAIN=$DOMAIN
GCS_BASE_URL=https://$DOMAIN
POSTGRES_USER=gcs
POSTGRES_PASSWORD=$PG_PASSWORD
POSTGRES_DB=gcs
DATABASE_URL=postgresql://gcs:$PG_PASSWORD@postgres:5432/gcs
REDIS_URL=redis://redis:6379
S3_ENDPOINT=http://minio:9000
S3_ACCESS_KEY=gcs
S3_SECRET_KEY=$(secret)
S3_BUCKET=gcs
GCS_SECRET=$(secret)
GCS_CONFIG_DIR=/app/config
COMPOSE_PROFILES=antivirus
$VERSION_LINE
EOF
    else
      echo "    [dry-run] scrie .env (GCS_DOMAIN=$DOMAIN, secrete: openssl rand -hex 32)"
    fi
  fi
elif [ -f "$DIR/VERSION" ] && [ "$DRY_RUN" -eq 0 ]; then
  # Versiunea afișată de installer și de ACP urmează pachetul nou.
  NEW_VERSION="$(cat "$DIR/VERSION")"
  if grep -q '^GCS_VERSION=' "$DIR/.env"; then
    $SUDO sed -i "s/^GCS_VERSION=.*/GCS_VERSION=$NEW_VERSION/" "$DIR/.env"
  else
    echo "GCS_VERSION=$NEW_VERSION" | $SUDO tee -a "$DIR/.env" > /dev/null
  fi
fi

# 7. Pornirea serviciilor (la actualizare, migrațiile se aplică la pornirea aplicației).
step "Pornesc serviciile (docker compose up -d --build)"
run sh -c "cd '$DIR' && $SUDO docker compose up -d --build"

# 8. Aplicația răspunde?
step "Aștept aplicația (/api/health)"
if [ "$DRY_RUN" -eq 0 ]; then
  for _ in $(seq 1 90); do
    if (cd "$DIR" && $SUDO docker compose exec -T web wget -qO- http://127.0.0.1:3000/api/health > /dev/null 2>&1); then break; fi
    sleep 2
  done
fi

# 9. Comanda `gcs` și, la o instalare nouă, codul de instalare.
step "Instalez comanda gcs în /usr/local/bin"
run chmod +x "$DIR/gcs"
run $SUDO ln -sf "$DIR/gcs" /usr/local/bin/gcs

echo
if [ "$UPGRADE" -eq 1 ]; then
  echo "GamingCommunitySuite a fost actualizat în $DIR. Backup-ul de dinainte e în $DIR/backups."
else
  CODE="(vezi: cd $DIR && docker compose logs web | grep 'Cod de instalare')"
  if [ "$DRY_RUN" -eq 0 ]; then
    FOUND="$(cd "$DIR" && $SUDO docker compose logs web 2> /dev/null | grep -o 'Cod de instalare: [A-Z0-9-]*' | tail -1 | sed 's/Cod de instalare: //')"
    [ -n "$FOUND" ] && CODE="$FOUND"
  fi
  echo "GamingCommunitySuite rulează. Continuă instalarea în browser:"
  echo "  Adresa:            https://$DOMAIN/install"
  echo "  Cod de instalare:  $CODE"
fi
echo "Comenzi utile: gcs status · gcs backup · gcs reset-admin-password <nume>"
