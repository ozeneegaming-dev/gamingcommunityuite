"use server";

import {
  checkLicenseOnline,
  GcsMemoryRateLimiter,
  GcsRateLimited,
  gcsEdition,
  hashPassword,
  installDomain,
  resolveAppSelection,
  normalizeEmail,
  runChecks,
  testDatabase,
  validateUsername,
  verifyInstallCode,
  type GcsDbConnection,
  type GcsInstallStep,
} from "@gcs/core";
import { cookies, headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { clientIp } from "@/lib/actor";
import { isSameOrigin } from "@/lib/actions";
import { gcsConfigDir } from "@/lib/config";
import { hasInstallSession, INSTALL_COOKIE, includedConnection, installState, savedLicense, stepIndex, stepPath, verifyInstallLicense } from "@/lib/install";
import { services } from "@/lib/services";

export type GcsInstallActionResult = { ok: true; next: string } | { ok: false; errors: Record<string, string> };

const field = (fd: FormData, name: string) => {
  const v = fd.get(name);
  return typeof v === "string" ? v.trim() : "";
};

/** Verificările comune: același Origin și sesiunea de instalare (codul a fost introdus). */
async function guard(): Promise<Record<string, string> | null> {
  const t = await getTranslations("install.errors");
  if (!isSameOrigin(await headers()) || !(await hasInstallSession())) return { _: t("session") };
  return null;
}

/** Salvează un pas și mută wizard-ul la următorul (doar înainte: reluarea unui pas anterior nu dă progresul înapoi). */
async function complete(step: GcsInstallStep, next: GcsInstallStep, data?: Record<string, unknown>): Promise<GcsInstallActionResult> {
  const state = installState();
  const before = (await state.progress()).step;
  await state.saveStep(step, data ?? {});
  await state.advance(stepIndex(before) > stepIndex(next) ? before : next);
  return { ok: true, next: stepPath(next) };
}

export async function submitInstallCode(fd: FormData): Promise<GcsInstallActionResult> {
  const t = await getTranslations("install.steps.code");
  const h = await headers();
  if (!isSameOrigin(h)) return { ok: false, errors: { code: t("invalid") } };
  try {
    // Ediția Lite nu are încă bază de date la acest pas: limita încercărilor stă în memoria procesului.
    const limiter = gcsEdition() === "lite" ? installCodeLimiter : services().rateLimiter;
    const ok = await verifyInstallCode(gcsConfigDir(), field(fd, "code"), { ip: clientIp(h), limiter });
    if (!ok) return { ok: false, errors: { code: t("invalid") } };
  } catch (error) {
    if (error instanceof GcsRateLimited) return { ok: false, errors: { code: t("rateLimited") } };
    throw error;
  }
  const state = installState();
  const token = await state.createInstallSession();
  (await cookies()).set(INSTALL_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && !process.env.GCS_BASE_URL?.startsWith("http://"),
    path: "/",
    maxAge: 60 * 60 * 24,
  });
  const { step } = await state.progress();
  if (step === "code") await state.advance("checks");
  return { ok: true, next: step === "code" ? "/install/checks" : stepPath(step) };
}

const installCodeLimiter = new GcsMemoryRateLimiter();

/** Pasul „Verificare sistem”: Redis, disc și folderul de configurare sunt obligatorii (baza de date se verifică la pasul ei). */
export async function continueFromChecks(): Promise<GcsInstallActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, errors: denied };
  const results = await runChecks({ databaseUrl: process.env.DATABASE_URL, redisUrl: process.env.REDIS_URL, s3Endpoint: process.env.S3_ENDPOINT, configDir: gcsConfigDir(), edition: gcsEdition() });
  const blocking = results.filter((r) => !r.ok && ["redis", "disk", "config_writable"].includes(r.id));
  if (blocking.length > 0) {
    const t = await getTranslations("install.steps.checks");
    return { ok: false, errors: { _: t("blocked") } };
  }
  return complete("checks", "license");
}

/**
 * Pasul „Licență”: tokenul semnat (verificat OFFLINE: semnătura, expirarea, domeniul), apoi, dacă e configurată,
 * verificarea online la platforma-mamă (doar o licență revocată blochează) și acceptarea EULA. Tokenul se ține doar
 * pe server (secretele instalării); în progres rămâne doar numele licențiatului.
 */
export async function saveLicense(fd: FormData): Promise<GcsInstallActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, errors: denied };
  const t = await getTranslations("install.steps.license.errors");
  const token = field(fd, "token");
  const result = verifyInstallLicense(token);
  if (!result.ok) return { ok: false, errors: { token: t(result.error, { domain: installDomain() }) } };
  if (!result.license.dev && (await checkLicenseOnline(token, { domain: installDomain() })).status === "revoked") return { ok: false, errors: { token: t("revoked") } };
  if (fd.get("eula") !== "on") return { ok: false, errors: { eula: t("eula") } };
  return complete("license", "apps", { token, licensee: result.license.licensee });
}

/** Pasul „Aplicații”: aplicațiile bifate (cele premium doar dacă licența le include) și aplicația de pornire. */
export async function saveApps(fd: FormData): Promise<GcsInstallActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, errors: denied };
  const t = await getTranslations("install.steps.apps.errors");
  const licensed = await savedLicense();
  if (!licensed) return { ok: false, errors: { _: t("license") } };
  const selected = fd.getAll("app").filter((v): v is string => typeof v === "string");
  const landing = field(fd, "landing");
  const registry = services().registry;
  const resolved = resolveAppSelection(registry, licensed.license, { selected, landing });
  if (!resolved.ok) {
    const tr = await getTranslations();
    const labelKey = resolved.app ? registry.module(resolved.app)?.app?.labelKey : undefined;
    const app = labelKey && tr.has(labelKey) ? tr(labelKey) : (resolved.app ?? "");
    return { ok: false, errors: { _: t(resolved.error, { app }) } };
  }
  return complete("apps", "database", { selected: [...resolved.selection.enabled], landing: resolved.selection.landing });
}

function connectionFrom(fd: FormData): { mode: "included" | "external"; conn: GcsDbConnection | null } {
  if (field(fd, "mode") !== "external") return { mode: "included", conn: includedConnection() };
  return {
    mode: "external",
    conn: {
      host: field(fd, "host"),
      port: Number(field(fd, "port")) || 5432,
      user: field(fd, "user"),
      password: typeof fd.get("password") === "string" ? (fd.get("password") as string) : "",
      database: field(fd, "database") || "gcs",
    },
  };
}

export async function testDatabaseConnection(fd: FormData): Promise<{ ok: boolean; message: string }> {
  const denied = await guard();
  if (denied) return { ok: false, message: denied._! };
  const t = await getTranslations("install");
  const { conn } = connectionFrom(fd);
  if (!conn) return { ok: false, message: t("errors.db_unreachable") };
  const result = await testDatabase(conn);
  if (!result.ok) return { ok: false, message: t(`errors.${result.errorKey}`) };
  return { ok: true, message: result.created ? t("steps.database.okCreated") : t("steps.database.ok") };
}

export async function saveDatabase(fd: FormData): Promise<GcsInstallActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, errors: denied };
  const t = await getTranslations("install");
  const { mode, conn } = connectionFrom(fd);
  if (!conn) return { ok: false, errors: { _: t("errors.db_unreachable") } };
  const result = await testDatabase(conn);
  if (!result.ok) return { ok: false, errors: { _: t(`errors.${result.errorKey}`) } };
  const data: Record<string, unknown> = { mode };
  if (mode === "external") Object.assign(data, { host: conn.host, port: conn.port, user: conn.user, database: conn.database, password: conn.password });
  return complete("database", "site", data);
}

export async function saveSite(fd: FormData): Promise<GcsInstallActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, errors: denied };
  const tf = await getTranslations("errors.fields");
  const name = field(fd, "name");
  const url = field(fd, "url");
  const locale = field(fd, "locale");
  const timezone = field(fd, "timezone") || "Europe/Bucharest";
  const errors: Record<string, string> = {};
  if (name.length < 1 || name.length > 64) errors.name = tf("invalid_length");
  if (url && !URL.canParse(url)) errors.url = tf("invalid_url");
  if (!["ro", "en"].includes(locale)) errors.locale = tf("invalid_choice");
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return complete("site", "email", { name, url, locale, timezone });
}

export async function saveEmail(fd: FormData): Promise<GcsInstallActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, errors: denied };
  const tf = await getTranslations("errors.fields");
  const host = field(fd, "host");
  const port = Number(field(fd, "port") || 587);
  const from = field(fd, "from");
  const errors: Record<string, string> = {};
  if (host) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) errors.port = tf("invalid_port");
    if (!/^[^\s@]+@[^\s@]+$/.test(from)) errors.from = tf("invalid_email");
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const data: Record<string, unknown> = { host, port, user: field(fd, "user"), from };
  const pass = typeof fd.get("pass") === "string" ? (fd.get("pass") as string) : "";
  if (pass) data.pass = pass;
  return complete("email", "admin", data);
}

export async function saveAdmin(fd: FormData): Promise<GcsInstallActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, errors: denied };
  const tAuth = await getTranslations("auth.errors");
  const t = await getTranslations("install.steps.admin");
  const name = field(fd, "name");
  const email = normalizeEmail(field(fd, "email"));
  const password = typeof fd.get("password") === "string" ? (fd.get("password") as string) : "";
  const confirm = typeof fd.get("confirm") === "string" ? (fd.get("confirm") as string) : "";
  const errors: Record<string, string> = {};
  const nameError = validateUsername(name);
  if (nameError) errors.name = tAuth(nameError);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = tAuth("email_invalid");
  if (password.length < 8) errors.password = tAuth("password_too_short");
  else if (password !== confirm) errors.confirm = t("mismatch");
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  // Parola nu ajunge pe disc în clar: doar hash-ul Argon2, în `.env.runtime` (0600), până la finalul instalării.
  return complete("admin", "data", { name, email, password_hash: await hashPassword(password) });
}

export async function saveData(fd: FormData): Promise<GcsInstallActionResult> {
  const denied = await guard();
  if (denied) return { ok: false, errors: denied };
  return complete("data", "run", { kind: field(fd, "kind") === "empty" ? "empty" : "demo" });
}
