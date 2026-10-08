#!/usr/bin/env node
// GCS Server Bridge — pasul de release (specul 2026-10-08-servere-plugin-v2 §6): după compilarea ambelor pluginuri
// (release.ps1 / release.sh), copiază în servers-plugins/release/ binarele, sursele cerute de licență și configurile-
// șablon, apoi scrie manifest.json: versiunile pluginurilor, sha256 pentru fiecare fișier, sha256 al surselor folosite
// și versiunile uneltelor. Site-ul pune în pachetele din ACP doar fișierele care au sha256-ul din manifest, iar testul
// release-ului prinde un binar vechi (sursele schimbate fără release nou).
//
//   node release.mjs --amxxpc "1.10.0.5486" --dotnet "8.0.425" --includes "easyhttp-1.5.0,reapi-5.29.0.358"
//
// Fără dependențe (doar modulele Node). Licența: MIT.

import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Sursele fiecărui plugin (relativ la servers-plugins/), în ordinea hash-ului. */
export function sourceFiles(root, game) {
  if (game === "cs16") return ["amxx/gcs_bridge.sma", "amxx/gcs_bridge.inc"];
  const dir = path.join(root, "cs2", "GcsBridge");
  return [
    ...readdirSync(dir)
      .filter((f) => f.endsWith(".cs"))
      .sort()
      .map((f) => `cs2/GcsBridge/${f}`),
    "cs2/GcsBridge/GcsBridge.csproj",
  ];
}

export function fileSha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Hash-ul surselor unui plugin: pentru fiecare fișier, calea și sha256-ul conținutului cu rândurile normalizate (CRLF →
 * LF, ca să nu depindă de sistemul pe care s-a scos depozitul), apoi sha256 peste toate.
 */
export function sourcesSha256(root, game) {
  const lines = sourceFiles(root, game).map((rel) => `${rel}\n${fileSha256(readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n"))}\n`);
  return fileSha256(lines.join(""));
}

/** Versiunile din surse: `VERSION` / `PLUGIN_ID` (.sma), `<Version>` (.csproj), `Version` (BridgeClient.cs). */
export function sourceVersions(root) {
  const sma = readFileSync(path.join(root, "amxx/gcs_bridge.sma"), "utf8");
  const csproj = readFileSync(path.join(root, "cs2/GcsBridge/GcsBridge.csproj"), "utf8");
  const client = readFileSync(path.join(root, "cs2/GcsBridge/BridgeClient.cs"), "utf8");
  return {
    cs16: { version: /#define VERSION\s+"([^"]+)"/.exec(sma)?.[1] ?? null, id: /#define PLUGIN_ID\s+"([^"]+)"/.exec(sma)?.[1] ?? null },
    cs2: {
      version: /<Version>([^<]+)<\/Version>/.exec(csproj)?.[1] ?? null,
      clientVersion: /public const string Version = "([^"]+)";/.exec(client)?.[1] ?? null,
      id: /public const string PluginId = "gcs-cs2\/" \+ Version;/.test(client) ? `gcs-cs2/${/public const string Version = "([^"]+)";/.exec(client)?.[1]}` : null,
    },
  };
}

/** Fișierele release-ului: numele din folderul jocului ← sursa (relativ la servers-plugins/). */
export const RELEASE_LAYOUT = {
  cs16: {
    "gcs_bridge.amxx": "amxx/build/gcs_bridge.amxx",
    "gcs_bridge.sma": "amxx/gcs_bridge.sma",
    "gcs_bridge.inc": "amxx/gcs_bridge.inc",
    "gcs_bridge.cfg": "amxx/gcs_bridge.cfg",
    LICENSE: "amxx/LICENSE",
  },
  cs2: {
    "GcsBridge.dll": "cs2/GcsBridge/bin/Release/net8.0/GcsBridge.dll",
    "GcsBridge.json": "cs2/GcsBridge.json",
    LICENSE: "cs2/LICENSE",
  },
};

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "1";
  return out;
}

function release(args) {
  const root = here;
  const out = path.join(root, "release");
  const versions = sourceVersions(root);
  if (!versions.cs16.version || versions.cs16.id !== `gcs-amxx/${versions.cs16.version}`) throw new Error("Versiunea pluginului AMX Mod X (VERSION / PLUGIN_ID) nu e coerentă.");
  if (!versions.cs2.version || versions.cs2.version !== versions.cs2.clientVersion) throw new Error("Versiunea pluginului CS2 (<Version> / BridgeClient.Version) nu e coerentă.");
  if (versions.cs16.version !== versions.cs2.version) throw new Error("Pluginurile au versiuni diferite.");
  rmSync(out, { recursive: true, force: true });
  const plugins = {};
  for (const [game, files] of Object.entries(RELEASE_LAYOUT)) {
    mkdirSync(path.join(out, game), { recursive: true });
    const hashes = {};
    for (const [name, rel] of Object.entries(files)) {
      copyFileSync(path.join(root, rel), path.join(out, game, name));
      hashes[name] = fileSha256(readFileSync(path.join(out, game, name)));
    }
    plugins[game] = { id: versions[game].id, version: versions[game].version, sourcesSha256: sourcesSha256(root, game), files: hashes };
  }
  const csproj = readFileSync(path.join(root, "cs2/GcsBridge/GcsBridge.csproj"), "utf8");
  const manifest = {
    version: versions.cs16.version,
    builtAt: new Date().toISOString(),
    tools: {
      amxxpc: args.amxxpc ?? "necunoscut",
      amxxIncludes: (args.includes ?? "").split(",").filter(Boolean).join(", "),
      dotnetSdk: args.dotnet ?? "necunoscut",
      counterStrikeSharpApi: /Include="CounterStrikeSharp\.API" Version="([^"]+)"/.exec(csproj)?.[1] ?? "necunoscut",
    },
    plugins,
  };
  writeFileSync(path.join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

const isMain = /release\.mjs$/.test(process.argv[1] ?? "");
if (isMain) {
  try {
    const manifest = release(parseArgs(process.argv.slice(2)));
    console.log(`Release ${manifest.version}: ${Object.entries(manifest.plugins).map(([g, p]) => `${g} (${Object.keys(p.files).length} fișiere)`).join(", ")}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
