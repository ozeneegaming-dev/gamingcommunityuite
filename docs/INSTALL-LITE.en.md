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
3. The `config` folder (created on first start) must be writable by the application; never delete it: it holds the
   application secret, the licence and the uploaded files.

## 3. The Node.js application

**cPanel → Setup Node.js App → Create Application**
- *Node.js version*: 22.x (or the newest offered, at least 20.9);
- *Application mode*: **Production**;
- *Application root*: the folder from step 2 (e.g. `gcs`);
- *Application URL*: the community’s domain or subdomain;
- *Application startup file*: **`app.js`**;
- *Create*. Do **not** press “Run NPM Install”: the dependencies are already in the archive.

**Plesk → the domain → Node.js**
- *Node.js Version*: 22.x; *Document Root*: keep the domain’s default (`httpdocs`); *Application Root*: `gcs`;
- *Application Startup File*: **`app.js`**; *Application Mode*: `production`;
- *Enable Node.js*. Don’t run “NPM install”.

Environment variables: none required. Optionally `GCS_BASE_URL=https://your-domain` (the exact public address).

## 4. Installing from the browser

1. Open `https://your-domain/install`.
2. **Install code**: it appears in the application log (cPanel: *Setup Node.js App* → the app → the log file in the
   application folder, `stderr.log` / `passenger.log`; Plesk: *Node.js* → *Logs*) on the line
   `[GCS] Cod de instalare: XXXX-XXXX-XXXX`.
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
- **Backups**: the database (cPanel → *Backup* / phpMyAdmin → *Export*) and the `config` folder (secret, licence, files).
- **Moving to another domain**: change the *Application URL* and the address in ACP → Settings → General.

## How it differs from the VPS edition

- No websocket: live updates arrive via SSE / polling (a few seconds’ delay).
- Scheduled tasks run on cron (every 5 minutes), not continuously.
- On **MySQL**: search doesn’t know word forms (“mașini” doesn’t find “mașina”; prefixes work), and **plugins with their
  own database** (e.g. VIP Studio as a plugin, Support tickets) can’t be installed — they work on PostgreSQL.
- No bundled automatic translation service (an external one can be connected in ACP → Settings → Languages).

## Common problems

| Symptom | What to do |
|---|---|
| “Cannot find module …/server.js” | *Application root* must be the folder that contains `app.js`. |
| The page returns 503 after installing | Restart the application from the panel (*Restart*); check the log. |
| “The database user can’t create tables” | Grant the user **ALL PRIVILEGES** on the database (step 1). |
| The cron “hasn’t run yet” | Check the folder in the command and the path to `node`; run the command once in *Terminal* (if available). |
| “Prisma … engine” errors on start | The host isn’t Linux x64 with glibc (e.g. Alpine / ARM): the Lite edition isn’t supported there. |
