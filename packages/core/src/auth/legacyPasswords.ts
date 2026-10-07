import { createHash, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";

/**
 * Formatele de parolă ale platformelor din care se importă (specul importului, §6). Hash-ul vechi se păstrează
 * marcat cu un prefix (`legacy-<schemă>$…`), deci formatul nu se ghicește niciodată; la prima autentificare reușită
 * parola se rescrie în Argon2id (`upgradeLegacyPassword`).
 *
 * - `bcrypt`: `$2y$` / `$2a$` / `$2b$` (aceeași funcție, doar versiunea diferă);
 * - `md5s`: `md5(md5(sare) . md5(parolă))`;
 * - `sha256s` / `sha1s`: `hash(hash(parolă) . sare)`.
 */
export type GcsLegacyScheme = "bcrypt" | "md5s" | "sha256s" | "sha1s";
export type GcsLegacyPassword = { scheme: GcsLegacyScheme; hash: string; salt?: string };

const PREFIX = "legacy-";
const BCRYPT = /^\$2[aby]?\$\d{2}\$[./A-Za-z0-9]{53}$/;
const HEX_LENGTH: Record<Exclude<GcsLegacyScheme, "bcrypt">, number> = { md5s: 32, sha256s: 64, sha1s: 40 };
const ALGORITHM: Record<Exclude<GcsLegacyScheme, "bcrypt">, string> = { md5s: "md5", sha256s: "sha256", sha1s: "sha1" };
const B64URL = /^[A-Za-z0-9_-]*$/;

/** Hash-ul marcat de salvat în `accounts.password`. Aruncă eroare la un hash care nu are forma schemei. */
export function legacyPasswordHash(p: GcsLegacyPassword): string {
  if (p.scheme === "bcrypt") {
    if (!BCRYPT.test(p.hash)) throw new Error("legacy_hash_invalid");
    return `${PREFIX}bcrypt$${p.hash}`;
  }
  const hash = p.hash.toLowerCase();
  if (!new RegExp(`^[0-9a-f]{${HEX_LENGTH[p.scheme]}}$`).test(hash)) throw new Error("legacy_hash_invalid");
  // Sarea poate conține `$` sau orice alt caracter: se salvează în base64url.
  return `${PREFIX}${p.scheme}$${Buffer.from(p.salt ?? "", "utf8").toString("base64url")}$${hash}`;
}

export function isLegacyPasswordHash(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

function parse(stored: string): GcsLegacyPassword | null {
  if (!isLegacyPasswordHash(stored)) return null;
  const body = stored.slice(PREFIX.length);
  const sep = body.indexOf("$");
  if (sep === -1) return null;
  const scheme = body.slice(0, sep);
  const rest = body.slice(sep + 1);
  if (scheme === "bcrypt") return BCRYPT.test(rest) ? { scheme, hash: rest } : null;
  if (scheme !== "md5s" && scheme !== "sha256s" && scheme !== "sha1s") return null;
  const parts = rest.split("$");
  if (parts.length !== 2 || !B64URL.test(parts[0]!)) return null;
  const hash = parts[1]!;
  if (!new RegExp(`^[0-9a-f]{${HEX_LENGTH[scheme]}}$`).test(hash)) return null;
  return { scheme, hash, salt: Buffer.from(parts[0]!, "base64url").toString("utf8") };
}

const digest = (algorithm: string, s: string) => createHash(algorithm).update(s, "utf8").digest("hex");

function sameHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Escaparea pe care platforma veche o aplica parolei înainte de formula `md5s` (conturile vechi, neactualizate).
 * Se verifică și parola brută, și cea escapată.
 */
function legacyEscape(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/<!--/g, "&#60;&#33;--")
    .replace(/-->/g, "--&#62;")
    .replace(/<script/gi, "&#60;script")
    .replace(/>/g, "&gt;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br />")
    .replace(/\$/g, "&#036;")
    .replace(/!/g, "&#33;")
    .replace(/'/g, "&#39;")
    .replace(/\\/g, "&#092;");
}

/** Verifică o parolă față de un hash vechi marcat; `false` pentru orice format necunoscut sau stricat. */
export async function verifyLegacyPassword(stored: string, password: string): Promise<boolean> {
  const p = parse(stored);
  if (!p) return false;
  if (p.scheme === "bcrypt") {
    try {
      // `$2y$` (PHP) e același algoritm ca `$2b$`.
      return await bcrypt.compare(password, p.hash.replace(/^\$2[ay]\$/, "$2b$"));
    } catch {
      return false;
    }
  }
  const algorithm = ALGORITHM[p.scheme];
  const salt = p.salt ?? "";
  if (p.scheme === "md5s") {
    const saltHash = digest("md5", salt);
    const candidates = new Set([password, legacyEscape(password)]);
    let ok = false;
    for (const candidate of candidates) ok = sameHex(digest("md5", saltHash + digest("md5", candidate)), p.hash) || ok;
    return ok;
  }
  return sameHex(digest(algorithm, digest(algorithm, password) + salt), p.hash);
}
