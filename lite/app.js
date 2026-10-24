// GamingCommunitySuite — ediția Lite: fișierul de pornire pentru Passenger
// (cPanel → „Setup Node.js App”, Plesk → Node.js: „Application startup file” = app.js).
//
// Pregătește mediul (ediția, folderul de configurare, secretul aplicației) și pornește serverul Next.js gata construit.
// Nu se editează: setările se schimbă din ACP, iar variabilele proprii se pun în panoul gazdei.
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const env = process.env;

env.GCS_EDITION = env.GCS_EDITION || "lite";
env.NODE_ENV = env.NODE_ENV || "production";
env.NEXT_TELEMETRY_DISABLED = "1";
env.GCS_APP_ROOT = root;
env.GCS_CONFIG_DIR = env.GCS_CONFIG_DIR || path.join(root, "config");
env.GCS_MIGRATIONS_DIR = env.GCS_MIGRATIONS_DIR || path.join(root, "packages", "db", "prisma", "migrations");

const configDir = env.GCS_CONFIG_DIR;
fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });

// Secretul aplicației (sesiuni, tokenuri, cron): generat la prima pornire și păstrat în config/.env.runtime (0600).
const runtimeFile = path.join(configDir, ".env.runtime");
let runtime = "";
try {
  runtime = fs.readFileSync(runtimeFile, "utf8");
} catch {
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

require(path.join(root, "apps", "web", "server.js"));
