import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { clearThemeCache } from "./cockpit-fixtures";
import { forumTree, memberInNewContext, topicWithReplies, uid } from "./forum-fixtures";
import { enterAcpAsRoot, sql, userId, useFreshIp } from "./helpers";

/**
 * Realizări v2: constructorul de reguli din ACP (o regulă construită, declanșată de un topic → badge + notificare +
 * widget-ul „Ultimele realizări” live), urcarea în rang (toast + bara de progres), importul „Pachet Gaming”, scara
 * rangurilor și widget-ul în GCS Dark și într-o temă clasică (și la 375 px). Capturile: `GCS_E2E_SHOTS=<folder>`.
 */
const SHOTS = process.env.GCS_E2E_SHOTS ?? "";
const CLASSIC = "e2e-ach-clasic";

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

const widget = (page: Page) => page.locator('[data-widget="profile.recentBadges"]').filter({ visible: true });

test.beforeAll(async () => {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  await sql(
    `INSERT INTO themes (key, name, "isDefault", enabled, settings, "updatedAt") VALUES ($1, 'Clasic Realizări', false, true, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET enabled = true, settings = EXCLUDED.settings, "updatedAt" = now()`,
    [CLASSIC, JSON.stringify({ preset: "classic" })],
  );
  await clearThemeCache();
});

test.afterAll(async () => {
  // Regulile pe evenimente și badge-urile pachetului nu trebuie să schimbe punctele din celelalte teste.
  await sql(`DELETE FROM achievement_rules WHERE trigger = 'EVENT'`);
  await sql(`DELETE FROM badges WHERE key LIKE 'gp\\_%' OR key LIKE 'e2e\\_ach\\_%'`);
  await sql(`DELETE FROM themes WHERE key = $1`, [CLASSIC]);
  await clearThemeCache();
});

test("o regulă construită în ACP: topic → badge + notificare + widget-ul live", async ({ page, request, browser }) => {
  test.setTimeout(120_000);
  const id = uid();
  await useFreshIp(page.context(), "100.94.0");
  const badgeKey = `e2e_ach_${id}`;
  await sql(`INSERT INTO badges (key, name, description, color, "artTier", "artIcon", position) VALUES ($1, $2, 'Primul topic', '#4FA3FF', 'gold', 'fa-solid fa-rocket', 99)`, [badgeKey, `Pionier ${id}`]);
  const { forum } = await forumTree(request);
  await enterAcpAsRoot(page, `AchRoot${id}`, `ach-root-${id}@example.com`);

  await page.goto("/admin/members/achievements/rules");
  const builder = page.getByTestId("gcs-rule-builder");
  await builder.getByLabel("Evenimentul").selectOption("forums.topic");
  await builder.getByTestId("gcs-rule-reward-actor").getByLabel("Badge").selectOption({ label: `Pionier ${id}` });
  await builder.getByTestId("gcs-rule-reward-actor").getByLabel("Puncte").fill("15");
  await builder.getByLabel("Numele regulii").fill(`Pionier ${id}`);
  await expect(builder.getByTestId("gcs-rule-preview")).toContainText("Deschide un topic");
  await expect(builder.getByTestId("gcs-rule-preview")).toContainText(`badge „Pionier ${id}”`);
  await shot(page, "acp-rule-builder");
  await builder.getByRole("button", { name: "Adaugă regula" }).click();
  const row = page.getByTestId("gcs-rule-row").filter({ hasText: `Pionier ${id}` }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText("a 1-a oară");
  await shot(page, "acp-rule-list");

  // Copia (oprită) și ștergerea ei, cu confirmarea din pagină.
  await row.getByRole("button", { name: `Copiază „Pionier ${id}”` }).click();
  const copy = page.getByTestId("gcs-rule-row").filter({ hasText: `Pionier ${id} (2)` });
  await expect(copy).toBeVisible();
  await expect(copy.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  await copy.getByRole("button", { name: `Șterge „Pionier ${id} (2)”` }).click();
  await page.getByTestId("gcs-confirm-ok").click();
  await expect(copy).toHaveCount(0);

  // Vizitatorul are pagina de start deschisă; badge-ul nou apare live în „Ultimele realizări”.
  const visitorContext = await browser.newContext();
  await useFreshIp(visitorContext, "100.94.1");
  const visitor = await visitorContext.newPage();
  await visitor.goto("/");
  await expect(widget(visitor)).toBeVisible();
  const author = await memberInNewContext(browser, `Pionier${id}`, `pionier-${id}@example.com`, "100.94.2");
  await topicWithReplies(request, forum.id, `pionier-${id}@example.com`, `Primul ${id}`);
  const uidAuthor = await userId(`pionier-${id}@example.com`);
  await expect.poll(async () => (await sql(`SELECT 1 FROM user_badges ub JOIN badges b ON b.id = ub."badgeId" WHERE ub."userId" = $1 AND b.key = $2`, [uidAuthor, badgeKey])).length).toBe(1);
  const entry = widget(visitor).getByTestId("gcs-recent-badge").filter({ hasText: `Pionier ${id}` }).first();
  await expect(entry).toBeVisible({ timeout: 15_000 });
  await expect(entry).toContainText(`Pionier${id}`);
  await expect(entry).toContainText("a primit");
  await expect(entry.locator("img.gcs-badgeArt")).toHaveAttribute("src", /^\/badge-art\/v1\/medal-gold-/);
  await shot(visitor, "widget-live-gcs-dark");
  // Notificarea „Ai primit …”.
  await expect.poll(async () => (await sql(`SELECT 1 FROM notifications WHERE "userId" = $1 AND type = 'profile.badge'`, [uidAuthor])).length).toBeGreaterThan(0);
  await author.goto("/notifications");
  await expect(author.getByText(`Pionier ${id}`).first()).toBeVisible();
  await visitorContext.close();
  await author.context().close();
});

test("urcarea în rang: toast-ul de sărbătorire și bara de progres pe profil", async ({ page, request, browser }) => {
  test.setTimeout(120_000);
  const id = uid();
  await useFreshIp(page.context(), "100.94.10");
  const { forum } = await forumTree(request);
  await enterAcpAsRoot(page, `RankRoot${id}`, `rank-root-${id}@example.com`);
  const rankName = `Legendă ${id}`;
  try {
    await page.goto("/admin/members/achievements/ranks");
    await expect(page.getByTestId("gcs-rank-ladder")).toBeVisible();
    const form = page.locator("section", { has: page.locator("#gcs-rank-new") });
    await form.getByLabel("Nume").fill(rankName);
    await form.getByLabel("Postări (minim)").fill("3");
    await form.getByLabel("Treapta emblemei").selectOption("legend");
    await form.getByLabel("Animație discretă").check();
    await form.getByRole("button", { name: "Adaugă" }).click();
    const card = page.getByTestId("gcs-rank-card").filter({ hasText: rankName });
    await expect(card).toBeVisible();
    await expect(card.locator("img.gcs-badgeArt")).toHaveAttribute("src", /rosette-custom-/);
    await shot(page, "acp-rank-ladder");

    const member = await memberInNewContext(browser, `Urcare${id}`, `urcare-${id}@example.com`, "100.94.11");
    await member.goto("/");
    // 3 postări → worker-ul evaluează și trimite evenimentul live în camera membrului.
    await topicWithReplies(request, forum.id, `urcare-${id}@example.com`, `Urcare ${id}`, 2);
    const toast = member.getByTestId("gcs-rank-up");
    await expect(toast).toBeVisible({ timeout: 25_000 });
    await expect(toast).toContainText(rankName);
    await shot(member, "rank-up-toast");
    const uidMember = await userId(`urcare-${id}@example.com`);
    await member.goto(`/members/${uidMember}`);
    const box = member.getByTestId("gcs-profile-achievements");
    await expect(box.getByRole("progressbar")).toBeVisible();
    await expect(box.getByTestId("gcs-achievements-level")).toContainText(rankName);
    await shot(member, "profile-rank-progress");
    // Distribuția: rangul are un membru, cu link spre lista filtrată.
    await page.reload();
    await expect(page.getByTestId("gcs-rank-card").filter({ hasText: rankName }).getByTestId("gcs-rank-members")).toHaveAttribute("href", /\/admin\/members\?rank=\d+/);
    await member.context().close();
  } finally {
    await sql(`DELETE FROM ranks WHERE name = $1`, [rankName]);
  }
});

test("„Pachet Gaming”: importul din ACP adaugă regulile și badge-urile; setările și recalcularea", async ({ page }) => {
  test.setTimeout(90_000);
  const id = uid();
  await useFreshIp(page.context(), "100.94.20");
  await enterAcpAsRoot(page, `PackRoot${id}`, `pack-root-${id}@example.com`);
  await page.goto("/admin/members/achievements/rules");
  await page.getByTestId("gcs-rule-pack").click();
  await page.getByTestId("gcs-confirm-ok").click();
  await expect(page.getByRole("status").filter({ hasText: "Importat:" })).toBeVisible();
  await expect(page.getByTestId("gcs-rule-row").filter({ hasText: "500 de mesaje în chat" })).toBeVisible();
  await expect(page.getByTestId("gcs-rule-row").filter({ hasText: "100 de reacții primite" })).toContainText("cine a dat reacția");
  expect((await sql(`SELECT 1 FROM badges WHERE key = 'gp_marathon'`)).length).toBe(1);
  await shot(page, "acp-gaming-pack");

  await page.goto("/admin/members/achievements/settings");
  const recalc = page.getByTestId("gcs-recalc");
  await recalc.getByRole("button", { name: "Recalculează acum" }).click();
  await expect(recalc).toHaveAttribute("data-state", "done", { timeout: 60_000 });
  await expect(recalc.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  await shot(page, "acp-recalc");
});

for (const theme of [
  { key: "gcs-dark", label: "gcs-dark" },
  { key: CLASSIC, label: "clasic" },
]) {
  test(`widget-ul „Ultimele realizări” în tema ${theme.label} (desktop și 375 px)`, async ({ browser }) => {
    const id = uid();
    await sql(`INSERT INTO badges (key, name, color, "artTier", position) VALUES ($1, $2, '#3DDC97', 'silver', 98) ON CONFLICT (key) DO NOTHING`, [`e2e_ach_t${id}`, `Temă ${id}`]);
    const email = `tema-${id}@example.com`;
    const author = await memberInNewContext(browser, `Tema${id}`, email, "100.94.30");
    await author.context().close();
    await sql(`INSERT INTO user_badges ("userId", "badgeId") SELECT u.id, b.id FROM users u, badges b WHERE u.email = $1 AND b.key = $2`, [email, `e2e_ach_t${id}`]);
    for (const width of [1366, 375]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await useFreshIp(context, "100.94.31");
      const url = new URL(test.info().project.use.baseURL ?? "http://localhost:3100");
      await context.addCookies([{ name: "gcs-skin", value: theme.key, domain: url.hostname, path: "/" }]);
      const page = await context.newPage();
      await page.goto("/");
      await expect(page.locator('link[rel="stylesheet"][href*="gcs-theme.css"]')).toHaveAttribute("href", new RegExp(`t=${theme.key}`));
      const entry = widget(page).getByTestId("gcs-recent-badge").filter({ hasText: `Temă ${id}` }).first();
      await entry.scrollIntoViewIfNeeded();
      await expect(entry).toBeVisible();
      await expect(entry).toContainText(`Tema${id}`);
      // Fără scroll orizontal la 375 px.
      // La 375 px widget-ul încape în lățime (fără scroll orizontal din cauza lui).
      if (width === 375) {
        const box = await widget(page).boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(376);
        expect(await widget(page).evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      }
      await widget(page).scrollIntoViewIfNeeded();
      await shot(page, `widget-${theme.label}-${width}`);
      await context.close();
    }
  });
}
