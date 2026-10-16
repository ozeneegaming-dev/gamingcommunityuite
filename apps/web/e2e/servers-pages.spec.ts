import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { GcsMockServer, httpTransport, mockPlayer } from "../../../servers-plugins/mock/gcs-mock-server.mjs";
import { member, typeInEditor, uid } from "./forum-fixtures";
import { startFakeGameServer, type FakeGameServer } from "./game-server";
import { enterAcpAsRoot, resetSetting, setSetting, sql, useFreshIp } from "./helpers";

/**
 * Paginile publice ale punții (specul 2026-10-08-servere-pagini), pe date reale generate de serverul de joc fals prin
 * HTTP: un server CS2 de mix (A2S fals pentru status, puntea pentru statistici), un meci încheiat 10–6 și unul live,
 * un ban din joc, un admin de server online. Se verifică profilul jucătorului (toate tab-urile), clasamentele, meciurile
 * (pagina meciului, tabela live), `/bans` (căutare, filtre, detaliu), sancțiunea dată de staff de pe site și ridicată,
 * contestația (coada staff-ului, nota internă invizibilă autorului, acceptarea cu ridicarea), „Conturi de joc” (codul
 * scris în joc pe un server CS 1.6), prezența adminilor, widget-ul și submeniul Servere. Cu `GCS_E2E_SHOTS=<folder>`
 * salvează capturile (temele întunecată și luminoasă, desktop și 375 px).
 */

test.describe.configure({ mode: "serial" });

const SHOTS = process.env.GCS_E2E_SHOTS ?? "";
const id = uid();
const NAME = `Mix Arena ${id}`;
const ROOT = `Staff${id}`;
const ROOT_EMAIL = `bridge-staff-${id}@example.com`;
const MEMBER = `Raptor${id}`;
const MEMBER_EMAIL = `bridge-member-${id}@example.com`;
const NAMES = ["Raptor", "Nyx", "Kestrel", "Vandal", "Orbit", "Draco", "Pixel", "Sable", "Torque", "Mirage"];
// Identități proprii (alte SteamID-uri decât specul punții), cu nume ușor de citit în capturi.
const PLAYERS = NAMES.map((name, i) => mockPlayer("cs2", 300 + i, { name: `${name}${i === 9 ? "_x" : ""}`, ip: `198.51.100.${120 + i}` }));
const CHEATER = PLAYERS[9]!;
const ADMIN = PLAYERS[0]!;

let fake: FakeGameServer;
/** Staff-ul (Root Admin, cu ACP-ul deschis): un singur context pentru toate testele (2FA-ul cere reautentificare). */
let staffContext: BrowserContext;
let staff: Page;
let serverId = 0;
let serverHref = "";
let mock: GcsMockServer;
let banId = 0;
/** Statisticile jucătorilor din meciul live (starea trimisă de „plugin” are totalurile). */
let liveStats = new Map<string, ReturnType<typeof zero>>();

/** O captură (doar cu `GCS_E2E_SHOTS`), după fonturi și imagini. */
async function shot(target: Page | Locator, name: string, fullPage = true) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const page = "page" in target ? target.page() : target;
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(400);
  if ("page" in target) await target.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  else await target.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage });
}

async function theme(page: Page, value: "dark" | "light") {
  await page.context().addCookies([{ name: "gcs-theme", value, url: `${new URL(page.url()).origin}/` }]);
}

const zero = () => ({ kills: 0, deaths: 0, assists: 0, headshots: 0, damage: 0, mvps: 0 });

/**
 * Un meci mix complet (warmup → live → pauză → live → încheiat) cu ucideri, runde și focuri; `winners` dă câștigătorul
 * fiecărei runde. Ca scenariul serverului fals, cu jucătorii acestui test.
 */
async function playMatch(m: GcsMockServer, matchId: string, winners: ("A" | "B")[], map = "de_mirage") {
  const teamA = PLAYERS.slice(0, 5);
  const teamB = PLAYERS.slice(5);
  const stats = new Map(PLAYERS.map((p) => [p.auth, zero()]));
  const state = (status: string, round: number, score: { A: number; B: number }) => m.matchState(matchId, status, { map, round, score: { ...score }, teamA, teamB, stats });
  await m.send([m.event("match", { match: state("warmup", 0, { A: 0, B: 0 }) })]);
  await m.send([m.event("match", { match: state("live", 0, { A: 0, B: 0 }) })]);
  const score = { A: 0, B: 0 };
  const half = Math.ceil(winners.length / 2);
  for (const [i, winner] of winners.entries()) {
    const round = i + 1;
    const win = winner === "A" ? teamA : teamB;
    const lose = winner === "A" ? teamB : teamA;
    const events = [];
    for (let k = 0; k < 3; k++) {
      const killer = win[(round + k) % 5]!;
      const victim = lose[(round * 2 + k) % 5]!;
      const headshot = (round + k) % 3 === 0;
      events.push(m.event("kill", { killer, victim, weapon: ["ak47", "m4a1", "awp"][k], headshot, map }));
      const s = stats.get(killer.auth)!;
      s.kills += 1;
      s.headshots += headshot ? 1 : 0;
      s.damage += 100 + k * 13;
      stats.get(victim.auth)!.deaths += 1;
      stats.get(win[(round + k + 1) % 5]!.auth)!.assists += k === 1 ? 1 : 0;
    }
    score[winner] += 1;
    stats.get(win[round % 5]!.auth)!.mvps += 1;
    const ctTeam = round <= half ? "A" : "B";
    events.push(m.event("round_end", { winner: winner === ctTeam ? "CT" : "T", map, players: PLAYERS.map((p, idx) => ({ player: p, team: (idx < 5) === (ctTeam === "A") ? "CT" : "T" })) }));
    events.push(m.event("match_round", { matchId, round, winner, scoreA: score.A, scoreB: score.B, reason: "elimination" }));
    await m.send(events);
    if (round === half) {
      await m.send([m.event("match", { match: state("halftime", round, score) })]);
      await m.send([m.event("match", { match: state("live", round, score) })]);
    }
  }
  return { state, score, stats };
}

/** Un heartbeat cu adminul în joc (prezența ține 2 × intervalul; se reîmprospătează înainte de verificări). */
async function adminBeat(match?: unknown) {
  await mock.heartbeat({ map: "de_mirage", players: [{ ...ADMIN, team: "CT", score: 12, time: 900 }], ...(match !== undefined ? { match } : {}) });
}

test.beforeAll(async ({ browser }) => {
  fake = await startFakeGameServer({ name: "Mix Arena | 5v5", map: "de_mirage" });
  staffContext = await browser.newContext();
  await useFreshIp(staffContext, "100.77.0");
  staff = await staffContext.newPage();
});

test.afterAll(async () => {
  await staffContext?.close();
  await fake?.close();
  await resetSetting("servers.rank_min_minutes");
  await sql(`DELETE FROM game_sanctions WHERE "serverId" = $1 OR "playerId" IN (SELECT id FROM game_players WHERE name = ANY($2))`, [serverId, PLAYERS.map((p) => p.name)]);
  await sql(`DELETE FROM game_servers WHERE name LIKE $1`, [`%${id}%`]);
});

test("staff: serverul (ACP), cheia API, un admin de server și datele generate de serverul de joc fals", async ({ baseURL }) => {
  test.setTimeout(240_000);
  const page = staff;
  await enterAcpAsRoot(page, ROOT, ROOT_EMAIL);

  // Serverul (din ACP, ca lista publică să-l vadă imediat), pe A2S-ul fals local.
  await page.goto("/admin/gaming/servers/new");
  await page.getByRole("radio", { name: "Counter-Strike 2 / CS:GO" }).check();
  await page.getByLabel("Numele afișat").fill(NAME);
  await page.getByLabel("Host (IP sau domeniu)").fill("127.0.0.1");
  await page.getByLabel("Portul jocului", { exact: true }).fill(String(fake.udpPort));
  await page.getByTestId("gcs-server-save").click();
  await expect(page).toHaveURL(/\/admin\/gaming\/servers$/);
  const [row] = await sql<{ id: number; slug: string }>(`SELECT id, slug FROM game_servers WHERE name = $1`, [NAME]);
  serverId = row!.id;
  serverHref = `/servers/${row!.id}-${row!.slug}`;

  // Adminul serverului: identitatea Steam a primului jucător, cu presetarea „Admin”.
  const [admin] = await sql<{ id: number }>(`INSERT INTO game_players (kind, value, trust, name) VALUES ('STEAM', $1, 'HIGH', $2) RETURNING id`, [steam64(300), ADMIN.name]);
  await sql(`INSERT INTO game_admins (subject, "playerId", "serverId", "presetId", "updatedAt") VALUES ('PLAYER', $1, $2, (SELECT id FROM game_admin_presets WHERE name = 'Admin'), now())`, [admin!.id, serverId]);

  // Serverul de mix și cheia API (arătată o singură dată).
  await page.goto(`/admin/gaming/servers/${serverId}/bridge`);
  await page.getByTestId("gcs-bridge-is-mix").check();
  await page.getByRole("button", { name: "Salvează", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Salvat" })).toBeVisible();
  await page.getByTestId("gcs-bridge-key-create").click();
  const token = await page.getByTestId("gcs-bridge-token").inputValue();
  expect(token).toMatch(/^gcs1\./);
  mock = new GcsMockServer({ token, transport: httpTransport(baseURL ?? "http://localhost:3100"), game: "cs2", runId: `pg${id}` });

  // Toți intră; un meci încheiat 10–6, focuri (precizia), un ban din joc dat de admin, apoi un meci live.
  await mock.heartbeat({ map: "de_mirage", players: PLAYERS.map((p) => ({ ...p, team: "CT", score: 0, time: 60 })) });
  await mock.send([mock.event("map", { map: "de_mirage" }), ...PLAYERS.map((p) => mock.event("connect", { player: p }))]);
  const done = await playMatch(mock, `m1-${id}`, ["A", "A", "B", "A", "A", "B", "A", "B", "A", "B", "A", "A", "B", "A", "B", "A"]);
  const ended = await mock.send([mock.event("match", { match: done.state("ended", 16, done.score) })]);
  expect(ended[0]).toMatchObject({ status: "ok" });
  await mock.send(PLAYERS.slice(0, 6).map((p, i) => mock.event("weapon_stats", { player: p, weapon: "ak47", shots: 120 + i * 10, hits: 46 + i * 4, damage: 1300 + i * 90, headshots: 3 })));
  const ban = await mock.send([
    mock.event("sanction", { kind: "ban", target: { ...CHEATER }, minutes: 1440, reason: "wallhack evident", scope: "server", admin: { ...ADMIN } }),
    mock.event("admin_action", { admin: ADMIN, action: "kick", target: CHEATER, reason: "wallhack evident" }),
  ]);
  banId = Number(ban[0]?.sanctionId ?? 0);
  expect(banId).toBeGreaterThan(0);
  await mock.send(PLAYERS.slice(1).map((p) => mock.event("disconnect", { player: p, playtime: 2400 })));
  const live = await playMatch(mock, `m2-${id}`, ["B", "A", "A"], "de_mirage");
  liveStats = live.stats;
  await adminBeat(live.state("live", 3, live.score));

  const [counts] = await sql<{ matches: number; rated: number; kills: number }>(
    `SELECT (SELECT count(*)::int FROM game_matches WHERE "serverId" = $1) AS matches,
            (SELECT count(*)::int FROM game_matches WHERE "serverId" = $1 AND rated) AS rated,
            (SELECT COALESCE(SUM(kills), 0)::int FROM game_player_stats WHERE "serverId" = $1) AS kills`,
    [serverId],
  );
  expect(counts).toEqual({ matches: 2, rated: 1, kills: 57 });
  // Locurile pe server se calculează la 10 minute: pentru test, imediat (fără prag de timp de joc). Pragul e oprit și
  // pentru jobul worker-ului, care altfel (rulând între timp) ar goli locurile jucătorilor cu mai puțin de 30 de minute.
  await setSetting("servers.rank_min_minutes", 0);
  await sql(`UPDATE game_player_stats s SET rank = r.rank FROM (SELECT "playerId", ROW_NUMBER() OVER (ORDER BY score DESC, kills DESC, "playerId")::int AS rank FROM game_player_stats WHERE "serverId" = $1) r WHERE s."serverId" = $1 AND s."playerId" = r."playerId"`, [serverId]);
});

test("serverul: imaginea hărții, „Admin online”, meciul live, clasamentul, meciurile și adminii în joc", async ({ page, context }) => {
  test.setTimeout(150_000);
  await useFreshIp(context, "100.77.1");
  await page.goto("/");
  await adminBeat();

  // Cardul: worker-ul citește A2S-ul fals (online, de_mirage) → bannerul arată harta (arta generică a jocului).
  const card = page.getByTestId("gcs-server-card").filter({ hasText: NAME });
  await expect(async () => {
    await adminBeat();
    await page.goto("/servers");
    await expect(card.getByTestId("gcs-server-status")).toHaveText("Online", { timeout: 2000 });
  }).toPass({ timeout: 75_000 });
  // Imaginea hărții e rezolvată pe server (fără redirect): fără imagine încărcată și fără șablon, arta generică.
  // (Pagina reîncărcată: statusul online poate fi venit live, iar o hartă venită live trece prin rută.)
  await page.reload();
  await expect(card.getByTestId("gcs-server-map-image")).toHaveAttribute("data-map", "de_mirage");
  await expect(card.getByTestId("gcs-server-map-image")).toHaveAttribute("data-kind", "art");
  await expect(card.getByTestId("gcs-server-admin-online")).toHaveText("Admin online");
  const art = await page.request.get("/api/servers/maps/image/cs2/de_mirage", { maxRedirects: 0 });
  expect(art.status()).toBe(302);
  expect(art.headers().location).toBe("/api/servers/maps/art/cs2");

  // Cu un șablon direct (implicit), cardul încarcă imaginea chiar de la adresa externă (fără referrer, leneș).
  await setSetting("servers.map_template_cs2", "https://imagini.exemplu.test/cs2/{map}.jpg");
  try {
    await page.goto("/servers");
    const external = card.getByTestId("gcs-server-map-image");
    await expect(external).toHaveAttribute("data-kind", "direct");
    // Pe card imaginea e încadrată: un fundal estompat + imaginea clară (amândouă de la aceeași adresă).
    await expect(external.locator("img")).toHaveCount(2);
    for (const img of await external.locator("img").all()) {
      await expect(img).toHaveAttribute("src", "https://imagini.exemplu.test/cs2/de_mirage.jpg");
      await expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
      await expect(img).toHaveAttribute("loading", "lazy");
    }
  } finally {
    await resetSetting("servers.map_template_cs2");
  }
  await page.goto("/servers");
  await shot(card, "server-card", false);

  await page.goto(serverHref);
  const board = page.getByTestId("gcs-match-board");
  await expect(board).toHaveAttribute("data-status", "live");
  await expect(board.getByTestId("gcs-match-score")).toContainText("2");
  await expect(board.getByTestId("gcs-match-team-A")).toContainText(PLAYERS[0]!.name);
  await expect(page.getByTestId("gcs-server-board").locator("tbody tr")).toHaveCount(10);
  await expect(page.getByTestId("gcs-match-row")).toHaveCount(2);
  await expect(page.getByTestId("gcs-server-game-admins")).toContainText(ADMIN.name);
  await expect(page.getByTestId("gcs-server-head-status").getByTestId("gcs-server-admin-online")).toBeVisible();

  // Live: o rundă nouă ajunge pe pagină fără reîncărcare (realtime sau rezerva de 15 s).
  const live = await playMatchRound(4, "A", { A: 2, B: 1 });
  await expect(board.getByTestId("gcs-match-score")).toContainText("3", { timeout: 30_000 });
  expect(live).toBe(true);
  await shot(page, "server-page");
});

/** O rundă în plus în meciul live (scorul nou), plus starea completă (ca pluginul). */
async function playMatchRound(round: number, winner: "A" | "B", before: { A: number; B: number }): Promise<boolean> {
  const score = { ...before, [winner]: before[winner] + 1 };
  const matchId = `m2-${id}`;
  const state = mock.matchState(matchId, "live", { map: "de_mirage", round, score, teamA: PLAYERS.slice(0, 5), teamB: PLAYERS.slice(5), stats: liveStats });
  const res = await mock.send([mock.event("match_round", { matchId, round, winner, scoreA: score.A, scoreB: score.B, reason: "bomb" }), mock.event("match", { match: state })]);
  return res.every((r: { status: string }) => r.status === "ok");
}

test("meciurile și clasamentele: istoricul, pagina meciului (rundele, echipele, ELO), ELO și clasicul pe server", async ({ page, context }) => {
  test.setTimeout(120_000);
  await useFreshIp(context, "100.77.2");
  await page.goto(`/servers/matches?server=${serverId}`);
  // Blocul filtrelor: tab-urile cu numărătorile (pe serverul ales), „Actualizare live” pornită implicit.
  await expect(page.getByTestId("gcs-mix-count-all")).toHaveText("2");
  await expect(page.getByTestId("gcs-mix-count-live")).toHaveText("1");
  await expect(page.getByTestId("gcs-mix-count-ended")).toHaveText("1");
  const toggle = page.getByTestId("gcs-mix-live");
  await expect(toggle).toBeChecked();
  const cards = page.getByTestId("gcs-mix-card");
  await expect(cards).toHaveCount(2);
  const liveCard = cards.first();
  const endedCard = cards.nth(1);
  await expect(liveCard).toHaveAttribute("data-status", "live");
  await expect(liveCard.getByTestId("gcs-mix-card-status")).toContainText("Live · runda");
  await expect(liveCard.locator(".gcs-liveDot")).toHaveCount(1);
  // Cardul compact: harta (imaginea rezolvată pe server), formatul, scorul, starea, ELO-ul mediu, durata; o singură legătură.
  await expect(endedCard).toHaveAttribute("data-status", "ended");
  await expect(endedCard.locator(".gcs-mapPic")).toHaveAttribute("data-kind", "art");
  await expect(endedCard).toContainText("de_mirage");
  await expect(endedCard.getByTestId("gcs-mix-card-mode")).toHaveText("5v5");
  await expect(endedCard.getByTestId("gcs-mix-card-score")).toHaveText(/^10.*6$/);
  await expect(endedCard.getByTestId("gcs-mix-card-status")).toContainText("Încheiat ·");
  await expect(endedCard.getByTestId("gcs-mix-card-elo")).toHaveText(/^ELO mediu \d/);
  await expect(endedCard.getByTestId("gcs-mix-card-duration")).toHaveText(/\d+ min/);
  await expect(endedCard.getByRole("link")).toHaveCount(1);
  await expect(liveCard.getByRole("link")).toHaveCount(1);

  // Live: o rundă nouă schimbă scorul de pe card fără reîncărcare (realtime sau rezerva de 15 s).
  await expect(liveCard.getByTestId("gcs-mix-card-score")).toHaveText(/^3.*1$/);
  expect(await playMatchRound(5, "B", { A: 3, B: 1 })).toBe(true);
  await expect(liveCard.getByTestId("gcs-mix-card-score")).toHaveText(/^3.*2$/, { timeout: 30_000 });
  // Oprită: scorul rămâne; repornită: lista se aduce la zi imediat.
  await toggle.uncheck();
  await expect(page.getByTestId("gcs-mix-live-state")).toHaveText("oprită");
  expect(await playMatchRound(6, "A", { A: 3, B: 2 })).toBe(true);
  await page.waitForTimeout(2000);
  await expect(liveCard.getByTestId("gcs-mix-card-score")).toHaveText(/^3.*2$/);
  await toggle.check();
  await expect(liveCard.getByTestId("gcs-mix-card-score")).toHaveText(/^4.*2$/, { timeout: 15_000 });
  await shot(page, "matches-list");

  // Tab-urile (Live / Terminate) și filtrul pe hartă (formularul merge și fără JavaScript).
  const tabs = page.getByTestId("gcs-mix-tabs");
  await tabs.getByRole("link", { name: /Live/ }).click();
  await expect(page).toHaveURL(/status=live/);
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toHaveAttribute("data-status", "live");
  await tabs.getByRole("link", { name: /Terminate/ }).click();
  await expect(page).toHaveURL(/status=ended/);
  await expect(cards).toHaveCount(1);
  await page.getByTestId("gcs-mix-filter-map").selectOption("de_mirage");
  await page.getByTestId("gcs-mix-filter-form").getByRole("button").click();
  await expect(page).toHaveURL(/map=de_mirage/);
  await expect(page).toHaveURL(/status=ended/);
  await expect(cards).toHaveCount(1);
  await expect(page.getByTestId("gcs-mix-count-ended")).toHaveText("1");

  // Tot cardul duce la pagina meciului (un clic pe imaginea hărții, nu pe text).
  const media = await cards.first().locator(".gcs-mixCard__media").boundingBox();
  await page.mouse.click(media!.x + media!.width / 2, media!.y + media!.height / 2);
  await expect(page).toHaveURL(/\/servers\/matches\/\d+$/);
  const board = page.getByTestId("gcs-match-board");
  await expect(board).toHaveAttribute("data-status", "ended");
  await expect(board.getByTestId("gcs-match-score")).toHaveText(/^10.*6$/);
  await expect(page.getByTestId("gcs-round-strip").locator("li")).toHaveCount(16);
  await expect(page.getByTestId("gcs-match-team-A").locator("tbody tr")).toHaveCount(5);
  await expect(page.getByTestId("gcs-match-team-A").locator(".gcs-eloDelta").first()).toHaveAttribute("data-sign", "up");
  await expect(page.getByTestId("gcs-match-team-B").locator(".gcs-eloDelta").first()).toHaveAttribute("data-sign", "down");
  await shot(page, "match-page");

  await page.goto("/servers/leaderboard");
  await expect(page.getByTestId("gcs-board-elo").locator("tbody tr").filter({ hasText: PLAYERS[0]!.name })).toHaveCount(1);
  await shot(page, "leaderboard-elo");
  await page.getByTestId("gcs-board-filter").getByRole("link", { name: NAME }).click();
  await expect(page).toHaveURL(new RegExp(`server=${serverId}`));
  await expect(page.getByTestId("gcs-board-classic").locator("tbody tr")).toHaveCount(10);
  await shot(page, "leaderboard-classic");
});

test("profilul jucătorului: cartea, toate tab-urile, sancțiunile, legătura cu membrul în ambele sensuri", async ({ page, context }) => {
  test.setTimeout(150_000);
  await useFreshIp(context, "100.77.3");
  await member(page, MEMBER, MEMBER_EMAIL);
  const [me] = await sql<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [MEMBER_EMAIL]);
  // Identitatea Steam a primului jucător e a membrului (ca după „Conectează Steam”).
  await sql(`UPDATE game_players SET "userId" = $1, "linkSource" = 'STEAM', "linkedAt" = now() WHERE kind = 'STEAM' AND value = $2`, [me!.id, steam64(300)]);

  await page.goto(`/servers/leaderboard?server=${serverId}`);
  await page.getByTestId("gcs-board-classic").getByRole("link", { name: PLAYERS[0]!.name }).click();
  await expect(page).toHaveURL(/\/servers\/players\/\d+-raptor/);
  const profile = page.getByTestId("gcs-player-profile");
  await expect(page.getByTestId("gcs-player-name")).toHaveText(PLAYERS[0]!.name);
  await expect(profile.getByTestId("gcs-identity").first()).toContainText("Steam");
  await expect(profile.getByTestId("gcs-identity").first()).toContainText("Încredere ridicată");
  await expect(page.getByTestId("gcs-player-member")).toContainText(MEMBER);
  await expect(page.getByTestId("gcs-player-elo")).toBeVisible();
  await expect(page.getByTestId("gcs-form-guide").locator("li")).toHaveCount(1);
  await expect(page.getByTestId("gcs-player-stats")).toContainText("Precizie");
  await shot(page, "player-overview");

  const tabs = page.getByTestId("gcs-player-tabs");
  await tabs.getByRole("link", { name: "Clasic" }).click();
  await expect(page.getByTestId("gcs-player-classic")).toContainText(NAME);
  await tabs.getByRole("link", { name: "Mix" }).click();
  await expect(page.getByTestId("gcs-player-mix")).toContainText("1–0–0");
  await expect(page.getByTestId("gcs-elo-chart")).toBeVisible();
  await shot(page, "player-mix");
  await tabs.getByRole("link", { name: "Meciuri" }).click();
  await expect(page.getByTestId("gcs-match-row")).toHaveCount(2);
  await tabs.getByRole("link", { name: "Arme" }).click();
  await expect(page.getByTestId("gcs-player-weapons")).toContainText("ak47");
  await shot(page, "player-weapons");
  await tabs.getByRole("link", { name: "Hărți" }).click();
  // Fără imagine încărcată și fără șablon: arta generică a jocului, rezolvată pe server (fără redirect).
  await expect(page.getByTestId("gcs-player-maps").locator(".gcs-mapPic").first()).toHaveAttribute("data-kind", "art");
  await expect(page.getByTestId("gcs-player-maps").locator(".gcs-mapPic").first()).toHaveAttribute("data-map", "de_mirage");
  await shot(page, "player-maps");
  // Sancțiunile (lista bannurilor e publică), fără IP pentru un membru.
  await tabs.getByRole("link", { name: "Sancțiuni" }).click();
  await expect(page.getByTestId("gcs-player-sanctions")).toHaveCount(0);
  await page.goto(`/bans/${banId}`);
  await page.getByTestId("gcs-ban-details").getByRole("link", { name: CHEATER.name }).click();
  await page.getByTestId("gcs-player-tabs").getByRole("link", { name: "Sancțiuni" }).click();
  await expect(page.getByTestId("gcs-player-sanctions")).toContainText("wallhack evident");
  await expect(page.getByTestId("gcs-player-sanctions").locator(".gcs-identity__id")).toHaveCount(0);

  // Profilul membrului → profilul de jucător (și înapoi).
  await page.goto(`/members/${me!.id}?tab=games`);
  await expect(page.getByTestId("gcs-profile-game-stats")).toContainText("K/D");
  await shot(page, "member-game-stats");
  await page.getByTestId("gcs-profile-game-link").click();
  await expect(page.getByTestId("gcs-player-name")).toHaveText(PLAYERS[0]!.name);
  await page.getByTestId("gcs-player-member").getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/members/${me!.id}`));
});

test("/bans: căutarea, filtrele, detaliul; staff-ul dă un mute pe toate serverele de pe site și îl ridică", async () => {
  test.setTimeout(150_000);
  const page = staff;

  await page.goto("/bans");
  await page.getByTestId("gcs-bans-q").fill(CHEATER.name);
  await page.getByRole("search", { name: "Caută în sancțiuni" }).getByRole("button", { name: "Caută" }).click();
  const ban = page.getByTestId("gcs-ban-row").filter({ hasText: "wallhack evident" });
  await expect(ban).toHaveCount(1);
  await expect(ban).toHaveAttribute("data-status", "active");
  await expect(ban.getByTestId("gcs-ban-remaining")).toBeVisible();
  // Staff-ul vede IP-ul (servers.view_ips).
  await expect(ban).toContainText("198.51.100.");
  await shot(page, "bans-search");
  await page.getByTestId("gcs-bans-type").getByRole("link", { name: "Mute" }).click();
  await expect(page.getByTestId("gcs-bans-empty")).toBeVisible();

  // Sancțiune nouă de pe site: un mute pe toate serverele, pentru un jucător căutat.
  await page.goto("/bans");
  await page.getByTestId("gcs-sanction-new").click();
  await expect(page).toHaveURL(/\/bans\/new$/);
  // Opțiunile sunt carduri (eticheta cu radio-ul ascuns vizual): clicul cade pe card.
  await page.getByRole("radio", { name: /Mute/ }).check({ force: true });
  await page.getByTestId("gcs-sanction-player").fill(PLAYERS[3]!.name);
  await page.getByRole("option", { name: new RegExp(PLAYERS[3]!.name) }).click();
  await expect(page.getByTestId("gcs-sanction-player-picked")).toContainText(PLAYERS[3]!.name);
  await page.getByTestId("gcs-sanction-scope-global").check({ force: true });
  await page.getByTestId("gcs-sanction-reason").fill("spam pe voce");
  await page.getByTestId("gcs-sanction-duration").selectOption("1440");
  await page.getByTestId("gcs-sanction-evidence").fill("https://clips.exemplu.ro/demo-1");
  // O captură încărcată (pipeline-ul atașamentelor), legată de sancțiune la creare.
  await page.getByTestId("gcs-sanction-files").setInputFiles({ name: "captura.png", mimeType: "image/png", buffer: await shotPng() });
  await expect(page.getByTestId("gcs-sanction-thumbs").locator("img")).toHaveCount(1);
  await shot(page, "sanction-form");
  await page.getByTestId("gcs-sanction-submit").click();
  await expect(page).toHaveURL(/\/bans\/\d+$/);
  await expect(page.getByTestId("gcs-ban-details")).toContainText("Pe toate serverele");
  await expect(page.getByTestId("gcs-ban-evidence")).toContainText("clips.exemplu.ro/demo-1");
  await expect(page.getByTestId("gcs-ban-files").locator("img")).toHaveCount(1);
  await shot(page, "sanction-detail");
  const muteId = Number(page.url().split("/").pop());
  // Serverul de joc primește mute-ul la sincronizare.
  const synced = await mock.pullSanctions();
  expect(synced).toEqual(expect.arrayContaining([expect.objectContaining({ id: muteId, type: "mute", active: true, scope: "global" })]));

  await page.getByTestId("gcs-sanction-lift-reason").fill("s-a scuzat");
  await page.getByTestId("gcs-sanction-lift-submit").click();
  await expect(page.getByTestId("gcs-ban-lifted")).toContainText("s-a scuzat");
  expect(await mock.pullSanctions()).toEqual(expect.arrayContaining([{ id: muteId, active: false }]));
});

test("contestația: membrul sancționat contestă, staff-ul preia, nota internă rămâne internă, acceptarea ridică banul", async ({ page, context }) => {
  test.setTimeout(150_000);
  await useFreshIp(context, "100.77.5");
  const appealer = `Sable${id}`;
  await member(page, appealer, `bridge-appeal-${id}@example.com`);
  const [me] = await sql<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [`bridge-appeal-${id}@example.com`]);
  await sql(`UPDATE game_players SET "userId" = $1, "linkSource" = 'STAFF', "linkedAt" = now() WHERE kind = 'STEAM' AND value = $2`, [me!.id, steam64(309)]);

  await page.goto(`/bans/${banId}`);
  await page.getByTestId("gcs-ban-appeal").click();
  await expect(page).toHaveURL(new RegExp(`/servers/tickets/new\\?kind=appeal&sanction=${banId}`));
  await expect(page.getByTestId("gcs-ticket-sanction")).toHaveValue(String(banId));
  await page.getByTestId("gcs-ticket-title").fill("Nu am folosit wallhack");
  await typeInEditor(page, "Am jucat corect; am demo-ul rundei 3.", page.getByTestId("gcs-ticket-form"));
  await page.getByTestId("gcs-ticket-evidence").fill("https://clips.exemplu.ro/runda-3");
  await shot(page, "ticket-form");
  await page.getByTestId("gcs-ticket-submit").click();
  await expect(page).toHaveURL(/\/servers\/tickets\/\d+$/);
  const ticketUrl = page.url();
  await expect(page.getByTestId("gcs-ticket-status")).toHaveText("Deschis");

  // Staff-ul: coada „De tratat”, preluarea, nota internă și răspunsul public, apoi acceptarea cu ridicarea banului.
  await staff.goto("/servers/tickets?scope=handle");
  // Rândul are și linkurile membrilor (autorul, responsabilul): se deschide titlul.
  await staff.getByTestId("gcs-ticket-row").filter({ hasText: "Nu am folosit wallhack" }).getByRole("link", { name: "Nu am folosit wallhack" }).click();
  await staff.getByTestId("gcs-ticket-take").click();
  await expect(staff.getByTestId("gcs-ticket-assignee-name")).toHaveText(ROOT);
  await staff.getByTestId("gcs-ticket-internal").locator("input").check();
  await typeInEditor(staff, "Notă: demo-ul arată clar.", staff.getByTestId("gcs-ticket-reply"));
  await staff.getByTestId("gcs-ticket-reply-submit").click();
  await expect(staff.getByTestId("gcs-ticket-internal-note")).toContainText("demo-ul arată clar");
  await typeInEditor(staff, "Am verificat demo-ul, ai dreptate.", staff.getByTestId("gcs-ticket-reply"));
  await staff.getByTestId("gcs-ticket-reply-submit").click();
  await expect(staff.getByTestId("gcs-ticket-message")).toContainText("ai dreptate");
  await expect(staff.getByTestId("gcs-ticket-lift").locator("input")).toBeChecked();
  await staff.getByTestId("gcs-ticket-status-reason").fill("demo verificat");
  await staff.getByTestId("gcs-ticket-to-ACCEPTED").click();
  await expect(staff.getByTestId("gcs-ticket-status")).toHaveText("Acceptat");
  await shot(staff, "ticket-staff");

  // Autorul: răspunsul public, fără nota internă; banul e ridicat.
  await page.goto(ticketUrl);
  await expect(page.getByTestId("gcs-ticket-status")).toHaveText("Acceptat");
  await expect(page.getByTestId("gcs-ticket-message")).toContainText("ai dreptate");
  await expect(page.getByTestId("gcs-ticket-internal-note")).toHaveCount(0);
  expect(await page.content()).not.toContain("demo-ul arată clar");
  await shot(page, "ticket-author");
  await page.goto(`/bans/${banId}`);
  await expect(page.getByTestId("gcs-ban-lifted")).toContainText("demo verificat");
  await page.goto("/servers/tickets");
  await expect(page.getByTestId("gcs-ticket-row")).toHaveCount(1);
});

test("conturile de joc: codul de legare scris în joc (CS 1.6, non-Steam), identitatea legată și dezlegarea", async ({ page, context }) => {
  test.setTimeout(150_000);
  await useFreshIp(context, "100.77.7");
  await member(page, `Orbit${id}`, `bridge-link-${id}@example.com`);
  // Un al doilea server, CS 1.6 (identitățile non-Steam se leagă prin cod), cu cheia lui (staff-ul, în ACP).
  const [cs16] = await sql<{ id: number }>(
    `INSERT INTO game_servers (game, host, port, name, slug, position, "updatedAt") VALUES ('cs16', '192.0.2.45', $1, $2, $3, 901, now()) RETURNING id`,
    [27_200 + Math.floor(Math.random() * 700), `Classic 1.6 ${id}`, `classic-16-${id}`],
  );
  await staff.goto(`/admin/gaming/servers/${cs16!.id}/bridge`);
  await staff.getByTestId("gcs-bridge-key-create").click();
  const token = await staff.getByTestId("gcs-bridge-token").inputValue();
  const old = new GcsMockServer({ token, transport: httpTransport(new URL(staff.url()).origin), game: "cs16", runId: `l${id}` });

  // Membrul: Setări → Cont → Conturi de joc → codul; în joc, `/gcs COD` de pe un client non-Steam.
  await page.goto("/settings/account");
  const section = page.getByTestId("gcs-game-accounts");
  await expect(section).toContainText("Nicio identitate de joc legată.");
  await section.getByTestId("gcs-link-code-generate").click();
  const code = ((await section.getByTestId("gcs-link-code").textContent()) ?? "").trim().split(/\s+/).pop()!;
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  await shot(section, "game-accounts-code", false);
  const res = await old.link({ auth: "STEAM_0:1:777123", steam: false, name: "NonSteam_E2E", ip: "198.51.100.88" }, code);
  expect(res.status).toBe(200);
  expect(res.json).toMatchObject({ ok: true, user: `Orbit${id}` });
  await page.reload();
  const identity = section.getByTestId("gcs-game-identity").filter({ hasText: "NonSteam_E2E" });
  await expect(identity).toContainText("Non-Steam");
  await expect(identity).toContainText("medie");
  await expect(identity).toContainText("legat prin cod");
  await shot(section, "game-accounts-linked", false);
  await identity.getByTestId("gcs-game-identity-unlink").click();
  await expect(section.getByTestId("gcs-game-identity")).toHaveCount(0);
  await sql(`DELETE FROM game_servers WHERE id = $1`, [cs16!.id]);
});

test("prezența adminilor: pagina, widget-ul „Admini online” și avertismentul de inactivitate din ACP", async () => {
  test.setTimeout(150_000);
  const page = staff;
  await adminBeat();

  await page.goto(`/servers/admins?server=${serverId}`);
  const card = page.getByTestId("gcs-admin-card").filter({ hasText: ADMIN.name });
  await expect(card).toHaveAttribute("data-online", "");
  await expect(card.getByTestId("gcs-admin-online")).toContainText(NAME);
  await shot(page, "admins-presence");

  // Widget-ul în coloana din dreapta a paginii principale.
  await page.goto("/");
  await page.getByTestId("gcs-user-menu").click();
  await page.getByTestId("gcs-menu-page-editor").click();
  await page.getByTestId("gcs-widget-add-sidebar").click();
  await page.getByTestId("gcs-widget-catalog-sidebar").getByRole("listitem").filter({ hasText: "Admini online" }).click();
  await page.getByTestId("gcs-page-editor-save").click();
  await expect(page.getByTestId("gcs-page-editor-status")).toHaveText("Pagina a fost salvată.");
  await page.getByTestId("gcs-page-editor-done").click();
  await adminBeat();
  await page.reload();
  const widget = page.getByTestId("gcs-widget-admins-online").filter({ visible: true });
  await expect(widget.getByTestId("gcs-widget-admin").filter({ hasText: ADMIN.name })).toBeVisible();
  await shot(widget, "widget-admins-online", false);

  // ACP: un admin nevăzut niciodată → avertismentul și eticheta.
  const [ghost] = await sql<{ id: number }>(`INSERT INTO game_players (kind, value, trust, name) VALUES ('STEAM', $1, 'HIGH', $2) RETURNING id`, [steam64(399), `Ghost${id}`]);
  await sql(`INSERT INTO game_admins (subject, "playerId", "serverId", flags, "updatedAt") VALUES ('PLAYER', $1, $2, 'bce', now())`, [ghost!.id, serverId]);
  await page.goto(`/admin/gaming/server-admins?server=${serverId}`);
  await expect(page.getByTestId("gcs-admins-inactive-warning")).toBeVisible();
  await expect(page.getByTestId("gcs-admin-inactive").or(page.getByText("Nevăzut niciodată")).first()).toBeVisible();
  await shot(page, "acp-admins-presence");
});

test("meniul: Servere e un submeniu cu paginile punții", async ({ page, context }) => {
  await useFreshIp(context, "100.77.9");
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Principal" });
  await expect(nav).toHaveAttribute("data-ready", "");
  await nav.getByRole("button", { name: "Servere" }).click();
  const menu = page.getByRole("menu", { name: "Servere" });
  await expect(menu.getByRole("menuitem")).toHaveText(["Toate serverele", "Clasamente", "Meciuri mix", "Banuri", "Admini", "Contestații"]);
  await menu.getByRole("menuitem", { name: "Banuri" }).click();
  await expect(page).toHaveURL(/\/bans$/);
  await expect(nav.getByRole("button", { name: "Servere" })).toHaveClass(/gcs-nav__link--active/);
});

test("capturile: temele întunecată și luminoasă, desktop și 375 px", async ({ page, context }) => {
  test.skip(!SHOTS, "doar cu GCS_E2E_SHOTS");
  test.setTimeout(240_000);
  await useFreshIp(context, "100.77.10");
  await page.goto("/");
  const [player] = await sql<{ id: number }>(`SELECT id FROM game_players WHERE kind = 'STEAM' AND value = $1`, [steam64(300)]);
  const [match] = await sql<{ id: number }>(`SELECT id FROM game_matches WHERE "serverId" = $1 AND status = 'ENDED'`, [serverId]);
  const pages: [string, string][] = [
    ["player", `/servers/players/${player!.id}`],
    ["player-mix", `/servers/players/${player!.id}?tab=mix`],
    ["match", `/servers/matches/${match!.id}`],
    ["matches", "/servers/matches"],
    ["matches-live", "/servers/matches?status=live"],
    ["bans", "/bans"],
    ["ban", `/bans/${banId}`],
    ["leaderboard", "/servers/leaderboard"],
    ["admins", "/servers/admins"],
    ["server", serverHref],
  ];
  for (const t of ["dark", "light"] as const) {
    await theme(page, t);
    for (const [name, url] of pages) {
      await adminBeat();
      await page.goto(url);
      await shot(page, `${name}-${t}`);
    }
  }
  await theme(page, "dark");
  await page.setViewportSize({ width: 375, height: 812 });
  const overflow: string[] = [];
  for (const t of ["dark", "light"] as const) {
    await theme(page, t);
    for (const [name, url] of pages) {
      await page.goto(url);
      await shot(page, `${name}-mobile-${t}`);
      // Fără derulare orizontală a paginii pe telefon (elementele mai late decât ecranul, pentru diagnostic).
      const wide = await page.evaluate(() => {
        if (document.documentElement.scrollWidth <= window.innerWidth + 1) return null;
        const out: string[] = [];
        for (const el of document.querySelectorAll("body *")) {
          const r = el.getBoundingClientRect();
          if (r.right > window.innerWidth + 1 && r.width > 0) out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").split(" ").join(".")} ${Math.round(r.right)}`);
        }
        return `${document.documentElement.scrollWidth}: ${out.slice(0, 6).join(" | ")}`;
      });
      if (wide) overflow.push(`${name} ${t} → ${wide}`);
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(overflow).toEqual([]);
});

/** O imagine PNG mică pentru dovezi: un colț din captura paginii staff-ului (fără imagini din afara testului). */
async function shotPng(): Promise<Buffer> {
  return staff.screenshot({ clip: { x: 0, y: 0, width: 64, height: 36 } });
}

/** SteamID64 pentru `accountId = 900000 + n` (ca `mockPlayer`). */
function steam64(n: number): string {
  return (76561197960265728n + BigInt(900_000 + n)).toString();
}
