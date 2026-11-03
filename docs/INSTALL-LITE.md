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
3. Folderul trebuie să poată fi scris de aplicație: la prima pornire ea își creează folderele de date.

Structura, după prima pornire:

```
gcs/
├── app.js · cron.mjs   fișierul de pornire și cron-ul (nu se editează)
├── config/             setările instalării, licența, secretele (nu-l șterge niciodată)
├── uploads/            fișierele încărcate de membri (avatare, atașamente, galerie, descărcări)
├── applications/       aplicațiile premium instalate ca pachete (ex. Studio VIP)
├── plugins/            pluginurile instalate
├── server/             motorul compilat și dependențele lui (nu se editează)
└── docs/ · VERSION · LICENSE · EULA.md · THIRD-PARTY-NOTICES.md · CHECKSUMS.sha256
```

- Pachetele din `applications/` și `plugins/` se instalează din **ACP → Aplicații** și se păstrează în baza de date;
  folderele sunt copia lor dezarhivată, refăcută singură la pornire (nu le modifica de mână).
- **Temele** stau în baza de date, cu istoricul fiecărui fișier CSS (**ACP → Aspect**); se exportă și se importă ca
  pachete din ACP, deci nu au un folder.
- Rădăcina nu are `node_modules` intenționat (dependențele sunt în `server/`): altfel panoul nu te-ar lăsa să schimbi
  versiunea Node.js.

## 3. Aplicația Node.js

**cPanel → Setup Node.js App → Create Application**
- *Node.js version*: 22.x (sau cea mai nouă oferită, minim 20.9);
- *Application mode*: **Production**;
- *Application root*: folderul de la pasul 2 (ex. `gcs`);
- *Application URL*: domeniul sau subdomeniul comunității;
- *Application startup file*: **`app.js`**;
- *Create*. **Nu** apăsa „Run NPM Install”: dependențele sunt deja în arhivă (în `server/node_modules`).

Versiunea Node.js se poate schimba oricând: *Setup Node.js App* → aplicația (*Edit*) → *Node.js version* → *Save*, apoi
*Restart*. Pe o versiune sub 20.9 aplicația nu pornește, iar jurnalul ei (pasul 4) spune ce versiune să alegi.

**Plesk → domeniul → Node.js**
- *Node.js Version*: 22.x; *Document Root*: lasă-l pe cel implicit al domeniului (`httpdocs`); *Application Root*: `gcs`;
- *Application Startup File*: **`app.js`**; *Application Mode*: `production`;
- *Enable Node.js*. Nu rula „NPM install”.

Variabile de mediu: nu sunt necesare. Opțional `GCS_BASE_URL=https://domeniul-tau` (adresa publică exactă). Fără ea,
installer-ul folosește adresa din browser (după codul de instalare) și o păstrează în `config/.env.runtime`; de aceea
deschide installer-ul la adresa finală a comunității (domeniul din licență, cu `https://`).

## 4. Instalarea din browser

1. Deschide `https://domeniul-tau/install`.
2. **Codul de instalare**: aplicația îl generează la prima pornire (prima vizită a site-ului) și îl scrie în jurnalul de
   erori (stderr), pe rândul `[GCS] Cod de instalare: XXXX-XXXX-XXXX`:
   - cPanel: jurnalul din folderul aplicației, `stderr.log` sau `passenger.log` (deschide-l din *File Manager*); dacă
     aplicația are completat câmpul *Passenger log file*, fișierul de acolo;
   - Plesk: *Node.js* → *Logs*.

   Codul apare o singură dată (pe disc stă doar o amprentă a lui). Dacă nu-l mai găsești, vezi „Probleme frecvente”.
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
- **Backup**: baza de date (cPanel → *Backup* / phpMyAdmin → *Export*) și folderele `config/` (secretul, licența) și
  `uploads/` (fișierele membrilor). `applications/` și `plugins/` se refac singure din baza de date.
- **Mutarea pe alt domeniu**: schimbă *Application URL* și adresa din ACP → Setări → General.

## 7. Actualizarea

1. Fă un backup (vezi mai sus).
2. Încarcă arhiva versiunii noi și dezarhiveaz-o lângă aplicație (ex. în `/home/cont/gcs-nou`).
3. În folderul aplicației, înlocuiește `server/` cu cel nou (șterge-l pe cel vechi, apoi mută-l pe cel nou) și
   suprascrie fișierele de la rădăcină (`app.js`, `cron.mjs`, `docs/`, `VERSION`, `LICENSE`, `EULA.md`,
   `THIRD-PARTY-NOTICES.md`, `CHECKSUMS.sha256`). `config/`, `uploads/`, `applications/` și `plugins/` nu sunt în
   arhivă: rămân neatinse.
4. *Restart* în panou, apoi deschide site-ul: migrațiile bazei de date rulează singure.

O instalare cu structura veche (pachetul 1.0.0 din 2026-10-30: fișierele membrilor în `config/files`, codul în rădăcină)
se mută singură la prima pornire: `config/files` → `uploads/`, pachetele → `applications/` și `plugins/`, iar codul vechi
(`apps/`, `packages/`, `node_modules/`, `servers-plugins/`) în `old-version/`. Nimic nu se șterge: un fișier care există
deja în destinație rămâne pe loc și apare în jurnal. După ce verifici site-ul, poți șterge `old-version/`.

## Ce diferă față de ediția VPS

- Fără websocket: actualizările live vin prin SSE / polling (câteva secunde întârziere).
- Sarcinile programate rulează la cron (la 5 minute), nu continuu.
- Pe **MySQL**: căutarea nu cunoaște flexiunile („mașini” nu găsește „mașina”; prefixele merg), iar **pluginurile cu
  bază de date proprie** (ex. Studio VIP ca plugin, Tickete suport) nu se pot instala — merg pe PostgreSQL.
- Fără serviciul de traducere automată inclus (se poate lega unul extern din ACP → Setări → Limbi).

## Probleme frecvente

| Simptom | Ce faci |
|---|---|
| „Cannot find module …/server.js” | *Application root* trebuie să fie folderul care conține `app.js` (și `server/`). |
| Nu găsesc codul de instalare | Șterge din *File Manager* fișierul `config/install_code.hash`, apasă *Restart* în panou și deschide site-ul: în jurnal (`stderr.log` / `passenger.log`) apare un cod nou (cel vechi nu mai e valid). |
| Aplicația nu pornește, iar în jurnal (`stderr.log` / `passenger.log`) scrie „Node.js … e prea vechi” sau `SyntaxError: Unexpected token '??='` | Versiunea Node.js e sub 20.9: alege 22 sau 24 în panou (pasul 3), apoi *Restart*. |
| Panoul refuză schimbarea versiunii Node.js: „application should not contain folder/file named node_modules in application root” | Rădăcina aplicației conține un folder `node_modules` (ex. după „Run NPM Install”). Aplicația nu-l folosește (dependențele ei sunt în `server/node_modules`): șterge-l, schimbă versiunea, apoi *Restart*. |
| Pagina dă 503 după instalare | Repornește aplicația din panou (*Restart*); verifică jurnalul. |
| „Utilizatorul bazei nu poate crea tabele” | Dă utilizatorului **ALL PRIVILEGES** pe bază (pasul 1). |
| Cron-ul „nu a rulat încă” | Verifică folderul din comandă și calea spre `node`; rulează comanda o dată în *Terminal* (dacă există). |
| Erori „Prisma … engine” la pornire | Gazda nu e Linux x64 cu glibc (ex. Alpine / ARM): ediția Lite nu e suportată acolo. Dacă în jurnal scrie „Motoarele Prisma nu au putut fi pregătite în server/”, aplicația nu poate scrie în folderul `server/` (la prima pornire face acolo câteva copii ale motorului bazei de date): verifică drepturile folderului, apoi *Restart*. |
