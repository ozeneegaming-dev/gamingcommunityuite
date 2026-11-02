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
env.GCS_CONFIG_DIR = env.GCS_CONFIG_DIR || path.join(root, "config");
env.GCS_MIGRATIONS_DIR = env.GCS_MIGRATIONS_DIR || path.join(server, "packages", "db", "prisma", "migrations");

const configDir = env.GCS_CONFIG_DIR;
fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });

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
