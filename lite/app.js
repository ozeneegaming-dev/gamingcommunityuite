// GamingCommunitySuite — ediția Lite: fișierul de pornire pentru Passenger
// (cPanel → „Setup Node.js App”, Plesk → Node.js: „Application startup file” = app.js).
//
// Pregătește mediul (ediția, folderul de configurare, secretul aplicației) și pornește serverul Next.js gata construit,
// din folderul `server/`. Dependențele stau în `server/node_modules`, nu în rădăcină: CloudLinux (NodeJS Selector)
// refuză schimbarea versiunii Node.js cât timp rădăcina aplicației conține un folder `node_modules`.
// Nu se editează: setările se schimbă din ACP, iar variabilele proprii se pun în panoul gazdei.
//
// Fișierul folosește doar sintaxă veche (ES2015), ca un Node.js prea vechi să ajungă la verificarea versiunii și să
// afișeze mesajul ei, nu o eroare de sintaxă.
"use strict";

// Versiunea minimă (ca în verificările installer-ului), înainte de orice `require`: serverul Next.js are sintaxă pe care
// Node-urile vechi nu o înțeleg (ex. `??=` pe Node 14), iar `require("node:…")` lipsește sub Node 14.18.
var MIN_NODE = [20, 9];
var nodeVersion = process.versions.node.split(".").map(Number);
if (nodeVersion[0] < MIN_NODE[0] || (nodeVersion[0] === MIN_NODE[0] && nodeVersion[1] < MIN_NODE[1])) {
  process.stderr.write(
    "[GCS] Node.js " + process.versions.node + " e prea vechi: GamingCommunitySuite cere Node.js " + MIN_NODE.join(".") +
      " sau mai nou (recomandat 22 sau 24). Alege versiunea în panoul gazdei (cPanel → Setup Node.js App → Node.js version;" +
      " Plesk → Node.js → Node.js Version), apoi repornește aplicația.\n" +
      "[GCS] Node.js " + process.versions.node + " is too old: GamingCommunitySuite needs Node.js " + MIN_NODE.join(".") +
      " or newer (22 or 24 recommended). Pick the version in the hosting panel (cPanel → Setup Node.js App → Node.js" +
      " version; Plesk → Node.js → Node.js Version), then restart the application.\n"
  );
  process.exit(1);
}

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const server = path.join(root, "server");
const env = process.env;

env.GCS_EDITION = env.GCS_EDITION || "lite";
env.NODE_ENV = env.NODE_ENV || "production";
env.NEXT_TELEMETRY_DISABLED = "1";
env.GCS_APP_ROOT = root;
// Structura instalării: `config/` (setările instalării, licența, secretele), `uploads/` (fișierele membrilor),
// `plugins/` și `applications/` (pachetele instalate din ACP, dezarhivate din baza de date) și `server/` (motorul).
env.GCS_CONFIG_DIR = env.GCS_CONFIG_DIR || path.join(root, "config");
env.GCS_UPLOADS_DIR = env.GCS_UPLOADS_DIR || path.join(root, "uploads");
env.GCS_PLUGINS_DIR = env.GCS_PLUGINS_DIR || path.join(root, "plugins");
env.GCS_APPLICATIONS_DIR = env.GCS_APPLICATIONS_DIR || path.join(root, "applications");
env.GCS_MIGRATIONS_DIR = env.GCS_MIGRATIONS_DIR || path.join(server, "packages", "db", "prisma", "migrations");

const configDir = env.GCS_CONFIG_DIR;
fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });

// Pachetele aplicațiilor premium (ca `GCS_PREMIUM_APPS` din aplicație): stau în `applications/`, nu în `plugins/`.
const PREMIUM_APP_PACKAGES = ["gcs.servers", "gcs.shop", "gcs.vip_studio", "gcs.chat_pro", "gcs.groups_pro"];

/**
 * Mută `from` la `to`. Dacă `to` există, mută doar ce lipsește acolo: un fișier care există deja în destinație nu se
 * suprascrie, rămâne pe loc și ajunge în `conflicts`. Nimic nu se șterge (doar folderele rămase goale).
 */
function moveInto(from, to, conflicts) {
  let source;
  try {
    source = fs.lstatSync(from);
  } catch (error) {
    return; // Nimic de mutat (sau un alt proces l-a mutat deja).
  }
  let target = null;
  try {
    target = fs.lstatSync(to);
  } catch (error) {
    // Destinația lipsește: o mutare simplă.
  }
  if (!target) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      if (error.code === "ENOENT") return;
      // Alt proces a creat destinația între timp: se unesc folderele, mai jos.
      if (error.code !== "EEXIST" && error.code !== "ENOTEMPTY") throw error;
      target = fs.lstatSync(to);
    }
  }
  if (!source.isDirectory() || !target.isDirectory()) {
    conflicts.push(from);
    return;
  }
  for (const name of fs.readdirSync(from)) moveInto(path.join(from, name), path.join(to, name), conflicts);
  try {
    fs.rmdirSync(from); // Doar dacă a rămas gol.
  } catch (error) {
    // Au rămas conflicte.
  }
}

// Structura de dinainte (pachetul din 2026-10-30): fișierele membrilor în `config/files`, pachetele dezarhivate în
// `config/plugins`, codul (`apps/`, `packages/`, `node_modules/`, `servers-plugins/`) în rădăcină. Se mută singure în
// structura nouă la pornire; codul vechi ajunge în `old-version/` (CloudLinux nu schimbă versiunea Node.js cât timp
// rădăcina are `node_modules`).
try {
  const conflicts = [];
  const moves = [
    [path.join(configDir, "files"), env.GCS_UPLOADS_DIR],
    [path.join(configDir, "plugins"), env.GCS_PLUGINS_DIR],
  ];
  for (const key of PREMIUM_APP_PACKAGES) moves.push([path.join(env.GCS_PLUGINS_DIR, key), path.join(env.GCS_APPLICATIONS_DIR, key)]);
  if (fs.existsSync(path.join(root, "apps", "web", "server.js"))) {
    for (const name of ["node_modules", "apps", "packages", "servers-plugins"]) {
      const from = path.join(root, name);
      // Doar folderele reale: o legătură `node_modules` e a selectorului CloudLinux.
      if (fs.existsSync(from) && fs.lstatSync(from).isDirectory()) moves.push([from, path.join(root, "old-version", name)]);
    }
    process.stderr.write("[GCS] Codul versiunii vechi se mută în old-version/ (după ce verifici site-ul, folderul se poate șterge).\n");
  }
  for (const move of moves) {
    if (path.resolve(move[0]) !== path.resolve(move[1])) moveInto(move[0], move[1], conflicts);
  }
  if (conflicts.length > 0) {
    const names = conflicts.slice(0, 10).map((file) => path.relative(root, file));
    process.stderr.write(`[GCS] ${conflicts.length} fișiere din structura veche au rămas pe loc (există deja în destinație): ${names.join(", ")}\n`);
  }
} catch (error) {
  process.stderr.write(`[GCS] Mutarea în structura nouă s-a oprit (nimic nu s-a pierdut): ${error && error.message}\n`);
}
for (const dir of [env.GCS_UPLOADS_DIR, env.GCS_PLUGINS_DIR, env.GCS_APPLICATIONS_DIR]) fs.mkdirSync(dir, { recursive: true });

// Secretul aplicației (sesiuni, tokenuri, cron): generat la prima pornire și păstrat în config/.env.runtime (0600).
const runtimeFile = path.join(configDir, ".env.runtime");
let runtime = "";
try {
  runtime = fs.readFileSync(runtimeFile, "utf8");
} catch (error) {
  // Prima pornire.
}
const read = (key) => {
  const m = new RegExp(`^${key}=(.*)$`, "m").exec(runtime);
  if (!m) return undefined;
  return m[1].startsWith('"') ? JSON.parse(m[1]) : m[1];
};
if (!env.GCS_SECRET) {
  const saved = read("GCS_SECRET");
  if (saved) env.GCS_SECRET = saved;
  else {
    env.GCS_SECRET = crypto.randomBytes(48).toString("hex");
    fs.writeFileSync(runtimeFile, `${runtime}${runtime && !runtime.endsWith("\n") ? "\n" : ""}GCS_SECRET=${env.GCS_SECRET}\n`, { mode: 0o600 });
  }
}
for (const key of ["DATABASE_URL", "GCS_BASE_URL"]) {
  const saved = read(key);
  if (saved && !env[key]) env[key] = saved;
}

require(path.join(server, "apps", "web", "server.js"));
