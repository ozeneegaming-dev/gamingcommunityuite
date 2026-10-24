import { e2eDb } from "./db";
import { e2eKv } from "./kv";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { generateSync } from "otplib";

export const PASSWORD = "parola-sigura-123";

let ipCounter = 0;
/** Un IP unic per context (X-Forwarded-For), ca rate limit-ul pe IP să nu se adune între teste. */
export async function useFreshIp(context: BrowserContext, prefix = "198.51.100"): Promise<string> {
  ipCounter++;
  const ip = `${prefix}.${(ipCounter % 250) + 1}`;
  await context.setExtraHTTPHeaders({ "x-forwarded-for": ip });
  return ip;
}

/** Interogări directe în baza E2E (`DATABASE_URL`, setat de `e2e/run.mts`). */
export async function sql<T extends Record<string, unknown> = Record<string, unknown>>(
  query: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = await e2eDb(process.env.DATABASE_URL);
  try {
    return (await client.query<T>(query, params)).rows;
  } finally {
    await client.end();
  }
}

/** Ziua de azi după fusul site-ului (`YYYY-MM-DD`, Europe/Bucharest): calculată aici, portabil pe ambele baze. */
export function siteDay(at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** Pe MySQL (ediția Lite) pluginurile cu bază de date proprie nu sunt suportate: specurile lor rulează doar pe PostgreSQL. */
export const onMysql = /^mysql:\/\//i.test(process.env.DATABASE_URL ?? "");

/** Mută userul în grupul dat (ca grup principal) și invalidează cache-ul de permisiuni. */
export async function setPrimaryGroup(email: string, groupKey: string): Promise<void> {
  await sql(`UPDATE users SET "primaryGroupId" = (SELECT id FROM groups WHERE key = $2) WHERE email = $1`, [email, groupKey]);
  await sql(`UPDATE system_state SET "permVersion" = "permVersion" + 1 WHERE id = 1`);
}

/** Eroarea afișată în formular (Next.js mai are un `role="alert"` pentru anunțarea rutelor). */
export const formAlert = (page: Page) => page.locator("form [role=alert]");

export async function register(page: Page, name: string, email: string, password = PASSWORD): Promise<void> {
  await page.goto("/register");
  await page.getByLabel("Nume de utilizator").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Parolă").fill(password);
  await page.getByRole("button", { name: "Creează cont" }).click();
}

export async function login(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Parolă").fill(password);
  // Așteptăm răspunsul serverului: mesajul de eroare poate fi identic cu cel de la încercarea anterioară.
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/auth/sign-in/email")),
    page.getByRole("button", { name: "Intră în cont" }).click(),
  ]);
}

/** Ieșire din cont: așteptăm reîncărcarea paginii, ca navigările următoare să nu se suprapună cu ea. */
export async function logout(page: Page): Promise<void> {
  await page.getByTestId("gcs-user-menu").click();
  await page.getByTestId("gcs-menu-logout").click();
  await expect(page.getByRole("link", { name: "Autentificare" })).toBeVisible();
}

/** Codul TOTP curent pentru cheia afișată la activarea 2FA. */
export const totp = (secret: string) => generateSync({ secret });

/** Un Root Admin complet intrat în ACP (vezi `enterAcp`). */
export function enterAcpAsRoot(page: Page, name: string, email: string): Promise<string> {
  return enterAcp(page, name, email, "root_admin");
}

/**
 * Un user complet intrat în ACP: înregistrare, mutarea în grupul dat, activarea 2FA și reautentificarea.
 * Întoarce cheia TOTP, pentru reautentificări ulterioare.
 */
export async function enterAcp(page: Page, name: string, email: string, groupKey: string): Promise<string> {
  await register(page, name, email);
  await expect(page.getByTestId("gcs-header-user")).toHaveText(name);
  await setPrimaryGroup(email, groupKey);

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/2fa-setup$/);
  await page.getByLabel("Parola contului").fill(PASSWORD);
  await page.getByRole("button", { name: "Continuă" }).click();
  const secret = (await page.getByTestId("gcs-totp-secret").textContent())?.trim() ?? "";
  await page.getByLabel("Codul din aplicație").fill(totp(secret));
  await page.getByRole("button", { name: "Activează 2FA" }).click();

  await expect(page).toHaveURL(/\/admin\/reauth$/);
  await page.getByLabel("Parolă").fill(PASSWORD);
  await page.getByLabel("Cod 2FA").fill(totp(secret));
  await page.getByRole("button", { name: "Intră în ACP" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  return secret;
}

/** Id-ul unui user după email. */
export async function userId(email: string): Promise<string> {
  const rows = await sql<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
  return rows[0]!.id;
}

/** Id-ul unui grup după cheie. */
export async function groupId(key: string): Promise<number> {
  const rows = await sql<{ id: number }>(`SELECT id FROM groups WHERE key = $1`, [key]);
  return rows[0]!.id;
}

/**
 * Readuce o setare la valoarea implicită: o șterge din baza E2E și golește cache-ul de setări din Redis
 * (`REDIS_URL`, setat de `e2e/run.mts`), ca testele următoare să nu fie afectate.
 */
export async function resetSetting(key: string): Promise<void> {
  await sql(`DELETE FROM settings WHERE key = $1`, [key]);
  await clearSettingsCache();
}

/** Scrie o setare direct în baza E2E (fără validarea din ACP) și golește cache-ul de setări; se readuce cu `resetSetting`. */
export async function setSetting(key: string, value: unknown): Promise<void> {
  await sql(`INSERT INTO settings (key, value, "updatedAt") VALUES ($1, $2::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now()`, [key, JSON.stringify(value)]);
  await clearSettingsCache();
}

/**
 * Lista serverelor de joc e în cache (Redis, `servers:list`): un server adăugat direct în bază (fixture) apare pe paginile
 * publice doar după ștergerea ei (altfel, dacă un spec anterior a umplut cache-ul, serverul nou lipsește → 404).
 */
export async function clearServersCache(): Promise<void> {
  const redis = await e2eKv();
  try {
    await redis.del("gcs:k:servers:list");
  } finally {
    redis.disconnect();
  }
}

async function clearSettingsCache(): Promise<void> {
  const redis = await e2eKv();
  try {
    const keys = await redis.keys("gcs:k:setting*");
    if (keys.length > 0) await redis.del(...keys);
  } finally {
    redis.disconnect();
  }
}
