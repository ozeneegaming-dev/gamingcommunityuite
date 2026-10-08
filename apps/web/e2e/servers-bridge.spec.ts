import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { GcsMockServer, httpTransport } from "../../../servers-plugins/mock/gcs-mock-server.mjs";
import { uid } from "./forum-fixtures";
import { enterAcpAsRoot, sql, useFreshIp } from "./helpers";

/**
 * Puntea cu serverele de joc (specul 2026-10-08-servere-bridge §18, E2E minimal): cheia creată în ACP (arătată o singură
 * dată), scenariul complet al serverului de joc fals pe instanța reală (HTTP, semnătura, heartbeat-uri, evenimente, un meci
 * mix 10–6, un ban din joc), apoi datele vizibile în ACP (starea punții, meciul încheiat, hărțile, adminii) și în baza de
 * date. Cu `GCS_E2E_SHOTS=<folder>` salvează capturile paginilor ACP.
 */

test.describe.configure({ mode: "serial" });

const SHOTS = process.env.GCS_E2E_SHOTS ?? "";
const id = uid();
const NAME = `Mix E2E ${id}`;
let serverId = 0;
let token = "";

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

test.beforeAll(async () => {
  // Un server CS2 (adăugarea din formular e acoperită de servers.spec.ts); adresa de documentație nu răspunde la interogări.
  const rows = await sql<{ id: number }>(
    `INSERT INTO game_servers (game, host, port, name, slug, position, "updatedAt") VALUES ('cs2', '192.0.2.44', $1, $2, $3, 900, now()) RETURNING id`,
    [27_100 + Math.floor(Math.random() * 800), NAME, `mix-e2e-${id}`],
  );
  serverId = rows[0]!.id;
});

test.afterAll(async () => {
  // Serverul (cu cheile, sesiunile, statisticile și meciurile lui, în cascadă) dispare după test.
  await sql(`DELETE FROM game_sanctions WHERE "serverId" = $1`, [serverId]);
  await sql(`DELETE FROM game_servers WHERE id = $1`, [serverId]);
});

test("ACP: cheia API (o singură dată), scenariul complet al serverului fals, starea punții și meciul încheiat", async ({ page, context, baseURL }) => {
  test.setTimeout(180_000);
  await useFreshIp(context, "100.76.0");
  await enterAcpAsRoot(page, `Punte${id}`, `punte-${id}@example.com`);

  // Pagina serverului are legătura spre „Plugin și chei API”.
  await page.goto(`/admin/gaming/servers/${serverId}`);
  await page.getByTestId("gcs-acp-server-bridge").click();
  await expect(page).toHaveURL(new RegExp(`/admin/gaming/servers/${serverId}/bridge$`));
  await expect(page.getByTestId("gcs-bridge-connected")).toHaveAttribute("data-connected", "0");

  // Serverul de meciuri mix, apoi cheia: arătată o singură dată, în lista cheilor doar keyId-ul.
  await page.getByTestId("gcs-bridge-is-mix").check();
  await page.getByRole("button", { name: "Salvează", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Salvat" })).toBeVisible();
  await page.getByLabel("Eticheta cheii (opțional)").fill("serverul de mix");
  await page.getByTestId("gcs-bridge-key-create").click();
  const tokenInput = page.getByTestId("gcs-bridge-token");
  await expect(tokenInput).toHaveValue(/^gcs1\.[a-z0-9]{12}\.[A-Za-z0-9_-]{43}$/);
  token = await tokenInput.inputValue();
  const keyId = token.split(".")[1]!;
  await expect(page.getByTestId("gcs-bridge-key").filter({ hasText: keyId })).toBeVisible();
  await shot(page, "bridge-key");
  await page.reload();
  await expect(page.getByTestId("gcs-bridge-token")).toHaveCount(0);
  expect(await page.content()).not.toContain(token.split(".")[2]!);

  // Scenariul complet, prin HTTP real, ca pluginul de pe server.
  const mock = new GcsMockServer({ token, transport: httpTransport(baseURL ?? "http://localhost:3100"), game: "cs2" });
  const out = await mock.scenarioFull();
  expect(out.ended).toMatchObject({ status: "ok" });
  expect(out.ban).toMatchObject({ status: "ok", note: "scope_downgraded" });
  expect(out.sanctions).toEqual(expect.arrayContaining([expect.objectContaining({ id: out.ban.sanctionId, type: "ban", active: true, reason: "wallhack", scope: "server" })]));

  // O cerere semnată greșit e refuzată (aceeași cheie, semnătura stricată).
  const forged = await new GcsMockServer({ token: token.replace(/.$/, (c) => (c === "A" ? "B" : "A")), transport: httpTransport(baseURL ?? "http://localhost:3100") }).request("POST", "/heartbeat", {});
  expect(forged.status).toBe(401);

  // ACP: starea punții (ultimul heartbeat, pluginul), numerele, cheia folosită.
  await page.reload();
  await expect(page.getByTestId("gcs-bridge-connected")).toHaveAttribute("data-connected", "1");
  await expect(page.getByTestId("gcs-bridge-plugin")).toHaveText("gcs-mock/cs2/1.0.0");
  await expect(page.getByTestId("gcs-bridge-count-matches")).toContainText("1");
  await expect(page.getByTestId("gcs-bridge-count-sanctions")).toContainText("1");
  await expect(page.getByTestId("gcs-bridge-count-players")).toContainText("10");
  await expect(page.getByTestId("gcs-bridge-key").filter({ hasText: keyId })).not.toContainText("niciodată");
  await shot(page, "bridge-status");

  // Meciul încheiat, evaluat ELO, cu rundele lui; banul din joc; statisticile.
  const [match] = await sql<{ status: string; scoreA: number; scoreB: number; winner: string; rated: boolean; rounds: number }>(
    `SELECT m.status, m."scoreA", m."scoreB", m.winner, m.rated, (SELECT count(*)::int FROM game_match_rounds r WHERE r."matchId" = m.id) AS rounds
     FROM game_matches m WHERE m."serverId" = $1`,
    [serverId],
  );
  expect(match).toEqual({ status: "ENDED", scoreA: 10, scoreB: 6, winner: "A", rated: true, rounds: 16 });
  const elo = await sql<{ elo: number }>(`SELECT r.elo FROM game_ratings r JOIN game_match_players mp ON mp."playerId" = r."playerId" JOIN game_matches m ON m.id = mp."matchId" WHERE m."serverId" = $1 ORDER BY r.elo DESC`, [serverId]);
  expect(elo).toHaveLength(10);
  expect(elo[0]!.elo).toBeGreaterThan(1000);
  const [kills] = await sql<{ kills: number }>(`SELECT COALESCE(SUM(kills), 0)::int AS kills FROM game_player_stats WHERE "serverId" = $1`, [serverId]);
  expect(kills!.kills).toBe(48);
  const [open] = await sql<{ n: number }>(`SELECT count(*)::int AS n FROM game_sessions WHERE "serverId" = $1 AND "disconnectedAt" IS NULL`, [serverId]);
  expect(open!.n).toBe(0);

  // Hărțile: harta văzută, cu arta generică (fără capturi ale altora).
  await page.goto("/admin/gaming/server-maps?game=cs2&q=de_mirage");
  const map = page.getByTestId("gcs-server-map").filter({ hasText: "de_mirage" });
  await expect(map).toBeVisible();
  await expect(map.locator("img")).toHaveAttribute("src", "/api/servers/maps/art/cs2");
  const art = await page.request.get("/api/servers/maps/art/cs2");
  expect(art.headers()["content-type"]).toContain("image/svg+xml");
  expect(await art.text()).not.toMatch(/<image|<script|href=/);
  await shot(page, "bridge-maps");

  // Adminii serverelor: presetările implicite.
  await page.goto("/admin/gaming/server-admins");
  await expect(page.getByTestId("gcs-admin-presets")).toContainText("Head admin");
  await shot(page, "bridge-admins");
});
