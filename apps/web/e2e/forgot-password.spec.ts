import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { uid } from "./forum-fixtures";
import { formAlert, login, logout, onMysql, PASSWORD, register, resetSetting, setSetting, sql, useFreshIp } from "./helpers";

/**
 * „Am uitat parola”: cererea (același mesaj neutru pentru orice date), emailul cu linkul de unică folosință, parola nouă
 * (politica verificată pe server), linkul folosit / expirat, emailul neconfigurat și funcția oprită din ACP.
 * Capturile: `GCS_SHOTS_DIR=<folder>` (pe MySQL, cu sufixul `-mysql`).
 */
const SHOTS = process.env.GCS_SHOTS_DIR ?? "";
async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, `${name}${onMysql ? "-mysql" : ""}.png`) });
}

type Mail = { to: string; subject: string; html: string };
const NEW_PASSWORD = "parola-noua-789";

/** Emailurile trimise în E2E (outbox-ul de test), cele mai noi întâi. */
async function outbox(request: APIRequestContext): Promise<Mail[]> {
  const res = await request.post("/api/_test/profile", { data: { action: "outbox" } });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as Mail[];
}

/** Emailul pleacă după răspuns: îl așteptăm în outbox (cel mai nou pentru adresă și subiect). */
async function waitForMail(request: APIRequestContext, to: string, subject: RegExp): Promise<Mail> {
  let found: Mail | undefined;
  await expect
    .poll(async () => {
      found = (await outbox(request)).find((m) => m.to === to && subject.test(m.subject));
      return found !== undefined;
    })
    .toBe(true);
  return found!;
}

/** Primul link al emailului e cel din conținut (antetul învelișului e text); `&` poate ieși `&#38;` sau `&amp;`. */
function firstLink(mail: Mail): string {
  const link = /href="([^"]+)"/.exec(mail.html)![1]!.replace(/&(?:#38|amp);/g, "&");
  const url = new URL(link);
  return url.pathname + url.search;
}

async function requestReset(page: Page, identifier: string): Promise<void> {
  await page.goto("/forgot-password");
  await page.getByLabel("Email sau nume de utilizator").fill(identifier);
  await page.getByRole("button", { name: "Trimite linkul de resetare" }).click();
  await expect(page.getByTestId("gcs-forgot-sent")).toHaveText(
    "Dacă există un cont cu aceste date, ți-am trimis un email cu un link pentru resetarea parolei. Linkul e valabil 30 de minute; verifică și folderul Spam.",
  );
}

/** Un membru înregistrat, apoi ieșit din cont (resetarea e pentru cine nu poate intra). */
async function memberOut(page: Page, name: string, email: string): Promise<void> {
  await register(page, name, email);
  await expect(page.getByTestId("gcs-header-user")).toHaveText(name);
  await logout(page);
}

test.beforeEach(async ({ context }) => {
  await useFreshIp(context, "192.0.2");
  // Emailul configurat (ACP → Setări → Email); în E2E emailurile ajung în outbox-ul de test, nu la un server SMTP.
  await setSetting("email.smtp_host", "smtp.example.com");
  await setSetting("email.from", "noreply@example.com");
});

test.afterEach(async () => {
  await resetSetting("email.smtp_host");
  await resetSetting("email.from");
  await resetSetting("auth.password_reset_enabled");
});

test("din login: cererea, emailul, parola nouă (politica întâi), apoi vechea parolă nu mai merge și cea nouă da", async ({ page, request }) => {
  const id = uid();
  const email = `uituc-${id}@example.com`;
  await memberOut(page, `Uituc${id}`, email);

  await page.goto("/login");
  const forgot = page.getByTestId("gcs-login-forgot");
  await expect(forgot).toHaveText("Ai uitat parola?");
  await shot(page, "01-login-forgot-link");
  await forgot.click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await expect(page.getByRole("heading", { name: "Ai uitat parola?", level: 1 })).toBeVisible();
  await shot(page, "02-forgot-form");

  await page.getByLabel("Email sau nume de utilizator").fill(email.toUpperCase());
  await page.getByRole("button", { name: "Trimite linkul de resetare" }).click();
  await expect(page.getByTestId("gcs-forgot-sent")).toContainText("Dacă există un cont cu aceste date");
  await shot(page, "03-forgot-sent");

  const mail = await waitForMail(request, email, /^Resetarea parolei — /);
  expect(mail.html).toContain("Powered by GamingCommunitySuite");
  expect(mail.html).toContain("Linkul e valabil 30 de minute și merge o singură dată.");
  const link = firstLink(mail);
  expect(link).toMatch(/^\/reset-password\?token=[A-Za-z0-9_-]{43}$/);
  // Doar hash-ul tokenului e în baza de date.
  const token = new URLSearchParams(link.split("?")[1]).get("token")!;
  const rows = await sql<{ identifier: string }>(`SELECT identifier FROM verifications WHERE identifier LIKE 'password-reset:%' AND value = (SELECT id FROM users WHERE email = $1)`, [email]);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.identifier).not.toContain(token);
  if (SHOTS) {
    const view = await page.context().newPage();
    await view.setViewportSize({ width: 720, height: 900 });
    await view.setContent(mail.html);
    await shot(view, "04-email-link");
    await view.close();
  }

  const reset = await page.goto(link);
  expect(reset?.headers()["referrer-policy"]).toBe("no-referrer");
  await expect(page.getByRole("heading", { name: "Parolă nouă", level: 1 })).toBeVisible();
  await expect(page.getByText("Cel puțin 8 caractere, cu litere și cifre.")).toBeVisible();
  await shot(page, "05-reset-form");

  // Politica parolelor, verificată pe server (formularul nu o blochează în browser).
  await page.getByTestId("gcs-reset-password").fill("scurt1");
  await page.getByTestId("gcs-reset-confirm").fill("scurt1");
  await page.getByRole("button", { name: "Salvează parola" }).click();
  await expect(page.getByTestId("gcs-reset-form").getByRole("alert")).toHaveText("Parola trebuie să aibă cel puțin 8 caractere");
  await page.getByTestId("gcs-reset-password").fill("doarliteremulte");
  await page.getByTestId("gcs-reset-confirm").fill("doarliteremulte");
  await page.getByRole("button", { name: "Salvează parola" }).click();
  await expect(page.getByTestId("gcs-reset-form").getByRole("alert")).toHaveText("Parola trebuie să conțină și litere, și cifre");
  await shot(page, "06-reset-policy-error");
  await page.getByTestId("gcs-reset-password").fill(NEW_PASSWORD);
  await page.getByTestId("gcs-reset-confirm").fill(`${NEW_PASSWORD}x`);
  await page.getByRole("button", { name: "Salvează parola" }).click();
  await expect(page.getByTestId("gcs-reset-form").getByRole("alert")).toHaveText("Parolele nu coincid.");

  await page.getByTestId("gcs-reset-confirm").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Salvează parola" }).click();
  await expect(page).toHaveURL(/\/login\?reset=done$/);
  await expect(page.getByTestId("gcs-login-notice")).toHaveText("Parola a fost schimbată. Intră în cont cu parola nouă.");
  await shot(page, "07-login-reset-done");

  await login(page, email, PASSWORD);
  await expect(formAlert(page)).toHaveText("Email sau parolă incorectă");
  await login(page, email, NEW_PASSWORD);
  await expect(page.getByTestId("gcs-header-user")).toHaveText(`Uituc${id}`);

  const changed = await waitForMail(request, email, /^Parola a fost schimbată — /);
  expect(changed.html).toContain("toate sesiunile deschise ale contului au fost închise");
  const audit = await sql<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'auth.password_reset' AND "targetId" = (SELECT id FROM users WHERE email = $1)`, [email]);
  expect(Number(audit[0]!.n)).toBe(1);
});

test("un link folosit sau expirat: mesaj clar și linkul spre o cerere nouă", async ({ page, request }) => {
  const id = uid();
  const email = `link-${id}@example.com`;
  await memberOut(page, `Link${id}`, email);

  // Folosit o dată → a doua deschidere spune că nu mai e valabil.
  await requestReset(page, `Link${id}`);
  const used = firstLink(await waitForMail(request, email, /^Resetarea parolei — /));
  await page.goto(used);
  await page.getByTestId("gcs-reset-password").fill(NEW_PASSWORD);
  await page.getByTestId("gcs-reset-confirm").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Salvează parola" }).click();
  await expect(page).toHaveURL(/\/login\?reset=done$/);
  await page.goto(used);
  const invalid = page.getByTestId("gcs-reset-invalid");
  await expect(invalid.getByRole("alert")).toHaveText("Linkul de resetare nu mai e valabil: a expirat, a fost deja folosit sau a fost înlocuit de o cerere mai nouă.");
  await shot(page, "08-reset-link-used");
  await invalid.getByRole("link", { name: "Cere un link nou" }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);

  // Expirat cât timp formularul era deschis → la trimitere, același mesaj (parola nu se schimbă).
  await requestReset(page, email);
  await expect.poll(async () => (await outbox(request)).filter((m) => m.to === email && /^Resetarea parolei/.test(m.subject)).length).toBe(2);
  const fresh = firstLink((await outbox(request)).find((m) => m.to === email && /^Resetarea parolei/.test(m.subject))!);
  expect(fresh).not.toBe(used);
  await page.goto(fresh);
  await expect(page.getByTestId("gcs-reset-form")).toBeVisible();
  await sql(`UPDATE verifications SET "expiresAt" = $1 WHERE identifier LIKE 'password-reset:%' AND value = (SELECT id FROM users WHERE email = $2)`, [new Date("2020-01-01T00:00:00.000Z"), email]);
  await page.getByTestId("gcs-reset-password").fill("alta-parola-321");
  await page.getByTestId("gcs-reset-confirm").fill("alta-parola-321");
  await page.getByRole("button", { name: "Salvează parola" }).click();
  await expect(page.getByTestId("gcs-reset-invalid").getByRole("alert")).toContainText("Linkul de resetare nu mai e valabil");
  // Și deschis din nou, expirat.
  await page.goto(fresh);
  await expect(page.getByTestId("gcs-reset-invalid")).toBeVisible();
  await expect(page.getByTestId("gcs-reset-form")).toHaveCount(0);

  await page.goto("/login");
  await login(page, email, NEW_PASSWORD);
  await expect(page.getByTestId("gcs-header-user")).toHaveText(`Link${id}`);
});

test("un email sau un nume necunoscut primește exact același mesaj, fără niciun email", async ({ page, request }) => {
  const id = uid();
  const newest = JSON.stringify((await outbox(request))[0] ?? null);
  await requestReset(page, `nimeni-${id}@example.com`);
  await shot(page, "09-unknown-same-message");
  await requestReset(page, `Nimeni${id}`);
  // Răspunsul a plecat deja; emailurile (dacă ar exista) pleacă imediat după el.
  await page.waitForTimeout(1000);
  const mails = await outbox(request);
  expect(mails.filter((m) => m.to === `nimeni-${id}@example.com`)).toHaveLength(0);
  expect(JSON.stringify(mails[0] ?? null)).toBe(newest);
});

test("fără emailul configurat, pagina spune să contactezi echipa; oprită din ACP, linkul dispare din login", async ({ page }) => {
  await resetSetting("email.smtp_host");
  await page.goto("/forgot-password");
  const unavailable = page.getByTestId("gcs-reset-unavailable");
  await expect(unavailable.getByRole("status")).toHaveText(
    "Resetarea parolei prin email nu e disponibilă momentan: site-ul nu are configurată trimiterea emailurilor. Ca să-ți recuperezi contul, contactează echipa site-ului.",
  );
  await expect(unavailable.getByRole("link", { name: "Vezi echipa site-ului" })).toHaveAttribute("href", "/staff");
  await expect(page.getByLabel("Email sau nume de utilizator")).toHaveCount(0);
  await shot(page, "10-forgot-no-email");
  // Linkul din login rămâne (pagina explică ce e de făcut).
  await page.goto("/login");
  await expect(page.getByTestId("gcs-login-forgot")).toBeVisible();

  await setSetting("email.smtp_host", "smtp.example.com");
  await setSetting("auth.password_reset_enabled", false);
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Intră în cont" })).toBeVisible();
  await expect(page.getByTestId("gcs-login-forgot")).toHaveCount(0);
  await page.goto("/forgot-password");
  await expect(page.getByTestId("gcs-reset-unavailable").getByRole("status")).toHaveText(
    "Resetarea parolei prin email e oprită pe acest site. Ca să-ți recuperezi contul, contactează echipa site-ului.",
  );
});

test("pe un telefon (375 px): formularul încape, fără derulare orizontală", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 760 });
  await page.goto("/forgot-password");
  await expect(page.getByRole("button", { name: "Trimite linkul de resetare" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot(page, "11-forgot-375");
});
