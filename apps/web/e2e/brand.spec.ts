import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { member, uid } from "./forum-fixtures";
import { enterAcpAsRoot, sql, useFreshIp } from "./helpers";

/**
 * Brandul GCS (docs/BRAND.md, sursa `packages/core/src/themes/brand.ts`): ACP-ul e cromul produsului în ambele moduri,
 * oricare ar fi tema site-ului; forumul are tokenii brandului; emailurile pleacă prin învelișul de brand. Installer-ul
 * e verificat în `install.spec.ts`. Cu `GCS_SHOTS_DIR`, și capturile paginilor cheie (desktop și 375 px).
 */
const SHOTS = process.env.GCS_SHOTS_DIR;

async function shot(page: Page, name: string, full = false) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, `brand-${name}.png`), fullPage: full });
}

/** Valoarea calculată a unei variabile CSS, cu litere mici (build-ul minifică hex-urile). */
const cssVar = (el: Locator, name: string) => el.evaluate((node, n) => getComputedStyle(node).getPropertyValue(n).trim().toLowerCase(), name);

async function acpTheme(page: Page, value: "dark" | "light") {
  await page.context().addCookies([{ name: "gcs-acp-theme", value, url: page.url() }]);
  await page.reload();
}

async function profileFixture<T = unknown>(request: APIRequestContext, data: Record<string, unknown>): Promise<T> {
  const res = await request.post("/api/_test/profile", { data });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as T;
}

test("ACP-ul are brandul GCS: navy, accentul portocaliu, DM Sans, bara de iconițe închisă și în modul luminos", async ({ page, context }) => {
  test.setTimeout(120_000);
  await useFreshIp(context, "100.81.0");
  const id = uid();
  await enterAcpAsRoot(page, `Brand${id}`, `brand-${id}@example.com`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/admin");
  const acp = page.locator(".gcs-acp");
  await expect(acp).toHaveClass(/gcs-product/);

  await acpTheme(page, "dark");
  await expect(acp).toHaveCSS("background-color", "rgb(11, 15, 23)");
  await expect(page.locator(".gcs-acpRail").first()).toHaveCSS("background-color", "rgb(14, 18, 26)");
  expect(await cssVar(acp, "--gcs-accent")).toBe("#df390c");
  expect(await cssVar(acp, "--gcs-btn-primary-bg")).toBe("#cd340b");
  expect(await acp.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/DM[ _]Sans/);
  await shot(page, "acp-dashboard-dark");
  await page.goto("/admin/groups");
  await expect(page.getByRole("heading", { name: "Grupuri", level: 1 })).toBeVisible();
  await shot(page, "acp-groups-dark", true);

  await page.goto("/admin");
  await acpTheme(page, "light");
  await expect(acp).toHaveCSS("background-color", "rgb(241, 243, 247)");
  await expect(page.locator(".gcs-acpRail").first()).toHaveCSS("background-color", "rgb(14, 18, 26)");
  expect(await cssVar(acp, "--gcs-accentInk")).toBe("#c2300a");
  await shot(page, "acp-dashboard-light");

  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await shot(page, "acp-dashboard-light-375");
  await acpTheme(page, "dark");
  await shot(page, "acp-dashboard-dark-375");
  console.log(`[GCS] dashboard ACP la 375 px: ${await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)} px peste lățime`);
  // Fără defilare orizontală pe o pagină de listă (ca `acp-screens.spec.ts`).
  await page.goto("/admin/groups");
  await expect(page.getByRole("heading", { name: "Grupuri", level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test("forumul are tokenii brandului (tema implicită GCS Dark)", async ({ page, context }) => {
  await useFreshIp(context, "100.81.1");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const html = page.locator("html");
  expect(await cssVar(html, "--gcs-brand-accent")).toBe("#df390c");
  expect(await cssVar(html, "--gcs-danger")).not.toBe("");
  if (await html.evaluate((el) => el.classList.contains("gcs-nova"))) {
    expect(await cssVar(html, "--gcs-accent")).toBe("#df390c");
    // Avertismentul e chihlimbar, nu portocaliul mărcii.
    expect(await cssVar(html, "--gcs-warn")).toBe("#f2b33d");
  }
  await shot(page, "forum-home-dark", true);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await shot(page, "forum-home-375");
});

test("emailurile pleacă prin învelișul de brand, iar primul link rămâne cel din conținut", async ({ page, context, request }) => {
  await useFreshIp(context, "100.81.2");
  const id = uid();
  await member(page, `Mail${id}`, `mail-${id}@example.com`);
  await sql(`UPDATE users SET email = $2 WHERE email = $1`, [`mail-${id}@example.com`, `7656119${Date.now()}@steam.invalid`]);
  await page.goto("/");
  await page.getByTestId("gcs-steam-email-banner").getByRole("link").click();
  await page.getByLabel("Adresa nouă").fill(`mail2-${id}@example.com`);
  await page.getByRole("button", { name: "Trimite linkul de confirmare" }).click();
  await expect(page.getByTestId("gcs-settings-status").first()).toHaveText("Ți-am trimis un link de confirmare pe adresa nouă.");

  const mails = await profileFixture<{ to: string; subject: string; html: string }[]>(request, { action: "outbox" });
  const mail = mails.find((m) => m.to === `mail2-${id}@example.com`)!;
  expect(mail.html).toContain("Powered by GamingCommunitySuite");
  expect(mail.html).toContain("border-bottom:3px solid #DF390C");
  expect(mail.html).toContain(mail.subject);
  const link = /href="([^"]+)"/.exec(mail.html)![1]!.replace(/&(?:#38|amp);/g, "&");
  expect(new URL(link).pathname).not.toBe("/");

  if (SHOTS) {
    await page.setViewportSize({ width: 720, height: 900 });
    await page.setContent(mail.html);
    await shot(page, "email", true);
  }
});
