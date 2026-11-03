import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { novaSettings, patchNova, removeServers, restoreNova, seedLiveMatch, seedServers, type SeededServer } from "./cockpit-fixtures";
import { forumTree, member, topicWithReplies, uid } from "./forum-fixtures";
import { useFreshIp } from "./helpers";

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
  // Pastilele serverelor: plinul în roșu (32/32), restul cu jucătorii.
  const strip = page.getByTestId("gcs-cockpit-servers");
  await expect(strip).toBeVisible();
  await expect.poll(async () => strip.getByTestId("gcs-cockpit-strip").count()).toBeGreaterThanOrEqual(4);
  const full = strip.getByTestId("gcs-cockpit-strip").filter({ hasText: `Plin ${id}` });
  await expect(full).toHaveClass(/gcs-ck__strip--full/);
  await expect(full).toContainText("32/32");
  await expect(strip.getByTestId("gcs-cockpit-strip").filter({ hasText: `MIX1 ${id}` })).toContainText("9/14");
  // Fără cutia „Acum în comunitate” (Feed live / Live acum / Top).
  for (const panel of ["gcs-cockpit-feed", "gcs-cockpit-live", "gcs-cockpit-top"]) await expect(page.getByTestId(panel)).toHaveCount(0);
  await expect(page.locator(".gcs-ck__console")).toHaveCount(0);

  // Coloana din dreapta implicită, în ordine: serverele, cine e online, topul săptămânii, ultimele postări, meciurile live.
  const order = await page
    .locator('[data-zone="sidebar"] [data-widget]')
    .evaluateAll((els) => [...new Set(els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => e.getAttribute("data-widget")))]);
  expect(order.slice(0, 5)).toEqual(["servers.list", "core.online", "core.ranking", "forums.recentPosts", "servers.liveMatches"]);
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
    // Strâns: doar banda cu titlul, pe un singur rând (cât banda, plus chenarul).
    const band = (await w.locator(":scope > .gcs-widgetTitle").boundingBox())!;
    expect(box!.height - band.height, type).toBeLessThanOrEqual(4);
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
