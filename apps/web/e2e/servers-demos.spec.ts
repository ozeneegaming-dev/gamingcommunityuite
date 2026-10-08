import { createHash } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { startSftpDemoServer } from "../../../packages/modules/test/demoServers";
import { GcsMockServer, httpTransport } from "../../../servers-plugins/mock/gcs-mock-server.mjs";
import { uid } from "./forum-fixtures";
import { enterAcpAsRoot, sql, useFreshIp } from "./helpers";

/**
 * HLTV / GOTV la meciurile mix (specul 2026-10-08-servere-hltv §9): adresa și întârzierea setate în ACP → „Urmărește live”
 * pe meciul live (pagina meciului, cardul din /servers/matches, pagina serverului); sursa HTTP (un folder local cu un demo
 * HLTV) → meciul serverului fals se încheie → gcs-worker aduce demo-ul → apare pe pagina meciului și se descarcă identic;
 * apoi sursa SFTP (un server local) testată din procesul web: parola sigilată, amprenta cheii reținută la prima conectare.
 */

test.describe.configure({ mode: "serial" });

const id = uid();
const NAME = `HLTV E2E ${id}`;
let serverId = 0;
let serverHref = "";
let folder: { url: string; demo: Buffer; name: string; close: () => Promise<void> } | null = null;

/** `AALLZZhhmm` (UTC) al unui moment: data din numele unui demo HLTV. */
const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:T]/g, "").slice(2, 12);

/** Un folder HTTP local cu pagina de index și un demo CS 1.6 (antetul HLDEMO). */
async function startDemoFolder() {
  const demo = Buffer.concat([Buffer.from("HLDEMO\0\0", "latin1"), Buffer.alloc(300_000, 7).map((b, i) => (i % 97 === 0 ? i % 251 : b))]);
  const name = `mix-${stamp(Date.now() - 60_000)}-de_mirage.dem`;
  const server = http.createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path === "/demos/") {
      res.setHeader("content-type", "text/html");
      return res.end(`<html><body><a href="../">../</a>\n<a href="${name}">${name}</a></body></html>`);
    }
    if (path === `/demos/${name}`) {
      res.setHeader("content-length", String(demo.length));
      return res.end(demo);
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/demos/`, demo, name, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

test.beforeAll(async () => {
  folder = await startDemoFolder();
});

test.afterAll(async () => {
  await folder?.close();
  await sql(`DELETE FROM game_match_demos WHERE "serverId" = $1`, [serverId]);
  await sql(`DELETE FROM game_servers WHERE id = $1`, [serverId]);
});

test("ACP HLTV / GOTV → „Urmărește live” pe meciul live; sursa HTTP → demo-ul apare pe pagina meciului și se descarcă identic", async ({ page, context, browser, baseURL }) => {
  test.setTimeout(240_000);
  await useFreshIp(context, "100.76.5");
  await enterAcpAsRoot(page, `Hltv${id}`, `hltv-${id}@example.com`);

  // Serverul CS 1.6 (din ACP, ca paginile publice să-l vadă imediat), apoi serverul de mix și cheia (arătată o dată).
  await page.goto("/admin/gaming/servers/new");
  await page.getByRole("radio", { name: "Counter-Strike 1.6" }).check();
  await page.getByLabel("Numele afișat").fill(NAME);
  await page.getByLabel("Host (IP sau domeniu)").fill("127.0.0.1");
  await page.getByLabel("Portul jocului", { exact: true }).fill(String(27_100 + Math.floor(Math.random() * 800)));
  await page.getByTestId("gcs-server-save").click();
  await expect(page).toHaveURL(/\/admin\/gaming\/servers$/);
  const [created] = await sql<{ id: number; slug: string }>(`SELECT id, slug FROM game_servers WHERE name = $1`, [NAME]);
  serverId = created!.id;
  serverHref = `/servers/${created!.id}-${created!.slug}`;
  await page.goto(`/admin/gaming/servers/${serverId}/bridge`);
  await page.getByTestId("gcs-bridge-is-mix").check();
  await page.getByRole("button", { name: "Salvează", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Salvat" }).first()).toBeVisible();
  await page.getByTestId("gcs-bridge-key-create").click();
  const token = await page.getByTestId("gcs-bridge-token").inputValue();
  expect(token).toMatch(/^gcs1\./);

  // „HLTV / GOTV și demo-uri”: adresa, întârzierea, sursa HTTP (folderul local), fusul orar al numelor.
  const tv = page.getByTestId("gcs-bridge-tv");
  await expect(tv).toBeVisible();
  await tv.getByTestId("gcs-tv-address").fill("127.0.0.1:27020");
  await tv.getByTestId("gcs-tv-delay").fill("90");
  await tv.getByTestId("gcs-tv-source").selectOption("http");
  await tv.getByTestId("gcs-tv-http").fill(`${folder!.url}{file}`);
  await tv.getByTestId("gcs-tv-timezone").fill("UTC");
  await tv.getByRole("button", { name: "Salvează HLTV / GOTV" }).click();
  await expect(tv.getByRole("status").filter({ hasText: "Salvat" })).toBeVisible();
  // Testul conexiunii folosește setările salvate: vede demo-ul din folder.
  await tv.getByTestId("gcs-tv-test").click();
  await expect(tv.getByTestId("gcs-tv-test-result")).toContainText("1 demo-uri");
  await expect(tv.getByTestId("gcs-tv-test-result")).toContainText(folder!.name);

  // Meciul mix al serverului fals pornește (live).
  const mock = new GcsMockServer({ token, transport: httpTransport(baseURL ?? "http://localhost:3100"), game: "cs16" });
  const ctx = await mock.startMix({ map: "de_mirage" });
  const [match] = await sql<{ id: number }>(`SELECT id FROM game_matches WHERE "serverId" = $1 AND "externalId" = $2`, [serverId, ctx.matchId]);
  const matchId = match!.id;

  // „Urmărește live”: pe pagina meciului, pe cardul live din listă și pe pagina serverului, cu întârzierea.
  await page.goto(`/servers/matches/${matchId}`);
  const watch = page.getByTestId("gcs-watch-live");
  await expect(watch).toHaveAttribute("href", "steam://connect/127.0.0.1:27020");
  await expect(page.getByTestId("gcs-watch-live-delay")).toHaveText("întârziere 90 s");
  await page.goto(`/servers/matches?server=${serverId}&status=live`);
  await expect(page.getByTestId("gcs-mix-card").filter({ has: page.getByTestId("gcs-mix-card-watch") })).toHaveCount(1);
  await expect(page.getByTestId("gcs-mix-card-watch")).toHaveAttribute("href", "steam://connect/127.0.0.1:27020");
  await page.goto(serverHref);
  await expect(page.getByTestId("gcs-watch-live")).toHaveAttribute("href", "steam://connect/127.0.0.1:27020");

  // Pentru un test scurt: fără întârziere la final (demo-ul se aduce la 30 s după meci, nu la 2 minute).
  await sql(`UPDATE game_server_tv SET delay = 0 WHERE "serverId" = $1`, [serverId]);
  await mock.finishMix(ctx);
  await page.goto(`/servers/matches/${matchId}`);
  await expect(page.getByTestId("gcs-watch-live")).toHaveCount(0);
  // Staff-ul vede demo-ul în așteptare.
  await expect(page.getByTestId("gcs-demo-state").first()).toHaveAttribute("data-status", /waiting|fetching|available/);

  // gcs-worker îl aduce (jobul programat la final); pagina meciului arată descărcarea.
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId("gcs-demo-download")).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 120_000, intervals: [3000] });
  await expect(page.getByTestId("gcs-demo-state").first()).toHaveAttribute("data-status", "available");
  await expect(page.getByTestId("gcs-demo-downloads")).toHaveText("Descărcări: 0");
  const href = await page.getByTestId("gcs-demo-download").getAttribute("href");
  expect(href).toMatch(/^\/api\/servers\/demos\/\d+$/);

  // Un vizitator (fără cont) îl descarcă: fișierul .dem identic, ca atașament, privat.
  const guest = await browser.newContext({ baseURL });
  const res = await guest.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-disposition"]).toContain(`de_mirage-`);
  expect(res.headers()["cache-control"]).toBe("private, no-store");
  const body = await res.body();
  expect(createHash("sha256").update(body).digest("hex")).toBe(createHash("sha256").update(folder!.demo).digest("hex"));
  await guest.close();
  const [row] = await sql<{ downloads: number; encoding: string; status: string }>(`SELECT downloads, encoding, status FROM game_match_demos WHERE "matchId" = $1`, [matchId]);
  expect(row).toEqual({ downloads: 1, encoding: "gzip", status: "AVAILABLE" });

  // ACP: ultima aducere reușită și demo-ul în lista ultimelor.
  await page.goto(`/admin/gaming/servers/${serverId}/bridge`);
  await expect(page.getByTestId("gcs-tv-last-fetch")).toContainText("reușită");
  await expect(page.getByTestId("gcs-tv-demo").first()).toHaveAttribute("data-status", "available");
  // ID-ul inexistent → 404.
  expect((await page.request.get("/api/servers/demos/999999999")).status()).toBe(404);

  // SFTP: „Testează conexiunea” rulează în procesul web; parola nu se arată înapoi și stă sigilată în baza de date.
  const sftp = await startSftpDemoServer(new Map([[folder!.name, { bytes: folder!.demo }]]));
  try {
    const box = page.getByTestId("gcs-bridge-tv");
    await box.getByTestId("gcs-tv-source").selectOption("sftp");
    await box.getByTestId("gcs-tv-host").fill("127.0.0.1");
    await box.locator('input[name="port"]').fill(String(sftp.port));
    await box.getByTestId("gcs-tv-username").fill(sftp.user);
    await box.getByTestId("gcs-tv-password").fill(sftp.pass);
    await box.getByTestId("gcs-tv-dir").fill(sftp.dir);
    await box.getByRole("button", { name: "Salvează HLTV / GOTV" }).click();
    await expect(box.getByRole("status").filter({ hasText: "Salvat" })).toBeVisible();
    await box.getByTestId("gcs-tv-test").click();
    await expect(box.getByTestId("gcs-tv-test-result")).toContainText("1 demo-uri");
    await expect(box.getByTestId("gcs-tv-test-result")).toContainText("amprenta SHA256:");
    await page.reload();
    await expect(page.getByTestId("gcs-tv-password")).toHaveValue("");
    expect(await page.content()).not.toContain(sftp.pass);
    const [cfg] = await sql<{ secret: string; hostKey: string }>(`SELECT secret, "hostKey" FROM game_server_tv WHERE "serverId" = $1`, [serverId]);
    expect(cfg!.secret).toMatch(/^v1\./);
    expect(cfg!.secret).not.toContain(sftp.pass);
    expect(cfg!.hostKey).toMatch(/^SHA256:/);
  } finally {
    await sftp.close();
  }
});
