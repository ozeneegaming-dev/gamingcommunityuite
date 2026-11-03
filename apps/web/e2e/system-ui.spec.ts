import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { clearThemeCache } from "./cockpit-fixtures";
import { fixture, forumTree, member, topicWithReplies, typeInEditor, uid } from "./forum-fixtures";
import { enterAcpAsRoot, resetSetting, sql, userId, useFreshIp } from "./helpers";

/**
 * SYSTEM UI (specul system-ui, 2026-10-16): funcțiile sunt ale sistemului, temele schimbă doar aspectul. Matricea:
 * tema „Clasic” (designul clasic, antetul „Clasic”), „GCS Dark” (implicită, antetul „Standard”) și o temă importată
 * dintr-un pachet (designul clasic, antetul „Cockpit”) × desktop și 375 px: panourile notificărilor, mesajelor,
 * „Creează”, contului și căutării se deschid cu date live și se închid (Escape, click în afară), mega meniul, bara de jos
 * de pe mobil, consola pornită / oprită, coloanele subsolului, tooltip-ul, sugestiile de mențiuni și hover card-ul.
 * Apoi comutatorul lună / soare: perechea GCS Dark ↔ GCS White, pentru un membru și pentru un vizitator.
 * Capturile: `GCS_E2E_SHOTS=<folder>`.
 */
const SHOTS = process.env.GCS_E2E_SHOTS ?? "";
const CLASSIC = "e2e-sys-clasic";
const PACKAGE = "e2e-sys-pachet";

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

/** Un membru creat direct în bază (autorul conținutului, fără browser). */
async function otherMember(name: string, email: string): Promise<void> {
  await sql(
    `INSERT INTO users (id, name, "nameNormalized", email, "primaryGroupId", "updatedAt") VALUES ($1, $2, $3, $4, (SELECT id FROM groups WHERE key = 'member'), now())`,
    [`e2esys${Math.random().toString(36).slice(2, 10)}`, name, name.toLowerCase(), email],
  );
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  // Tema „Clasic” (designul de până acum), cu consola pornită și bara de jos pe mobil.
  await sql(
    `INSERT INTO themes (key, name, "isDefault", enabled, settings, "updatedAt") VALUES ($1, 'Clasic E2E', false, true, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET enabled = true, settings = EXCLUDED.settings, "updatedAt" = now()`,
    [CLASSIC, JSON.stringify({ preset: "classic", cockpit: { enabled: true }, mobileNav: { placement: "bottom" } })],
  );
  // O temă importată din pachet (ACP → Aspect → Teme → Importă): designul clasic, antetul Cockpit, consola pornită.
  const { headerPreset } = await import("@gcs/core/themes");
  const pkg = {
    format: "gcs-theme",
    version: 1,
    key: PACKAGE,
    name: "Pachet E2E",
    settings: { preset: "classic", dark: { accent: "#8B5CF6" }, header: { layout: headerPreset("cockpit") }, cockpit: { enabled: true }, mobileNav: { placement: "bottom" } },
    cssFiles: [{ name: "pachet.css", content: ".gcs-card { outline: 1px solid color-mix(in srgb, var(--gcs-accent) 30%, transparent); }" }],
  };
  const context = await browser.newContext();
  await useFreshIp(context, "100.93.0");
  const page = await context.newPage();
  const id = uid();
  await enterAcpAsRoot(page, `SysRoot${id}`, `sys-root-${id}@example.com`);
  await page.goto("/admin/appearance/themes");
  await page.getByTestId("gcs-acp-theme-import-file").setInputFiles({ name: `${PACKAGE}.gcs-theme.json`, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(pkg)) });
  await page.getByRole("button", { name: "Importă tema" }).click();
  await expect(page.getByTestId("gcs-acp-theme").filter({ has: page.getByRole("heading", { name: "Pachet E2E" }) })).toBeVisible();
  await context.close();
  await sql(`UPDATE themes SET enabled = true WHERE key = $1`, [PACKAGE]);
  await clearThemeCache();
});

test.afterAll(async () => {
  await sql(`DELETE FROM themes WHERE key IN ($1, $2)`, [CLASSIC, PACKAGE]);
  await clearThemeCache();
});

type Theme = { key: string; label: string; cockpit: boolean; create: boolean; bar: boolean };
const THEMES: Theme[] = [
  { key: CLASSIC, label: "clasic", cockpit: true, create: false, bar: true },
  { key: "gcs-dark", label: "gcs-dark", cockpit: false, create: false, bar: false },
  { key: PACKAGE, label: "pachet", cockpit: true, create: true, bar: true },
];

/** Membrul A (în browser, cu tema aleasă), cu o notificare și un mesaj privat de la B, plus un topic al lui B. */
async function setup(browser: Browser, theme: Theme, ip: string, width: number) {
  const id = uid();
  const context = await browser.newContext();
  await useFreshIp(context, ip);
  const url = new URL(test.info().project.use.baseURL ?? "http://localhost:3100");
  await context.addCookies([{ name: "gcs-skin", value: theme.key, domain: url.hostname, path: "/" }]);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1366, height: 900 });
  const a = `sys-a-${id}@example.com`;
  const b = `sys-b-${id}@example.com`;
  const bName = `Bogdan${id}`;
  await member(page, `Ana${id}`, a);
  await otherMember(bName, b);
  const request = page.request;
  const { forum } = await forumTree(request);
  const topic = await topicWithReplies(request, forum.id, b, `Sistem ${id}`);
  await sql(`INSERT INTO follows ("userId", "contentType", "contentId") VALUES ($1, 'topic', $2) ON CONFLICT DO NOTHING`, [await userId(a), String(topic.topicId)]);
  await fixture(request, { action: "reply", topicId: topic.topicId, text: "Un răspuns pentru clopoțel", authorEmail: b });
  await fixture(request, { action: "pm", fromEmail: b, toEmail: a, title: `Salut ${id}`, text: "Un mesaj pentru panou" });
  await page.setViewportSize({ width, height: width < 400 ? 812 : 900 });
  return { page, context, id, bName, topic };
}

/** Un click în afara panourilor (colțul de jos al paginii). */
const clickOutside = (page: Page) => page.mouse.click(5, (page.viewportSize()?.height ?? 800) - 5);

for (const theme of THEMES) {
  test(`${theme.label}, desktop: panourile antetului, mega meniul, consola, subsolul, tooltip-ul, mențiunile, hover card-ul`, async ({ browser }) => {
    test.setTimeout(240_000);
    const { page, context, id, bName, topic } = await setup(browser, theme, `100.93.${THEMES.indexOf(theme) + 1}`, 1366);
    await page.goto("/");
    await expect(page.locator('link[rel="stylesheet"][href*="gcs-theme.css"]')).toHaveAttribute("href", new RegExp(`t=${theme.key}`));
    await expect(page.getByTestId("gcs-header-builder")).toBeVisible();
    await shot(page, `${theme.label}-desktop-home`);

    // Notificările: clopoțelul cu numărul live, panoul cu notificarea; Escape îl închide.
    await expect(page.getByTestId("gcs-header-bell-count")).toHaveText(/^[1-9]/);
    await page.getByTestId("gcs-header-bell").click();
    const notif = page.getByTestId("gcs-notif-panel");
    await expect(notif).toBeVisible();
    await expect(notif.getByRole("link", { name: new RegExp(`${bName} a răspuns`) })).toBeVisible();
    await shot(page, `${theme.label}-desktop-notifications`);
    await page.keyboard.press("Escape");
    await expect(notif).toBeHidden();

    // Mesajele: panoul cu ultimele conversații (conversația lui B, necitită); click în afară îl închide.
    await expect(page.getByTestId("gcs-header-unread")).toHaveText("1");
    await page.getByTestId("gcs-header-messages").click();
    const messages = page.getByTestId("gcs-messages-panel");
    await expect(messages).toBeVisible();
    await expect(messages.getByTestId("gcs-messages-item")).toContainText(`Salut ${id}`);
    await shot(page, `${theme.label}-desktop-messages`);
    await clickOutside(page);
    await expect(messages).toBeHidden();

    // „Creează” (unde e pus în antet): meniul după aplicații; Escape îl închide.
    if (theme.create) {
      await page.getByTestId("gcs-create-open").filter({ visible: true }).click();
      const create = page.getByTestId("gcs-create-menu");
      await expect(create).toBeVisible();
      await expect(create.getByRole("menuitem").first()).toBeVisible();
      await shot(page, `${theme.label}-desktop-create`);
      await page.keyboard.press("Escape");
      await expect(create).toBeHidden();
    }

    // Contul: cardul de rang și secțiunile; Escape îl închide.
    await page.getByTestId("gcs-user-menu").click();
    const account = page.getByTestId("gcs-account-menu");
    await expect(account).toBeVisible();
    await expect(account.getByTestId("gcs-account-section-content")).toBeVisible();
    await shot(page, `${theme.label}-desktop-account`);
    await page.keyboard.press("Escape");
    await expect(account).toBeHidden();

    // Căutarea: panoul cu câmpul; Escape îl închide.
    await page.getByTestId("gcs-search-open").filter({ visible: true }).first().click();
    const search = page.getByTestId("gcs-search-panel");
    await expect(search).toBeVisible();
    await expect(page.getByTestId("gcs-search-input")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(search).toBeHidden();

    // Mega meniul: primul item cu submeniu de pe bară (Servere / Membri) se deschide și se închide.
    const nav = page.getByTestId("gcs-hb-nav");
    await expect(nav).toHaveAttribute("data-ready", "");
    const trigger = nav.locator('[data-testid^="gcs-nav-menu-"]').filter({ visible: true }).first();
    const name = (await trigger.innerText()).trim();
    await trigger.click();
    const mega = page.getByRole("menu", { name });
    await expect(mega).toBeVisible();
    await expect(mega.getByRole("menuitem").first()).toBeVisible();
    // Panoul (în orice temă): în ecran, cu săgeata de sus deasupra butonului care l-a deschis.
    await mega.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => null))));
    const megaBox = (await mega.boundingBox())!;
    expect(megaBox.x).toBeGreaterThanOrEqual(0);
    expect(megaBox.x + megaBox.width).toBeLessThanOrEqual(1366);
    const arrowBox = await mega.getByTestId("gcs-mega-arrow").boundingBox();
    if (arrowBox) {
      const triggerBox = (await trigger.boundingBox())!;
      expect(arrowBox.x + arrowBox.width / 2).toBeGreaterThanOrEqual(triggerBox.x);
      expect(arrowBox.x + arrowBox.width / 2).toBeLessThanOrEqual(triggerBox.x + triggerBox.width);
    }
    await shot(page, `${theme.label}-desktop-mega`);
    await page.keyboard.press("Escape");
    await expect(mega).toBeHidden();

    // Consola de sub antet: pornită în temă → apare, oprită → lipsește (orice design).
    if (theme.cockpit) await expect(page.getByTestId("gcs-cockpit")).toBeVisible();
    else await expect(page.getByTestId("gcs-cockpit")).toHaveCount(0);

    // Subsolul: coloanele implicite.
    const footer = page.getByTestId("gcs-site-footer");
    await expect(footer.getByTestId("gcs-footer-column")).toHaveCount(3);
    await footer.scrollIntoViewIfNeeded();
    await shot(page, `${theme.label}-desktop-footer`);

    // Tooltip-ul (componenta comună): pastila unui grup din legendă.
    const pill = page.locator('[data-widget="core.statsPanel"] [data-testid="gcs-legend"]:visible a.gcs-legend__pill').first();
    await pill.hover();
    await expect(page.locator(".gcs-tooltip").filter({ visible: true }).first()).toContainText(/membr/);

    // Mențiunile: sugestiile din editorul răspunsului; hover card-ul pe numele autorului.
    await page.goto(topic.url);
    await typeInEditor(page, "Salut ");
    // Un prefix unic (alte specuri creează multe conturi „Bogdan…”; lista arată primele 10 în ordine alfabetică).
    await page.keyboard.type(`@${bName.slice(0, -2)}`);
    const option = page.locator(".gcs-mentionList").getByRole("option").filter({ hasText: `@${bName}` });
    await expect(option).toBeVisible();
    await shot(page, `${theme.label}-desktop-mention`);
    await page.keyboard.press("Escape");
    const author = page.getByTestId("gcs-post").first().locator(".gcs-post__authorName a");
    const card = page.locator(".gcs-hoverCardLayer").getByTestId("gcs-hover-card");
    await expect(async () => {
      await page.mouse.move(0, 0);
      await author.hover();
      await expect(card).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 20_000 });
    await shot(page, `${theme.label}-desktop-hovercard`);
    await context.close();
  });

  test(`${theme.label}, 375 px: antetul încape, panourile se deschid, bara de jos sau sertarul`, async ({ browser }) => {
    test.setTimeout(180_000);
    const { page, context } = await setup(browser, theme, `100.93.${THEMES.indexOf(theme) + 11}`, 375);
    await page.goto("/");
    await expect(page.getByTestId("gcs-header-builder")).toHaveAttribute("data-device", "mobile");
    // Fără scroll orizontal la 375 px.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await shot(page, `${theme.label}-375-home`);

    // Contul: panoul pe toată lățimea; click în afară îl închide.
    await page.getByTestId("gcs-user-menu").click();
    const account = page.getByTestId("gcs-account-menu");
    await expect(account).toBeVisible();
    await shot(page, `${theme.label}-375-account`);
    await page.keyboard.press("Escape");
    await expect(account).toBeHidden();

    if (theme.bar) {
      // Bara de jos (orice temă, din setările temei): „Creează” deschide meniul, Mesaje duce la mesaje.
      const bar = page.getByTestId("gcs-mobile-bar");
      await expect(bar).toBeVisible();
      await bar.getByTestId("gcs-mobile-bar-create").click();
      const create = page.getByTestId("gcs-create-menu");
      await expect(create).toBeVisible();
      await shot(page, `${theme.label}-375-bar-create`);
      await page.keyboard.press("Escape");
      await expect(create).toBeHidden();
      await bar.getByTestId("gcs-mobile-bar-messages").click();
      await expect(page).toHaveURL(/\/messages/);
    } else {
      // Iconițele în antet: notificările se deschid; sertarul duce la pagini.
      await page.getByTestId("gcs-header-bell").click();
      await expect(page.getByTestId("gcs-notif-panel")).toBeVisible();
      await page.keyboard.press("Escape");
      await page.getByTestId("gcs-mobile-nav").click();
      const drawer = page.getByRole("dialog", { name: "Principal" });
      await expect(drawer).toBeVisible();
      await shot(page, `${theme.label}-375-drawer`);
      await drawer.getByRole("button", { name: "Membri" }).click();
      await drawer.getByRole("link", { name: "Toți membrii" }).click();
      await expect(page).toHaveURL(/\/members$/);
    }
    await context.close();
  });
}

test("comutatorul lună / soare: membrul trece GCS Dark ↔ GCS White (preferința îl urmează); vizitatorul la fel (cookie)", async ({ browser }) => {
  test.setTimeout(180_000);
  const id = uid();
  const context = await browser.newContext();
  await useFreshIp(context, "100.93.30");
  const page = await context.newPage();
  await page.setViewportSize({ width: 1366, height: 900 });
  const email = `sys-toggle-${id}@example.com`;
  await member(page, `Comuta${id}`, email);
  await page.goto("/");
  const toggle = page.getByTestId("gcs-header-theme");
  await expect(page.locator('link[rel="stylesheet"][href*="gcs-theme.css"]')).toHaveAttribute("href", /t=gcs-dark/);
  await expect(toggle).toHaveAttribute("data-side", "dark");
  await toggle.hover();
  await expect(page.locator(".gcs-tooltip").filter({ visible: true }).first()).toContainText(/luminoas/i);
  await shot(page, "toggle-member-dark");
  await toggle.click();
  await expect(page.locator('link[rel="stylesheet"][href*="gcs-theme.css"]')).toHaveAttribute("href", /t=gcs-white/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByTestId("gcs-header-theme")).toHaveAttribute("data-side", "light");
  await shot(page, "toggle-member-light");
  const [row] = await sql<{ prefs: { skin?: string } }>(`SELECT prefs FROM users WHERE email = $1`, [email]);
  expect(row!.prefs.skin).toBe("gcs-white");
  // Pe alt dispozitiv (fără cookie), preferința membrului alege tema.
  await context.clearCookies({ name: "gcs-skin" });
  await page.reload();
  await expect(page.locator('link[rel="stylesheet"][href*="gcs-theme.css"]')).toHaveAttribute("href", /t=gcs-white/);
  // Meniul contului: luna duce înapoi la GCS Dark.
  await page.getByTestId("gcs-user-menu").click();
  await page.getByTestId("gcs-account-theme-dark").click();
  await expect(page.locator('link[rel="stylesheet"][href*="gcs-theme.css"]')).toHaveAttribute("href", /t=gcs-dark/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await context.close();

  // Vizitatorul: cookie-ul păstrează alegerea.
  const guestContext = await browser.newContext();
  await useFreshIp(guestContext, "100.93.31");
  const guest = await guestContext.newPage();
  await guest.setViewportSize({ width: 1366, height: 900 });
  await guest.goto("/");
  await guest.getByTestId("gcs-header-theme").click();
  await expect(guest.locator('link[rel="stylesheet"][href*="gcs-theme.css"]')).toHaveAttribute("href", /t=gcs-white/);
  await guest.reload();
  await expect(guest.locator("html")).toHaveAttribute("data-theme", "light");
  expect((await guestContext.cookies()).find((c) => c.name === "gcs-skin")?.value).toBe("gcs-white");
  await shot(guest, "toggle-guest-light");
  await guestContext.close();
});

test("ACP → Aspect → Teme: perechea oprită ascunde comutatorul; o pereche aleasă (Clasic ↔ GCS White) îl readuce", async ({ browser }) => {
  test.setTimeout(180_000);
  const id = uid();
  const context = await browser.newContext();
  await useFreshIp(context, "100.93.40");
  const page = await context.newPage();
  await page.setViewportSize({ width: 1366, height: 900 });
  await enterAcpAsRoot(page, `SysPair${id}`, `sys-pair-${id}@example.com`);
  await page.goto("/admin/appearance/themes");
  const card = page.getByTestId("gcs-acp-theme-toggle");
  await expect(card.getByTestId("gcs-acp-theme-toggle-dark")).toHaveValue("gcs-dark");
  await expect(card.getByTestId("gcs-acp-theme-toggle-light")).toHaveValue("gcs-white");
  await shot(page, "toggle-acp");
  // Aceeași temă de două ori: eroare, nimic salvat.
  await card.getByTestId("gcs-acp-theme-toggle-light").selectOption("gcs-dark");
  await card.getByRole("button", { name: "Salvează" }).click();
  await expect(card.getByText("Alege două teme diferite.")).toBeVisible();
  // Oprit: comutatorul dispare din antet.
  await card.getByTestId("gcs-acp-theme-toggle-light").selectOption("gcs-white");
  await card.getByTestId("gcs-acp-theme-toggle-enabled").uncheck();
  await card.getByRole("button", { name: "Salvează" }).click();
  await expect(card.getByText("Salvat")).toBeVisible();
  await page.goto("/");
  await expect(page.getByTestId("gcs-header-builder")).toBeVisible();
  await expect(page.getByTestId("gcs-header-theme")).toHaveCount(0);
  // Clasic ↔ GCS White: pe tema clasică (întunecată) soarele duce la GCS White.
  await page.goto("/admin/appearance/themes");
  await card.getByTestId("gcs-acp-theme-toggle-enabled").check();
  await card.getByTestId("gcs-acp-theme-toggle-dark").selectOption(CLASSIC);
  await card.getByRole("button", { name: "Salvează" }).click();
  await expect(card.getByText("Salvat")).toBeVisible();
  // Root e pe GCS Dark (în afara perechii, întunecată): soarele duce la GCS White, apoi luna la tema clasică.
  await page.goto("/");
  await page.getByTestId("gcs-user-menu").click();
  await page.getByTestId("gcs-account-theme-light").click();
  await expect(page.locator('link[rel="stylesheet"][href*="gcs-theme.css"]')).toHaveAttribute("href", /t=gcs-white/);
  await page.getByTestId("gcs-user-menu").click();
  await page.getByTestId("gcs-account-theme-dark").click();
  await expect(page.locator('link[rel="stylesheet"][href*="gcs-theme.css"]')).toHaveAttribute("href", new RegExp(`t=${CLASSIC}`));
  await resetSetting("themes.toggle");
  await sql(`UPDATE users SET prefs = prefs - 'skin' WHERE email = $1`, [`sys-pair-${id}@example.com`]);
  await context.close();
});
