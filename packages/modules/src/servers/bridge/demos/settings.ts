import { isIP } from "node:net";
import { normalizeHost } from "../../net";

/**
 * Validarea setărilor „HLTV / GOTV și demo-uri” ale unui server (specul 2026-10-08-servere-hltv §2.1, §3, §4): adresa de
 * vizionare, șablonul HTTP, folderul, prefixul, utilizatorul, amprenta SFTP, cheia privată și parola rcon. Funcțiile
 * `…Error` întorc codul erorii (cheia de traducere `errors.fields.*`) sau `null`.
 */

/** Sursele demo-urilor; `plugin` doar pe CS2 (încărcarea directă a pluginului). */
export const DEMO_SOURCES = ["none", "ftp", "ftps", "sftp", "http", "plugin"] as const;
export type GcsDemoSource = (typeof DEMO_SOURCES)[number];
export const isDemoSource = (v: unknown): v is GcsDemoSource => typeof v === "string" && (DEMO_SOURCES as readonly string[]).includes(v);
/** Sursele care se conectează la un host (FTP / FTPS / SFTP). */
export const REMOTE_SOURCES = ["ftp", "ftps", "sftp"] as const;
export const DEFAULT_PORTS: Record<string, number> = { ftp: 21, ftps: 21, sftp: 22 };

export const TV_DELAY_MAX = 3600;
export const HTTP_TEMPLATE_MAX = 500;
const CONTROL = /[\u0000-\u001F\u007F]/;
const FILE = "{file}";

/** Adresa HLTV / GOTV `host:port` (IPv4 sau nume public; nu IPv6); `""` → `null`, altfel `"invalid"`. */
export function parseTvAddress(raw: unknown): { host: string; port: number; value: string } | null | "invalid" {
  if (typeof raw !== "string") return "invalid";
  const value = raw.trim();
  if (value === "") return null;
  const m = /^([A-Za-z0-9.-]{1,253}):(\d{1,5})$/.exec(value);
  if (!m) return "invalid";
  const host = normalizeHost(m[1]);
  const port = Number(m[2]);
  if (!host || isIP(host) === 6 || port < 1 || port > 65_535) return "invalid";
  return { host, port, value: `${host}:${port}` };
}

/** Legătura „Urmărește live” (clientul Steam pornește jocul și se conectează ca spectator). */
export function steamConnectUrl(address: string): string {
  return `steam://connect/${address}`;
}

/** Șablonul HTTP al demo-urilor: `http(s)://host[:port]/…/{file}` (`{file}` = ultimul segment al căii). */
export function httpTemplateError(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return "required";
  if (raw.length > HTTP_TEMPLATE_MAX || /[\s"'<>\\`]/.test(raw) || CONTROL.test(raw)) return "invalid_template";
  if (raw.split(FILE).length !== 2 || !raw.endsWith(`/${FILE}`)) return "invalid_template";
  const probe = raw.replace(FILE, "gcs-probe.dem");
  if (!URL.canParse(probe)) return "invalid_template";
  const url = new URL(probe);
  if (url.protocol !== "http:" && url.protocol !== "https:") return "invalid_template";
  if (url.username || url.password || url.search || url.hash) return "invalid_template";
  if (!url.pathname.endsWith("/gcs-probe.dem") || url.hostname.includes("gcs-probe")) return "invalid_template";
  return null;
}

/** Folderul șablonului (fără `{file}`): pagina de index cu lista fișierelor. */
export function httpFolderUrl(template: string): string {
  return template.slice(0, template.length - FILE.length);
}

/** Folderul de pe server: max 256, fără caractere de control, ghilimele sau segmente `..`. */
export function remoteDirError(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 256 || CONTROL.test(raw) || /["'<>|*?\\]/.test(raw)) return "invalid_path";
  if (raw.split("/").some((seg) => seg === "..")) return "invalid_path";
  return null;
}

/** Prefixul numelor: `[A-Za-z0-9_.-]`, max 32 (gol = fără filtru). */
export function prefixError(raw: unknown): string | null {
  return typeof raw === "string" && /^[A-Za-z0-9_.-]{0,32}$/.test(raw) ? null : "invalid_prefix";
}

/** Utilizatorul FTP / SFTP: 1–128 caractere, fără caractere de control. */
export function usernameError(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return "required";
  return raw.length > 128 || CONTROL.test(raw) ? "invalid" : null;
}

/** Amprenta cheii SFTP (`SHA256:<base64>`, ca `ssh-keygen -lf`); goală = se reține la prima conectare. */
export function hostKeyError(raw: unknown): string | null {
  if (raw === "") return null;
  return typeof raw === "string" && /^SHA256:[A-Za-z0-9+/]{43}=?$/.test(raw) ? null : "invalid_host_key";
}

/** Cheia privată SFTP (PEM / OpenSSH), max 16 KB. */
export function privateKeyError(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 16_384) return "invalid_private_key";
  return /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]+-----END [A-Z0-9 ]*PRIVATE KEY-----/.test(raw) ? null : "invalid_private_key";
}

/** Parola rcon a HLTV-ului (`adminpassword`): 1–64, fără ghilimele (o închid în comandă) și caractere de control. */
export function rconPasswordError(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return "required";
  return raw.length > 64 || CONTROL.test(raw) || raw.includes('"') ? "invalid_password" : null;
}
