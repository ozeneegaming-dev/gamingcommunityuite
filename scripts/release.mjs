#!/usr/bin/env node
/**
 * Release-ul de redistribuire GamingCommunitySuite (etapa 11): `pnpm release [-- --version 1.2.0] [--out <folder>] [--no-premium]`.
 *
 * Scrie în `dist/release/<versiune>/`:
 * - `gcs-<versiune>.tar.gz` și `gcs-<versiune>.zip` (pachetul standard), fiecare cu `<arhivă>.sha256`. În pachet, folderul
 *   `gcs-<versiune>/`: sursele aplicației, `docker-compose.yml`, `.env.example`, `install.sh`, `docs/INSTALL.md`, `EULA.md`,
 *   `THIRD-PARTY-NOTICES.md`, `LICENSE`, `VERSION` și `CHECKSUMS.sha256` (suma fiecărui fișier, verificată de `install.sh`);
 * - `premium/`: un pachet `.gcs` per aplicație premium livrată ca plugin (formatul pachetelor de plugin), **nesemnat**.
 *   Semnarea e o comandă separată, rulată de proprietar: `pnpm release:sign -- --key <cheia privată PEM>`.
 *
 * Nu intră în pachet: `.git`, `node_modules`, testele și E2E-ul, configurările serverelor noastre, `.env`, cheile, machetele,
 * brief-urile, capturile, `tools/blingmodels`, tema comunității noastre și sursele pluginurilor de server (doar binarele
 * compilate din `servers-plugins/release/`). Garda de branding citește tot conținutul pachetului înainte de arhivare.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Căile (relative, cu `/`) care nu intră niciodată în pachetul unui client. */
export const RELEASE_EXCLUDES = [
  /(^|\/)\.git(\/|$)/,
  /(^|\/)node_modules\//,
  /^\.github\//,
  /^\.claude\//,
  /^AGENTS\.md$/,
  /(^|\/)\.env$/,
  /(^|\/)\.env\.(?!example$)[^/]+$/,
  /(^|\/)docker-compose\.override\.yml$/,
  /(^|\/)keys?\//,
  /\.(pem|key)$/,
  /^docs\/(?!INSTALL\.md$)/,
  /(^|\/)(gcs-)?mockups\//,
  /(^|\/)(gcs-)?briefs\//,
  /(^|\/)gcs-shots\//,
  /^tools\//,
  /^themes\//,
  /^scripts\/(runner\.|check\.cmd|test-|release)/,
  /^servers-plugins\/(?!release\/)/,
  /(^|\/)e2e\//,
  /(^|\/)test\//,
  /(^|\/)__tests__\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /(^|\/)(vitest|playwright)\.config\.[cm]?[jt]s$/,
  /(^|\/)dist\//,
  /(^|\/)\.next\//,
  /(^|\/)\.turbo\//,
  /(^|\/)coverage\//,
];

export const isShipped = (rel) => !RELEASE_EXCLUDES.some((re) => re.test(rel));

/**
 * Brandul: pachetul clientului e doar GamingCommunitySuite. Numele vechi al proiectului nostru și alte platforme de
 * comunitate nu apar nicăieri (aceeași listă ca garda din `apps/web/lib/branding.test.ts`, plus numele nostru intern).
 */
export const RELEASE_BRANDING = [/red-?line/i, /\bIPS\b/, /invision/i, /indungi/i, /ipsappzone/i, /xenforo/i, /vbulletin/i, /phpbb/i];
const TEXT = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx|json|css|md|prisma|sql|yml|yaml|sh|cmd|ps1|txt|html|svg|example|cfg|inc|sma|toml|lock|Dockerfile)$|(^|\/)(Dockerfile|Caddyfile|gcs|LICENSE|VERSION|\.gitignore|\.nvmrc|[^./]+)$/;

/** Rescrierile din copia clientului (sursele rămân neschimbate: serverele noastre își păstrează numele proiectului Docker). */
export const CLIENT_REWRITES = {
  "docker-compose.yml": (s) => s.replace(/^name:.*$/m, "name: gcs"),
  "package.json": (s) => {
    const pkg = JSON.parse(s);
    pkg.name = "gamingcommunitysuite";
    return `${JSON.stringify(pkg, null, 2)}\n`;
  },
};

/** Liniile cu nume interzise din fișierele text ale pachetului (`cale:linie: text`). */
export function brandingIssues(files) {
  const out = [];
  for (const [rel, data] of files) {
    if (!TEXT.test(rel)) continue;
    const text = Buffer.from(data).toString("utf8");
    if (text.includes("\u0000")) continue;
    text.split("\n").forEach((line, i) => {
      // Și cu etichetele scoase: un nume despărțit în elemente (ex. <span>-</span>) rămâne un nume.
      const plain = line.replace(/<[^>]*>/g, "");
      if (RELEASE_BRANDING.some((re) => re.test(line) || re.test(plain))) out.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  return out;
}

export const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/** `CHECKSUMS.sha256`: `<sha256>  <cale>`, sortat după cale (formatul lui `sha256sum -c`). */
export function checksumsFile(files) {
  return (
    [...files]
      .filter(([rel]) => rel !== "CHECKSUMS.sha256")
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([rel, data]) => `${sha256(data)}  ${rel}`)
      .join("\n") + "\n"
  );
}

/** Fișierele proiectului (urmărite de git și cele noi, neignorate), relative la rădăcină. */
export function projectFiles(root = ROOT) {
  const res = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "buffer" });
  if (res.status !== 0) throw new Error(`git ls-files a eșuat: ${res.stderr}`);
  return [...new Set(res.stdout.toString("utf8").split("\u0000").filter(Boolean))].filter((rel) => existsSync(path.join(root, rel)));
}

const LICENSE_TEXT = (version) => `GamingCommunitySuite ${version}

Copyright (c) the GamingCommunitySuite owner. All rights reserved.

This software is licensed, not sold. Its use is governed by the End User Licence Agreement in EULA.md
and requires a valid GamingCommunitySuite licence key. Third-party components keep their own licences,
listed in THIRD-PARTY-NOTICES.md.
`;

/** Conținutul pachetului standard (cale → octeți), cu fișierele generate. */
export function releaseFiles({ root = ROOT, version, files = projectFiles(root) }) {
  const out = new Map();
  for (const rel of files) {
    if (!isShipped(rel)) continue;
    let data = readFileSync(path.join(root, rel));
    const rewrite = CLIENT_REWRITES[rel];
    if (rewrite) data = Buffer.from(rewrite(data.toString("utf8")), "utf8");
    out.set(rel, data);
  }
  out.set("VERSION", Buffer.from(`${version}\n`, "utf8"));
  out.set("LICENSE", Buffer.from(LICENSE_TEXT(version), "utf8"));
  for (const required of ["install.sh", "docker-compose.yml", ".env.example", "docs/INSTALL.md", "EULA.md", "THIRD-PARTY-NOTICES.md"]) {
    if (!out.has(required)) throw new Error(`lipsește din pachet: ${required}`);
  }
  out.set("CHECKSUMS.sha256", Buffer.from(checksumsFile(out), "utf8"));
  return out;
}

// ─── Arhivele (scrise aici, fără `tar`/`zip` din sistem: același rezultat pe Linux și Windows) ──────────────

const EXECUTABLE = /(^|\/)(install\.sh|gcs|[^/]+\.sh)$/;

function tarHeader(name, size, mode, type = "0") {
  const h = Buffer.alloc(512);
  h.write(name.slice(0, 100), 0, "utf8");
  h.write(`${mode.toString(8).padStart(7, "0")}\0`, 100, "ascii");
  h.write("0000000\0", 108, "ascii");
  h.write("0000000\0", 116, "ascii");
  h.write(`${size.toString(8).padStart(11, "0")}\0`, 124, "ascii");
  h.write(`${Math.floor(Date.UTC(2026, 0, 1) / 1000).toString(8).padStart(11, "0")}\0`, 136, "ascii");
  h.write("        ", 148, "ascii");
  h.write(type, 156, "ascii");
  h.write("ustar\0", 257, "ascii");
  h.write("00", 263, "ascii");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
  return h;
}
const pad512 = (n) => Buffer.alloc((512 - (n % 512)) % 512);

/** Un tar (ustar, cu antete PAX pentru căile lungi), comprimat gzip. */
export function writeTarGz(entries) {
  const parts = [];
  for (const { name, data } of entries) {
    const mode = EXECUTABLE.test(name) ? 0o755 : 0o644;
    if (Buffer.byteLength(name) > 100) {
      const record = (k, v) => {
        const body = ` ${k}=${v}\n`;
        let len = Buffer.byteLength(body);
        len += String(len + String(len).length).length;
        return `${len}${body}`;
      };
      const pax = Buffer.from(record("path", name), "utf8");
      parts.push(tarHeader("PaxHeader", pax.length, 0o644, "x"), pax, pad512(pax.length));
    }
    parts.push(tarHeader(name, data.length, mode), data, pad512(data.length));
  }
  parts.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(parts), { level: 9 });
}

/** Un zip (deflate, cu numele în UTF-8 și drepturile Unix pentru scripturi). */
export function writeZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt32LE(0x5c210000, 10);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, body);
    const mode = EXECUTABLE.test(name) ? 0o100755 : 0o100644;
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(0x031e, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(useDeflate ? 8 : 0, 10);
    c.writeUInt32LE(0x5c210000, 12);
    c.writeUInt32LE(crc >>> 0, 16);
    c.writeUInt32LE(body.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameBuf.length, 28);
    c.writeUInt32LE((mode << 16) >>> 0, 38);
    c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

// ─── Pachetele premium (pluginurile semnabile) ─────────────────────────────────────────────────────────────

/** Aplicațiile premium livrate ca plugin: comanda de construire și folderul cu arhiva rezultată. */
export const PREMIUM_PLUGINS = [{ app: "vip_studio", build: ["--filter", "@gcs/plugin-sdk", "build:vip-studio"], dist: "packages/plugin-sdk/plugins/vip-studio/dist", pattern: /^gcs\.vip_studio-[\d.]+\.zip$/ }];

function buildPremium(root, outDir) {
  const premiumDir = path.join(outDir, "premium");
  mkdirSync(premiumDir, { recursive: true });
  const built = [];
  for (const p of PREMIUM_PLUGINS) {
    const res = spawnSync("pnpm", p.build, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
    if (res.status !== 0) throw new Error(`construirea pachetului premium ${p.app} a eșuat`);
    const dist = path.join(root, p.dist);
    const zip = readdirSync(dist)
      .filter((n) => p.pattern.test(n))
      .map((n) => ({ n, t: statSync(path.join(dist, n)).mtimeMs }))
      .sort((a, b) => b.t - a.t)[0];
    if (!zip) throw new Error(`nu găsesc arhiva pachetului premium ${p.app} în ${p.dist}`);
    const target = path.join(premiumDir, zip.n.replace(/\.zip$/, ".gcs"));
    copyFileSync(path.join(dist, zip.n), target);
    writeFileSync(`${target}.sha256`, `${sha256(readFileSync(target))}  ${path.basename(target)}\n`);
    built.push(target);
  }
  writeFileSync(
    path.join(premiumDir, "README.md"),
    "# Pachetele premium GamingCommunitySuite\n\nPachetele `.gcs` de aici sunt **nesemnate**. Semnarea o face proprietarul, cu cheia lui privată:\n\n```bash\npnpm release:sign -- --key <cale spre cheia privată PEM> [--key-id gcs-2026]\n```\n\nAplicațiile premium incluse în codul de bază (ex. Servere, Chat Pro, Grupuri Pro) nu au un pachet separat: le deblochează licența.\n",
  );
  return built;
}

// ─── Release-ul ────────────────────────────────────────────────────────────────────────────────────────────

/** Construiește release-ul și întoarce căile scrise. */
export function buildRelease({ root = ROOT, version, out, premium = true, files } = {}) {
  if (!version || !/^\d+\.\d+\.\d+([-.][0-9A-Za-z.]+)?$/.test(version)) throw new Error(`versiune invalidă: ${version}`);
  const outDir = out ?? path.join(root, "dist", "release", version);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const content = releaseFiles({ root, version, ...(files ? { files } : {}) });
  const issues = brandingIssues(content);
  if (issues.length > 0) throw new Error(`garda de branding a găsit nume interzise în pachet:\n${issues.join("\n")}`);

  const top = `gcs-${version}`;
  const entries = [...content].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([rel, data]) => ({ name: `${top}/${rel}`, data }));
  const tarGz = path.join(outDir, `${top}.tar.gz`);
  const zip = path.join(outDir, `${top}.zip`);
  writeFileSync(tarGz, writeTarGz(entries));
  writeFileSync(zip, writeZip(entries));
  for (const file of [tarGz, zip]) writeFileSync(`${file}.sha256`, `${sha256(readFileSync(file))}  ${path.basename(file)}\n`);

  const premiumFiles = premium ? buildPremium(root, outDir) : [];
  return { outDir, tarGz, zip, files: content.size, premium: premiumFiles };
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const version = arg("version") ?? JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
    const result = buildRelease({ version, out: arg("out"), premium: !process.argv.includes("--no-premium") });
    console.log(`release ${version}: ${result.files} fișiere`);
    console.log(`  ${path.relative(ROOT, result.tarGz)}`);
    console.log(`  ${path.relative(ROOT, result.zip)}`);
    for (const p of result.premium) console.log(`  ${path.relative(ROOT, p)} (nesemnat: pnpm release:sign -- --key <cheia privată>)`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
