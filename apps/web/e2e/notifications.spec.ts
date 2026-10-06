import { expect, test } from "@playwright/test";
import { fixture, forumTree, member, topicWithReplies, uid } from "./forum-fixtures";
import { sql, userId, useFreshIp } from "./helpers";

/** Un al doilea membru, creat direct în bază (doar autor de conținut prin fixture-uri, fără browser). */
async function otherMember(id: string, name: string, email: string): Promise<void> {
  await sql(
    `INSERT INTO users (id, name, "nameNormalized", email, "primaryGroupId", "updatedAt") VALUES ($1, $2, $3, $4, (SELECT id FROM groups WHERE key = 'member'), $5)`,
    [`e2e${id}${Math.random().toString(36).slice(2, 8)}`, name, name.toLowerCase(), email, "2026-01-01T00:00:00Z"],
  );
}

/** Notificările (specul etapei 4 §8): clopoțelul live, dropdown-ul, preferințele și plicul live. */
test("A urmărește un topic; B răspunde → clopoțelul lui A arată 1 fără reîncărcare; click duce la postare", async ({ page, request, context }) => {
  await useFreshIp(context, "203.0.113");
  const id = uid();
  const { forum } = await forumTree(request);
  const a = `ana-${id}@example.com`;
  const b = `bogdan-${id}@example.com`;
  await member(page, `Ana${id}`, a);
  await otherMember(id, `Bogdan${id}`, b);

  const topic = await topicWithReplies(request, forum.id, b, `Urmărit ${id}`);
  await sql(`INSERT INTO follows ("userId", "contentType", "contentId") VALUES ($1, 'topic', $2) ON CONFLICT DO NOTHING`, [await userId(a), String(topic.topicId)]);

  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-realtime", "on", { timeout: 20_000 });
  await expect(page.getByTestId("gcs-header-bell-count")).toHaveCount(0);

  const reply = await fixture<{ postId: number }>(request, { action: "reply", topicId: topic.topicId, text: "Un răspuns nou", authorEmail: b });
  await expect(page.getByTestId("gcs-header-bell-count")).toHaveText("1", { timeout: 10_000 });

  await page.getByTestId("gcs-header-bell").click();
  const panel = page.getByTestId("gcs-notif-panel");
  await expect(panel).toBeVisible();
  const item = panel.getByRole("link", { name: new RegExp(`Bogdan${id} a răspuns în „Urmărit ${id}”`) });
  await expect(item).toBeVisible();
  await item.click();
  await expect(page).toHaveURL(new RegExp(`/topic/${topic.topicId}-`));
  await expect(page.locator(`#post-${reply.postId}`)).toBeVisible();
  await expect(page.getByTestId("gcs-header-bell-count")).toHaveCount(0);

  // Escape închide dropdown-ul.
  await page.getByTestId("gcs-header-bell").click();
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
});

test("preferința Site oprită pentru răspunsuri → nicio notificare nouă", async ({ page, request, context }) => {
  await useFreshIp(context, "203.0.111");
  const id = uid();
  const { forum } = await forumTree(request);
  const a = `ana2-${id}@example.com`;
  const b = `bogdan2-${id}@example.com`;
  await member(page, `Ana${id}`, a);
  await otherMember(id, `Bogdan${id}`, b);
  const topic = await topicWithReplies(request, forum.id, b, `Tăcut ${id}`);
  await sql(`INSERT INTO follows ("userId", "contentType", "contentId") VALUES ($1, 'topic', $2) ON CONFLICT DO NOTHING`, [await userId(a), String(topic.topicId)]);

  await page.goto("/settings/notifications");
  const row = page.getByTestId("gcs-pref-forums.reply");
  await row.getByRole("checkbox").uncheck();
  await page.getByRole("button", { name: "Salvează", exact: true }).click();
  await expect(page.getByTestId("gcs-settings-status")).toHaveText("Preferințele au fost salvate.");

  await fixture(request, { action: "reply", topicId: topic.topicId, text: "Nu trebuie să ajungă", authorEmail: b });
  await expect.poll(async () => (await sql(`SELECT 1 FROM notifications WHERE "userId" = $1`, [await userId(a)])).length).toBe(0);
});

test("un mesaj privat nou crește plicul live", async ({ page, request, context }) => {
  await useFreshIp(context, "203.0.110");
  const id = uid();
  const a = `ana3-${id}@example.com`;
  const b = `bogdan3-${id}@example.com`;
  await member(page, `Ana${id}`, a);
  await otherMember(id, `Bogdan${id}`, b);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-realtime", "on", { timeout: 20_000 });
  await expect(page.getByTestId("gcs-header-unread")).toHaveCount(0);
  await fixture(request, { action: "pm", fromEmail: b, toEmail: a, title: `Salut ${id}`, text: "Ce faci?" });
  await expect(page.getByTestId("gcs-header-unread")).toHaveText("1", { timeout: 10_000 });
  await expect(page.getByTestId("gcs-header-bell-count")).toHaveText("1");
});
