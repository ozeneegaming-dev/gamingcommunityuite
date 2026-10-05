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
