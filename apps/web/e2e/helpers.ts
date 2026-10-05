import { expect, type BrowserContext, type Page } from "@playwright/test";
import { generateSync } from "otplib";
import pg from "pg";

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
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query<T>(query, params)).rows;
  } finally {
    await client.end();
  }
}

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
  await page.getByRole("button", { name: "Ieșire" }).click();
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
