import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { forumTree, member, topicWithReplies, typeInEditor, uid } from "./forum-fixtures";
import { enterAcpAsRoot, sql, useFreshIp } from "./helpers";

/**
 * Aplicația Clanuri (specul 2026-10-08-clanuri), cap-coadă: staff-ul alege categoria forumurilor private, un VIP creează
 * clanul (cu logo și forum cerut), staff-ul îl aprobă, un membru cere intrarea și liderul îl acceptă, apoi îl numește
 * ofițer; forumul privat se vede doar de membri (un străin primește „fără acces”), excluderea ia accesul imediat, iar
 * desființarea șterge clanul. Cu `GCS_E2E_SHOTS=<folder>` salvează capturile (director, pagina clanului, administrarea,
 * opțiunile din ACP, tema închisă / deschisă, mobil).
 */

test.describe.configure({ mode: "serial" });

const SHOTS = process.env.GCS_E2E_SHOTS ?? "";
const id = uid();
const TAG = `C${id.slice(0, 3).toUpperCase()}`;
const NAME = `Haita Rosie ${id}`;
const LEADER = `Lider${id}`;
const LEADER_EMAIL = `clan-lider-${id}@example.com`;
const ANA = `Ana${id}`;
const BOB = `Bob${id}`;
const CID = `Cid${id}`;
// Un logo mic (PNG), trecut prin pipeline-ul atașamentelor.
const LOGO =
  "iVBORw0KGgoAAAANSUhEUgAAAGAAAAAYCAMAAAAyNwimAAAB6VBMVEWALRCPMRF4Kw+DLhCKMBFxKQ9+LBB7LA+FLhB2Kg99LBBnJg5uKA55Kw+SMhFpJw6XMxKZNBJiJQ2HLxB0Kg9fJA1vKA5/LRCMMBGCLRB8LBCBLRBaIw16Kw+ELhB1Kg93Kw+GLxCILxGRMhFqJw5zKQ9yKQ+JLxGLMBFVIQxwKQ6NMRGOMRFTIQxsKA5tKA6QMRFrJw5sJw6TMhGUMhGWMxJoJg5QIAyUMhKVMxJkJg5lJg5kJQ1mJg6YMxKNMBGILxBhJQ1jJQ2aNBKcNhKdOBKfOhJzKg9eJA1gJA2iPRGkPxGlQRFcIw1bIw1dIw1dJA1LHwusSBGqRxGnQxGoRRFYIg1ZIg2CLhCvTBCtShGyUBCwThBYIgxWIgxXIgxJHguzUhC3VRC4VxBUIQy9XQ+7Ww+/Xw+6WRBSIAxRIAxGHQvFZg/DZA/AYA/CYg9EHQtOIAxPIAxOHwxNHwzKaw7Iag7LbQ7GaA+gPBJKHgtMHwyhPBHQcw7RdQ7OcQ7Nbw5BHAtHHgtIHgu1VBDYfA21UxDVeA3Tdg7Weg0/GwpFHQvZfg3bgA3dgg3egw1DHAtCHAvghQ3hhw3kiwzjiQxAHAvmjQzpkAzojgzrkgw9Gwo+Gwo8Ggo8GwrxmQvulgzslAzwmAt75//pAAAACXBIWXMAAAsTAAALEwEAmpwYAAABOUlEQVRIx7XM1VJCUQAF0I10N6JigoGKjdjdjd1iBwZ2B7bY3fmlPvjo6BzuzFkfsPD69vzi8dy53ZcXLtex07m943Cs2O2rc7PTMzbb2KjFMmA2d/d0NbcYDDXVtXVlWm15vkpVkJWRmS0Wp8pNpsSkuHiJThfN5UaEazTBQmGIj1QayOf7i3g8X4BqHuDHBs2cHSQQgEkuJ8xD1XlhoJlHcjhRYJBLSHN9bkwsaOYsVoIR3uelxLlMlpwCmnlaulUBr3Mf8lyRo1SCZl5YVFwCmvlaRWUVaOaNTQ31IM1FP3mrN3l7W2cHaOa9u339oJmPDA0Og2Y+OTUxDrJc/W++/Ee+tDC/CJr51ub6BohyPUG+/zs/PDjaA8385PTsHCS5kWF+dX17A5r5/ePDEwhyK9P88+Pr/RstbbpQdknnFgAAAABJRU5ErkJggg==";

let clanUrl = "";
let clanId = 0;
let forumId = 0;
const opened: BrowserContext[] = [];

/** Un membru nou într-un context de browser propriu (grupul dat). */
async function user(browser: Browser, name: string, email: string, group: string, ip: string): Promise<Page> {
  const context = await browser.newContext();
  opened.push(context);
  await useFreshIp(context, ip);
  const page = await context.newPage();
  await member(page, name, email, group);
  return page;
}

/** O captură (doar cu `GCS_E2E_SHOTS`), după ce fonturile și imaginile s-au încărcat. */
async function shot(target: Page | Locator, name: string, opts: { fullPage?: boolean } = {}) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const page = "page" in target ? target.page() : target;
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(300);
  if ("page" in target) await target.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  else await target.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: opts.fullPage ?? false });
}

/** Tema site-ului (cookie-ul `gcs-theme`, pe tot site-ul), pentru capturi. */
async function theme(page: Page, value: "dark" | "light") {
  await page.context().addCookies([{ name: "gcs-theme", value, url: `${new URL(page.url()).origin}/` }]);
}

let root: Page;
let leader: Page;
let ana: Page;

test.afterAll(async () => {
  for (const c of opened) await c.close().catch(() => {});
  // Clanul testului dispare (dacă testul s-a oprit înainte de desființare), ca alte specuri să vadă site-ul ca înainte.
  await sql(`DELETE FROM clans WHERE "nameNormalized" LIKE $1`, [`%${id}`]);
});

test("ACP: categoria forumurilor private din opțiuni; tab-urile setărilor", async ({ browser, request }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext();
  opened.push(context);
  await useFreshIp(context, "100.76.0");
  root = await context.newPage();
  await enterAcpAsRoot(root, `ClanAdm${id}`, `clan-adm-${id}@example.com`);
  const tree = await forumTree(request);

  await root.goto("/admin/gaming/clans/settings?tab=forum");
  await expect(root.getByTestId("gcs-acp-clan-settings-tabs")).toBeVisible();
  await root.getByTestId("gcs-acp-clans.forum_parent").selectOption(String(tree.category.id));
  await root.getByTestId("gcs-acp-clans.forum_mode").selectOption("optional");
  await root.getByRole("button", { name: "Salvează" }).click();
  await expect(root.getByRole("status").filter({ hasText: "Salvat" })).toBeVisible();
  await expect(root.getByTestId("gcs-acp-clan-forum-warning")).toHaveCount(0);
  await shot(root, "acp-clans-settings-forum");

  await root.goto("/admin/gaming/clans/settings?tab=groups");
  const vipRow = root.getByTestId("gcs-acp-clan-groups").locator('tr[data-group="vip_gold"]');
  await expect(vipRow.getByRole("checkbox", { name: /Creează clanuri/ })).toBeChecked();
  await expect(root.getByTestId("gcs-acp-clan-groups").locator('tr[data-group="member"]').getByRole("checkbox", { name: /Creează clanuri/ })).not.toBeChecked();
  await shot(root, "acp-clans-settings-groups");
  // Căutarea din ACP duce la pagina proprie a opțiunilor, nu la formularul generic.
  await root.goto("/admin/settings/clans");
  await expect(root).toHaveURL(/\/admin\/gaming\/clans\/settings$/);
});

test("un membru obișnuit nu poate crea; VIP-ul creează clanul, care așteaptă aprobarea", async ({ browser }) => {
  test.setTimeout(180_000);
  const plain = await user(browser, `Simplu${id}`, `clan-simplu-${id}@example.com`, "member", "100.76.1");
  await plain.goto("/clans");
  await expect(plain.getByTestId("gcs-clan-create")).toHaveCount(0);
  await plain.goto("/clans/new");
  await expect(plain.getByTestId("gcs-clan-create-forbidden")).toBeVisible();

  leader = await user(browser, LEADER, LEADER_EMAIL, "vip_gold", "100.76.2");
  await leader.goto("/clans");
  await leader.getByTestId("gcs-clan-create").click();
  await expect(leader).toHaveURL(/\/clans\/new$/);
  const form = leader.getByTestId("gcs-clan-form");
  // Tagul prea lung e refuzat pe câmp.
  await form.getByTestId("gcs-clan-field-tag").fill("PREALUNG");
  await form.getByTestId("gcs-clan-field-name").fill(NAME);
  await form.getByTestId("gcs-clan-submit").click();
  await expect(form.getByTestId("gcs-clan-error-tag")).toHaveText("Prea lung");
  await form.getByTestId("gcs-clan-field-tag").fill(TAG);
  await typeInEditor(leader, `Clan de test ${id}. Jucăm CS2 seara.`, form.locator(".gcs-richInput"));
  await form.getByTestId("gcs-clan-field-color").fill("#e0592a");
  await leader.locator("#gcs-clan-logo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: Buffer.from(LOGO, "base64") });
  await expect(form.getByRole("img", { name: "Logo-ul curent" })).toBeVisible();
  await form.getByLabel("Discord (link de invitație)").fill("https://discord.gg/gcs-e2e");
  await form.getByTestId("gcs-clan-field-forum").check();
  await shot(leader, "clan-create");
  await form.getByTestId("gcs-clan-submit").click();
  await expect(leader).toHaveURL(/\/clans\/\d+-haita-rosie-/);
  clanUrl = new URL(leader.url()).pathname;
  clanId = Number(/\/clans\/(\d+)-/.exec(clanUrl)![1]);
  await expect(leader.getByTestId("gcs-clan-pending")).toBeVisible();
  await expect(leader.getByTestId("gcs-clan-tag")).toContainText(TAG);

  // Până la aprobare, ceilalți nu-l văd.
  expect((await plain.goto(clanUrl))?.status()).toBe(404);
  const [row] = await sql<{ status: string; logoId: string | null; forumRequested: boolean }>(`SELECT status::text, "logoId", "forumRequested" FROM clans WHERE id = $1`, [clanId]);
  expect(row).toMatchObject({ status: "PENDING", forumRequested: true });
  expect(row!.logoId).not.toBeNull();
});

test("staff-ul aprobă clanul din ACP: devine activ, primește forumul privat, fondatorul e anunțat", async () => {
  test.setTimeout(120_000);
  await root.goto("/admin/gaming/clans");
  const item = root.getByTestId("gcs-acp-clan").filter({ hasText: NAME });
  await expect(item).toBeVisible();
  await shot(root, "acp-clans-list");
  await item.getByRole("button", { name: "Aprobă" }).click();
  await expect(item).toHaveCount(0);
  const [row] = await sql<{ status: string; forumId: number | null }>(`SELECT status::text, "forumId" FROM clans WHERE id = $1`, [clanId]);
  expect(row!.status).toBe("ACTIVE");
  expect(row!.forumId).not.toBeNull();
  forumId = row!.forumId!;
  await expect
    .poll(async () => (await sql(`SELECT 1 FROM notifications n JOIN users u ON u.id = n."userId" WHERE u.email = $1 AND n.type = 'clans.review'`, [LEADER_EMAIL])).length)
    .toBe(1);
  await root.goto(`/admin/gaming/clans/${clanId}`);
  await expect(root.getByTestId("gcs-acp-clan-audit")).toContainText("clans.approve");
  await shot(root, "acp-clan-detail");
});

test("un membru cere intrarea, liderul acceptă și îl numește ofițer; forumul privat apare doar membrilor", async ({ browser }) => {
  test.setTimeout(180_000);
  ana = await user(browser, ANA, `clan-ana-${id}@example.com`, "member", "100.76.3");
  await ana.goto("/clans");
  const card = ana.getByTestId("gcs-clan-card").filter({ hasText: NAME });
  await expect(card).toBeVisible();
  // Aprobat, clanul are deja loc în clasament (fără să aștepte recalcularea orară).
  await expect(card.locator(".gcs-clanCard__rank")).toHaveText(/^#\d+$/);
  await card.getByRole("link", { name: NAME, exact: true }).click();
  await expect(ana).toHaveURL(new RegExp(`${clanUrl}$`));
  await expect(ana.getByTestId("gcs-clan-forum")).toHaveCount(0);
  await ana.getByTestId("gcs-clan-request").click();
  await ana.getByTestId("gcs-clan-request-message").fill("Joc CS2 de 3 ani, caut o echipă serioasă.");
  await ana.getByTestId("gcs-clan-request-send").click();
  await expect(ana.getByTestId("gcs-clan-request-pending")).toBeVisible();

  await leader.goto(`${clanUrl}/manage?tab=requests`);
  const request = leader.getByTestId("gcs-clan-request-row").filter({ hasText: ANA });
  await expect(request).toContainText("caut o echipă serioasă");
  await shot(leader, "clan-manage-requests");
  await request.getByTestId("gcs-clan-request-accept").click();
  await expect(leader.getByTestId("gcs-clan-request-row")).toHaveCount(0);

  await leader.goto(`${clanUrl}/manage`);
  const anaRow = leader.getByTestId("gcs-clan-manage-member").filter({ hasText: ANA });
  await expect(anaRow.getByTestId("gcs-clan-member-role")).toHaveText("Membru");
  await anaRow.getByRole("button", { name: "Numește ofițer" }).click();
  await expect(anaRow.getByTestId("gcs-clan-member-role")).toHaveText("Ofițer");
  // Aplicația Servere e activă: liderul vede cine are Steam conectat (statisticile de joc).
  await expect(anaRow.getByTestId("gcs-clan-member-steam")).toHaveText("Neconectat");
  await shot(leader, "clan-manage-members");

  // Ana (acum ofițer) vede forumul clanului; un topic al liderului apare acolo.
  const [forum] = await sql<{ slug: string }>(`SELECT slug FROM forums WHERE id = $1`, [forumId]);
  const topic = await topicWithReplies(leader.request, forumId, LEADER_EMAIL, `Strategia secreta ${id}`, 0);
  await ana.goto(clanUrl);
  await expect(ana.getByTestId("gcs-clan-forum")).toContainText(`Strategia secreta ${id}`);
  // Statisticile de joc (din aplicația Servere): încă niciuna; Ana, fără Steam conectat, primește indicația.
  await expect(ana.getByTestId("gcs-clan-game")).toContainText("Niciun membru nu are încă statistici");
  await expect(ana.getByTestId("gcs-clan-steam-hint")).toBeVisible();
  await ana.getByTestId("gcs-clan-forum-link").click();
  await expect(ana).toHaveURL(new RegExp(`/forum/${forumId}-${forum!.slug}`));
  await expect(ana.getByText(`Strategia secreta ${id}`)).toBeVisible();
  await expect(
    sql(`SELECT 1 FROM notifications n JOIN users u ON u.id = n."userId" WHERE u.email = $1 AND n.type = 'clans.membership'`, [`clan-ana-${id}@example.com`]).then((r) => r.length),
  ).resolves.toBeGreaterThan(0);

  // Un străin (alt membru) nu vede forumul: nici pe pagina clanului, nici la adresa directă, nici topicul.
  const bob = await user(browser, BOB, `clan-bob-${id}@example.com`, "member", "100.76.4");
  await bob.goto(clanUrl);
  await expect(bob.getByTestId("gcs-clan-roster")).toContainText(ANA);
  await expect(bob.getByTestId("gcs-clan-forum")).toHaveCount(0);
  // Fără dreptul de a vedea forumul, nici existența lui nu se dezvăluie: 404.
  expect((await bob.goto(`/forum/${forumId}-${forum!.slug}`))?.status()).toBe(404);
  await bob.goto(topic.url);
  await expect(bob.getByText(`Strategia secreta ${id}`)).toHaveCount(0);
  await bob.goto("/");
  await expect(bob.getByRole("link", { name: `[${TAG}] ${NAME}` })).toHaveCount(0);
});

test("tagul lângă nume: postbit, hover card și profil; capturile paginilor (temă închisă / deschisă, mobil)", async ({ request }) => {
  test.setTimeout(240_000);
  const tree = await forumTree(request);
  const topic = await topicWithReplies(request, tree.forum.id, LEADER_EMAIL, `Salut de la clan ${id}`, 0);
  await leader.goto(topic.url);
  const postbit = leader.getByTestId("gcs-postbit").first();
  await expect(postbit.getByTestId("gcs-postbit-clan")).toContainText(TAG);
  await shot(postbit, "clan-postbit");
  await postbit.locator(".gcs-post__authorName a.gcs-userLink").hover();
  const hover = leader.getByTestId("gcs-hover-card");
  await expect(hover.getByTestId("gcs-hover-clan")).toHaveText(TAG);
  await shot(hover, "clan-hovercard");
  await leader.goto(`/members/${(await sql<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [LEADER_EMAIL]))[0]!.id}`);
  await expect(leader.getByTestId("gcs-profile-clan-tag")).toHaveText(TAG);
  await expect(leader.getByTestId("gcs-profile-clans")).toContainText(NAME);
  await shot(leader.locator(".gcs-profileHeader"), "clan-profile");

  for (const t of ["dark", "light"] as const) {
    await theme(leader, t);
    await leader.goto("/clans");
    await expect(leader.getByTestId("gcs-clan-grid")).toBeVisible();
    await shot(leader, `clans-directory-${t}`);
    await leader.goto(clanUrl);
    await expect(leader.getByTestId("gcs-clan-roster")).toBeVisible();
    await shot(leader, `clan-page-${t}`, { fullPage: true });
    await leader.goto(`${clanUrl}/manage?tab=settings`);
    await expect(leader.getByTestId("gcs-clan-form")).toBeVisible();
    await shot(leader, `clan-manage-settings-${t}`, { fullPage: true });
  }
  await theme(leader, "dark");
  if (SHOTS) {
    await leader.setViewportSize({ width: 390, height: 844 });
    await leader.goto("/clans");
    await shot(leader, "clans-directory-mobile", { fullPage: true });
    await leader.goto(clanUrl);
    await shot(leader, "clan-page-mobile", { fullPage: true });
    await leader.goto(`${clanUrl}/manage`);
    await shot(leader, "clan-manage-mobile", { fullPage: true });
    await leader.setViewportSize({ width: 1280, height: 800 });
  }
});

test("excluderea ia accesul la forum imediat; desființarea șterge clanul", async ({ browser }) => {
  test.setTimeout(180_000);
  // Un al treilea membru intră (cerere acceptată de ofițerul Ana), apoi e scos de lider.
  const cid = await user(browser, CID, `clan-cid-${id}@example.com`, "member", "100.76.5");
  await cid.goto(clanUrl);
  await cid.getByTestId("gcs-clan-request").click();
  await cid.getByTestId("gcs-clan-request-send").click();
  await expect(cid.getByTestId("gcs-clan-request-pending")).toBeVisible();
  await ana.goto(`${clanUrl}/manage?tab=requests`);
  await ana.getByTestId("gcs-clan-request-row").filter({ hasText: CID }).getByTestId("gcs-clan-request-accept").click();
  await expect(ana.getByTestId("gcs-clan-request-row")).toHaveCount(0);
  const [forum] = await sql<{ slug: string }>(`SELECT slug FROM forums WHERE id = $1`, [forumId]);
  const forumUrl = `/forum/${forumId}-${forum!.slug}`;
  await cid.goto(forumUrl);
  await expect(cid.getByRole("heading", { level: 1 })).toContainText(TAG);

  await leader.goto(`${clanUrl}/manage`);
  const row = leader.getByTestId("gcs-clan-manage-member").filter({ hasText: CID });
  leader.once("dialog", (d) => void d.accept());
  await row.getByRole("button", { name: "Scoate din clan" }).click();
  await expect(leader.getByTestId("gcs-clan-manage-member").filter({ hasText: CID })).toHaveCount(0);
  expect((await cid.goto(forumUrl))?.status()).toBe(404);

  // Desființarea: tagul greșit e refuzat, apoi clanul dispare.
  await leader.goto(`${clanUrl}/manage?tab=danger`);
  await leader.getByTestId("gcs-clan-disband-confirm").fill("GRESIT");
  await leader.getByTestId("gcs-clan-disband").click();
  await expect(leader.getByRole("alert").filter({ hasText: "Textul nu se potrivește." })).toBeVisible();
  await shot(leader, "clan-manage-danger");
  await leader.getByTestId("gcs-clan-disband-confirm").fill(TAG.toLowerCase());
  await leader.getByTestId("gcs-clan-disband").click();
  await expect(leader).toHaveURL(/\/clans$/);
  expect(await sql(`SELECT 1 FROM clans WHERE id = $1`, [clanId])).toHaveLength(0);
  expect((await leader.goto(clanUrl))?.status()).toBe(404);
  // Forumul avea un topic: rămâne doar pentru staff, iar fostul ofițer nu-l mai vede.
  expect((await ana.goto(forumUrl))?.status()).toBe(404);
  await expect
    .poll(async () => (await sql(`SELECT 1 FROM notifications n JOIN users u ON u.id = n."userId" WHERE u.email = $1 AND n.data->>'kind' = 'disbanded'`, [`clan-ana-${id}@example.com`])).length)
    .toBe(1);
});
