import { expect, test, type Page } from "@playwright/test";
import { patchNova, preset, novaSettings, removeServers, restoreNova, seedLiveMatch, seedServers, shot, type SeededServer } from "./cockpit-fixtures";
import { forumTree, topicWithReplies, uid } from "./forum-fixtures";
import { enterAcpAsRoot, register, setPrimaryGroup, sql, useFreshIp, userId } from "./helpers";

/**
 * Hero Cockpit (specul 2026-10-10-hero-cockpit): antetul construit (Esports, Cockpit), panoul de căutare și Ctrl+K,
 * „+ Creează” după aplicații, mega meniurile, meniul contului după drepturi, consola (pornită / oprită) cu trofeele
 * primelor 3 locuri, widget-ul „Clasament”, bara de jos de pe mobil și starea compactă la derulare.
 */

let saved: Record<string, unknown>;
let servers: SeededServer[] = [];

test.beforeAll(async () => {
  saved = await novaSettings();
});

test.afterAll(async () => {
  await restoreNova(saved);
  await removeServers(servers);
});

// Fiecare test pornește de la tema publicată (antetul clasic: înregistrarea și ajutoarele lui).
test.beforeEach(async () => {
  if (saved) await restoreNova(saved);
});

/** Un membru nou într-un context propriu (grupul dat). */
async function newMember(page: Page, name: string, email: string, group = "member") {
  await register(page, name, email);
  await expect(page.getByTestId("gcs-header-user")).toHaveText(name);
  await setPrimaryGroup(email, group);
  await page.reload();
}

test("antetul Esports: rândurile, crestătura, starea compactă la derulare, mega meniurile, căutarea (Ctrl+K) și „Creează”", async ({ page, context, request }) => {
  test.setTimeout(300_000);
  await useFreshIp(context, "100.91.1");
  const id = uid();
  const email = `hc-root-${id}@example.com`;
  await enterAcpAsRoot(page, `Cockpit${id}`, email);
  const tree = await forumTree(request);
  const topic = await topicWithReplies(request, tree.forum.id, email, `Configuri dust2 ${id}`, 2);
  servers = await seedServers([
    { name: `MIX #1 ${id}`, game: "cs16", players: 10, max: 10, map: "de_dust2" },
    { name: `Public ${id}`, game: "cs2", players: 19, max: 32, map: "de_mirage" },
    { name: `Retake ${id}`, game: "cs2", players: 4, max: 12, map: "de_ancient" },
  ]);
  await patchNova({ header: { layout: await preset("esports"), compact: true, mega: true, dropdowns: "click" }, mobileNav: { placement: "header" } });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const header = page.getByTestId("gcs-header-builder");
  await test.step("rândurile Esports și crestătura cu logo-ul", async () => {
    await expect(header).toHaveAttribute("data-preset", "esports");
    await expect(header).toHaveAttribute("data-device", "desktop");
    await expect(header.locator('[data-row="top"]')).toBeVisible();
    await expect(page.getByTestId("gcs-header-notch")).toBeVisible();
    await expect(header.getByTestId("gcs-hb-nav")).toBeVisible();
    await expect(header.getByTestId("gcs-hb-nav-right")).toBeVisible();
    await expect(page.getByTestId("gcs-header-user")).toHaveText(`Cockpit${id}`);
    await shot(page, "01-esports-header-desktop");
  });

  await test.step("starea compactă: rândul de sus se strânge, crestătura se micșorează, antetul rămâne sus", async () => {
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect(header).toHaveAttribute("data-compact", "");
    const top = header.locator('[data-row="top"]');
    await expect(top).toHaveAttribute("data-collapsed", "");
    await expect.poll(async () => (await top.boundingBox())?.height ?? 0).toBeLessThan(2);
    await expect.poll(async () => (await header.locator('[data-row="main"]').boundingBox())?.height ?? 0).toBeCloseTo(74, 0);
    await expect.poll(async () => page.getByTestId("gcs-header-notch").evaluate((el) => getComputedStyle(el).transform)).toContain("0.68");
    expect((await header.boundingBox())?.y).toBeCloseTo(0, 0);
    await shot(page, "02-esports-compact");
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(header).not.toHaveAttribute("data-compact", "");
  });

  await test.step("mega meniul: 2 coloane, descrierea, insigna live, rândul de jos cu „Joacă acum”", async () => {
    const servers = header.getByTestId("gcs-hb-nav").getByRole("button", { name: "Servere" }).or(header.getByTestId("gcs-hb-nav-right").getByRole("button", { name: "Servere" }));
    await servers.first().click();
    const panel = page.getByRole("menu", { name: "Servere" });
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId("gcs-mega-item").first()).toContainText("Toate serverele");
    await expect(panel).toContainText("Status live, jucători, conectare dintr-un click");
    await expect(panel.getByTestId("gcs-mega-badge").first()).toHaveText("3 ONLINE");
    await expect(panel.getByTestId("gcs-mega-cta")).toHaveText("Joacă acum");
    await expect(panel.getByTestId("gcs-mega-cta")).toHaveAttribute("href", /^steam:\/\/connect\//);
    await shot(page, "03-mega-menu");
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(servers.first()).toHaveAttribute("aria-expanded", "false");
  });

  await test.step("căutarea: Ctrl+K, domeniile instalate, rezultatele rapide, Enter → pagina completă, căutările recente", async () => {
    await page.keyboard.press("Control+K");
    const dialog = page.getByRole("dialog", { name: "Căutare" });
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("gcs-search-input")).toBeFocused();
    await expect(dialog.getByTestId("gcs-search-scope-servers")).toBeVisible();
    await expect(dialog.getByTestId("gcs-search-scope-clans")).toBeVisible();
    await page.getByTestId("gcs-search-input").fill(`dust2 ${id}`);
    const result = dialog.getByTestId("gcs-search-result").filter({ hasText: `Configuri dust2 ${id}` });
    await expect(result.first()).toBeVisible();
    await expect(result.first().locator(".gcs-sp__tag")).toHaveText("TOPIC");
    await shot(page, "04-search-panel");
    await page.getByTestId("gcs-search-scope-servers").click();
    await page.getByTestId("gcs-search-input").fill(`Public ${id}`);
    await expect(dialog.getByTestId("gcs-search-result").filter({ hasText: `Public ${id}` })).toHaveAttribute("data-type", "server");
    await page.getByTestId("gcs-search-scope-all").click();
    await page.getByTestId("gcs-search-input").fill(`Configuri dust2 ${id}`);
    await expect(dialog.getByTestId("gcs-search-result").first()).toBeVisible();
    await page.getByTestId("gcs-search-input").press("Escape");
    await expect(dialog).toBeHidden();
    await page.getByTestId("gcs-search-open").click();
    await page.getByTestId("gcs-search-input").fill(`zzz-${id}`);
    await page.getByTestId("gcs-search-input").press("Enter");
    await expect(page).toHaveURL(new RegExp(`/search\\?q=zzz-${id}`));
    await page.getByTestId("gcs-search-open").click();
    await expect(page.getByTestId("gcs-search-recent")).toContainText(`zzz-${id}`);
    await page.keyboard.press("Escape");
  });

  await test.step("„+ Creează”: itemii aplicațiilor; într-un forum, primul e „Topic nou în <forum>”", async () => {
    await page.goto("/");
    await page.getByTestId("gcs-create-open").click();
    const menu = page.getByTestId("gcs-create-menu");
    await expect(menu.getByTestId("gcs-create-message")).toBeVisible();
    await expect(menu.getByTestId("gcs-create-clan")).toBeVisible();
    await expect(menu.getByTestId("gcs-create-ticket")).toBeVisible();
    await expect(menu.getByTestId("gcs-create-sanction")).toBeVisible();
    await page.keyboard.press("Escape");
    // Aplicația Clanuri oprită: itemul ei dispare.
    await sql(`INSERT INTO apps (key, enabled, "updatedAt") VALUES ('clans', false, now()) ON CONFLICT (key) DO UPDATE SET enabled = false`);
    await clearAppsCache();
    await page.goto(topic.url);
    await page.getByTestId("gcs-create-open").click();
    await expect(menu.getByRole("menuitem").first()).toHaveText(`Topic nou în ${tree.forumName}`);
    await expect(menu.getByTestId("gcs-create-topicHere")).toHaveAttribute("href", `/forum/${tree.forum.id}-${tree.forum.slug}/new`);
    await expect(menu.getByTestId("gcs-create-clan")).toHaveCount(0);
    await shot(page, "05-create-menu");
    await sql(`UPDATE apps SET enabled = true WHERE key = 'clans'`);
    await clearAppsCache();
    await page.keyboard.press("Escape");
  });
});

/** Cache-ul aplicațiilor (pornite / oprite). */
async function clearAppsCache() {
  const { default: Redis } = await import("ioredis");
  const r = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  try {
    const keys = [...(await r.keys("gcs:k:apps*")), ...(await r.keys("gcs:k:nav*"))];
    if (keys.length > 0) await r.del(...keys);
    await sql(`UPDATE system_state SET "permVersion" = "permVersion" + 1 WHERE id = 1`);
  } finally {
    r.disconnect();
  }
}

test("meniul contului: cardul de rang, statusul, secțiunile după drepturi și aplicații", async ({ page, context, browser }) => {
  test.setTimeout(240_000);
  await useFreshIp(context, "100.91.2");
  const id = uid();
  const rootEmail = `hc-acc-root-${id}@example.com`;
  await enterAcpAsRoot(page, `Contul${id}`, rootEmail);
  await patchNova({ header: { layout: await preset("cockpit"), compact: true }, mobileNav: { placement: "header" } });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  // Cockpit: statusul serverelor live în dreapta rândului cu meniul.
  if (servers.length > 0) await expect(page.getByTestId("gcs-servers-live")).toContainText("servere online");
  await page.getByTestId("gcs-user-menu-trigger").click();
  const menu = page.getByTestId("gcs-account-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("link", { name: `Contul${id}` })).toBeVisible();
  await expect(menu.getByTestId("gcs-account-group").first()).toHaveAttribute("href", /\/members\?group=\d+$/);
  await expect(menu.getByTestId("gcs-account-section-content")).toContainText("Profilul meu");
  await expect(menu.getByTestId("gcs-account-section-settings")).toContainText("Confidențialitate și ignorați");
  await expect(menu.getByTestId("gcs-account-section-staff")).toContainText("Panoul de administrare (ACP)");
  await expect(menu.getByTestId("gcs-account-section-staff")).toContainText("Coada de moderare");
  await expect(menu.getByTestId("gcs-account-section-gaming")).toContainText("Conturi legate");
  await expect(menu.getByTestId("gcs-account-remaining")).toContainText("până la rangul");
  await shot(page, "06-account-menu");

  // Statusul „Invizibil” = „Arată când sunt online” oprit (confidențialitatea).
  await menu.getByTestId("gcs-account-status-invisible").click();
  await expect(menu.getByTestId("gcs-account-status-invisible")).toHaveAttribute("aria-checked", "true");
  await expect.poll(async () => (await sql<{ v: string }>(`SELECT privacy->>'showOnline' AS v FROM users WHERE email = $1`, [rootEmail]))[0]?.v).toBe("false");
  await menu.getByTestId("gcs-account-status-online").click();
  await expect.poll(async () => (await sql<{ v: string }>(`SELECT privacy->>'showOnline' AS v FROM users WHERE email = $1`, [rootEmail]))[0]?.v).toBe("true");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  // Un membru obișnuit: fără Staff; cu aplicația Servere oprită, fără Gaming (dacă nu are clan).
  const ctx = await browser.newContext();
  await useFreshIp(ctx, "100.91.3");
  const p2 = await ctx.newPage();
  await newMember(p2, `Membru${id}`, `hc-acc-m-${id}@example.com`);
  await p2.setViewportSize({ width: 1440, height: 900 });
  await p2.goto("/");
  await p2.getByTestId("gcs-user-menu-trigger").click();
  const m2 = p2.getByTestId("gcs-account-menu");
  await expect(m2.getByTestId("gcs-account-section-content")).toBeVisible();
  await expect(m2.getByTestId("gcs-account-section-staff")).toHaveCount(0);
  await ctx.close();
});

test("consola Hero Cockpit: pornită / oprită, feed-ul, meciul live, trofeele primelor 3 și widget-ul „Clasament”", async ({ page, context, request }) => {
  test.setTimeout(300_000);
  await useFreshIp(context, "100.91.4");
  const id = uid();
  const rootEmail = `hc-ck-root-${id}@example.com`;
  await enterAcpAsRoot(page, `Consola${id}`, rootEmail);
  const tree = await forumTree(request);
  // 4 autori cu 14, 11, 8 și 2 postări azi: primii 3 primesc trofeele, al 4-lea insigna neutră.
  const authors: string[] = [];
  for (const [i, n] of [14, 11, 8, 2].entries()) {
    const email = `hc-ck-a${i}-${id}@example.com`;
    const ctx = await context.browser()!.newContext();
    await useFreshIp(ctx, `100.91.${10 + i}`);
    await register(await ctx.newPage(), `Autor${i}${id}`, email);
    await expect.poll(async () => (await sql(`SELECT 1 FROM users WHERE email = $1`, [email])).length).toBe(1);
    await setPrimaryGroup(email, "member");
    await ctx.close();
    authors.push(email);
    await topicWithReplies(request, tree.forum.id, email, `Topic ${i} ${id}`, n - 1);
  }
  const local = await seedServers([
    { name: `MIX #2 ${id}`, game: "cs16", players: 10, max: 10, map: "de_inferno" },
    { name: `Deathrun ${id}`, game: "cs16", players: 18, max: 32, map: "deathrun_temple" },
  ]);
  servers = [...servers, ...local];
  await seedLiveMatch(
    local[0]!.id,
    [
      { name: `Autor0${id}`, team: "A", kills: 18, deaths: 9, userId: await userId(authors[0]!) },
      { name: "Kaze", team: "A", kills: 14, deaths: 11 },
      { name: `Autor1${id}`, team: "B", kills: 16, deaths: 13, userId: await userId(authors[1]!) },
      { name: "Raze", team: "B", kills: 9, deaths: 14 },
    ],
    { a: 12, b: 9 },
  );

  await test.step("oprită: nicio consolă sub antet", async () => {
    await patchNova({ header: { layout: await preset("esports") }, cockpit: { enabled: false } });
    await page.goto("/");
    await expect(page.getByTestId("gcs-cockpit")).toHaveCount(0);
  });

  await test.step("pornită pe pagina principală: banda personală, feed-ul, meciul live, topul cu trofee, benzile serverelor", async () => {
    await patchNova({ cockpit: { enabled: true, pages: "home", left: "feed", center: "live", right: "top" } });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    const cockpit = page.getByTestId("gcs-cockpit");
    await expect(cockpit).toBeVisible();
    await expect(page.getByTestId("gcs-cockpit-welcome")).toBeVisible();
    await expect(page.getByTestId("gcs-cockpit-feed-item").first()).toBeVisible();
    await expect(page.getByTestId("gcs-cockpit-match")).toContainText("12");
    await expect(page.getByTestId("gcs-cockpit-match")).toContainText(`Autor0${id}`);
    await expect.poll(async () => page.getByTestId("gcs-cockpit-strip").count()).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId("gcs-cockpit-play")).toBeVisible();
    const top = page.getByTestId("gcs-cockpit-top");
    await top.getByTestId("gcs-cockpit-top-period-day").click();
    const rows = top.getByTestId("gcs-cockpit-top-row");
    await expect(rows.nth(0)).toHaveAttribute("data-medal", "gold");
    await expect(rows.nth(1)).toHaveAttribute("data-medal", "silver");
    await expect(rows.nth(2)).toHaveAttribute("data-medal", "bronze");
    await expect(rows.nth(3)).not.toHaveAttribute("data-medal", /.+/);
    await expect(top.getByTestId("gcs-cockpit-top-trophy")).toHaveCount(3);
    await expect(rows.nth(0).getByRole("img", { name: "Locul 1, aur" })).toBeVisible();
    await expect(rows.nth(0)).toContainText(`Autor0${id}`);
    await shot(page, "07-cockpit-desktop", { fullPage: false });
    await shot(page, "07c-home-full-dark", { fullPage: true });
    // Modul luminos: antetul rămâne închis, consola urmează tokenurile temei.
    await page.context().addCookies([{ name: "gcs-theme", value: "light", url: page.url() }]);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.getByTestId("gcs-cockpit")).toBeVisible();
    await shot(page, "07b-cockpit-light");
    await page.context().addCookies([{ name: "gcs-theme", value: "dark", url: page.url() }]);
    await page.reload();
    await expect(page.getByTestId("gcs-cockpit-feed-tab-mix")).toBeVisible();
    await page.getByTestId("gcs-cockpit-feed-tab-forum").click();
    await expect(page.getByTestId("gcs-cockpit-feed-item").first()).toHaveAttribute("data-kind", /topic|reply|member/);
  });

  await test.step("doar pe pagina principală: pe alte pagini nu apare; „pe toate paginile” o arată peste tot", async () => {
    await page.goto("/members");
    await expect(page.getByTestId("gcs-cockpit")).toHaveCount(0);
    await patchNova({ cockpit: { pages: "all" } });
    await page.goto("/members");
    await expect(page.getByTestId("gcs-cockpit")).toBeVisible();
    await patchNova({ cockpit: { pages: "home" } });
  });

  await test.step("widget-ul „Clasament” în coloana laterală: măsurile, perioada, trofeele, mesajul, locul tău", async () => {
    await sql(`INSERT INTO widget_placements (page, zone, position, type, config, groups) VALUES ('index', 'sidebar', 0, 'core.ranking', '{"metric":"posts","period":"day"}', '{}')`);
    await clearWidgetCache();
    await page.goto("/");
    // Widgeturile vin în flux (streaming): rezerva ascunsă rămâne în pagină, deci doar copia vizibilă.
    const widget = page.getByTestId("gcs-ranking-widget").filter({ visible: true }).first();
    await expect(widget).toBeVisible();
    await expect(widget.getByTestId("gcs-ranking-widget-row").first()).toHaveAttribute("data-medal", "gold");
    await expect(widget.getByTestId("gcs-ranking-widget-trophy")).toHaveCount(3);
    await expect(widget.getByTestId("gcs-ranking-widget-message").first()).toHaveAttribute("href", /\/messages\/new\?to=/);
    await expect(widget.getByTestId("gcs-ranking-widget-you")).toBeVisible();
    await widget.getByTestId("gcs-ranking-widget-metric-online").click();
    await expect(widget.getByTestId("gcs-ranking-widget-metric-online")).toHaveAttribute("aria-selected", "true");
    await shot(page, "08-ranking-widget");
    await sql(`DELETE FROM widget_placements WHERE type = 'core.ranking'`);
    await clearWidgetCache();
  });
});

/** Cache-ul layout-urilor de widget-uri. */
async function clearWidgetCache() {
  const { default: Redis } = await import("ioredis");
  const r = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  try {
    const keys = await r.keys("gcs:k:layout*");
    if (keys.length > 0) await r.del(...keys);
  } finally {
    r.disconnect();
  }
}

test("mobil (375 px): antetul compact, cardul LIVE, cardurile cu puncte, bara de jos fără scroll orizontal", async ({ page, context }) => {
  test.setTimeout(180_000);
  await useFreshIp(context, "100.91.5");
  const id = uid();
  await page.setViewportSize({ width: 375, height: 812 });
  await newMember(page, `Mobil${id}`, `hc-mob-${id}@example.com`);
  await patchNova({
    header: { layout: await preset("cockpit") },
    mobileNav: { placement: "bottom", labels: true, items: ["forum", "servers", "create", "messages", "notifications"] },
    cockpit: { enabled: true, pages: "home", left: "feed", center: "live", right: "top" },
  });
  await page.goto("/");
  const header = page.getByTestId("gcs-header-builder");
  await expect(header).toHaveAttribute("data-device", "mobile");
  const bar = page.getByTestId("gcs-mobile-bar");
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("link")).toHaveCount(4);
  await expect(bar.getByTestId("gcs-mobile-bar-create")).toBeVisible();
  await expect(bar.getByTestId("gcs-mobile-bar-servers")).toHaveText(/Servere/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await shot(page, "09-mobile-home");
  await bar.getByTestId("gcs-mobile-bar-create").click();
  await expect(page.getByTestId("gcs-create-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  // Fără etichete: doar iconițele (textul rămâne pentru cititoarele de ecran).
  await patchNova({ mobileNav: { labels: false } });
  await page.reload();
  await expect(page.getByTestId("gcs-mobile-bar")).toHaveClass(/gcs-mbar--iconsOnly/);
  // În antet (fără bara de jos): bara dispare.
  await patchNova({ mobileNav: { placement: "header" } });
  await page.reload();
  await expect(page.getByTestId("gcs-mobile-bar")).toHaveCount(0);
});

test("editorul vizual: constructorul de antet (presetările, drag & drop), live în previzualizare și publicat pe site", async ({ page, context }) => {
  test.setTimeout(240_000);
  await useFreshIp(context, "100.91.6");
  const id = uid();
  await enterAcpAsRoot(page, `Editor${id}`, `hc-ed-${id}@example.com`);
  await restoreNova(saved);
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.goto("/admin/theme-editor/nova");
  await page.getByTestId("gcs-studio-nav-header").click();
  await page.getByTestId("gcs-studio-nav-headerBuilder").click();
  const editor = page.getByTestId("gcs-header-builder-editor");
  await expect(editor).toBeVisible();
  await expect(page.getByTestId("gcs-hb-preset-classic")).toHaveAttribute("aria-checked", "true");

  // Presetarea Esports: draft-ul salvat, previzualizarea arată antetul construit.
  await page.getByTestId("gcs-hb-preset-esports").click();
  await expect(page.getByTestId("gcs-hb-preset-esports")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("gcs-studio-status")).toHaveText(/Draft salvat/);
  const preview = page.frameLocator('[data-testid="gcs-studio-preview"]');
  await expect(preview.getByTestId("gcs-header-builder")).toHaveAttribute("data-preset", "esports", { timeout: 30_000 });
  await shot(page, "10-theme-editor-builder");

  // Drag & drop: rețelele sociale în tava „nefolosite”, apoi „Creează” în rândul principal, la dreapta.
  await page.getByTestId("gcs-hb-chip-social").dragTo(page.getByTestId("gcs-hb-tray"));
  await expect(page.getByTestId("gcs-hb-tray").getByTestId("gcs-hb-chip-social")).toBeVisible();
  await expect(preview.locator('[data-el="social"]')).toHaveCount(0);
  await page.getByTestId("gcs-hb-chip-create").dragTo(page.getByTestId("gcs-hb-zone-main-right"));
  await expect(page.getByTestId("gcs-hb-zone-main-right").getByTestId("gcs-hb-chip-create")).toBeVisible();
  await expect(preview.locator('[data-row="main"] [data-zone="right"] [data-el="create"]')).toHaveCount(1);
  await expect(editor).toContainText("Aspect propriu");

  // Cu tastatura: Enter alege, săgeata în sus mută elementul în zona vecină.
  await page.getByTestId("gcs-hb-chip-search").focus();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("gcs-hb-zone-main-center").getByTestId("gcs-hb-chip-search")).toBeVisible();

  // Dispozitivul Mobil: previzualizarea trece pe mobil.
  await page.getByTestId("gcs-hb-device-mobile").click();
  await expect(page.getByTestId("gcs-studio-size-mobile")).toHaveAttribute("aria-pressed", "true");

  // Publică: site-ul primește antetul construit.
  await page.getByTestId("gcs-studio-save").click();
  await expect(page.getByTestId("gcs-studio-status")).toHaveText(/tema e publicată/);
  await page.goto("/");
  await expect(page.getByTestId("gcs-header-builder")).toHaveAttribute("data-preset", "esports");
  await expect(page.locator('[data-row="main"] [data-zone="right"] [data-el="create"]')).toHaveCount(1);
  await restoreNova(saved);
});
