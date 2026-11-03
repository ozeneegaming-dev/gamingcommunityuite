import { expect, test, type APIRequestContext } from "@playwright/test";
import { forumTree, memberInNewContext, topicWithReplies, uid } from "./forum-fixtures";
import { enterAcpAsRoot, sql, useFreshIp } from "./helpers";

async function profileFixture<T = unknown>(request: APIRequestContext, data: Record<string, unknown>): Promise<T> {
  const res = await request.post("/api/_test/profile", { data });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as T;
}

test.beforeEach(async ({ context }) => {
  await useFreshIp(context, "203.0.113");
});

test("redenumirea rangului „Recrut” apare pe topic în ≤ 2 s", async ({ page, request, browser }) => {
  const id = uid();
  const { forum } = await forumTree(request);
  const author = await memberInNewContext(browser, `Rang${id}`, `rang-${id}@example.com`, "198.51.100");
  const topic = await topicWithReplies(request, forum.id, `rang-${id}@example.com`, `Rang ${id}`);
  await profileFixture(request, { action: "evaluate", email: `rang-${id}@example.com` });
  await author.goto(topic.url);
  await expect(author.getByTestId("gcs-post-rank").first()).toHaveText("Recrut");

  await enterAcpAsRoot(page, `RootRank${id}`, `root-rank-${id}@example.com`);
  await page.goto("/admin/members/achievements/ranks");
  // Doar scara: niciun formular de rang în pagină până nu se deschide panoul.
  const rankRow = (name: string) => page.locator(`[data-testid="gcs-rank-card"][data-rank="${name}"]`);
  await expect(rankRow("Recrut")).toBeVisible();
  await expect(page.locator('input[name="name"]')).toHaveCount(0);
  await rankRow("Recrut").getByTestId("gcs-rank-edit-open").click();
  const panel = page.getByTestId("gcs-rank-edit");
  await expect(panel.getByLabel("Nume", { exact: true })).toHaveValue("Recrut");
  await panel.getByLabel("Nume", { exact: true }).fill(`Recrut ${id}`);
  await panel.getByRole("button", { name: "Salvează" }).click();
  // Salvarea închide panoul, iar scara arată numele nou.
  await expect(panel).toHaveCount(0);
  await expect(rankRow(`Recrut ${id}`)).toBeVisible();

  await expect.poll(async () => {
    await author.reload();
    return author.getByTestId("gcs-post-rank").first().textContent();
  }, { timeout: 2000, intervals: [200] }).toBe(`Recrut ${id}`);

  // Înapoi la numele implicit, ca celelalte teste să vadă „Recrut”.
  await rankRow(`Recrut ${id}`).getByTestId("gcs-rank-edit-open").click();
  await panel.getByLabel("Nume", { exact: true }).fill("Recrut");
  await panel.getByRole("button", { name: "Salvează" }).click();
  await expect(panel).toHaveCount(0);
  await expect(rankRow("Recrut")).toBeVisible();
  await author.close();
});

test("o regulă nouă „3 postări → badge” se aplică automat de worker după postări", async ({ page, request, browser }) => {
  const id = uid();
  const { forum } = await forumTree(request);
  await enterAcpAsRoot(page, `RootRule${id}`, `root-rule-${id}@example.com`);

  await page.goto("/admin/members/achievements/badges");
  // Grila insignelor: niciun editor deschis în pagină.
  await expect(page.getByTestId("gcs-badge-grid")).toBeVisible();
  await expect(page.getByTestId("gcs-badge-editor")).toHaveCount(0);
  await page.getByTestId("gcs-badge-new-open").click();
  const newBadge = page.getByTestId("gcs-badge-new");
  await newBadge.getByLabel("Cheie").fill(`b_${id}`);
  await newBadge.getByLabel("Nume", { exact: true }).fill(`Activ ${id}`);
  await newBadge.getByLabel("Text pe insignă").fill("A");
  // Insigna: forma și nivelul schimbă previzualizarea pe loc.
  await newBadge.getByLabel("Scut").check();
  await newBadge.getByLabel("Aur", { exact: true }).check();
  await expect(newBadge.getByTestId("gcs-badge-preview")).toHaveAttribute("src", /^\/badge-art\/v1\/shield-gold-/);
  await newBadge.getByLabel("Manual (acordat de staff)").uncheck();
  await newBadge.getByRole("button", { name: "Adaugă", exact: true }).click();
  await expect(newBadge).toHaveCount(0);
  const saved = page.getByTestId("gcs-acp-badge").filter({ hasText: `b_${id}` });
  await expect(saved).toBeVisible();
  await expect(saved).toContainText("Automat");
  await expect(saved.locator("img.gcs-badgeArt").first()).toHaveAttribute("src", /^\/badge-art\/v1\/shield-gold-f4b740-i-solid-star\.svg$/);
  // Editarea în panou: datele badge-ului, apoi punctele noi pe card.
  await saved.getByTestId("gcs-badge-edit-open").click();
  const badgePanel = page.getByTestId("gcs-badge-edit");
  await expect(badgePanel.getByLabel("Cheie")).toHaveValue(`b_${id}`);
  await badgePanel.getByLabel("Puncte", { exact: true }).fill("7");
  await badgePanel.getByRole("button", { name: "Salvează" }).click();
  await expect(badgePanel).toHaveCount(0);
  await expect(saved).toContainText("7 puncte");

  await page.goto("/admin/members/achievements/rules");
  // Regulile clasice sunt rânduri compacte: formularul apare doar în panou.
  const classic = page.getByTestId("gcs-classic-rules");
  await expect(classic).toBeVisible();
  await expect(classic.locator('input[name="name"]')).toHaveCount(0);
  await classic.getByTestId("gcs-classic-rule-new-open").click();
  const newRule = page.getByTestId("gcs-classic-rule-new");
  await newRule.getByLabel("Nume", { exact: true }).fill(`3 postări ${id}`);
  await newRule.getByLabel("Când", { exact: true }).selectOption("POSTS_COUNT");
  await newRule.getByLabel("Prag", { exact: true }).fill("3");
  await newRule.getByLabel("Badge", { exact: true }).selectOption({ label: `Activ ${id}` });
  await newRule.getByRole("button", { name: "Adaugă", exact: true }).click();
  await expect(newRule).toHaveCount(0);
  const ruleRow = page.getByTestId("gcs-acp-rule").filter({ hasText: `3 postări ${id}` });
  await expect(ruleRow).toBeVisible();
  await expect(ruleRow).toContainText("Prag 3");
  await expect(ruleRow).toContainText(`Activ ${id}`);
  await expect(ruleRow.getByRole("switch")).toHaveAttribute("aria-checked", "true");

  const author = await memberInNewContext(browser, `Activ${id}`, `activ-${id}@example.com`, "198.51.100");
  await topicWithReplies(request, forum.id, `activ-${id}@example.com`, `Activ ${id}`, 2);
  const [row] = await sql<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [`activ-${id}@example.com`]);
  // Worker-ul evaluează regulile la ~2 s după ultimul eveniment.
  await expect
    .poll(async () => (await sql(`SELECT 1 FROM user_badges ub JOIN badges b ON b.id = ub."badgeId" WHERE ub."userId" = $1 AND b.key = $2`, [row!.id, `b_${id}`])).length, {
      timeout: 20_000,
    })
    .toBe(1);
  await author.goto(`/members/${row!.id}`);
  await expect(author.getByTestId("gcs-profile-badges").locator(".gcs-badgeGrid__item", { hasText: `Activ ${id}` }).locator("img.gcs-badgeArt")).toHaveAttribute("src", /shield-gold-/);
  await author.close();
});

test("promovări: o regulă nouă se salvează și apare în listă", async ({ page }) => {
  const id = uid();
  await enterAcpAsRoot(page, `RootPromo${id}`, `root-promo-${id}@example.com`);
  await page.goto("/admin/members/promotions");
  const form = page.locator("section", { has: page.locator("#gcs-promotion-new") });
  await form.getByLabel("Nume").fill(`Veteran ${id}`);
  await form.getByLabel("Postări (minim)").fill("500");
  await form.getByRole("button", { name: "Promovare nouă" }).click();
  await expect(page.getByTestId("gcs-acp-promotion").filter({ has: page.locator(`input[value="Veteran ${id}"]`) })).toBeVisible();
});
