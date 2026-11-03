# GamingCommunitySuite Lite — installing on shared hosting (cPanel, Plesk)

The Lite edition runs on regular hosting with **Node.js** (cPanel → “Setup Node.js App”, Plesk → “Node.js”), without
Docker, root access or Redis. Data lives in a **MySQL / MariaDB** or **PostgreSQL** database provided by the host.

> Versiunea în română: [INSTALL-LITE.md](INSTALL-LITE.md)

## Requirements

| | Minimum |
|---|---|
| Node.js | 20.9 or newer (22 or 24 recommended) |
| Database | MySQL 8.0.13+ / MariaDB 10.6+ **or** PostgreSQL 14+ with the `unaccent` and `pg_trgm` extensions |
| Disk space | 2 GB free (the app takes ~600 MB unpacked; the rest is for uploads) |
| Memory | 1 GB for the Node.js process (the “LVE” / “Memory” limit in the panel) |
| Cron | one scheduled task every 5 minutes |
| System | Linux x64 (glibc) — regular cPanel / Plesk hosts |

Archive: `gcs-lite-<version>.zip` (+ `gcs-lite-<version>.zip.sha256`, the checksum).

## 1. Database

**cPanel:** *MySQL® Databases* → create a database (e.g. `account_gcs`) and a user with a strong password → *Add User To
Database* → tick **ALL PRIVILEGES**.
**Plesk:** *Databases* → *Add Database* (MySQL), with a new database user.

Write down: the host (usually `localhost`), the port (MySQL `3306`, PostgreSQL `5432`), the database name, user, password.

## 2. Application files

1. Upload the archive in the *File Manager*, to a folder **outside** `public_html` (e.g. `/home/account/gcs`).
2. *Extract* — this creates the `gcs-lite-<version>` folder; you can rename it (e.g. `gcs`).
3. The folder must be writable by the application: on first start it creates its data folders.

The layout, after the first start:

```
gcs/
├── app.js · cron.mjs   the startup file and the cron (don’t edit)
├── config/             installation settings, licence, secrets (never delete it)
├── uploads/            files uploaded by members (avatars, attachments, gallery, downloads)
├── applications/       premium applications installed as packages (e.g. VIP Studio)
├── plugins/            installed plugins
├── server/             the compiled engine and its dependencies (don’t edit)
└── docs/ · VERSION · LICENSE · EULA.md · THIRD-PARTY-NOTICES.md · CHECKSUMS.sha256
```

- The packages in `applications/` and `plugins/` are installed from **ACP → Applications** and kept in the database;
  the folders are their unpacked copy, rebuilt automatically on start (don’t change them by hand).
- **Themes** live in the database, with the history of every CSS file (**ACP → Appearance**); they are exported and
  imported as packages from the ACP, so they have no folder.
- The root has no `node_modules` on purpose (the dependencies are in `server/`): otherwise the panel wouldn’t let you
  change the Node.js version.

## 3. The Node.js application

**cPanel → Setup Node.js App → Create Application**
- *Node.js version*: 22.x (or the newest offered, at least 20.9);
- *Application mode*: **Production**;
- *Application root*: the folder from step 2 (e.g. `gcs`);
- *Application URL*: the community’s domain or subdomain;
- *Application startup file*: **`app.js`**;
- *Create*. Do **not** press “Run NPM Install”: the dependencies are already in the archive (in `server/node_modules`).

You can change the Node.js version at any time: *Setup Node.js App* → the application (*Edit*) → *Node.js version* →
*Save*, then *Restart*. On a version below 20.9 the application doesn’t start, and its log (step 4) says which version
to pick.

**Plesk → the domain → Node.js**
- *Node.js Version*: 22.x; *Document Root*: keep the domain’s default (`httpdocs`); *Application Root*: `gcs`;
- *Application Startup File*: **`app.js`**; *Application Mode*: `production`;
- *Enable Node.js*. Don’t run “NPM install”.

Environment variables: none required. Optionally `GCS_BASE_URL=https://your-domain` (the exact public address).
Without it, the installer uses the address from the browser (after the install code) and keeps it in
`config/.env.runtime`; so open the installer at the community’s final address (the licensed domain, with `https://`).

## 4. Installing from the browser

1. Open `https://your-domain/install`.
2. **Install code**: the application generates it on first start (the site’s first visit) and writes it to the error log
   (stderr), on the line `[GCS] Cod de instalare: XXXX-XXXX-XXXX`:
   - cPanel: the log in the application folder, `stderr.log` or `passenger.log` (open it from the *File Manager*); if
     the application’s *Passenger log file* field is filled in, the file named there;
   - Plesk: *Node.js* → *Logs*.

   The code is shown only once (only a fingerprint of it is kept on disk). If you can’t find it, see “Common problems”.
3. **Checks**: the Node.js version, disk, the `config` folder.
4. **Licence**, **Applications**, then **Database**: choose **MySQL / MariaDB** (or PostgreSQL), fill in the details from
   step 1 and press *Test connection*.
5. Site, email, administrator, starting data → **Install**.
6. **Final step: Cron** — see below. Then *Enter the ACP*.

## 5. Cron (required)

Scheduled tasks (digest emails, VIP expiry, cleanups, statistics, rankings) run on the host’s cron. The installer’s
final page and **ACP → System → Cron** show the exact command to copy:

**cPanel → Cron Jobs → Add New Cron Job**: *Common Settings* = “Once Per Five Minutes” (`*/5 * * * *`), *Command* = the
command shown, like:

```bash
cd "/home/account/gcs" && "/home/account/nodevenv/gcs/22/bin/node" cron.mjs >/dev/null 2>&1
```

**Plesk → Scheduled Tasks → Add Task**: *Run a command*, the same command, *Run* = “Cron style” `*/5 * * * *`.

If the panel can’t run Node.js, use the address variant (also on the cron page, with your token):
`curl -fsS --max-time 60 "https://your-domain/api/cron?token=…"`.

After adding the cron, wait 5 minutes and press **Check**. The ACP dashboard shows a warning while the cron isn’t running.

## 6. After installation

- **Live updates** (notifications, chat, “who’s online”): no websocket, via SSE or polling. If the host cuts long
  connections, choose “Polling only” in **ACP → Settings → Advanced** and, if needed, the interval (default 5 s).
- **Backups**: the database (cPanel → *Backup* / phpMyAdmin → *Export*) and the `config/` (secret, licence) and
  `uploads/` (members’ files) folders. `applications/` and `plugins/` are rebuilt automatically from the database.
- **Moving to another domain**: change the *Application URL* and the address in ACP → Settings → General.

## 7. Upgrading

1. Make a backup (see above).
2. Upload the new version’s archive and extract it next to the application (e.g. into `/home/account/gcs-new`).
3. In the application folder, replace `server/` with the new one (delete the old one, then move the new one in) and
   overwrite the files in the root (`app.js`, `cron.mjs`, `docs/`, `VERSION`, `LICENSE`, `EULA.md`,
   `THIRD-PARTY-NOTICES.md`, `CHECKSUMS.sha256`). `config/`, `uploads/`, `applications/` and `plugins/` are not in the
   archive: they stay untouched.
4. *Restart* in the panel, then open the site: database migrations run automatically.

An installation with the old layout (the 1.0.0 package from 2026-10-30: members’ files in `config/files`, the code in
the root) moves automatically on first start: `config/files` → `uploads/`, the packages → `applications/` and
`plugins/`, and the old code (`apps/`, `packages/`, `node_modules/`, `servers-plugins/`) into `old-version/`. Nothing is
deleted: a file that already exists at the destination stays where it is and is listed in the log. Once you’ve checked
the site, you can delete `old-version/`.

## How it differs from the VPS edition

- No websocket: live updates arrive via SSE / polling (a few seconds’ delay).
- Scheduled tasks run on cron (every 5 minutes), not continuously.
- On **MySQL**: search doesn’t know word forms (“mașini” doesn’t find “mașina”; prefixes work), and **plugins with their
  own database** (e.g. VIP Studio as a plugin, Support tickets) can’t be installed — they work on PostgreSQL.
- No bundled automatic translation service (an external one can be connected in ACP → Settings → Languages).

## Common problems

| Symptom | What to do |
|---|---|
| “Cannot find module …/server.js” | *Application root* must be the folder that contains `app.js` (and `server/`). |
| I can’t find the install code | Delete the `config/install_code.hash` file in the *File Manager*, press *Restart* in the panel and open the site: a new code appears in the log (`stderr.log` / `passenger.log`; the old one is no longer valid). |
| The application doesn’t start and the log (`stderr.log` / `passenger.log`) says “Node.js … is too old” or `SyntaxError: Unexpected token '??='` | The Node.js version is below 20.9: pick 22 or 24 in the panel (step 3), then *Restart*. |
| The panel refuses to change the Node.js version: “application should not contain folder/file named node_modules in application root” | The application root contains a `node_modules` folder (e.g. after “Run NPM Install”). The application doesn’t use it (its dependencies are in `server/node_modules`): delete it, change the version, then *Restart*. |
| The page returns 503 after installing | Restart the application from the panel (*Restart*); check the log. |
| “The database user can’t create tables” | Grant the user **ALL PRIVILEGES** on the database (step 1). |
| The cron “hasn’t run yet” | Check the folder in the command and the path to `node`; run the command once in *Terminal* (if available). |
| “Prisma … engine” errors on start | The host isn’t Linux x64 with glibc (e.g. Alpine / ARM): the Lite edition isn’t supported there. If the log says “Motoarele Prisma nu au putut fi pregătite în server/”, the application can’t write to the `server/` folder (on first start it adds a few copies of the database engine there): check the folder permissions, then *Restart*. |
