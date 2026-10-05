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
  const card = page.getByTestId("gcs-acp-rank").filter({ has: page.locator('input[name="name"][value="Recrut"]') });
  await card.getByLabel("Nume").fill(`Recrut ${id}`);
  await card.getByRole("button", { name: "Salvează" }).click();
  await expect(card.getByRole("status")).toBeVisible();

  await expect.poll(async () => {
    await author.reload();
    return author.getByTestId("gcs-post-rank").first().textContent();
  }, { timeout: 2000, intervals: [200] }).toBe(`Recrut ${id}`);

  // Înapoi la numele implicit, ca celelalte teste să vadă „Recrut”.
  const renamed = page.getByRole("region", { name: `Recrut ${id}` });
  await page.reload();
  await renamed.getByLabel("Nume").fill("Recrut");
  await renamed.getByRole("button", { name: "Salvează" }).click();
  await expect(page.getByRole("region", { name: "Recrut", exact: true })).toBeVisible();
  await author.close();
});

test("o regulă nouă „3 postări → badge” se aplică automat de worker după postări", async ({ page, request, browser }) => {
  const id = uid();
  const { forum } = await forumTree(request);
  await enterAcpAsRoot(page, `RootRule${id}`, `root-rule-${id}@example.com`);

  await page.goto("/admin/members/achievements/badges");
  const newBadge = page.locator("section", { has: page.locator("#gcs-badge-new") });
  await newBadge.getByLabel("Cheie").fill(`b_${id}`);
  await newBadge.getByLabel("Nume").fill(`Activ ${id}`);
  await newBadge.getByLabel("Simbol").fill("A");
  await newBadge.getByLabel("Manual (acordat de staff)").uncheck();
  await newBadge.getByRole("button", { name: "Adaugă" }).click();
  await expect(page.getByTestId("gcs-acp-badge").filter({ has: page.locator(`input[value="b_${id}"]`) })).toBeVisible();

  await page.goto("/admin/members/achievements/rules");
  const newRule = page.locator("section", { has: page.locator("#gcs-rule-new") });
  await newRule.getByLabel("Nume").fill(`3 postări ${id}`);
  await newRule.getByLabel("Când").selectOption("POSTS_COUNT");
  await newRule.getByLabel("Prag", { exact: true }).fill("3");
  await newRule.getByLabel("Badge").selectOption({ label: `A Activ ${id}` });
  await newRule.getByRole("button", { name: "Adaugă" }).click();
  await expect(page.getByTestId("gcs-acp-rule").filter({ has: page.locator(`input[value="3 postări ${id}"]`) })).toBeVisible();

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
  await expect(author.getByTestId("gcs-profile-badges").locator(".gcs-badgeGrid__item", { hasText: `Activ ${id}` })).toBeVisible();
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
