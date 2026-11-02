import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  databaseUrlFor,
  defaultDbPort,
  GCS_INSTALL_STEPS,
  GCS_PREMIUM_APPS,
  gcsEdition,
  GcsInstallState,
  installDomain,
  resolveAppSelection,
  verifyLicense,
  type GcsDbConnection,
  type GcsInstallInput,
  type GcsInstallProgress,
  type GcsInstallStep,
  type GcsLicense,
  type GcsLicenseResult,
} from "@gcs/core";
import { cookies } from "next/headers";
import { gcsConfigDir } from "./config";
import { services } from "./services";

export const INSTALL_COOKIE = "gcs-install";
/** Versiunea afișată de installer: `GCS_VERSION` (scris de release în `.env`) sau versiunea din surse. */
export const INSTALL_VERSION = process.env.GCS_VERSION || "1.0.0";

export const installState = () => new GcsInstallState(gcsConfigDir());

/** Pașii afișați în stânga wizard-ului („Gata” e finalul pasului „Instalare”). */
export const WIZARD_STEPS = GCS_INSTALL_STEPS.filter((s) => s !== "done");

/** Verifică offline licența pentru domeniul acestei instalări (aplicațiile premium cunoscute, pentru licența de test). */
export function verifyInstallLicense(token: string | null | undefined): GcsLicenseResult {
  return verifyLicense(token, { domain: installDomain(), premiumApps: GCS_PREMIUM_APPS });
}

/** Licența salvată la pasul „Licență” (doar pe server, în `.env.runtime`), verificată din nou; `null` dacă lipsește sau nu mai e validă. */
export async function savedLicense(): Promise<{ token: string; license: GcsLicense } | null> {
  const token = await installState().secret("license", "token");
  const result = verifyInstallLicense(token);
  return token && result.ok ? { token, license: result.license } : null;
}

/** Textul EULA din pachet (`EULA.md`, la rădăcina proiectului; și în imaginea standalone). */
export async function eulaText(): Promise<string> {
  const file = process.env.GCS_EULA_FILE ?? path.resolve(process.cwd(), "../../EULA.md");
  return readFile(file, "utf8").catch(() => "");
}
export const isWizardStep = (v: string): v is GcsInstallStep => (GCS_INSTALL_STEPS as readonly string[]).includes(v);
export const stepIndex = (step: GcsInstallStep) => GCS_INSTALL_STEPS.indexOf(step);

/**
 * Adresa unui pas. Pasul „run” e la `/install/progress`: `/install/run` e endpoint-ul (POST) care rulează
 * instalarea, iar în Next.js o rută API și o pagină nu pot avea aceeași cale.
 */
export const stepPath = (step: GcsInstallStep) => (step === "run" ? "/install/progress" : `/install/${step}`);

/**
 * Ediția Lite: panoul gazdei nu cere variabile de mediu, deci fără `GCS_BASE_URL` adresa site-ului se ia din cererea
 * proprietarului (originea browserului, altfel `x-forwarded-proto` + host-ul), doar după codul de instalare: un
 * vizitator oarecare nu o poate impune. Se păstrează în `config/.env.runtime` (`app.js` o citește la pornire); din ea
 * vin domeniul licenței (`installDomain()`) și adresa apelată de `cron.mjs`. O adresă setată în panou nu se schimbă.
 */
export async function rememberLiteBaseUrl(h: Pick<Headers, "get">): Promise<void> {
  if (gcsEdition() !== "lite" || process.env.GCS_BASE_URL) return;
  const first = (value: string | null) => value?.split(",")[0]?.trim() || null;
  const host = first(h.get("x-forwarded-host")) ?? first(h.get("host"));
  const candidates = [h.get("origin"), host ? `${first(h.get("x-forwarded-proto")) ?? "http"}://${host}` : null];
  const url = candidates.map((c) => (c && URL.canParse(c) ? new URL(c) : null)).find((u) => u && /^https?:$/.test(u.protocol) && u.hostname);
  if (!url) return;
  await installState().writeSecrets({ GCS_BASE_URL: url.origin });
  process.env.GCS_BASE_URL = url.origin;
}

/** Browserul a trecut de pasul „Cod de instalare” (cookie-ul sesiunii de instalare e valid). */
export async function hasInstallSession(): Promise<boolean> {
  const token = (await cookies()).get(INSTALL_COOKIE)?.value;
  return installState().verifyInstallSession(token);
}

/** Conexiunea la baza de date „inclusă” (din `DATABASE_URL`, configurat de Docker Compose). */
export function includedConnection(): GcsDbConnection | null {
  const raw = process.env.DATABASE_URL;
  if (!raw || !URL.canParse(raw)) return null;
  const url = new URL(raw);
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, "") || "gcs",
  };
}

type Data = GcsInstallProgress["data"];
const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);

/** URL-ul bazei de date alese în wizard (inclusă sau externă). */
export async function targetDatabaseUrl(data: Data): Promise<string | null> {
  const db = data.database ?? {};
  if (db.mode === "external") {
    const password = (await installState().secret("database", "password")) ?? "";
    const engine = db.engine === "mysql" ? "mysql" : "postgresql";
    return databaseUrlFor({
      engine,
      host: str(db.host),
      port: Number(db.port) || defaultDbPort(engine),
      user: str(db.user),
      password,
      database: str(db.database, "gcs"),
    });
  }
  return process.env.DATABASE_URL ?? null;
}

/** Datele rulării, din progresul salvat și din secretele din `.env.runtime`. */
export async function installInput(data: Data): Promise<GcsInstallInput | null> {
  const state = installState();
  const site = data.site ?? {};
  const admin = data.admin ?? {};
  const email = data.email ?? {};
  const passwordHash = await state.secret("admin", "password_hash");
  if (!site.name || !admin.email || !admin.name || !passwordHash) return null;
  // Licența și aplicațiile se verifică din nou la rulare (o licență expirată între timp oprește instalarea).
  const licensed = await savedLicense();
  if (!licensed) return null;
  const apps = data.apps ?? {};
  const selected = Array.isArray(apps.selected) ? apps.selected.filter((k): k is string => typeof k === "string") : [];
  const resolved = resolveAppSelection(services().registry, licensed.license, { selected, landing: str(apps.landing) });
  if (!resolved.ok) return null;
  const input: GcsInstallInput = {
    site: { name: str(site.name), url: str(site.url), locale: str(site.locale, "ro"), timezone: str(site.timezone, "Europe/Bucharest") },
    admin: { name: str(admin.name), email: str(admin.email), passwordHash },
    data: data.data?.kind === "empty" ? "empty" : "demo",
    apps: resolved.selection,
    license: licensed.token,
  };
  if (email.host) {
    input.email = {
      host: str(email.host),
      port: Number(email.port) || 587,
      user: str(email.user),
      pass: (await state.secret("email", "pass")) ?? "",
      from: str(email.from),
    };
  }
  return input;
}
