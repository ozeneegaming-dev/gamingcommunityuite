import { expect, test, type Browser, type Page } from "@playwright/test";
import { fixture, forumTree, member, topicWithReplies, typeInEditor, uid } from "./forum-fixtures";
import { enterAcpAsRoot, sql, userId, useFreshIp } from "./helpers";

/**
 * Mențiuni v2 (specul 2026-10-10-mentiuni-v2): mențiunile de grup activate din ACP, notificarea membrilor grupului,
 * cardul grupului pe pastilă și hover card-ul membrului pe o @mențiune dintr-o postare (și în formatul vechi).
 */

test.beforeEach(async ({ context }) => {
  await useFreshIp(context, "203.0.113");
});

/** Un membru logat într-un context nou de browser. */
async function memberPage(browser: Browser, name: string, email: string, ipPrefix: string): Promise<Page> {
  const context = await browser.newContext();
  await useFreshIp(context, ipPrefix);
  const page = await context.newPage();
  await member(page, name, email);
  return page;
}

/** Hover pe un element și stratul cardului afișat (după animația de apariție). */
async function hoverCard(page: Page, target: ReturnType<Page["locator"]>) {
  await target.hover();
  const layer = page.locator(".gcs-hoverCardLayer");
  await expect(layer).toBeVisible();
  await expect(layer).not.toHaveAttribute("data-side", "pending");
  return layer;
}

test("adminul activează mențiunile unui grup; un membru îl menționează; membrul grupului e notificat; cardurile pe pastilă și pe mențiune", async ({ page, browser, request }) => {
  const id = uid();
  const rootName = `Root${id}`;
  const rootEmail = `root-mention-${id}@example.com`;
  const groupName = `Echipa${id}`;
  await enterAcpAsRoot(page, rootName, rootEmail);

  // Un grup nou (fără mențiuni, implicit) și un membru al lui, ca grup secundar.
  const [group] = await sql<{ id: number }>(
    `INSERT INTO groups (key, name, color, icon, position, "isProtected", "inLegend") VALUES ($1, $2, '#3DDC97', 'fa-solid fa-gamepad', 900, false, false) RETURNING id`,
    [`custom_e2e_${id}`, groupName],
  );
  const coleg = await memberPage(browser, `Coleg${id}`, `coleg-${id}@example.com`, "198.18.40");
  await sql(`INSERT INTO user_groups ("userId", "groupId") VALUES ($1, $2)`, [await userId(`coleg-${id}@example.com`), group!.id]);

  await test.step("ACP → Grupuri → grupul → Mențiuni: poate fi menționat de membri, cu notificarea membrilor", async () => {
    await page.goto(`/admin/groups/${group!.id}`);
    const section = page.getByRole("region", { name: "Mențiuni" });
    await expect(section.getByRole("checkbox", { name: "Poate fi menționat" })).not.toBeChecked();
    await section.getByRole("checkbox", { name: "Poate fi menționat" }).check();
    await section.getByRole("checkbox", { name: "Membru", exact: true }).check();
    await expect(section.getByRole("checkbox", { name: "Notifică membrii" })).toBeChecked();
    await section.getByLabel("Câți membri primesc cel mult notificarea").fill("20");
    await section.getByRole("button", { name: "Salvează mențiunile" }).click();
    await expect(section.getByRole("status")).toHaveText("Salvat");
    const [row] = await sql<{ value: unknown }>(`SELECT value FROM group_settings WHERE "groupId" = $1 AND key = 'mentions.enabled'`, [group!.id]);
    expect(row!.value).toBe(true);
  });

  const { forum } = await forumTree(request);
  const topic = await topicWithReplies(request, forum.id, rootEmail, `Mențiuni ${id}`);
  const author = await memberPage(browser, `Autor${id}`, `autor-${id}@example.com`, "198.18.41");

  await test.step("membrul alege grupul (primul în listă, cu iconița) și un membru din sugestii, apoi trimite", async () => {
    await author.goto(topic.url);
    await typeInEditor(author, "Salut ");
    await author.keyboard.type(`@Echipa${id.slice(0, 3)}`);
    // Lista de sugestii (bara editorului are și ea `<option>`-uri, în selectorul de mărime).
    const list = author.locator(".gcs-mentionList");
    const groupOption = list.getByRole("option").filter({ hasText: `@${groupName}` });
    await expect(groupOption).toBeVisible();
    await expect(list.getByRole("option").first()).toHaveAttribute("data-kind", "group");
    await expect(groupOption.locator("svg")).toHaveCount(1);
    await groupOption.click();
    await author.keyboard.type(`și @Root${id}`);
    const userOption = list.getByRole("option").filter({ hasText: `@${rootName}` });
    await expect(userOption.locator(".gcs-avatar")).toBeVisible();
    await userOption.click();
    await author.keyboard.type("uitați-vă aici");
    await author.getByRole("button", { name: "Trimite răspunsul" }).click();

    const reply = author.getByTestId("gcs-post").last();
    const pill = reply.locator("a.gcs-groupMention");
    await expect(pill).toHaveText(`@${groupName}`);
    await expect(pill).toHaveAttribute("href", `/members?group=${group!.id}`);
    // Culoarea pastilei vine din CSS-ul generat pentru grup.
    await expect.poll(() => pill.evaluate((el) => getComputedStyle(el).getPropertyValue("--gcs-gm-color").trim())).toBe("#3DDC97");
    await expect(reply.locator("a.gcs-mention")).toHaveText(`@${rootName}`);
  });

  await test.step("membrul grupului primește „menționat prin grupul …” (fan-out-ul din worker)", async () => {
    await expect(async () => {
      await coleg.goto("/notifications");
      await expect(coleg.getByText(`Autor${id} te-a menționat prin grupul ${groupName} în „Mențiuni ${id}”`)).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    // Autorul nu e în grup: nu primește nimic pentru propria mențiune.
    const [own] = await sql<{ n: number }>(`SELECT count(*)::int AS n FROM notifications WHERE type = 'core.group_mention' AND "userId" = $1`, [await userId(`autor-${id}@example.com`)]);
    expect(own!.n).toBe(0);
  });

  await test.step("hover pe pastilă: cardul grupului, cu membrii și „Vezi toți”", async () => {
    await coleg.goto(topic.url);
    const pill = coleg.getByTestId("gcs-post").last().locator("a.gcs-groupMention");
    const layer = await hoverCard(coleg, pill);
    const card = layer.getByTestId("gcs-group-card");
    await expect(card.getByTestId("gcs-group-card-name")).toHaveText(groupName);
    await expect(card.getByTestId("gcs-group-card-members")).toHaveText("1");
    await expect(card.getByRole("link", { name: `Coleg${id}` })).toBeVisible();
    await expect(card.getByTestId("gcs-group-card-all")).toHaveAttribute("href", `/members?group=${group!.id}`);
    await coleg.mouse.move(0, 0);
    await expect(layer).toHaveCount(0);
  });

  await test.step("hover pe mențiunea unui membru dintr-o postare: hover card-ul membrului", async () => {
    const mention = coleg.getByTestId("gcs-post").last().locator("a.gcs-mention");
    const layer = await hoverCard(coleg, mention);
    await expect(layer.getByTestId("gcs-hover-card")).toBeVisible();
    await expect(layer.getByTestId("gcs-hover-card").locator(".gcs-hoverCard__name")).toHaveText(rootName);
  });

  await test.step("„Vezi toți”: lista de membri filtrată pe grup îl conține pe membrul cu grupul secundar", async () => {
    await coleg.goto(`/members?group=${group!.id}`);
    await expect(coleg.getByRole("link", { name: `Coleg${id}` }).first()).toBeVisible();
  });
});

test("o @mențiune salvată în formatul vechi (doar `data-user`) deschide hover card-ul membrului", async ({ page, request }) => {
  const id = uid();
  const { forum } = await forumTree(request);
  await member(page, `Vechi${id}`, `vechi-${id}@example.com`);
  const topic = await topicWithReplies(request, forum.id, `vechi-${id}@example.com`, `Format vechi ${id}`);
  const reply = await fixture<{ postId: number }>(request, { action: "reply", topicId: topic.topicId, text: "salut", authorEmail: `vechi-${id}@example.com`, mentionEmail: `vechi-${id}@example.com` });
  const uidOf = await userId(`vechi-${id}@example.com`);
  // HTML-ul de dinainte de Mențiuni v2: fără `data-user-id`.
  await sql(`UPDATE posts SET "contentHtml" = $2 WHERE id = $1`, [
    reply.postId,
    `<p><a class="gcs-userLink gcs-mention" href="/members/${uidOf}" data-user="${uidOf}">@Vechi${id}</a> salut</p>`,
  ]);
  await page.goto(topic.url);
  const mention = page.locator(`#post-${reply.postId} a.gcs-mention`);
  await expect(mention).not.toHaveAttribute("data-user-id", /.+/);
  const layer = await hoverCard(page, mention);
  await expect(layer.getByTestId("gcs-hover-card").locator(".gcs-hoverCard__name")).toHaveText(`Vechi${id}`);
});
