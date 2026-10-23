# Instalarea GamingCommunitySuite

*English version below.*

Ghid pentru instalarea GamingCommunitySuite pe un server propriu (VPS), cu Docker.

## Cerințe

| | Minim | Recomandat |
|---|---|---|
| Procesor | 2 vCPU | 4 vCPU |
| Memorie | 4 GB RAM | 8 GB RAM |
| Disc | 20 GB SSD | 40 GB SSD sau mai mult |
| Sistem | Linux pe x86_64 sau arm64 (ex. Ubuntu 24.04, Debian 12) | |

Mai ai nevoie de:

- **pachetul GamingCommunitySuite** (`gcs-<versiune>.tar.gz` și `gcs-<versiune>.tar.gz.sha256`) și **cheia de licență** din contul tău de client;
- **un domeniu** (ex. `forum.exemplu.ro`) și acces la setările lui DNS;
- **acces root** la server (direct sau cu `sudo`);
- **porturile 80 și 443** deschise în firewall. Caddy obține automat certificatul HTTPS (Let's Encrypt).

## 1. DNS

Creează la furnizorul domeniului o înregistrare **A** (și **AAAA**, dacă serverul are IPv6) care trimite domeniul spre IP-ul serverului:

```
forum.exemplu.ro.   A   203.0.113.10
```

Așteaptă până când `ping forum.exemplu.ro` arată IP-ul serverului. De obicei durează câteva minute.

## 2. Instalarea, dintr-o singură comandă

Copiază pachetul și fișierul `.sha256` pe server (sau folosește adresa lor de descărcare), apoi:

```bash
tar -xzf gcs-<versiune>.tar.gz gcs-<versiune>/install.sh --strip-components=1
sudo bash install.sh --from gcs-<versiune>.tar.gz --domain forum.exemplu.ro
```

Scriptul:

1. verifică sistemul (Linux, x86_64/arm64, root);
2. verifică pachetul: suma de control a arhivei (`.sha256`) și a fiecărui fișier din el (`CHECKSUMS.sha256`); un pachet modificat sau descărcat incomplet e refuzat;
3. instalează Docker din repo-ul oficial, dacă lipsește;
4. copiază fișierele în `/opt/gcs` (altă locație: `--dir <folder>`);
5. generează `/opt/gcs/.env` cu secrete noi (`openssl rand -hex 32`); secretele nu se afișează;
6. pornește serviciile cu `docker compose up -d --build`;
7. instalează comanda `gcs` în `/usr/local/bin`;
8. afișează adresa de instalare și **codul de instalare**.

Pentru o simulare fără nicio modificare, adaugă `--dry-run`. Pachetul se poate da și ca adresă: `--from https://…/gcs-<versiune>.tar.gz` (suma se citește din `…tar.gz.sha256` sau o dai cu `--sha256 <sumă>`).

## 3. Wizard-ul de instalare

Deschide `https://forum.exemplu.ro/install`. Pașii apar în stânga, cu starea fiecăruia:

1. **Cod de instalare**: codul afișat de script. Îl găsești oricând cu `cd /opt/gcs && docker compose logs web | grep "Cod de instalare"`.
2. **Verificare sistem**: PostgreSQL, Redis, stocarea fișierelor, spațiul pe disc, folderul de configurare.
3. **Licență**: cheia de licență și acceptarea termenilor de utilizare (EULA). Vezi secțiunea 4.
4. **Aplicații**: aplicațiile pornite la instalare și aplicația de pornire. Vezi secțiunea 5.
5. **Baza de date**: lasă „PostgreSQL inclus”, cu excepția cazului în care folosești un server PostgreSQL extern.
6. **Site**: numele, adresa, limba și fusul orar.
7. **Email (SMTP)**: opțional; îl poți completa și mai târziu, din ACP → Setări → Email.
8. **Administrator**: contul Root Admin, cu acces total.
9. **Date inițiale**: date demo sau fără date.
10. **Instalare**: pașii reali (tabelele, grupurile, setările, aplicațiile, adminul, finalul) apar live; dacă un pas eșuează, „Reîncearcă” îl reia.

Instalarea se poate relua oricând de la ultimul pas terminat. După final, installerul se blochează: `/install` nu mai există (404).

Varianta din consolă, fără browser (aceeași verificare a licenței; implicit pornește toate aplicațiile permise de licență):

```bash
gcs install                    # interactiv
GCS_INSTALL_LICENSE="GCS1.…" GCS_INSTALL_SITE_NAME="Comunitatea mea" GCS_INSTALL_SITE_URL="https://forum.exemplu.ro" \nGCS_INSTALL_ADMIN_NAME="Fondator" GCS_INSTALL_ADMIN_EMAIL="admin@exemplu.ro" GCS_INSTALL_ADMIN_PASSWORD="…" \nGCS_INSTALL_APPS="chat,clans" GCS_INSTALL_LANDING="forums" gcs install --non-interactive
```

## 4. Licența

- Cheia începe cu `GCS1.` și e semnată digital. Se verifică **pe server, fără internet**: semnătura, data de expirare și domeniul.
- Licența e valabilă pentru domeniile din ea (ex. `forum.exemplu.ro`, cu sau fără `www.`, sau `*.exemplu.ro` pentru subdomenii).
- Mesajele posibile: format greșit, cheie necunoscută, semnătură invalidă (cheia a fost modificată), licență expirată, domeniu greșit, licență revocată.
- Verificarea online la platforma GamingCommunitySuite e opțională: se activează cu `GCS_LICENSE_SERVER=<adresă>` în `.env`. Doar o licență revocată blochează; dacă serverul nu răspunde, verificarea offline e suficientă.
- Cheia se păstrează doar pe server (folderul de configurare, permisiuni `600`); nu ajunge în browser și nu apare în log-uri.

## 5. Aplicațiile

- **Standard** (în pachetul de bază, se pot bifa): Forum (mereu pornit), Galerie, Descărcări, Pagini, Clanuri, Calendar, Chat, VIP clasic. În wizard apar doar aplicațiile existente în versiunea instalată.
- **Premium** (vândute separat): Servere, Magazin, Studio VIP, Chat Pro, Grupuri Pro. Apar blocate dacă licența nu le include; cele incluse se pot bifa.
- Aplicațiile nebifate se instalează **oprite**: datele lor există, iar aplicația se pornește oricând din ACP → Aplicații.
- **Aplicația de pornire** e ce vede un vizitator pe prima pagină a site-ului (implicit Forumul).

## 6. Primul login

1. La finalul instalării ajungi în ACP, la **activarea autentificării în doi pași (2FA)**, obligatorie pentru panoul de administrare.
2. Scanează codul QR cu o aplicație de autentificare și păstrează codurile de rezervă.
3. Confirmă parola și codul 2FA. ACP-ul le cere din nou la fiecare 12 ore sau când se schimbă IP-ul.

Ai pierdut accesul la contul Root Admin? Pe server: `gcs reset-admin-password <nume>`. Comanda afișează o singură dată o parolă nouă, dezactivează 2FA-ul contului și îi închide sesiunile.

## 7. Actualizarea

```bash
sudo bash /opt/gcs/install.sh --upgrade --from gcs-<versiune-nouă>.tar.gz
```

Actualizarea face un backup (`gcs backup`), verifică și copiază fișierele noi, păstrează `.env`, `config/`, `backups/` și `docker-compose.override.yml`, apoi repornește serviciile. Migrațiile bazei de date rulează automat la pornire; datele rămân.

## 8. Backup și restaurare

```bash
gcs backup                       # în /opt/gcs/backups
gcs backup --out /mnt/backup     # în alt folder
gcs restore /mnt/backup/gcs-backup-20261005-0300.tar.gz
```

Arhiva conține baza de date (`pg_dump`), fișierele, folderul de configurare și `.env`. **`.env` conține secretele**, inclusiv cheia cu care sunt criptate secretele 2FA, așa că arhiva trebuie păstrată în siguranță (fișierul are permisiunile `600`).

`gcs restore` cere confirmarea prin numele site-ului, pornește modul mentenanță, restaurează datele și oprește mentenanța.

Pentru backup automat zilnic, adaugă în `crontab -e` (ca root):

```
0 3 * * * /usr/local/bin/gcs backup --out /var/backups/gcs > /var/log/gcs-backup.log 2>&1
```

## 9. Depanare

| Problemă | Ce faci |
|---|---|
| „suma de control a pachetului nu se potrivește” | Descarcă din nou pachetul și fișierul `.sha256`. |
| `/install` nu se deschide | `cd /opt/gcs && docker compose ps` (toate serviciile `running`) și `docker compose logs web`. |
| Nu am codul de instalare | `cd /opt/gcs && docker compose logs web \| grep "Cod de instalare"` |
| „Licența nu e valabilă pentru domeniul …” | Adresa site-ului (`GCS_DOMAIN` din `.env`) trebuie să fie unul din domeniile licenței. |
| Certificatul HTTPS lipsește | Verifică DNS-ul (secțiunea 1) și porturile 80/443. |
| O aplicație lipsește din site | ACP → Aplicații: pornește-o (cele premium cer o licență care le include). |

## 10. Comenzi utile

| Comandă | Ce face |
|---|---|
| `gcs status` | Starea instalării și a serviciilor |
| `gcs maintenance on` / `off` | Pornește / oprește modul mentenanță |
| `gcs backup` / `gcs restore <fișier>` | Backup și restaurare |
| `gcs reset-admin-password <nume>` | Parolă nouă pentru un Root Admin |
| `cd /opt/gcs && docker compose logs -f web` | Log-urile aplicației |

---

# Installing GamingCommunitySuite

A guide to installing GamingCommunitySuite on your own server (VPS), with Docker.

## Requirements

| | Minimum | Recommended |
|---|---|---|
| CPU | 2 vCPU | 4 vCPU |
| Memory | 4 GB RAM | 8 GB RAM |
| Disk | 20 GB SSD | 40 GB SSD or more |
| System | Linux on x86_64 or arm64 (e.g. Ubuntu 24.04, Debian 12) | |

You also need:

- **the GamingCommunitySuite package** (`gcs-<version>.tar.gz` and `gcs-<version>.tar.gz.sha256`) and **your licence key** from your customer account;
- **a domain** (e.g. `forum.example.com`) and access to its DNS settings;
- **root access** to the server (directly or with `sudo`);
- **ports 80 and 443** open in the firewall. Caddy gets the HTTPS certificate automatically (Let's Encrypt).

## 1. DNS

At your domain provider, create an **A** record (and **AAAA** if the server has IPv6) pointing the domain to the server's IP:

```
forum.example.com.   A   203.0.113.10
```

Wait until `ping forum.example.com` shows the server's IP. It usually takes a few minutes.

## 2. One-command install

Copy the package and its `.sha256` file to the server (or use their download address), then:

```bash
tar -xzf gcs-<version>.tar.gz gcs-<version>/install.sh --strip-components=1
sudo bash install.sh --from gcs-<version>.tar.gz --domain forum.example.com
```

The script:

1. checks the system (Linux, x86_64/arm64, root);
2. checks the package: the archive checksum (`.sha256`) and the checksum of every file in it (`CHECKSUMS.sha256`); a changed or incomplete package is refused;
3. installs Docker from the official repository if it's missing;
4. copies the files to `/opt/gcs` (another location: `--dir <folder>`);
5. writes `/opt/gcs/.env` with fresh secrets (`openssl rand -hex 32`); secrets are never printed;
6. starts the services with `docker compose up -d --build`;
7. installs the `gcs` command in `/usr/local/bin`;
8. prints the install address and the **install code**.

Add `--dry-run` to simulate without changing anything. The package can also be given as an address: `--from https://…/gcs-<version>.tar.gz` (the checksum is read from `…tar.gz.sha256`, or pass `--sha256 <sum>`).

## 3. The install wizard

Open `https://forum.example.com/install`. The steps are listed on the left with their state:

1. **Install code**: the code printed by the script. You can find it any time with `cd /opt/gcs && docker compose logs web | grep "Cod de instalare"`.
2. **System check**: PostgreSQL, Redis, file storage, disk space, the config folder.
3. **Licence**: the licence key and accepting the terms of use (EULA). See section 4.
4. **Apps**: the apps enabled at install and the landing app. See section 5.
5. **Database**: keep "Included PostgreSQL" unless you use an external PostgreSQL server.
6. **Site**: name, address, language and time zone.
7. **Email (SMTP)**: optional; you can also fill it in later, in ACP → Settings → Email.
8. **Administrator**: the Root Admin account, with full access.
9. **Initial data**: demo data or none.
10. **Install**: the real steps (tables, groups, settings, apps, admin, finish) show live; if a step fails, "Retry" runs it again.

The install can be resumed from the last finished step at any time. When it's done the installer locks itself: `/install` no longer exists (404).

From the console, without a browser (the same licence check; by default it enables every app the licence allows):

```bash
gcs install                    # interactive
GCS_INSTALL_LICENSE="GCS1.…" GCS_INSTALL_SITE_NAME="My community" GCS_INSTALL_SITE_URL="https://forum.example.com" \nGCS_INSTALL_ADMIN_NAME="Founder" GCS_INSTALL_ADMIN_EMAIL="admin@example.com" GCS_INSTALL_ADMIN_PASSWORD="…" \nGCS_INSTALL_APPS="chat,clans" GCS_INSTALL_LANDING="forums" gcs install --non-interactive
```

## 4. The licence

- The key starts with `GCS1.` and is digitally signed. It is checked **on the server, offline**: signature, expiry date and domain.
- The licence is valid for the domains it lists (e.g. `forum.example.com`, with or without `www.`, or `*.example.com` for subdomains).
- Possible messages: wrong format, unknown key, invalid signature (the key was changed), expired licence, wrong domain, revoked licence.
- The online check with the GamingCommunitySuite platform is optional: turn it on with `GCS_LICENSE_SERVER=<address>` in `.env`. Only a revoked licence blocks; if the server doesn't answer, the offline check is enough.
- The key is kept on the server only (the config folder, permissions `600`); it never reaches the browser or the logs.

## 5. Apps

- **Standard** (in the base package, can be ticked): Forum (always on), Gallery, Downloads, Pages, Clans, Calendar, Chat, classic VIP. The wizard only shows the apps present in the installed version.
- **Premium** (sold separately): Servers, Shop, VIP Studio, Chat Pro, Groups Pro. They're locked unless your licence includes them; included ones can be ticked.
- Unticked apps are installed **switched off**: their data model is there, and you can turn the app on any time in ACP → Apps.
- The **landing app** is what a visitor sees on the site's front page (Forum by default).

## 6. First login

1. When the install finishes you land in the ACP, on **setting up two-factor authentication (2FA)**, required for the admin panel.
2. Scan the QR code with an authenticator app and keep the backup codes.
3. Confirm your password and 2FA code. The ACP asks again every 12 hours or when your IP changes.

Lost access to the Root Admin account? On the server: `gcs reset-admin-password <name>`. It prints a new password once, turns off the account's 2FA and ends its sessions.

## 7. Upgrading

```bash
sudo bash /opt/gcs/install.sh --upgrade --from gcs-<new-version>.tar.gz
```

The upgrade makes a backup (`gcs backup`), checks and copies the new files, keeps `.env`, `config/`, `backups/` and `docker-compose.override.yml`, then restarts the services. Database migrations run automatically on start; your data stays.

## 8. Backup and restore

```bash
gcs backup                       # into /opt/gcs/backups
gcs backup --out /mnt/backup     # into another folder
gcs restore /mnt/backup/gcs-backup-20261005-0300.tar.gz
```

The archive holds the database (`pg_dump`), the files, the config folder and `.env`. **`.env` holds the secrets**, including the key that encrypts the 2FA secrets, so keep the archive safe (the file has `600` permissions).

`gcs restore` asks you to confirm with the site name, turns on maintenance mode, restores the data and turns maintenance off.

For a daily automatic backup, add to `crontab -e` (as root):

```
0 3 * * * /usr/local/bin/gcs backup --out /var/backups/gcs > /var/log/gcs-backup.log 2>&1
```

## 9. Troubleshooting

| Problem | What to do |
|---|---|
| "the package checksum doesn't match" | Download the package and its `.sha256` file again. |
| `/install` doesn't open | `cd /opt/gcs && docker compose ps` (all services `running`) and `docker compose logs web`. |
| I don't have the install code | `cd /opt/gcs && docker compose logs web \| grep "Cod de instalare"` |
| "The licence isn't valid for the domain …" | The site address (`GCS_DOMAIN` in `.env`) must be one of the licence's domains. |
| No HTTPS certificate | Check DNS (section 1) and ports 80/443. |
| An app is missing from the site | ACP → Apps: turn it on (premium apps need a licence that includes them). |

## 10. Useful commands

| Command | What it does |
|---|---|
| `gcs status` | Install and service status |
| `gcs maintenance on` / `off` | Turn maintenance mode on / off |
| `gcs backup` / `gcs restore <file>` | Backup and restore |
| `gcs reset-admin-password <name>` | New password for a Root Admin |
| `cd /opt/gcs && docker compose logs -f web` | Application logs |
