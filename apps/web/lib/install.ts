import "server-only";
import {
  databaseUrlFor,
  GCS_INSTALL_STEPS,
  GcsInstallState,
  type GcsDbConnection,
  type GcsInstallInput,
  type GcsInstallProgress,
  type GcsInstallStep,
} from "@gcs/core";
import { cookies } from "next/headers";
import { gcsConfigDir } from "./config";

export const INSTALL_COOKIE = "gcs-install";
export const INSTALL_VERSION = "1.0.0";

export const installState = () => new GcsInstallState(gcsConfigDir());

/** Pașii afișați în wizard (9, ca în machetă). */
export const WIZARD_STEPS = GCS_INSTALL_STEPS;
export const isWizardStep = (v: string): v is GcsInstallStep => (GCS_INSTALL_STEPS as readonly string[]).includes(v);
export const stepIndex = (step: GcsInstallStep) => GCS_INSTALL_STEPS.indexOf(step);

/**
 * Adresa unui pas. Pasul „run” e la `/install/progress`: `/install/run` e endpoint-ul (POST) care rulează
 * instalarea, iar în Next.js o rută API și o pagină nu pot avea aceeași cale.
 */
export const stepPath = (step: GcsInstallStep) => (step === "run" ? "/install/progress" : `/install/${step}`);

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
    return databaseUrlFor({
      host: str(db.host),
      port: Number(db.port) || 5432,
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
  const input: GcsInstallInput = {
    site: { name: str(site.name), url: str(site.url), locale: str(site.locale, "ro"), timezone: str(site.timezone, "Europe/Bucharest") },
    admin: { name: str(admin.name), email: str(admin.email), passwordHash },
    data: data.data?.kind === "empty" ? "empty" : "demo",
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
