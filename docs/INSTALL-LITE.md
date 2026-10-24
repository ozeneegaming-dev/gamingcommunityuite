# GamingCommunitySuite Lite — instalarea pe găzduire partajată (cPanel, Plesk)

Ediția Lite rulează pe o găzduire obișnuită cu **Node.js** (cPanel → „Setup Node.js App”, Plesk → „Node.js”), fără
Docker, fără acces root și fără Redis. Datele stau într-o bază **MySQL / MariaDB** sau **PostgreSQL**, oferită de gazdă.

> English version: [INSTALL-LITE.en.md](INSTALL-LITE.en.md)

## Ce îți trebuie

| | Minim |
|---|---|
| Node.js | 20.9 sau mai nou (recomandat 22 sau 24) |
| Baza de date | MySQL 8.0.13+ / MariaDB 10.6+ **sau** PostgreSQL 14+ cu extensiile `unaccent` și `pg_trgm` |
| Spațiu pe disc | 2 GB liberi (aplicația ocupă ~600 MB după dezarhivare; restul pentru fișierele încărcate) |
| Memorie | 1 GB pentru procesul Node.js (limita „LVE” / „Memory” din panou) |
| Cron | o sarcină programată la 5 minute |
| Sistem | Linux x64 (glibc) — gazdele cu cPanel / Plesk obișnuite |

Arhiva: `gcs-lite-<versiune>.zip` (+ `gcs-lite-<versiune>.zip.sha256`, suma de control).

## 1. Baza de date

**cPanel:** *MySQL® Databases* → creează o bază (ex. `cont_gcs`) și un utilizator cu parolă puternică → *Add User To
Database* → bifează **ALL PRIVILEGES**.
**Plesk:** *Databases* → *Add Database* (MySQL), cu un utilizator nou al bazei.

Notează: gazda (de obicei `localhost`), portul (MySQL `3306`, PostgreSQL `5432`), numele bazei, utilizatorul, parola.

## 2. Fișierele aplicației

1. Încarcă arhiva în *File Manager*, într-un folder **în afara** `public_html` (ex. `/home/cont/gcs`).
2. *Extract* — se creează folderul `gcs-lite-<versiune>`; poți să-l redenumești (ex. `gcs`).
3. Folderul `config` (creat la prima pornire) trebuie să poată fi scris de aplicație; nu-l șterge niciodată: acolo stau
   secretul aplicației, licența și fișierele încărcate.

## 3. Aplicația Node.js

**cPanel → Setup Node.js App → Create Application**
- *Node.js version*: 22.x (sau cea mai nouă oferită, minim 20.9);
- *Application mode*: **Production**;
- *Application root*: folderul de la pasul 2 (ex. `gcs`);
- *Application URL*: domeniul sau subdomeniul comunității;
- *Application startup file*: **`app.js`**;
- *Create*. **Nu** apăsa „Run NPM Install”: dependențele sunt deja în arhivă.

**Plesk → domeniul → Node.js**
- *Node.js Version*: 22.x; *Document Root*: lasă-l pe cel implicit al domeniului (`httpdocs`); *Application Root*: `gcs`;
- *Application Startup File*: **`app.js`**; *Application Mode*: `production`;
- *Enable Node.js*. Nu rula „NPM install”.

Variabile de mediu: nu sunt necesare. Opțional `GCS_BASE_URL=https://domeniul-tau` (adresa publică exactă).

## 4. Instalarea din browser

1. Deschide `https://domeniul-tau/install`.
2. **Codul de instalare**: apare în jurnalul aplicației (cPanel: *Setup Node.js App* → aplicația → fișierul de log din
   folderul aplicației, `stderr.log` / `passenger.log`; Plesk: *Node.js* → *Logs*) pe rândul
   `[GCS] Cod de instalare: XXXX-XXXX-XXXX`.
3. **Verificări**: versiunea Node.js, discul, folderul `config`.
4. **Licență**, **Aplicații**, apoi **Baza de date**: alege **MySQL / MariaDB** (sau PostgreSQL), completează datele de la
   pasul 1 și apasă *Testează conexiunea*.
5. Site, email, administrator, date de pornire → **Instalează**.
6. **Pasul final: Cron** — vezi mai jos. Apoi *Intră în ACP*.

## 5. Cron-ul (obligatoriu)

Sarcinile programate (emailurile digest, expirarea VIP, curățenia, statisticile, clasamentele) rulează la cron-ul
gazdei. Pagina de final a instalării și **ACP → Sistem → Cron** îți arată comanda exactă, de copiat:

**cPanel → Cron Jobs → Add New Cron Job**: *Common Settings* = „Once Per Five Minutes” (`*/5 * * * *`), *Command* =
comanda afișată, de forma:

```bash
cd "/home/cont/gcs" && "/home/cont/nodevenv/gcs/22/bin/node" cron.mjs >/dev/null 2>&1
```

**Plesk → Scheduled Tasks → Add Task**: *Run a command*, aceeași comandă, *Run* = „Cron style” `*/5 * * * *`.

Dacă panoul nu poate rula Node.js, folosește varianta cu adresa (tot din pagina de cron, cu tokenul tău):
`curl -fsS --max-time 60 "https://domeniul-tau/api/cron?token=…"`.

După ce adaugi cron-ul, așteaptă 5 minute și apasă **Verifică**. În ACP, panoul afișează un avertisment cât timp cron-ul
nu rulează.

## 6. După instalare

- **Actualizări live** (notificări, chat, „cine e online”): fără websocket, prin SSE sau polling. Dacă gazda taie
  conexiunile lungi, alege în **ACP → Setări → Avansat** „Doar polling” și, după nevoie, intervalul (implicit 5 s).
- **Backup**: baza de date (cPanel → *Backup* / phpMyAdmin → *Export*) și folderul `config` (secretul, licența, fișierele).
- **Mutarea pe alt domeniu**: schimbă *Application URL* și adresa din ACP → Setări → General.

## Ce diferă față de ediția VPS

- Fără websocket: actualizările live vin prin SSE / polling (câteva secunde întârziere).
- Sarcinile programate rulează la cron (la 5 minute), nu continuu.
- Pe **MySQL**: căutarea nu cunoaște flexiunile („mașini” nu găsește „mașina”; prefixele merg), iar **pluginurile cu
  bază de date proprie** (ex. Studio VIP ca plugin, Tickete suport) nu se pot instala — merg pe PostgreSQL.
- Fără serviciul de traducere automată inclus (se poate lega unul extern din ACP → Setări → Limbi).

## Probleme frecvente

| Simptom | Ce faci |
|---|---|
| „Cannot find module …/server.js” | *Application root* trebuie să fie folderul care conține `app.js`. |
| Pagina dă 503 după instalare | Repornește aplicația din panou (*Restart*); verifică jurnalul. |
| „Utilizatorul bazei nu poate crea tabele” | Dă utilizatorului **ALL PRIVILEGES** pe bază (pasul 1). |
| Cron-ul „nu a rulat încă” | Verifică folderul din comandă și calea spre `node`; rulează comanda o dată în *Terminal* (dacă există). |
| Erori „Prisma … engine” la pornire | Gazda nu e Linux x64 cu glibc (ex. Alpine / ARM): ediția Lite nu e suportată acolo. |
