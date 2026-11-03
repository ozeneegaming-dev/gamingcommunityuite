import { e2eKv } from "./kv";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { forumTree, memberInNewContext, topicWithReplies, uid } from "./forum-fixtures";
import { enterAcpAsRoot, groupId, sql, userId, useFreshIp } from "./helpers";

/**
 * Grupurile peste tot (specul 2026-10-10-nume-mentiuni-grupuri-peste-tot): pastila oricărui grup (și a unuia creat acum
 * în ACP) e un link spre membrii lui, cu tooltip-ul numărătorii; legenda și postbit-ul duc la `/members?group=<id>`;
 * grupul afișat după prioritate (Moderator principal + VIP secundar) și pastilele grupurilor secundare; aplicația
 * premium Grupuri Pro: oprită → legenda simplă și 404 pe `/members/groups`, pornită → legenda pe categorii și pagina.
 */
const SHOTS = process.env.GCS_E2E_SHOTS ?? "";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});

const id = uid();
const rootName = `Gr${id}`;
const rootEmail = `groups-root-${id}@example.com`;
const testersName = `Testeri${id}`;
let rootPage: Page;
let testersId = 0;

/** Golește cache-urile grupurilor (listele, numărătorile, legenda, aplicațiile) după scrieri directe în baza E2E. */
async function flushGroupCaches(): Promise<void> {
  const redis = await e2eKv();
  try {
    const keys = await redis.keys("gcs:k:groups*");
    await redis.del("gcs:k:stats:group-legend", "gcs:k:apps:enabled", "gcs:k:groups-pro:places", ...keys);
  } finally {
    redis.disconnect();
  }
}

async function setGroupsPro(enabled: boolean): Promise<void> {
  await sql(`INSERT INTO apps (key, enabled, "updatedAt") VALUES ('groups_pro', $1, now()) ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, "updatedAt" = now()`, [enabled]);
  await flushGroupCaches();
}

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `groups-${name}.png`), fullPage: false });
}

test.afterAll(async () => {
  await setGroupsPro(false).catch(() => {});
});

test("un grup creat acum în ACP: pastila e link spre membrii lui, cu tooltip-ul „1 membru”", async ({ browser }) => {
  const context = await browser.newContext();
  await useFreshIp(context, "198.18.60");
  rootPage = await context.newPage();
  await enterAcpAsRoot(rootPage, rootName, rootEmail);

  await rootPage.goto("/admin/groups");
  await rootPage.getByTestId("gcs-group-new").click();
  const create = rootPage.getByRole("dialog", { name: "Grup nou" });
  await create.getByLabel("Numele grupului").fill(testersName);
  await create.getByRole("button", { name: "Creează grupul" }).click();
  await expect(rootPage).toHaveURL(/\/admin\/groups\/\d+$/);
  await expect.poll(async () => (await sql<{ id: number }>(`SELECT id FROM groups WHERE name = $1`, [testersName]))[0]?.id ?? 0).toBeGreaterThan(0);
  testersId = (await sql<{ id: number }>(`SELECT id FROM groups WHERE name = $1`, [testersName]))[0]!.id;

  // Membrul primește grupul ca grup secundar; pastila apare lângă grupul lui afișat, pe profil.
  const tester = await memberInNewContext(browser, `Tes${id}`, `groups-tester-${id}@example.com`, "198.18.61");
  const testerId = await userId(`groups-tester-${id}@example.com`);
  await sql(`INSERT INTO user_groups ("userId", "groupId") VALUES ($1, $2)`, [testerId, testersId]);
  await flushGroupCaches();

  await tester.goto(`/members/${testerId}`);
  const pill = tester.getByTestId("gcs-profile-secondary-group").filter({ hasText: testersName });
  await expect(pill).toHaveAttribute("href", `/members?group=${testersId}`);
  // Singurul membru îl are ca grup secundar: „1 membru, toți ca grup secundar · 1 online acum”.
  await expect(pill).toHaveAttribute("aria-label", new RegExp(`Membrii grupului ${testersName} · 1 membru, toți ca grup secundar · \\d+ online acum`));
  await pill.hover();
  await expect(tester.locator(".gcs-tooltip--group")).toContainText("1 membru");
  await shot(tester, "tooltip-new-group");
  await pill.click();
  await expect(tester).toHaveURL(new RegExp(`/members\\?group=${testersId}$`));
  await expect(tester.getByTestId("gcs-members-group-heading")).toContainText(testersName);
  const card = tester.getByTestId("gcs-member-card").filter({ hasText: `Tes${id}` });
  await expect(card.getByTestId("gcs-member-group-tag")).toHaveText("secundar");
  await tester.context().close();
});

test("legenda și postbit-ul: pastilele duc la membrii grupului; Moderator principal + VIP secundar", async ({ browser, request }) => {
  const context = await browser.newContext();
  await useFreshIp(context, "198.18.62");
  const visitor = await context.newPage();
  await flushGroupCaches();

  await test.step("legenda simplă din panoul de statistici: hover = numărătoarea, click = membrii grupului", async () => {
    await visitor.goto("/");
    const legend = visitor.locator('[data-widget="core.statsPanel"] [data-testid="gcs-legend"]:visible');
    const pill = legend.locator("a.gcs-legend__pill").filter({ hasText: "Root Admin" });
    await expect(pill).toHaveAttribute("href", `/members?group=${await groupId("root_admin")}`);
    await pill.hover();
    await expect(visitor.locator(".gcs-tooltip--group")).toContainText(/membr/);
    await pill.click();
    await expect(visitor).toHaveURL(new RegExp(`/members\\?group=${await groupId("root_admin")}$`));
    await expect(visitor.getByTestId("gcs-members-group-heading")).toContainText("Root Admin");
    await expect(visitor.getByTestId("gcs-member-card").filter({ hasText: rootName })).toBeVisible();
  });

  await test.step("un moderator cu VIP ca grup secundar: grupul afișat e Moderator, VIP apare ca pastilă secundară", async () => {
    const modEmail = `groups-mod-${id}@example.com`;
    const mod = await memberInNewContext(browser, `Mod${id}`, modEmail, "198.18.63");
    await sql(`UPDATE users SET "primaryGroupId" = $1 WHERE email = $2`, [await groupId("moderator"), modEmail]);
    await sql(`INSERT INTO user_groups ("userId", "groupId") VALUES ($1, $2)`, [await userId(modEmail), await groupId("vip_gold")]);
    await flushGroupCaches();
    const { forum } = await forumTree(request);
    const topic = await topicWithReplies(request, forum.id, modEmail, `Grupuri ${id}`);
    await visitor.goto(topic.url);
    const post = visitor.getByTestId("gcs-post").first();
    const shown = post.getByTestId("gcs-postbit-group");
    await expect(shown).toContainText("Moderator");
    await expect(post.getByTestId("gcs-postbit-secondary-groups")).toContainText("VIP Gold");
    // Numele are stilul grupului afișat (Moderator), nu al VIP-ului.
    await expect(post.locator(".gcs-post__authorName a.gcs-name")).toHaveClass(/gcs-name--moderator/);
    await shot(visitor, "postbit-secondary");
    await shown.click();
    await expect(visitor).toHaveURL(new RegExp(`/members\\?group=${await groupId("moderator")}$`));
    await expect(visitor.getByTestId("gcs-member-card").filter({ hasText: `Mod${id}` })).toBeVisible();
    // Profilul: grupul afișat (plin) și grupul secundar.
    await visitor.goto(`/members/${await userId(modEmail)}`);
    await expect(visitor.getByTestId("gcs-profile-group")).toContainText("Moderator");
    await expect(visitor.getByTestId("gcs-profile-secondary-group").filter({ hasText: "VIP Gold" })).toBeVisible();
    await mod.context().close();
  });
  await context.close();
});

test("Grupuri Pro: oprită → legenda simplă și 404; pornită → legenda pe categorii, grupurile legate și pagina grupurilor", async ({ browser }) => {
  const context = await browser.newContext();
  await useFreshIp(context, "198.18.64");
  const page = await context.newPage();
  await page.goto("/");

  await test.step("oprită (implicit): legenda simplă, `/members/groups` nu există", async () => {
    await setGroupsPro(false);
    await page.goto("/");
    await expect(page.locator('[data-widget="core.statsPanel"] [data-testid="gcs-legend"]:visible')).toBeVisible();
    await expect(page.getByTestId("gcs-legend-pro")).toHaveCount(0);
    const res = await page.goto("/members/groups");
    expect(res?.status()).toBe(404);
  });

  await test.step("pornită: cardurile categoriilor, rândurile cu numărători, dropdown-ul grupurilor legate", async () => {
    // Grupul creat mai devreme: în legendă, sub Administrator (Staff).
    await sql(`UPDATE groups SET "inLegend" = true WHERE id = $1`, [testersId]);
    await sql(`INSERT INTO group_settings ("groupId", key, value) VALUES ($1, 'legend.category', '"staff"'::jsonb), ($1, 'legend.parent', $2::jsonb) ON CONFLICT ("groupId", key) DO UPDATE SET value = EXCLUDED.value`, [
      testersId,
      JSON.stringify(await groupId("admin")),
    ]);
    await sql(`UPDATE groups SET "inLegend" = true WHERE key = 'admin'`);
    await setGroupsPro(true);
    await page.goto("/");
    const legend = page.locator('[data-testid="gcs-legend-pro"]:visible');
    await expect(legend).toBeVisible();
    await expect(page.locator(".gcs-legendPro__heading:visible")).toHaveText("Legenda grupurilor");
    await expect(legend.locator('[data-category="staff"] .gcs-legendPro__title')).toContainText("Staff");
    const row = legend.getByTestId("gcs-legend-pro-row").filter({ hasText: "Root Admin" });
    await expect(row).toHaveAttribute("href", `/members?group=${await groupId("root_admin")}`);
    await row.hover();
    await expect(page.locator(".gcs-tooltip--group")).toContainText(/membr/);
    const toggle = legend.locator('[data-category="staff"]').getByTestId("gcs-legend-pro-toggle");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const menu = legend.getByTestId("gcs-legend-pro-menu");
    await expect(menu).toContainText(testersName);
    await expect(menu).toContainText("Grupuri secundare legate");
    await shot(page, "legend-pro");
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(toggle).toBeFocused();
  });

  await test.step("„Vezi toate grupurile” → pagina grupurilor: rândurile se deschid, filtrul secundar", async () => {
    await page.locator('[data-testid="gcs-legend-pro-all"]:visible').click();
    await expect(page).toHaveURL(/\/members\/groups$/);
    await expect(page.locator(".gcs-groupsPage h1")).toContainText("Grupurile comunității");
    const row = page.getByTestId("gcs-groups-row-root_admin");
    const head = row.getByRole("button");
    await expect(head).toHaveAttribute("aria-expanded", "false");
    await head.click();
    await expect(head).toHaveAttribute("aria-expanded", "true");
    await expect(row.getByTestId("gcs-groups-member").first()).toBeVisible();
    await expect(row.getByRole("link", { name: /Toți membrii grupului/ })).toHaveAttribute("href", `/members?group=${await groupId("root_admin")}`);
    await shot(page, "groups-page");
    // Căutarea după un membru: grupurile lui, deschise, cu el în listă.
    await page.getByTestId("gcs-groups-search").fill(rootName);
    await page.getByTestId("gcs-groups-search").press("Enter");
    await expect(page).toHaveURL(new RegExp(`q=${rootName}`));
    const found = page.getByTestId("gcs-groups-row-root_admin");
    await expect(found.getByRole("button")).toHaveAttribute("aria-expanded", "true");
    await expect(found.getByTestId("gcs-groups-member").filter({ hasText: rootName })).toBeVisible();
    await page.goto("/members/groups");
    await page.getByTestId("gcs-groups-scope").getByRole("link", { name: "Doar secundar" }).click();
    await expect(page).toHaveURL(/scope=secondary/);
    await expect(page.getByTestId(`gcs-groups-row-${(await sql<{ key: string }>(`SELECT key FROM groups WHERE id = $1`, [testersId]))[0]!.key}`)).toBeVisible();
  });
  await setGroupsPro(false);
  await context.close();
});
