import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { hashPassword, verifyPassword } from "../auth/passwords";
import type { GcsRateLimiter } from "../auth/rateLimit";
import { GcsRateLimited } from "../errors";

/**
 * Pașii wizard-ului de instalare, în ordine (proprietarul, 2026-10-17): Verificare sistem → Licență → Aplicații →
 * Bază de date → (Site, Email) → Administrator → (Date inițiale) → Instalare. Codul de instalare îi precede pe toți.
 */
export const GCS_INSTALL_STEPS = ["code", "checks", "license", "apps", "database", "site", "email", "admin", "data", "run", "done"] as const;
export type GcsInstallStep = (typeof GCS_INSTALL_STEPS)[number];

export type GcsInstallProgress = { step: GcsInstallStep; data: Record<string, Record<string, unknown>> };

const FILES = {
  installed: "installed.lock",
  progress: "install_progress.json",
  secrets: ".env.runtime",
  runLock: "install.run.lock",
  codeHash: "install_code.hash",
  session: "install_session.hash",
  finish: "install_finish.json",
  license: "license.token",
} as const;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Câmpurile care nu ajung niciodată în progres (parole, secrete, chei API). */
const SECRET_FIELD = /pass(word)?|secret|token|api_?key/i;
const CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789";
const CODE_RULE = { window: 15 * 60, max: 5 };

/** Numele variabilei din `.env.runtime` pentru un secret (ex. `GCS_INSTALL_DATABASE_PASSWORD`). */
export const installSecretName = (step: string, field: string) =>
  `GCS_INSTALL_${step}_${field}`.toUpperCase().replace(/[^A-Z0-9_]/g, "_");

/** Scriere atomică: întâi un fișier temporar, apoi `rename` (un crash nu lasă un fișier pe jumătate scris). */
async function writeAtomic(file: string, content: string, mode?: number): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, content, mode !== undefined ? { mode } : {});
  await rename(tmp, file);
}

function encodeEnv(value: string): string {
  return /^[\w@%+=:,./-]*$/.test(value) ? value : JSON.stringify(value);
}

function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!m) continue;
    const raw = m[2]!;
    out[m[1]!] = raw.startsWith('"') ? (JSON.parse(raw) as string) : raw;
  }
  return out;
}

/**
 * Starea instalării, ținută pe disc în `configDir` (volumul `gcsconfig`), ca să supraviețuiască restartului
 * containerului și reîncărcării paginii (spec §17.1). Secretele stau separat, în `.env.runtime` (0600).
 */
export class GcsInstallState {
  constructor(private readonly configDir: string) {}

  private file(name: string): string {
    return path.join(this.configDir, name);
  }

  async isInstalled(): Promise<boolean> {
    return existsSync(this.file(FILES.installed));
  }

  async progress(): Promise<GcsInstallProgress> {
    try {
      const parsed = JSON.parse(await readFile(this.file(FILES.progress), "utf8")) as GcsInstallProgress;
      if (GCS_INSTALL_STEPS.includes(parsed.step)) return { step: parsed.step, data: parsed.data ?? {} };
    } catch {
      // Fără progres salvat (sau fișier corupt): instalarea începe de la primul pas.
    }
    return { step: "code", data: {} };
  }

  /** Salvează datele unui pas (fără secrete) și îl marchează ca pas curent. */
  async saveStep(step: GcsInstallStep, data: Record<string, unknown> = {}): Promise<void> {
    await mkdir(this.configDir, { recursive: true });
    const publicData: Record<string, unknown> = {};
    const secrets: Record<string, string> = {};
    for (const [key, value] of Object.entries(data)) {
      if (SECRET_FIELD.test(key)) secrets[installSecretName(step, key)] = String(value ?? "");
      else publicData[key] = value;
    }
    if (Object.keys(secrets).length > 0) await this.writeSecrets(secrets);

    const progress = await this.progress();
    progress.step = step;
    progress.data[step] = { ...(progress.data[step] ?? {}), ...publicData };
    await writeAtomic(this.file(FILES.progress), JSON.stringify(progress, null, 2));
  }

  /** Secretul salvat pentru un câmp al unui pas (ex. parola bazei de date), sau `null`. */
  async secret(step: GcsInstallStep, field: string): Promise<string | null> {
    return (await this.readSecrets())[installSecretName(step, field)] ?? null;
  }

  async readSecrets(): Promise<Record<string, string>> {
    try {
      return parseEnv(await readFile(this.file(FILES.secrets), "utf8"));
    } catch {
      return {};
    }
  }

  /** Adaugă/înlocuiește variabile în `.env.runtime` (0600), păstrând celelalte. */
  async writeSecrets(values: Record<string, string>): Promise<void> {
    await mkdir(this.configDir, { recursive: true });
    const merged = { ...(await this.readSecrets()), ...values };
    const content = Object.entries(merged).map(([k, v]) => `${k}=${encodeEnv(v)}`).join("\n") + "\n";
    await writeAtomic(this.file(FILES.secrets), content, 0o600);
  }

  /** După instalare: șterge secretele temporare ale wizard-ului (`GCS_INSTALL_*`), păstrând restul (ex. `DATABASE_URL`). */
  async clearInstallSecrets(): Promise<void> {
    const kept = Object.entries(await this.readSecrets()).filter(([k]) => !k.startsWith("GCS_INSTALL_"));
    const content = kept.map(([k, v]) => `${k}=${encodeEnv(v)}`).join("\n") + (kept.length ? "\n" : "");
    await writeAtomic(this.file(FILES.secrets), content, 0o600);
  }

  /** Lock-ul rulării instalării (creare exclusivă): o a doua rulare simultană primește `false`. */
  async acquireRunLock(): Promise<boolean> {
    await mkdir(this.configDir, { recursive: true });
    try {
      await writeFile(this.file(FILES.runLock), `${process.pid} ${new Date().toISOString()}\n`, { flag: "wx" });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  }

  async releaseRunLock(): Promise<void> {
    await rm(this.file(FILES.runLock), { force: true });
  }

  /**
   * Sesiunea wizard-ului: după codul de instalare corect, browserul primește un token (cookie httpOnly);
   * pe disc stă doar hash-ul lui. O sesiune nouă o înlocuiește pe cea veche.
   */
  async createInstallSession(): Promise<string> {
    await mkdir(this.configDir, { recursive: true });
    const token = randomBytes(32).toString("hex");
    await writeAtomic(this.file(FILES.session), sha256(token), 0o600);
    return token;
  }

  async verifyInstallSession(token: string | undefined): Promise<boolean> {
    if (!token) return false;
    try {
      return sameHash((await readFile(this.file(FILES.session), "utf8")).trim(), sha256(token));
    } catch {
      return false;
    }
  }

  /** Tokenul de unică folosință cu care browserul intră automat ca Root Admin la finalul instalării. */
  async createFinishToken(adminEmail: string): Promise<string> {
    const token = randomBytes(32).toString("hex");
    await writeAtomic(this.file(FILES.finish), JSON.stringify({ hash: sha256(token), email: adminEmail }), 0o600);
    return token;
  }

  /** Emailul adminului dacă tokenul e corect; tokenul se consumă (a doua folosire întoarce `null`). */
  async consumeFinishToken(token: string | undefined): Promise<string | null> {
    if (!token) return null;
    try {
      const saved = JSON.parse(await readFile(this.file(FILES.finish), "utf8")) as { hash: string; email: string };
      if (!sameHash(saved.hash, sha256(token))) return null;
      await rm(this.file(FILES.finish), { force: true });
      return saved.email;
    } catch {
      return null;
    }
  }

  /** Mută wizard-ul la un pas (fără date noi), ex. după ce pasul anterior a fost salvat. */
  async advance(step: GcsInstallStep): Promise<void> {
    await mkdir(this.configDir, { recursive: true });
    const progress = await this.progress();
    progress.step = step;
    await writeAtomic(this.file(FILES.progress), JSON.stringify(progress, null, 2));
  }

  /** Licența instalării: doar pe server, în folderul de configurare (0600); nu ajunge niciodată în browser sau în log. */
  async saveLicense(token: string): Promise<void> {
    await mkdir(this.configDir, { recursive: true });
    await writeAtomic(this.file(FILES.license), `${token.trim()}\n`, 0o600);
  }

  async readLicense(): Promise<string | null> {
    try {
      return (await readFile(this.file(FILES.license), "utf8")).trim() || null;
    } catch {
      return null;
    }
  }

  async markInstalled(): Promise<void> {
    await mkdir(this.configDir, { recursive: true });
    await writeAtomic(this.file(FILES.installed), `${new Date().toISOString()}\n`);
    await this.saveStep("done");
  }
}

const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Codul de instalare (spec §17.1): la prima pornire se generează 12 caractere `[A-Z2-9]`, se salvează doar
 * hash-ul Argon2 și codul apare în jurnalul aplicației, pe **stderr**: `docker compose logs` arată ambele fluxuri, dar
 * Passenger / LiteSpeed (ediția Lite pe cPanel, CloudLinux) păstrează doar stderr (`stderr.log`), iar stdout se pierde.
 * Apelurile următoare întorc `null`.
 */
export async function ensureInstallCode(configDir: string): Promise<string | null> {
  const file = path.join(configDir, FILES.codeHash);
  if (existsSync(file)) return null;
  await mkdir(configDir, { recursive: true });
  const raw = Array.from({ length: 12 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
  try {
    await writeFile(file, await hashPassword(raw), { flag: "wx", mode: 0o600 });
  } catch (error) {
    // Altă instanță a generat codul între timp.
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return null;
    throw error;
  }
  const code = raw.match(/.{4}/g)!.join("-");
  console.error(`[GCS] Cod de instalare: ${code}`);
  return code;
}

/** Verifică codul de instalare; maximum 5 încercări pe IP la 15 minute (apoi `GcsRateLimited`). */
export async function verifyInstallCode(
  configDir: string,
  code: string,
  opts: { ip: string; limiter: Pick<GcsRateLimiter, "consume"> },
): Promise<boolean> {
  const limit = await opts.limiter.consume(`install-code:${opts.ip}`, CODE_RULE);
  if (!limit.allowed) throw new GcsRateLimited({ retryAfter: String(limit.retryAfter ?? CODE_RULE.window) });
  let hash: string;
  try {
    hash = (await readFile(path.join(configDir, FILES.codeHash), "utf8")).trim();
  } catch {
    return false;
  }
  return verifyPassword(hash, normalizeCode(code));
}

/**
 * Poarta instalării (spec §17.1): înainte de instalare, totul duce la `/install` (în afară de health-check și
 * fișierele statice); după instalare, `/install*` nu mai există (404).
 */
export function installGate(pathname: string, installed: boolean): "pass" | "redirect" | "not_found" {
  const isInstall = pathname === "/install" || pathname.startsWith("/install/");
  if (installed) return isInstall ? "not_found" : "pass";
  // `/api/internal/` = endpoint-ul CLI-ului `gcs` (`gcs install` rulează înainte de instalare), protejat cu un HMAC.
  if (isInstall || pathname === "/api/health" || pathname.startsWith("/api/internal/") || pathname.startsWith("/_next/")) return "pass";
  return "redirect";
}
