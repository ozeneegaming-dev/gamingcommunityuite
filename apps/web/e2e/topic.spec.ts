import { expect, test } from "@playwright/test";
import { forumTree, member, memberInNewContext, topicWithReplies, typeInEditor, uid } from "./forum-fixtures";
import { sql, useFreshIp } from "./helpers";

test.beforeEach(async ({ context }) => {
  await useFreshIp(context, "198.18.30");
});

test("un membru răspunde: răspunsul apare la final, iar contorul crește", async ({ page, request }) => {
  const t = await forumTree(request);
  const id = uid();
  await member(page, `Ana${id}`, `ana-${id}@example.com`);
  const topic = await topicWithReplies(request, t.forum.id, `ana-${id}@example.com`, "Întrebare despre configuri");

  await page.goto(topic.url);
  // În română, 0 ia forma „few”: „0 răspunsuri”.
  await expect(page.getByText("0 răspunsuri", { exact: true })).toBeVisible();
  await typeInEditor(page, "Folosesc crosshair-ul static.");
  await page.getByRole("button", { name: "Trimite răspunsul" }).click();

  await expect(page.getByTestId("gcs-post").last()).toContainText("Folosesc crosshair-ul static.");
  await expect(page).toHaveURL(/#post-\d+$/);
  await expect(page.getByText("1 răspuns", { exact: true })).toBeVisible();
});

test("„Citează” inserează citatul cu autorul în răspuns", async ({ page, request }) => {
  const t = await forumTree(request);
  const id = uid();
  await member(page, `Bogdan${id}`, `bogdan-${id}@example.com`);
  const topic = await topicWithReplies(request, t.forum.id, `bogdan-${id}@example.com`, "Topic cu citat");

  await page.goto(topic.url);
  await page.getByTestId("gcs-post").first().getByRole("button", { name: "Citează" }).click();
  await expect(page.locator("#reply .gcs-quote")).toContainText("Primul mesaj din Topic cu citat");
  await typeInEditor(page, "Sunt de acord.");
  await page.getByRole("button", { name: "Trimite răspunsul" }).click();

  const last = page.getByTestId("gcs-post").last();
  await expect(last.locator("blockquote.gcs-quote")).toContainText(`Bogdan${id} a scris:`);
  await expect(last).toContainText("Sunt de acord.");
});

test("reacția „Like” crește contorul, iar a doua apăsare o retrage; raportarea afișează confirmarea", async ({ page, browser, request }) => {
  const t = await forumTree(request);
  const id = uid();
  const author = await memberInNewContext(browser, `Autor${id}`, `autor-${id}@example.com`, "198.18.31");
  const topic = await topicWithReplies(request, t.forum.id, `autor-${id}@example.com`, "Topic cu reacții");
  await author.context().close();

  await member(page, `Fan${id}`, `fan-${id}@example.com`);
  await page.goto(topic.url);
  const post = page.getByTestId("gcs-post").first();
  await post.getByRole("button", { name: "Reacționează", exact: true }).click();
  await post.getByRole("button", { name: "Reacționează cu Like" }).click();
  await expect(post.getByRole("button", { name: "Like: 1" })).toHaveAttribute("aria-pressed", "true");
  const [rep] = await sql<{ reputation: number }>(`SELECT reputation FROM users WHERE email = $1`, [`autor-${id}@example.com`]);
  expect(rep!.reputation).toBe(1);

  await post.getByRole("button", { name: "Like: 1" }).click();
  await expect(post.getByRole("button", { name: /^Like:/ })).toHaveCount(0);

  await post.getByRole("button", { name: "Raportează" }).click();
  await page.getByLabel("Motivul raportului").fill("Conținut nepotrivit");
  await page.getByRole("button", { name: "Trimite raportul" }).click();
  await expect(post.getByRole("button", { name: "Raport trimis. Mulțumim!" })).toBeVisible();
});

test("autorul își editează postarea („Editat”) și și-o ascunde; alt membru nu o mai vede", async ({ page, browser, request }) => {
  const t = await forumTree(request);
  const id = uid();
  await member(page, `Cristi${id}`, `cristi-${id}@example.com`);
  const topic = await topicWithReplies(request, t.forum.id, `cristi-${id}@example.com`, "Topic de editat", 1);

  await page.goto(topic.url);
  const reply = page.getByTestId("gcs-post").nth(1);
  await reply.getByRole("button", { name: "Editează" }).click();
  await reply.locator(".gcs-editor__content").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" (corectat)");
  await reply.getByRole("button", { name: "Salvează" }).click();
  await expect(reply).toContainText("Răspunsul 1 (corectat)");
  await expect(reply.getByText(/^Editat /)).toBeVisible();

  page.once("dialog", (d) => void d.accept());
  await reply.getByRole("button", { name: "Ascunde" }).click();
  // O postare ascunsă o mai văd doar moderatorii (nici autorul).
  await expect(page.getByTestId("gcs-post")).toHaveCount(1);

  const other = await memberInNewContext(browser, `Dana${id}`, `dana-${id}@example.com`, "198.18.32");
  await other.goto(topic.url);
  await expect(other.getByTestId("gcs-post")).toHaveCount(1);
  await expect(other.getByText("Răspunsul 1 (corectat)")).toHaveCount(0);
  await other.context().close();
});

test("permalink-ul duce la pagina și ancora corectă; un topic blocat nu are casetă de răspuns", async ({ page, request }) => {
  const t = await forumTree(request);
  const id = uid();
  await member(page, `Emil${id}`, `emil-${id}@example.com`);
  const topic = await topicWithReplies(request, t.forum.id, `emil-${id}@example.com`, "Topic lung", 22);

  await page.goto(`/topic/${topic.topicId}/post/${topic.ids[21]}`);
  await expect(page).toHaveURL(new RegExp(`\\?page=2#post-${topic.ids[21]}$`));
  await expect(page.locator(`#post-${topic.ids[21]}`)).toBeVisible();

  await sql(`UPDATE topics SET locked = true WHERE id = $1`, [topic.topicId]);
  await page.goto(topic.url);
  await expect(page.locator("#reply")).toHaveCount(0);
  await expect(page.getByTestId("gcs-no-reply")).toContainText("Topicul este blocat");
});

test("postbit-ul: grupul, bara de XP, câmpurile cu iconiță și imagine; un câmp doar pentru staff lipsește vizitatorului", async ({ page, request }) => {
  const t = await forumTree(request);
  const id = uid();
  const field = (body: Record<string, unknown>) => request.post("/api/_test/forum", { data: { action: "profileField", ...body } }).then((r) => r.json() as Promise<{ id: number }>);
  const country = await field({ key: `pb_c_${id}`, label: `Țară ${id}`, icon: "fa-solid fa-flag" });
  const weapon = await field({ key: `pb_w_${id}`, label: `Armă ${id}`, type: "IMAGE_SELECT", options: ["AWP", "AK-47"], optionImages: { AWP: "/files/awp-test" } });
  const secret = await field({ key: `pb_s_${id}`, label: `Secret ${id}`, visibility: "STAFF" });

  await member(page, `Post${id}`, `post-${id}@example.com`);
  const [user] = await sql<{ id: string }>(`UPDATE users SET points = 150, "customTitle" = $2 WHERE email = $1 RETURNING id`, [`post-${id}@example.com`, `Sniperul ${id}`]);
  for (const [fieldId, value] of [[country.id, "România"], [weapon.id, "AWP"], [secret.id, "ascuns"]] as const) {
    await sql(`INSERT INTO profile_field_values ("userId", "fieldId", value) VALUES ($1, $2, $3)`, [user!.id, fieldId, value]);
  }
  const topic = await topicWithReplies(request, t.forum.id, `post-${id}@example.com`, `Postbit ${id}`);

  // Autorul își vede și câmpul doar pentru staff.
  await page.goto(topic.url);
  const own = page.getByTestId("gcs-post").first().getByTestId("gcs-postbit");
  await expect(own).toContainText(`Sniperul ${id}`);
  await expect(own.getByTestId("gcs-postbit-fields")).toContainText(`Secret ${id}`);

  // Vizitatorul: titlul, grupul, XP-ul, câmpurile publice cu iconiță și imagine; fără câmpul de staff.
  const visitor = await page.context().browser()!.newContext();
  await useFreshIp(visitor, "198.18.31");
  const guest = await visitor.newPage();
  await guest.goto(topic.url);
  const card = guest.getByTestId("gcs-post").first().getByTestId("gcs-postbit");
  await expect(card.getByTestId("gcs-postbit-group")).toBeVisible();
  await expect(card.getByRole("progressbar")).toHaveAttribute("aria-valuenow", /^\d+$/);
  await expect(card.getByTestId("gcs-postbit-xp")).toContainText(/15\d/); // 150 + punctele primei postări
  const fields = card.getByTestId("gcs-postbit-fields");
  await expect(fields.locator(`[data-field="pb_c_${id}"]`)).toContainText("România");
  await expect(fields.locator(`[data-field="pb_c_${id}"] svg`)).toBeVisible();
  await expect(fields.locator(`[data-field="pb_w_${id}"] img`)).toHaveAttribute("src", "/files/awp-test");
  await expect(fields).not.toContainText(`Secret ${id}`);
  await visitor.close();
});
