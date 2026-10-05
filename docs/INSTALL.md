# Instalarea RED-LINE

Ghid pentru instalarea platformei pe un server propriu (VPS), cu Docker.

## Cerințe

| | Minim | Recomandat |
|---|---|---|
| Procesor | 2 vCPU | 4 vCPU |
| Memorie | 4 GB RAM | 8 GB RAM |
| Disc | 20 GB SSD | 40 GB SSD sau mai mult |
| Sistem | Linux pe x86_64 sau arm64 (ex. Ubuntu 24.04, Debian 12) | |

Mai ai nevoie de:

- **un domeniu** (ex. `forum.exemplu.ro`) și acces la setările lui DNS;
- **acces root** la server (direct sau cu `sudo`);
- **porturile 80 și 443** deschise în firewall. Caddy obține automat certificatul HTTPS (Let's Encrypt).

## 1. DNS

Creează la furnizorul domeniului o înregistrare **A** (și **AAAA**, dacă serverul are IPv6) care trimite domeniul spre IP-ul serverului:

```
forum.exemplu.ro.   A   203.0.113.10
```

Așteaptă până când `ping forum.exemplu.ro` arată IP-ul serverului. De obicei durează câteva minute.

## 2. Instalarea

Pe server, rulează:

```bash
curl -fsSL https://<adresa-proiectului>/install.sh -o install.sh
sudo GCS_REPO=<adresa-repo-ului-git> bash install.sh --domain forum.exemplu.ro
```

Scriptul:

1. verifică sistemul (Linux, x86_64/arm64, root);
2. instalează Docker din repo-ul oficial, dacă lipsește;
3. clonează proiectul în `/opt/redline` (altă locație: `--dir`);
4. generează `/opt/redline/.env` cu secrete noi (`openssl rand -hex 32`);
5. pornește serviciile cu `docker compose up -d --build`;
6. instalează comanda `gcs` în `/usr/local/bin`;
7. afișează adresa de instalare și **codul de instalare**.

Pentru o simulare fără nicio modificare, adaugă `--dry-run`.

## 3. Wizard-ul de instalare

Deschide `https://forum.exemplu.ro/install` și parcurge cei 9 pași:

1. **Cod de instalare**: codul afișat de script. Îl găsești oricând cu `cd /opt/redline && docker compose logs web | grep "Cod de instalare"`.
2. **Verificare sistem**: PostgreSQL, Redis, MinIO, spațiu pe disc, folderul de configurare.
3. **Baza de date**: lasă „PostgreSQL inclus”, cu excepția cazului în care folosești un server PostgreSQL extern.
4. **Site**: numele, adresa, limba și fusul orar.
5. **Email (SMTP)**: opțional; îl poți completa și mai târziu, din ACP → Setări → Email.
6. **Cont Root Admin**: contul cu acces total.
7. **Date inițiale**: date demo sau fără date.
8. **Instalare**: progresul apare live; „Copiază log” ajută la depanare.
9. **Gata**: intri automat în ACP.

Instalarea se poate relua oricând de la ultimul pas terminat. După final, `/install` nu mai există.

Varianta din consolă, fără browser:

```bash
gcs install                    # interactiv
GCS_INSTALL_SITE_NAME="RED-LINE" GCS_INSTALL_SITE_URL="https://forum.exemplu.ro" \
GCS_INSTALL_ADMIN_NAME="Fondator" GCS_INSTALL_ADMIN_EMAIL="admin@exemplu.ro" \
GCS_INSTALL_ADMIN_PASSWORD="…" gcs install --non-interactive
```

## 4. Primul login

1. La finalul instalării ajungi în ACP, la **activarea autentificării în doi pași (2FA)**, obligatorie pentru panoul de administrare.
2. Scanează codul QR cu o aplicație de autentificare (Google Authenticator, Authy, 1Password…) și păstrează codurile de rezervă.
3. Confirmă parola și codul 2FA. ACP-ul le cere din nou la fiecare 12 ore sau când se schimbă IP-ul.

Ai pierdut accesul la contul Root Admin? Pe server:

```bash
gcs reset-admin-password <nume>
```

Comanda afișează o singură dată o parolă nouă, dezactivează 2FA-ul contului și îi închide sesiunile.

## 5. Backup și restaurare

```bash
gcs backup                       # în /opt/redline/backups
gcs backup --out /mnt/backup     # în alt folder
gcs restore /mnt/backup/redline-backup-20261005-0300.tar.gz
```

Arhiva conține baza de date (`pg_dump`), fișierele (MinIO), folderul de configurare și `.env`. **`.env` conține secretele**, inclusiv cheia cu care sunt criptate secretele 2FA, așa că arhiva trebuie păstrată în siguranță (fișierul are permisiunile `600`).

`gcs restore` cere confirmarea prin numele site-ului, pornește modul mentenanță, restaurează datele și oprește mentenanța.

Pentru backup automat zilnic, adaugă în `crontab -e` (ca root):

```
0 3 * * * /usr/local/bin/gcs backup --out /var/backups/redline > /var/log/redline-backup.log 2>&1
```

## 6. Comenzi utile

| Comandă | Ce face |
|---|---|
| `gcs status` | Starea instalării și a serviciilor |
| `gcs maintenance on` / `off` | Pornește / oprește modul mentenanță |
| `gcs backup` / `gcs restore <fișier>` | Backup și restaurare |
| `gcs reset-admin-password <nume>` | Parolă nouă pentru un Root Admin |
| `cd /opt/redline && git pull && docker compose up -d --build` | Actualizare (migrațiile rulează automat la pornire) |
| `cd /opt/redline && docker compose logs -f web` | Log-urile aplicației |
