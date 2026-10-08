import { expect, test } from "@playwright/test";
import { fixture, forumTree, member, topicWithReplies, typeInEditor, uid } from "./forum-fixtures";
import { sql, useFreshIp } from "./helpers";

test.beforeEach(async ({ context }) => {
  await useFreshIp(context, "198.18.40");
});

test("un membru deschide un topic cu prefix, 2 tag-uri și sondaj, apoi votează", async ({ page, request }) => {
  const t = await forumTree(request);
  const id = uid();
  const [prefix] = await sql<{ id: number }>(`INSERT INTO topic_prefixes (name, color, position) VALUES ($1, '#5EA2FF', 99) RETURNING id`, [
    `Ajutor ${id}`,
  ]);
  await member(page, `Gelu${id}`, `gelu-${id}@example.com`);

  await page.goto(`/forum/${t.forum.id}-${t.forum.slug}`);
  await page.getByRole("link", { name: "Topic nou" }).click();
  await page.getByLabel("Titlu").fill("Ce hartă jucăm diseară?");
  await page.getByLabel("Prefix").selectOption({ label: `Ajutor ${id}` });
  const tagInput = page.getByLabel("Tag-uri");
  await tagInput.fill("cs2");
  await tagInput.press("Enter");
  await tagInput.fill("Hărți");
  await tagInput.press("Enter");
  await typeInEditor(page, "Votați mai jos!", page.locator("form"));
  await page.getByRole("button", { name: "Adaugă un sondaj" }).click();
  await page.getByRole("textbox", { name: "Întrebarea sondajului" }).fill("Ce hartă?");
  await page.getByLabel("Opțiunea 1").fill("Mirage");
  await page.getByLabel("Opțiunea 2").fill("Inferno");
  await page.getByRole("button", { name: "Publică topicul" }).click();

  await expect(page.getByRole("heading", { name: "Ce hartă jucăm diseară?", level: 1 })).toBeVisible();
  await expect(page.getByText(`Ajutor ${id}`).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "#cs2" })).toBeVisible();
  await expect(page.getByRole("link", { name: "#harti" })).toBeVisible();

  await page.getByRole("radio", { name: "Inferno" }).check();
  await page.getByRole("button", { name: "Votează" }).click();
  await expect(page.getByText("votul tău")).toBeVisible();
  expect(prefix).toBeTruthy();
});

test("moderatorul: fixează și blochează, mută din bara de acțiuni, desparte o postare, aprobă din topic", async ({ page, request }) => {
  const t = await forumTree(request);
  const id = uid();
  const target = await fixture<{ id: number; slug: string }>(request, { action: "forum", parentId: t.category.id, type: "FORUM", name: `Arhivă ${id}` });

  await member(page, `Mod${id}`, `mod-${id}@example.com`, "super_moderator");
  const authorEmail = `mod-${id}@example.com`;
  const a = await topicWithReplies(request, t.forum.id, authorEmail, "Primul de mutat");
  const b = await topicWithReplies(request, t.forum.id, authorEmail, "Al doilea de mutat");
  const c = await topicWithReplies(request, t.forum.id, authorEmail, "Topic de moderat", 2);

  // Fixează și blochează din meniul topicului.
  await page.goto(c.url);
  await page.getByText("Unelte de moderare").click();
  await page.getByRole("button", { name: "Fixează" }).click();
  await expect(page.getByRole("button", { name: "Anulează fixarea" })).toBeVisible();
  await page.getByRole("button", { name: "Blochează" }).click();
  await expect(page.getByRole("button", { name: "Deblochează" })).toBeVisible();

  // Despărțirea ultimei postări într-un topic nou.
  await page.getByRole("checkbox", { name: "Selectează postarea #3 pentru despărțire" }).check();
  await page.getByPlaceholder("Titlul topicului nou").fill("Discuție separată");
  await page.getByRole("button", { name: "Desparte postările selectate" }).click();
  await expect(page.getByRole("heading", { name: "Discuție separată", level: 1 })).toBeVisible();
  await expect(page.getByTestId("gcs-post")).toHaveCount(1);

  // Mutarea a două topicuri din bara de acțiuni a forumului.
  await page.goto(`/forum/${t.forum.id}-${t.forum.slug}`);
  await page.getByRole("checkbox", { name: "Selectează Primul de mutat" }).check();
  await page.getByRole("checkbox", { name: "Selectează Al doilea de mutat" }).check();
  await expect(page.getByText("2 topicuri selectate")).toBeVisible();
  await page.getByLabel("Mută în").selectOption({ label: `Arhivă ${id}` });
  await page.getByRole("button", { name: "Mută", exact: true }).click();
  await expect(page.getByRole("link", { name: "Primul de mutat" })).toHaveCount(0);
  const moved = await sql<{ forumId: number }>(`SELECT "forumId" FROM topics WHERE id = ANY($1)`, [[a.topicId, b.topicId]]);
  expect(moved.every((r) => r.forumId === target.id)).toBe(true);

  // Aprobarea unei postări în așteptare, direct din topic.
  const newbieEmail = `nou-${id}@example.com`;
  await sql(
    `INSERT INTO users (id, name, "nameNormalized", email, "primaryGroupId", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, (SELECT id FROM groups WHERE key = 'new_member'), timezone('UTC', now()), timezone('UTC', now()))`,
    [`nou${id}`, `Nou${id}`, `nou${id}`, newbieEmail],
  );
  const pending = await fixture<{ postId: number; pending: boolean }>(request, { action: "reply", topicId: a.topicId, text: "Mesaj de aprobat", authorEmail: newbieEmail });
  expect(pending.pending).toBe(true);
  await page.goto(a.url.replace(/^\/topic\/\d+-/, `/topic/${a.topicId}-`));
  const post = page.locator(`#post-${pending.postId}`);
  await expect(post.getByText("Așteaptă aprobarea unui moderator")).toBeVisible();
  await post.getByRole("button", { name: "Aprobă" }).click();
  await expect(post.getByText("Așteaptă aprobarea unui moderator")).toHaveCount(0);

  // Toate acțiunile apar în jurnal.
  const actions = await sql<{ action: string }>(`SELECT DISTINCT action FROM audit_logs WHERE action LIKE 'mod.%'`);
  expect(actions.map((r) => r.action)).toEqual(
    expect.arrayContaining(["mod.topic.pin", "mod.topic.lock", "mod.topic.split", "mod.topic.move", "mod.post.approve"]),
  );
});
