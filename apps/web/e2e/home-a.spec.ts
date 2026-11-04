import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { novaSettings, patchNova, removeServers, restoreNova, seedLiveMatch, seedServers, type SeededServer } from "./cockpit-fixtures";
import { fixture, forumTree, member, topicWithReplies, uid } from "./forum-fixtures";
import { e2eKv } from "./kv";
import { sql, useFreshIp } from "./helpers";

/**
 * Prima pagină nouă, varianta A (macheta `home-hovercard`, 2026-11-03): consola compactă sub antet (salutul cu
 * pastilele de stare, „Topic nou” / „Joacă acum”, pastilele serverelor, fără cele 3 panouri) și coloana din dreapta
 * implicită (serverele, cine e online, topul săptămânii, ultimele postări, meciurile live). Pe telefon (375 px):
 * fără derulare orizontală a paginii, pastilele serverelor se derulează, widget-urile coloanei sunt rânduri strânse
 * (în afară de servere). Capturile pentru proprietar: `GCS_E2E_SHOTS=<folder>` (`home-a-1440.png`, `home-a-375.png`).
 */

const SHOTS = process.env.GCS_E2E_SHOTS ?? "";
const id = uid();
let saved: Record<string, unknown>;
let servers: SeededServer[] = [];

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true, animations: "disabled" });
}

/** Un widget din coloana din dreapta (doar copia vizibilă: widget-urile vin în flux). */
const sideWidget = (page: Page, type: string): Locator => page.locator(`[data-zone="sidebar"] [data-widget="${type}"]`).filter({ visible: true }).first();

/** Pornește / oprește Chat Pro direct în baza E2E și golește cache-ul aplicațiilor (ca în `chat-pro.spec.ts`). */
async function setChatPro(enabled: boolean): Promise<void> {
  await sql(`INSERT INTO apps (key, enabled, "updatedAt") VALUES ('chat_pro', $1, now()) ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, "updatedAt" = now()`, [enabled]);
  const redis = await e2eKv();
  try {
    await redis.del("gcs:k:apps:enabled");
  } finally {
    redis.disconnect();
  }
}

test.beforeAll(async () => {
  saved = await novaSettings();
  // Tema implicită (GCS Dark) are deja aspectul compact; aici doar pornim consola, pe prima pagină.
  await patchNova({ cockpit: { enabled: true, pages: "home", layout: "compact" } });
  servers = await seedServers([
    { name: `Plin ${id}`, game: "cs16", players: 32, max: 32, map: "de_dust2" },
    { name: `MIX1 ${id}`, game: "cs16", players: 9, max: 14, map: "de_mirage" },
    { name: `MIX2 ${id}`, game: "cs2", players: 6, max: 14, map: "de_inferno" },
    { name: `Retake ${id}`, game: "cs2", players: 3, max: 12, map: "de_ancient" },
  ]);
  await seedLiveMatch(servers[1]!.id, [{ name: "Kaze", team: "A", kills: 12, deaths: 7 }, { name: "Raze", team: "B", kills: 9, deaths: 10 }], { a: 8, b: 5 });
});

test.afterAll(async () => {
  if (saved) await restoreNova(saved);
  await removeServers(servers);
});

test("membru, 1440 px: salutul cu pastilele, serverele, fără cele 3 panouri; coloana din dreapta cu widget-urile implicite", async ({ page, context, request }) => {
  test.setTimeout(180_000);
  await useFreshIp(context, "100.98.1");
  const name = `Acasa${id}`;
  const email = `home-a-${id}@example.com`;
  await member(page, name, email);
  // O postare nouă a membrului, ca „Ultimele postări” să aibă ce arăta.
  const tree = await forumTree(request);
  await topicWithReplies(request, tree.forum.id, email, `Salut de pe prima pagină ${id}`, 0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");

  const cockpit = page.getByTestId("gcs-cockpit");
  await expect(cockpit).toBeVisible();
  await expect(cockpit).toHaveAttribute("data-layout", "compact");
  // Rândul salutului: numele, pastilele de stare, butoanele rapide.
  const greet = page.getByTestId("gcs-cockpit-greet");
  await expect(greet).toContainText(name);
  await expect(page.getByTestId("gcs-cockpit-welcome")).toBeVisible();
  await expect(page.locator('[data-chip="unread"]')).toBeVisible();
  await expect(page.locator('[data-chip="unread"]')).toHaveAttribute("href", "/activity?unread=1");
  await expect(page.getByTestId("gcs-cockpit-play")).toBeVisible();
  await expect(page.getByTestId("gcs-cockpit-new-topic")).toHaveAttribute("href", /^\/forum\/\d+-[^/]+\/new$/);
  // „Meciuri live (N)” lângă „Joacă acum” (macheta HomeComplete): meciul mix de pe MIX1.
  await expect(page.getByTestId("gcs-cockpit-live-matches")).toHaveAttribute("href", "/servers/matches?status=live");
  await expect(page.getByTestId("gcs-cockpit-live-matches")).toHaveText(/Meciuri live \([1-9]\d*\)/);
  // Pastilele serverelor: plinul în roșu (32/32), restul cu jucătorii.
  const strip = page.getByTestId("gcs-cockpit-servers");
  await expect(strip).toBeVisible();
  await expect.poll(async () => strip.getByTestId("gcs-cockpit-strip").count()).toBeGreaterThanOrEqual(4);
  const full = strip.getByTestId("gcs-cockpit-strip").filter({ hasText: `Plin ${id}` });
  await expect(full).toHaveClass(/gcs-ck__strip--full/);
  await expect(full).toContainText("32/32");
  await expect(strip.getByTestId("gcs-cockpit-strip").filter({ hasText: `MIX1 ${id}` })).toContainText("9/14");
  // Consola compactă nu are cutia cu panouri (Feed live / Live acum / Top); „Acum în comunitate” e un widget separat.
  for (const panel of ["gcs-cockpit-feed", "gcs-cockpit-live", "gcs-cockpit-top"]) await expect(page.getByTestId(panel)).toHaveCount(0);
  await expect(cockpit.locator(".gcs-ck__console")).toHaveCount(0);

  // Coloana din dreapta implicită, în ordine: serverele, (obiectivul lunii, doar cu un obiectiv activ), cine e online,
  // topul săptămânii, ultimele postări, meciurile live.
  const order = await page
    .locator('[data-zone="sidebar"] [data-widget]')
    .evaluateAll((els) => [...new Set(els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => e.getAttribute("data-widget")))]);
  expect(order.filter((w) => w !== "vip.donationGoal").slice(0, 5)).toEqual(["servers.list", "core.online", "core.ranking", "forums.recentPosts", "servers.liveMatches"]);
  const srv = sideWidget(page, "servers.list");
  await expect(srv.getByTestId("gcs-widget-server").first()).toBeVisible();
  await expect(srv.getByTestId("gcs-widget-server-total")).toContainText(/jucător|jucători/);
  await expect(srv.locator(".gcs-serverBar--thin").first()).toBeVisible();
  const online = sideWidget(page, "core.online");
  await expect(online.getByTestId("gcs-online-summary")).toContainText(/membri/);
  const ranking = sideWidget(page, "core.ranking");
  await expect(ranking).toContainText("Topul săptămânii");
  await expect(ranking.getByTestId("gcs-ranking-widget-metric-posts")).toBeVisible();
  // Topul compact: fără rândul perioadelor.
  await expect(ranking.getByTestId("gcs-ranking-widget-period-week")).toHaveCount(0);
  const posts = sideWidget(page, "forums.recentPosts");
  await expect(posts.getByRole("link", { name: "Activitate" })).toHaveAttribute("href", "/activity");
  await expect(posts.getByRole("link", { name: `Salut de pe prima pagină ${id}` }).first()).toBeVisible();
  await expect(posts.locator(".gcs-widget__excerpt")).toHaveCount(0);
  const live = sideWidget(page, "servers.liveMatches");
  await expect(live.getByTestId("gcs-live-matches-all")).toHaveAttribute("href", "/servers/matches?status=live");
  await expect(live.getByTestId("gcs-live-match").filter({ hasText: `MIX1 ${id}` })).toContainText("8:5");
  // Pe desktop, widget-urile coloanei sunt deschise.
  await expect(online.getByTestId("gcs-collapse-toggle")).toHaveAttribute("aria-expanded", "true");
  await shot(page, "home-a-1440.png");
});

test("vizitator: bun venit, intrarea și înregistrarea în locul pastilelor", async ({ page, context }) => {
  await useFreshIp(context, "100.98.2");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.getByTestId("gcs-cockpit")).toHaveAttribute("data-layout", "compact");
  await expect(page.getByTestId("gcs-cockpit-guest")).toBeVisible();
  await expect(page.getByTestId("gcs-cockpit-welcome")).toHaveCount(0);
  await expect(page.getByTestId("gcs-cockpit-login")).toHaveAttribute("href", "/login");
  await expect(page.getByTestId("gcs-cockpit-servers")).toBeVisible();
});

test("telefon, 375 px: fără derulare orizontală, pastilele serverelor se derulează, widget-urile coloanei sunt rânduri strânse", async ({ page, context }) => {
  test.setTimeout(120_000);
  await useFreshIp(context, "100.98.3");
  await member(page, `AcasaTel${id}`, `home-a-tel-${id}@example.com`);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(page.getByTestId("gcs-cockpit-greet")).toContainText(`AcasaTel${id}`);
  await expect(page.getByTestId("gcs-cockpit-welcome")).toBeVisible();
  // Ca în machetă: fără rang și fără butoanele rapide pe telefon.
  await expect(page.getByTestId("gcs-cockpit-new-topic")).toBeHidden();
  await expect(page.getByTestId("gcs-cockpit-play")).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  // Pastilele serverelor: mai late decât ecranul, se derulează în bandă (nu pagina).
  const strip = page.getByTestId("gcs-cockpit-servers");
  await expect(strip).toBeVisible();
  const scroll = await strip.evaluate((el) => {
    const before = el.scrollLeft;
    el.scrollLeft = 240;
    return { overflow: getComputedStyle(el).overflowX, wider: el.scrollWidth > el.clientWidth, moved: el.scrollLeft > before, right: el.getBoundingClientRect().right };
  });
  expect(scroll.overflow).toBe("auto");
  expect(scroll.wider).toBe(true);
  expect(scroll.moved).toBe(true);
  expect(scroll.right).toBeLessThanOrEqual(375);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  // Widget-urile coloanei, sub forumuri: serverele deschise, restul strânse (banda cu titlul și săgeata).
  const srv = sideWidget(page, "servers.list");
  await srv.scrollIntoViewIfNeeded();
  await expect(srv.getByTestId("gcs-widget-server").first()).toBeVisible();
  const online = sideWidget(page, "core.online");
  const toggle = online.getByTestId("gcs-collapse-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(online.getByTestId("gcs-online-summary")).toBeVisible();
  await expect(online.locator(".gcs-onlineSide, .gcs-sideCard__line").first()).toBeHidden();
  for (const type of ["core.ranking", "forums.recentPosts", "servers.liveMatches"]) {
    const w = sideWidget(page, type);
    await expect(w.getByTestId("gcs-collapse-toggle"), type).toHaveAttribute("aria-expanded", "false");
    const box = await w.boundingBox();
    expect(box, type).not.toBeNull();
    expect(box!.x + box!.width, type).toBeLessThanOrEqual(376);
    // Strâns: doar banda cu titlul, pe un singur rând (cât banda, plus marginea interioară a casetei, ca la widget-urile
    // strânse de membru).
    const band = (await w.locator(":scope > .gcs-widgetTitle").boundingBox())!;
    expect(box!.height - band.height, type).toBeLessThanOrEqual(24);
    expect(await w.locator(".gcs-widgetTitle__text").evaluate((el) => getComputedStyle(el).whiteSpace), type).toBe("nowrap");
  }
  await shot(page, "home-a-375.png");
  // Deschis de membru: rândul se deschide și rămâne deschis la reîncărcare.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(online).toHaveAttribute("data-open", "");
  await page.reload();
  await expect(sideWidget(page, "core.online").getByTestId("gcs-collapse-toggle")).toHaveAttribute("aria-expanded", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test("macheta HomeComplete, 1440 px: „Acum în comunitate” sus, chat-ul în coloana din stânga, grila fără goluri", async ({ page, context, request }) => {
  test.setTimeout(180_000);
  await useFreshIp(context, "100.98.4");
  const email = `home-c-${id}@example.com`;
  await member(page, `AcasaC${id}`, email);
  // O categorie cu un singur forum și una cu două (golurile din grila de 3).
  const one = await forumTree(request);
  const two = await forumTree(request);
  await fixture(request, { action: "forum", parentId: two.category.id, type: "FORUM", name: `Al doilea ${id}` });
  await topicWithReplies(request, one.forum.id, email, `Despre mix ${id}`, 1);
  const url = new URL(page.url());
  await context.addCookies([{ name: "gcs-forum-view", value: "grid", domain: url.hostname, path: "/" }]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");

  await test.step("„Acum în comunitate”: banda cu jucătorii, feed-ul cu tab-uri, meciul live, serverele cu „Joacă acum”", async () => {
    const now = page.locator('[data-zone="top"] [data-testid="gcs-now-community"]').filter({ visible: true }).first();
    await expect(now).toBeVisible();
    await expect(now.getByRole("heading", { name: "Acum în comunitate" })).toBeVisible();
    await expect(now.getByTestId("gcs-now-community-players")).toContainText(/jucători|jucător/);
    await expect(now.getByTestId("gcs-now-community-feed-item").first()).toBeVisible();
    await now.getByTestId("gcs-now-community-feed-tab-forum").click();
    await expect(now.getByTestId("gcs-now-community-feed-tab-forum")).toHaveAttribute("aria-selected", "true");
    await expect(now.getByTestId("gcs-now-community-feed-item").first()).toHaveAttribute("data-kind", /topic|reply|status|member/);
    const match = now.getByTestId("gcs-now-community-match");
    await expect(match).toContainText("8");
    await expect(match).toContainText("5");
    await expect.poll(async () => now.getByTestId("gcs-now-community-strip").count()).toBeGreaterThanOrEqual(4);
    await expect(now.getByTestId("gcs-now-community-play")).toBeVisible();
  });

  await test.step("chat-ul stă în coloana din stânga, lângă coloana din dreapta (fără golul de sub categorii)", async () => {
    const chat = page.locator('[data-zone="main"] [data-testid="gcs-shoutbox"]').filter({ visible: true }).first();
    await expect(chat).toBeVisible();
    const main = (await page.locator(".gcs-widgetPage > .gcs-forumLayout > .gcs-forumLayout__main").boundingBox())!;
    const side = (await page.locator(".gcs-widgetPage > .gcs-forumLayout > .gcs-forumSidebar").boundingBox())!;
    const box = (await chat.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(side.x);
    expect(box.y).toBeGreaterThan(main.y);
  });

  await test.step("grila: un forum singur ocupă tot rândul (pe orizontală), două forumuri câte jumătate", async () => {
    const well = (cat: number) => page.locator(`section[aria-labelledby="gcs-cat-${cat}"] .gcs-category__well`);
    const wellOne = (await well(one.category.id).boundingBox())!;
    const cardOne = (await well(one.category.id).locator(":scope > *").first().boundingBox())!;
    expect(cardOne.width).toBeGreaterThan(wellOne.width - 40);
    // Pe orizontală: imaginea în stânga, textul în dreapta (deci cardul nu e mai înalt decât lat).
    expect(cardOne.height).toBeLessThan(cardOne.width / 2);
    const cardsTwo = well(two.category.id).locator(":scope > *");
    await expect(cardsTwo).toHaveCount(2);
    const a = (await cardsTwo.nth(0).boundingBox())!;
    const b = (await cardsTwo.nth(1).boundingBox())!;
    const wellTwo = (await well(two.category.id).boundingBox())!;
    expect(Math.abs(a.width - b.width)).toBeLessThan(2);
    expect(a.width + b.width).toBeGreaterThan(wellTwo.width - 60);
    expect(Math.abs(a.y - b.y)).toBeLessThan(2);
  });
  await shot(page, "home-complete-1440.png");

  await test.step("Chat Pro (premium, după licență): în coloana din stânga, cu bara de vot și clasamentul alături", async () => {
    await setChatPro(true);
    const [bar] = await sql<{ id: number }>(`INSERT INTO chat_pro_bar_items (text, "ctaLabel", "ctaUrl", "updatedAt") VALUES ($1, 'Votează', '/servers', now()) RETURNING id`, [`[SERVERE] Votează serverele ${id}`]);
    try {
      await page.reload();
      const chat = page.locator('[data-zone="main"] [data-testid="gcs-shoutbox"]').filter({ visible: true }).first();
      await expect(chat.getByTestId("gcs-chatpro-bar")).toBeVisible();
      const ranking = chat.getByTestId("gcs-chatpro-ranking");
      await expect(ranking).toBeVisible();
      // Clasamentul (podiumul, spammerul zilei, ultimul câștigător, statisticile tale) stă lângă mesaje, nu sub ele.
      const r = (await ranking.boundingBox())!;
      const c = (await chat.boundingBox())!;
      expect(r.x).toBeGreaterThan(c.x + c.width / 3);
      await chat.scrollIntoViewIfNeeded();
      if (SHOTS) await chat.screenshot({ path: path.join(SHOTS, "home-complete-chatpro-1440.png"), animations: "disabled" });
    } finally {
      await sql(`DELETE FROM chat_pro_bar_items WHERE id = $1`, [bar!.id]);
      await setChatPro(false);
    }
  });

  await test.step("telefon (375 px): fără derulare orizontală, widget-ul și chat-ul încap în ecran", async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload();
    const now = page.locator('[data-testid="gcs-now-community"]').filter({ visible: true }).first();
    await expect(now).toBeVisible();
    const box = (await now.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(376);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await shot(page, "home-complete-375.png");
  });
});
