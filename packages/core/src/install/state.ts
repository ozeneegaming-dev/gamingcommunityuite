import { randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { hashPassword, verifyPassword } from "../auth/passwords";
import type { GcsRedisRateLimiter } from "../auth/rateLimit";
import { GcsRateLimited } from "../errors";

/** Pașii wizard-ului de instalare (spec §17.1), în ordine. */
export const GCS_INSTALL_STEPS = ["code", "checks", "database", "site", "email", "admin", "data", "run", "done"] as const;
export type GcsInstallStep = (typeof GCS_INSTALL_STEPS)[number];

export type GcsInstallProgress = { step: GcsInstallStep; data: Record<string, Record<string, unknown>> };

const FILES = {
  installed: "installed.lock",
  progress: "install_progress.json",
  secrets: ".env.runtime",
  runLock: "install.run.lock",
  codeHash: "install_code.hash",
} as const;

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

  async markInstalled(): Promise<void> {
    await mkdir(this.configDir, { recursive: true });
    await writeAtomic(this.file(FILES.installed), `${new Date().toISOString()}\n`);
    await this.saveStep("done");
  }
}

const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Codul de instalare (spec §17.1): la prima pornire se generează 12 caractere `[A-Z2-9]`, se salvează doar
 * hash-ul Argon2 și codul apare în log-ul containerului. Apelurile următoare întorc `null`.
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
  console.log(`[RED-LINE] Cod de instalare: ${code}`);
  return code;
}

/** Verifică codul de instalare; maximum 5 încercări pe IP la 15 minute (apoi `GcsRateLimited`). */
export async function verifyInstallCode(
  configDir: string,
  code: string,
  opts: { ip: string; limiter: Pick<GcsRedisRateLimiter, "consume"> },
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
  if (isInstall || pathname === "/api/health" || pathname.startsWith("/_next/")) return "pass";
  return "redirect";
}
