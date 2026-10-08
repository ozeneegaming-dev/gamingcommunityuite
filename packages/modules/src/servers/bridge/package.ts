import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { GcsNotFound, GcsRateLimited, GcsValidationError, type GcsAcpRoleService, type GcsActor, type GcsRedisRateLimiter } from "@gcs/core";
import type { PrismaClient } from "@gcs/db";
import { writeZip, type GcsZipEntryInput } from "@gcs/plugin-sdk/zip";
import { SERVERS_ACP_SECTION, serverSlug } from "../service";
import { isBridgeGame } from "./config";
import type { GcsBridgeKeys } from "./keys";
import { parseBridgeKey } from "./signing";

/**
 * Pachetele pluginului (specul 2026-10-08-servere-plugin-v2 §4–6): același binar pe orice server, doar configul
 * diferă. Binarele vin din pasul de release (`servers-plugins/release/`, cu `manifest.json`: versiunile și sha256 pentru
 * fiecare fișier, verificate la citire). Arhiva pe server conține o cheie nouă (jurnal `servers.key.create`, sursa
 * `package`); pachetul general are doar adresa site-ului (înrolarea automată).
 */

export type GcsPluginGame = "cs16" | "cs2";
/** `server` = cu cheia serverului; `general` = cu adresa site-ului, fără cheie; `generic` = fără adresă (livrabilul). */
export type GcsPackageVariant = "server" | "general" | "generic";

export type GcsReleaseManifest = {
  version: string;
  builtAt: string;
  tools: Record<string, string>;
  plugins: Record<GcsPluginGame, { id: string; version: string; sourcesSha256: string; files: Record<string, string> }>;
};

export type GcsPluginRelease = { dir: string; manifest: GcsReleaseManifest; file: (game: GcsPluginGame, name: string) => Buffer };

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const PACKAGE_LIMIT = { window: 3600, max: 10 };

/** Fișierele fiecărui joc în folderul release-ului (cheile din `manifest.plugins.<joc>.files`). */
export const RELEASE_FILES: Record<GcsPluginGame, readonly string[]> = {
  cs16: ["gcs_bridge.amxx", "gcs_bridge.sma", "gcs_bridge.inc", "gcs_bridge.cfg", "LICENSE"],
  cs2: ["GcsBridge.dll", "GcsBridge.json", "LICENSE"],
};

/**
 * Citește și verifică release-ul: manifestul, fiecare fișier cu sha256-ul lui. Un fișier lipsă sau schimbat →
 * eroare (un binar vechi sau stricat nu ajunge pe servere).
 */
export function readPluginRelease(dir: string): GcsPluginRelease {
  let manifest: GcsReleaseManifest;
  try {
    manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as GcsReleaseManifest;
  } catch {
    throw new GcsValidationError({ release: "missing" });
  }
  const files = new Map<string, Buffer>();
  for (const game of ["cs16", "cs2"] as const) {
    const entry = manifest.plugins?.[game];
    if (!entry) throw new GcsValidationError({ release: "missing" });
    for (const name of RELEASE_FILES[game]) {
      const expected = entry.files?.[name];
      let content: Buffer;
      try {
        content = readFileSync(path.join(dir, game, name));
      } catch {
        throw new GcsValidationError({ release: "missing" }, { file: `${game}/${name}` });
      }
      if (!expected || sha256(content) !== expected) throw new GcsValidationError({ release: "corrupt" }, { file: `${game}/${name}` });
      files.set(`${game}/${name}`, content);
    }
  }
  return { dir, manifest, file: (game, name) => files.get(`${game}/${name}`)! };
}

/** Adresa site-ului pentru config: http(s) absolută, fără ghilimele, spații sau `;` (ar strica linia din config). */
export function packageSiteUrl(raw: string): string {
  const value = raw.trim().replace(/\/+$/, "");
  if (!URL.canParse(value)) throw new GcsValidationError({ siteUrl: "invalid" });
  const url = new URL(value);
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || /["';\s\\]/.test(value) || /[\u0000-\u001F\u007F]/.test(value)) {
    throw new GcsValidationError({ siteUrl: "invalid" });
  }
  return value;
}

/** Configul AMX Mod X din release, cu adresa și cheia completate (doar liniile `gcs_url` / `gcs_key`). */
export function cs16Config(template: string, url: string | null, key: string | null): string {
  return template
    .replace(/^gcs_url\s+"[^"\r\n]*"/m, `gcs_url "${url ?? "https://adresa-comunitatii"}"`)
    .replace(/^gcs_key\s+"[^"\r\n]*"/m, `gcs_key "${key ?? ""}"`);
}

/** Configul CounterStrikeSharp din release, cu `Url` și `Key` completate. */
export function cs2Config(template: string, url: string | null, key: string | null): string {
  const config = JSON.parse(template) as Record<string, unknown>;
  config.Url = url ?? "https://adresa-comunitatii";
  config.Key = key ?? "";
  return `${JSON.stringify(config, null, 2)}\n`;
}

/** Nota de instalare (română): ce face pluginul, cei 3 pași, cerințele, modulele opționale. */
export function installNote(game: GcsPluginGame, variant: GcsPackageVariant, opts: { version: string; url: string | null; serverName?: string }): string {
  const cs16 = game === "cs16";
  const title = cs16 ? `GCS Server Bridge ${opts.version} — Counter-Strike 1.6 (AMX Mod X)` : `GCS Server Bridge ${opts.version} — Counter-Strike 2 (CounterStrikeSharp)`;
  const folder = cs16 ? "cstrike/" : "game/csgo/";
  const configPath = cs16 ? "addons/amxmodx/configs/gcs_bridge.cfg" : "addons/counterstrikesharp/configs/plugins/GcsBridge/GcsBridge.json";
  const urlLine = cs16 ? 'gcs_url "https://adresa-comunitatii"' : '"Url": "https://adresa-comunitatii"';
  const steps =
    variant === "server"
      ? [
          `1. Încarcă pe server conținutul arhivei în folderul jocului (${folder}), peste folderul addons existent.`,
          "2. Repornește serverul (sau schimbă harta).",
          `3. Verifică pe site: ACP → Gaming → Servere → ${opts.serverName ? `„${opts.serverName}”` : "serverul"} → Plugin și chei API: starea devine „Conectat” în cel mult un minut.`,
          "",
          "Arhiva conține cheia acestui server (în config): nu o publica. Dacă se pierde, revoc-o din ACP.",
        ]
      : [
          variant === "generic"
            ? `1. Scrie adresa site-ului în ${configPath} (linia ${urlLine}), apoi încarcă pe server conținutul arhivei în folderul jocului (${folder}), peste folderul addons existent.`
            : `1. Încarcă pe server conținutul arhivei în folderul jocului (${folder}), peste folderul addons existent.`,
          "2. Repornește serverul (sau schimbă harta).",
          "3. Aprobă serverul pe site: ACP → Gaming → Servere → „Servere noi detectate” → Aprobă.",
          "   Pluginul se anunță singur la site; după aprobare primește cheia (o singură dată) și începe să trimită datele.",
        ];
  const requirements = cs16
    ? [
        "- AMX Mod X 1.9 sau 1.10: https://www.amxmodx.org/downloads.php",
        "- Modulul AmxxEasyHttp 1.4 sau mai nou (prin el pluginul vorbește HTTPS cu site-ul): pagina oficială a proiectului",
        "  (GitHub, „AmxxEasyHttp”, Releases). Din arhiva lui: modulul în addons/amxmodx/modules/ și certificatele",
        "  addons/amxmodx/data/amxx_easy_http_cacert.pem (necesare pentru HTTPS).",
        "- Opțional: ReAPI + Reunion, ca site-ul să deosebească jucătorii Steam de cei non-Steam.",
      ]
    : [
        "- Metamod:Source 2 (ramura „dev”): https://www.metamodsource.net/downloads.php?branch=dev",
        "- CounterStrikeSharp 1.0.368 sau mai nou (cu runtime-ul .NET la prima instalare): pagina oficială a proiectului",
        "  (GitHub, „CounterStrikeSharp”, Releases).",
      ];
  const filled = variant === "generic" ? "de completat adresa site-ului" : "completat";
  const files = cs16
    ? [
        "  addons/amxmodx/plugins/gcs_bridge.amxx           pluginul",
        "  addons/amxmodx/configs/plugins-gcs.ini           îl încarcă automat (plugins.ini nu se editează)",
        `  addons/amxmodx/configs/gcs_bridge.cfg            configul (${filled})`,
        "  addons/amxmodx/scripting/gcs_bridge.sma          sursa (licența GPL o cere alături)",
        "  addons/amxmodx/scripting/include/gcs_bridge.inc  doar pentru alte pluginuri de mix",
        "  LICENSE.txt                                      licența (GPL-3.0-or-later)",
      ]
    : [
        "  addons/counterstrikesharp/plugins/GcsBridge/GcsBridge.dll           pluginul",
        `  addons/counterstrikesharp/configs/plugins/GcsBridge/GcsBridge.json  configul (${filled})`,
        "  LICENSE.txt                                                          licența (MIT)",
      ];
  const modules = cs16
    ? [
        "Se pornesc doar din ACP (Gaming → Servere → serverul → Plugin și chei API → „Module opționale”), câte unul. Cât",
        "timp sunt oprite, pluginul nu înregistrează comenzile și nu atinge nimic din ce ține de ele:",
        "  - Admini din GCS: adminii din ACP înlocuiesc drepturile din users.ini (inclusiv adminii pe nume + parolă:",
        "    setinfo _pw parola).",
        "  - Bannuri, mute, gag din GCS: sancțiunile date pe site se aplică pe server.",
        "  - VIP din GCS: flag-urile VIP se adaugă peste drepturile existente.",
        "  - Ready-up mix: say /ready, meciul pornit de GCS.",
        "  - Comenzile de admin GCS: gcs_ban, gcs_gban, gcs_unban, gcs_mute, gcs_gag, gcs_unmute, gcs_ungag, gcs_match,",
        "    gcs_sync, aliasurile amx_ban / amx_unban și jurnalul acțiunilor (amx_kick, amx_slay …; pentru jurnal mută",
        "    linia gcs_bridge.amxx din plugins-gcs.ini în plugins.ini, înaintea lui admincmd.amxx).",
        "Pe server, gcs_allow_manage 0 în gcs_bridge.cfg ține pluginul doar colector, orice s-ar alege în ACP.",
      ]
    : [
        "Se pornesc doar din ACP (Gaming → Servere → serverul → Plugin și chei API → „Module opționale”), câte unul. Cât",
        "timp sunt oprite, pluginul nu înregistrează comenzile și nu atinge nimic din ce ține de ele:",
        "  - Admini din GCS: adminii din ACP înlocuiesc permisiunile din configs/admins.json.",
        "  - Bannuri, mute, gag din GCS: sancțiunile date pe site se aplică pe server.",
        "  - VIP din GCS: permisiunile VIP se adaugă peste cele existente.",
        "  - Ready-up mix: !ready, meciul pornit de GCS.",
        "  - Comenzile de admin GCS: css_gcsban, css_gcsgban, css_gcsunban, css_gcsmute, css_gcsgag, css_gcsunmute,",
        "    css_gcsungag, css_gcskick, css_gcsmatch.",
        'Pe server, "AllowManage": false în GcsBridge.json ține pluginul doar colector, orice s-ar alege în ACP.',
      ];
  const created = cs16
    ? [
        "  addons/amxmodx/data/gcs_bridge_*.json, gcs_bridge_queue.txt   listele locale și evenimentele netrimise",
        "  addons/amxmodx/data/gcs_bridge_enroll.json                     înregistrarea la site (secretul serverului)",
        "  addons/amxmodx/configs/gcs_bridge_key.cfg                      cheia primită după aprobare",
      ]
    : [
        "  addons/counterstrikesharp/plugins/GcsBridge/data/   listele locale, evenimentele netrimise, înregistrarea la",
        "                                                       site și cheia primită după aprobare",
      ];
  const lines = [
    title,
    "=".repeat(title.length),
    "",
    "Pluginul DOAR COLECTEAZĂ DATE pentru site-ul comunității (GamingCommunitySuite): cine joacă, hărțile, statisticile",
    "(ucideri, runde, timp de joc), meciurile mix și adminii prezenți (citiți din sistemul de admini al serverului).",
    "NU schimbă nimic pe server: nu atinge adminii, bannurile, comenzile sau alte pluginuri existente.",
    "",
    ...(opts.url ? [`Site-ul: ${opts.url}`, ""] : []),
    "Instalarea în 3 pași",
    "--------------------",
    ...steps,
    "",
    "Cerințe pe server (o singură dată, de pe paginile oficiale; nu sunt în arhivă)",
    "------------------------------------------------------------------------------",
    ...requirements,
    "",
    "Ce conține arhiva",
    "-----------------",
    ...files,
    "",
    "Module opționale (oprite implicit)",
    "----------------------------------",
    ...modules,
    "",
    "Legarea contului",
    "----------------",
    cs16 ? "Jucătorii își leagă identitatea de contul de pe site cu say /gcs COD (codul din Setări → Cont)." : "Pe CS2 contul Steam se leagă de pe site (Setări → Cont → Conectează Steam).",
    "",
    "Fișiere create de plugin (trebuie să se poată scrie acolo)",
    "----------------------------------------------------------",
    ...created,
    "",
  ];
  return lines.join("\r\n");
}

/** Arhiva unui joc: binarul, configul completat, nota, licența (și sursa, la CS 1.6). Fără `.pdb`. */
export function buildPluginPackage(release: GcsPluginRelease, game: GcsPluginGame, variant: GcsPackageVariant, opts: { url: string | null; key: string | null; serverName?: string }): Buffer {
  const version = release.manifest.plugins[game].version;
  const note = installNote(game, variant, { version, url: opts.url, ...(opts.serverName ? { serverName: opts.serverName } : {}) });
  const text = (s: string) => Buffer.from(s, "utf8");
  const entries: GcsZipEntryInput[] =
    game === "cs16"
      ? [
          { name: "addons/amxmodx/plugins/gcs_bridge.amxx", data: release.file("cs16", "gcs_bridge.amxx") },
          { name: "addons/amxmodx/configs/plugins-gcs.ini", data: text("; GCS Server Bridge: AMX Mod X încarcă singur fișierele plugins-*.ini.\r\ngcs_bridge.amxx\r\n") },
          { name: "addons/amxmodx/configs/gcs_bridge.cfg", data: text(cs16Config(release.file("cs16", "gcs_bridge.cfg").toString("utf8"), opts.url, opts.key)) },
          { name: "addons/amxmodx/scripting/gcs_bridge.sma", data: release.file("cs16", "gcs_bridge.sma") },
          { name: "addons/amxmodx/scripting/include/gcs_bridge.inc", data: release.file("cs16", "gcs_bridge.inc") },
          { name: "LICENSE.txt", data: release.file("cs16", "LICENSE") },
          { name: "INSTALARE.txt", data: text(note) },
        ]
      : [
          { name: "addons/counterstrikesharp/plugins/GcsBridge/GcsBridge.dll", data: release.file("cs2", "GcsBridge.dll") },
          { name: "addons/counterstrikesharp/configs/plugins/GcsBridge/GcsBridge.json", data: text(cs2Config(release.file("cs2", "GcsBridge.json").toString("utf8"), opts.url, opts.key)) },
          { name: "LICENSE.txt", data: release.file("cs2", "LICENSE") },
          { name: "INSTALARE.txt", data: text(note) },
        ];
  return writeZip(entries);
}

export type GcsPluginDownload = { filename: string; bytes: Buffer };

/** Descărcările din ACP: pachetul pe server (cu o cheie nouă) și pachetul general (fără cheie). */
export class GcsBridgePackages {
  private cached: { dir: string; release: GcsPluginRelease } | null = null;

  constructor(
    private readonly deps: {
      db: PrismaClient;
      acp: GcsAcpRoleService;
      rateLimiter: GcsRedisRateLimiter;
      keys: GcsBridgeKeys;
      /** Folderul release-ului (`servers-plugins/release`, sau `GCS_PLUGIN_RELEASE_DIR`). */
      releaseDir: () => string;
      /** Adresa publică a site-ului (`site.url`, altfel `GCS_BASE_URL`). */
      siteUrl: () => Promise<string>;
      now?: () => number;
    },
  ) {}

  /** Release-ul, verificat o dată pe proces (fișierele nu se schimbă cât rulează aplicația). */
  release(): GcsPluginRelease {
    const dir = this.deps.releaseDir();
    if (this.cached?.dir !== dir) this.cached = { dir, release: readPluginRelease(dir) };
    return this.cached.release;
  }

  private async begin(actor: GcsActor): Promise<{ release: GcsPluginRelease; url: string }> {
    const { acp, rateLimiter } = this.deps;
    await acp.assert(actor, SERVERS_ACP_SECTION, "edit");
    const limit = await rateLimiter.consume(`bridge-package:${actor.userId}`, PACKAGE_LIMIT);
    if (!limit.allowed) throw new GcsRateLimited({ retryAfter: String(limit.retryAfter) });
    return { release: this.release(), url: packageSiteUrl(await this.deps.siteUrl()) };
  }

  /** Pachetul unui server: o cheie API nouă („Pachet descărcat AAAA-LL-ZZ”), pusă doar în arhivă. */
  async forServer(actor: GcsActor, serverId: number): Promise<GcsPluginDownload> {
    const { release, url } = await this.begin(actor);
    const server = await this.deps.db.gameServer.findUnique({ where: { id: serverId }, select: { id: true, name: true, game: true } });
    if (!server) throw new GcsNotFound();
    if (!isBridgeGame(server.game)) throw new GcsValidationError({ game: "unsupported_game" });
    const date = new Date(this.deps.now?.() ?? Date.now()).toISOString().slice(0, 10);
    const key = await this.deps.keys.create(actor, server.id, { label: `Pachet descărcat ${date}`, source: "package" });
    if (!parseBridgeKey(key.token)) throw new Error("cheie invalidă");
    const game = server.game as GcsPluginGame;
    return { filename: `gcs-bridge-${game}-${serverSlug(server.name)}.zip`, bytes: buildPluginPackage(release, game, "server", { url, key: key.token, serverName: server.name }) };
  }

  /** Pachetul general: adresa site-ului, fără cheie (serverul se înrolează singur, adminul îl aprobă). */
  async general(actor: GcsActor, game: string): Promise<GcsPluginDownload> {
    const { release, url } = await this.begin(actor);
    if (!isBridgeGame(game)) throw new GcsValidationError({ game: "unsupported_game" });
    return { filename: `gcs-bridge-${game}-general.zip`, bytes: buildPluginPackage(release, game as GcsPluginGame, "general", { url, key: null }) };
  }
}
