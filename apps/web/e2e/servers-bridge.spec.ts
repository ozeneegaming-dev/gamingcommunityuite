import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { readZip } from "@gcs/plugin-sdk/zip";
import { expect, test, type Page } from "@playwright/test";
import { GcsMockServer, httpTransport, startA2sResponder } from "../../../servers-plugins/mock/gcs-mock-server.mjs";
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
  await expect(page.getByTestId("gcs-bridge-plugin")).toHaveText("gcs-mock/cs2/1.1.0");
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

  // Adminii serverelor: presetările implicite (numele lor sunt în câmpurile editabile).
  await page.goto("/admin/gaming/server-admins");
  const presetNames = page.getByTestId("gcs-admin-presets").locator('input[name="name"]');
  await expect(presetNames).toHaveCount(3);
  expect(await presetNames.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).toEqual(["Moderator", "Admin", "Head admin"]);
  await shot(page, "bridge-admins");
});

test("ACP: serverul nou se înrolează singur, adminul îl aprobă, primește cheia și trimite date; pachetul pe server are configul completat", async ({ page, context, baseURL }) => {
  test.setTimeout(180_000);
  const site = baseURL ?? "http://localhost:3100";
  // Un server de joc CS2 minimal la 127.0.0.1 (excepția operatorului din E2E) și serverul fals fără cheie, ca pluginul
  // general. Fără proxy în E2E, IP-ul sursei vine din X-Forwarded-For (în producție îl pune Caddy).
  const a2s = await startA2sResponder({ game: "cs2", name: `Enroll E2E ${id}`, map: "de_inferno" });
  let createdId = 0;
  try {
    await useFreshIp(context, "100.77.0");
    await enterAcpAsRoot(page, `Inrol${id}`, `inrol-${id}@example.com`);
    const mock = new GcsMockServer({ transport: httpTransport(site, { "X-Forwarded-For": "127.0.0.1" }), game: "cs2" });
    const enrolled = await mock.enroll({ port: a2s.port, hostname: `Enroll E2E ${id}`, map: "de_inferno", players: 0, maxPlayers: 20 });
    expect(enrolled.json).toMatchObject({ status: "pending" });

    // ACP → Gaming → Servere: „Servere noi detectate”, cu interogarea confirmată.
    await page.goto("/admin/gaming/servers");
    const row = page.getByTestId("gcs-enrollment").filter({ hasText: `Enroll E2E ${id}` });
    await expect(row).toHaveAttribute("data-address", `127.0.0.1:${a2s.port}`);
    await expect(row.getByTestId("gcs-enrollment-check")).toHaveAttribute("data-result", "ok");
    await shot(page, "bridge-enroll-pending");
    await row.getByTestId("gcs-enrollment-approve").click();
    await expect(page.getByRole("status").filter({ hasText: "Aprobat" })).toBeVisible();
    await expect(page.getByTestId("gcs-enrollment").filter({ hasText: `Enroll E2E ${id}` })).toHaveAttribute("data-status", "APPROVED");

    // Serverul fals primește cheia (o singură dată) și trimite heartbeat-ul semnat, cu un admin din sistemul serverului.
    const token = await mock.waitForKey({ intervalMs: 500, timeoutMs: 30_000 });
    expect(token).toMatch(/^gcs1\.[a-z0-9]{12}\.[A-Za-z0-9_-]{43}$/);
    const hb = await mock.heartbeat({ map: "de_inferno", players: [{ auth: "76561197960287930", steam: true, name: `AdminE2E${id}`, permissions: ["@css/generic", "@css/kick"] }] });
    expect(hb.config).toMatchObject({ features: { admins: false, sanctions: false, vip: false, mixReady: false, commands: false } });
    expect((await mock.enrollStatus()).json).toMatchObject({ status: "approved", delivered: true });
    const [created] = await sql<{ id: number; name: string }>(`SELECT id, name FROM game_servers WHERE host = '127.0.0.1' AND port = $1`, [a2s.port]);
    createdId = created!.id;
    expect(created!.name).toBe(`Enroll E2E ${id}`);

    // Starea punții: conectat, pluginul, adminul raportat de server, doar colector.
    await page.goto(`/admin/gaming/servers/${createdId}/bridge`);
    await expect(page.getByTestId("gcs-bridge-connected")).toHaveAttribute("data-connected", "1");
    await expect(page.getByTestId("gcs-bridge-plugin")).toHaveText("gcs-mock/cs2/1.1.0");
    await expect(page.getByTestId("gcs-bridge-server-admin")).toBeVisible();
    await expect(page.getByTestId("gcs-bridge-module-admins")).not.toBeChecked();
    await shot(page, "bridge-enroll-connected");

    // „Descarcă pluginul pentru acest server”: arhiva are DLL-ul și configul cu adresa site-ului și o cheie nouă.
    const download = page.waitForEvent("download");
    await page.getByTestId("gcs-bridge-package").click();
    const file = await (await download).path();
    const zip = readZip(readFileSync(file));
    expect([...zip.keys()]).toContain("addons/counterstrikesharp/plugins/GcsBridge/GcsBridge.dll");
    const config = JSON.parse(zip.get("addons/counterstrikesharp/configs/plugins/GcsBridge/GcsBridge.json")!.toString("utf8")) as { Url: string; Key: string; AllowManage: boolean };
    expect(config.Url).toBe(site.replace(/\/+$/, ""));
    expect(config.Key).toMatch(/^gcs1\.[a-z0-9]{12}\.[A-Za-z0-9_-]{43}$/);
    expect(config.Key).not.toBe(token);
    expect(zip.get("INSTALARE.txt")!.toString("utf8")).toContain("DOAR COLECTEAZĂ DATE");
    const packageKeyId = config.Key.split(".")[1]!;
    await page.reload();
    await expect(page.getByTestId("gcs-bridge-key").filter({ hasText: packageKeyId })).toContainText("Pachet descărcat");
    expect(await page.content()).not.toContain(config.Key.split(".")[2]!);
  } finally {
    await a2s.close();
    if (createdId) await sql(`DELETE FROM game_servers WHERE id = $1`, [createdId]);
    await sql(`DELETE FROM game_server_enrollments WHERE port = $1`, [a2s.port]);
  }
});
