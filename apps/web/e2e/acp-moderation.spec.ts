import { expect, test } from "@playwright/test";
import { fixture, forumTree, memberInNewContext, topicWithReplies, uid } from "./forum-fixtures";
import { enterAcpAsRoot, sql, useFreshIp } from "./helpers";

test.beforeEach(async ({ context }) => {
  await useFreshIp(context, "100.67.0");
});

/** Un user în grupul dat, creat direct în bază (pentru fixture-uri). */
async function dbUser(name: string, group: string): Promise<string> {
  const email = `${name.toLowerCase()}@example.com`;
  await sql(
    `INSERT INTO users (id, name, "nameNormalized", email, "primaryGroupId", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, (SELECT id FROM groups WHERE key = $5), timezone('UTC', now()), timezone('UTC', now()))`,
    [name.toLowerCase(), name, name.toLowerCase(), email, group],
  );
  return email;
}

test("o postare în așteptare apare în coadă și în widget; aprobarea o publică", async ({ page, request }) => {
  const id = uid();
  const t = await forumTree(request);
  const authorEmail = await dbUser(`Autor${id}`, "member");
  const newbieEmail = await dbUser(`Nou${id}`, "new_member");
  const topic = await topicWithReplies(request, t.forum.id, authorEmail, `Topic ${id}`);
  const pending = await fixture<{ postId: number; pending: boolean }>(request, { action: "reply", topicId: topic.topicId, text: `De aprobat ${id}`, authorEmail: newbieEmail });
  expect(pending.pending).toBe(true);

  await enterAcpAsRoot(page, `RootQ${id}`, `root-q${id}@example.com`);
  await expect(page.getByTestId("gcs-widget-moderation")).toContainText("așteaptă aprobare");
  await page.getByTestId("gcs-widget-moderation").getByRole("link", { name: "Deschide coada" }).click();

  const item = page.getByTestId("gcs-queue-item").filter({ hasText: `De aprobat ${id}` });
  await expect(item).toBeVisible();
  await item.getByRole("button", { name: "Aprobă" }).click();
  await expect(page.getByTestId("gcs-queue-item").filter({ hasText: `De aprobat ${id}` })).toHaveCount(0);
  const [row] = await sql<{ visibility: string }>(`SELECT visibility FROM posts WHERE id = $1`, [pending.postId]);
  expect(row!.visibility).toBe("VISIBLE");
});

test("un raport închis cu „Ascunde” ascunde postarea", async ({ page, request }) => {
  const id = uid();
  const t = await forumTree(request);
  const authorEmail = await dbUser(`Spam${id}`, "member");
  const topic = await topicWithReplies(request, t.forum.id, authorEmail, `Raportat ${id}`, 1);
  const reporter = await dbUser(`Martor${id}`, "member");
  await sql(`INSERT INTO reports (id, "contentType", "contentId", "reporterId", reason) VALUES ($1, 'forums.post', $2, (SELECT id FROM users WHERE email = $3), 'reclamă')`, [
    `r${id}`,
    String(topic.ids[1]),
    reporter,
  ]);

  await enterAcpAsRoot(page, `RootR${id}`, `root-r${id}@example.com`);
  await page.goto("/admin/members/moderation/reports");
  const item = page.getByTestId("gcs-report-item").filter({ hasText: `Raportat ${id}` });
  await item.getByRole("button", { name: "Ascunde conținutul și închide" }).click();
  await expect(page.getByTestId("gcs-report-item").filter({ hasText: `Raportat ${id}` })).toHaveCount(0);
  const [post] = await sql<{ visibility: string }>(`SELECT visibility FROM posts WHERE id = $1`, [topic.ids[1]]);
  expect(post!.visibility).toBe("HIDDEN");
});

test("o reacție nouă „Fire” (+2) apare pe postări", async ({ page, browser, request }) => {
  const id = uid();
  await enterAcpAsRoot(page, `RootE${id}`, `root-e${id}@example.com`);
  await page.goto("/admin/members/settings/reputation");
  const form = page.getByRole("region", { name: "Adaugă reacția" });
  await form.getByLabel("Cheie").fill(`fire${id}`.slice(0, 20));
  await form.getByLabel("Etichetă").fill(`Fire ${id}`);
  await form.getByLabel("Simbol").fill("🔥");
  await form.getByLabel("Culoare").fill("#FF9F1C");
  await form.getByLabel("Greutate").fill("2");
  await form.getByRole("button", { name: "Adaugă reacția" }).click();
  await expect(page.getByTestId("gcs-acp-reaction").filter({ has: page.locator(`input[value="Fire ${id}"]`) })).toBeVisible();

  const t = await forumTree(request);
  const authorEmail = await dbUser(`Scrib${id}`, "member");
  const topic = await topicWithReplies(request, t.forum.id, authorEmail, `Reacții ${id}`);
  const fan = await memberInNewContext(browser, `Fan${id}`, `fan-${id}@example.com`, "100.67.1");
  await fan.goto(topic.url);
  await fan.getByTestId("gcs-post").first().getByTestId("gcs-post-more").click();
  await fan.getByTestId("gcs-post").first().getByRole("menuitem", { name: "Reacționează", exact: true }).click();
  await fan.getByRole("button", { name: `Reacționează cu Fire ${id}` }).click();
  await expect(fan.getByRole("button", { name: `Fire ${id}: 1` })).toBeVisible();
  const [rep] = await sql<{ reputation: number }>(`SELECT reputation FROM users WHERE email = $1`, [authorEmail]);
  expect(rep!.reputation).toBe(2);
  await fan.context().close();
});

test("un moderator adăugat pe forumul A are unelte acolo, dar nu pe forumul B", async ({ page, browser, request }) => {
  const id = uid();
  const a = await forumTree(request);
  const b = await forumTree(request);
  const authorEmail = await dbUser(`Scriitor${id}`, "member");
  const inA = await topicWithReplies(request, a.forum.id, authorEmail, `În A ${id}`);
  const inB = await topicWithReplies(request, b.forum.id, authorEmail, `În B ${id}`);
  const mod = await memberInNewContext(browser, `Paznic${id}`, `paznic-${id}@example.com`, "100.67.2");

  await enterAcpAsRoot(page, `RootM${id}`, `root-m${id}@example.com`);
  await page.goto("/admin/members/staff/moderators");

  // Moderatorii globali: grupurile cu „Moderator pe toate forumurile” (Root Admin implicit), cu membrii lor.
  const root = page.getByTestId("gcs-mods-global").locator('[data-testid="gcs-mods-global-group"][data-group="root_admin"]');
  await expect(root).toBeVisible();
  await expect(root).toContainText(/\d+ (membru|membri|de membri)/);
  await expect(root.getByRole("link", { name: /^Grupul / })).toHaveAttribute("href", /\/admin\/groups\/\d+$/);

  // Panoul „Adaugă moderator”: forumurile grupate pe categorii, în ordinea arborelui.
  await page.getByTestId("gcs-mod-add-open").click();
  const panel = page.getByTestId("gcs-mod-add");
  await expect(panel).toBeVisible();
  const catA = panel.locator(`[data-testid="gcs-mod-category"][data-category="Categorie ${a.id}"]`);
  const catB = panel.locator(`[data-testid="gcs-mod-category"][data-category="Categorie ${b.id}"]`);
  await expect(catA.getByRole("checkbox", { name: a.forumName })).toBeVisible();
  await expect(catB.getByRole("checkbox", { name: b.forumName })).toBeVisible();
  await expect(catA.getByRole("checkbox", { name: b.forumName })).toHaveCount(0);
  // „Toate” bifează toată categoria; a doua apăsare o golește.
  await catB.getByRole("button", { name: `Alege toate forumurile din Categorie ${b.id}` }).click();
  await expect(catB.getByRole("checkbox", { name: b.forumName })).toBeChecked();
  await catB.getByRole("button", { name: `Scoate toate forumurile din Categorie ${b.id}` }).click();
  await expect(catB.getByRole("checkbox", { name: b.forumName })).not.toBeChecked();
  // Căutarea lasă doar forumul A; numărul celor alese se actualizează pe loc.
  await panel.getByTestId("gcs-mod-forum-search").fill(a.forumName);
  await expect(panel.getByTestId("gcs-mod-category")).toHaveCount(1);
  await catA.getByRole("checkbox", { name: a.forumName }).check();
  await expect(panel.getByTestId("gcs-mod-forum-count")).toHaveText("1 ales");

  // Membrul: sugestii pe măsură ce scrii (și cu @ în față), cu numele în stilul grupului.
  await panel.getByTestId("gcs-mod-member").fill(`@Paznic${id}`);
  const suggestion = panel.getByTestId("gcs-mod-suggestion").filter({ hasText: `Paznic${id}` });
  await expect(suggestion).toBeVisible();
  await expect(suggestion.locator('[class*="gcs-name--"]')).toHaveCount(1);
  await suggestion.click();
  await expect(panel.getByTestId("gcs-mod-picked")).toContainText(`Paznic${id}`);

  // Puterile: presetul „Doar aprobări”, plus Fixează și Blochează.
  await panel.getByTestId("gcs-mod-preset-approvals").click();
  await expect(panel.getByRole("checkbox", { name: "Aprobă" })).toBeChecked();
  await expect(panel.getByRole("checkbox", { name: "Editează" })).not.toBeChecked();
  await panel.getByRole("checkbox", { name: "Fixează" }).check();
  await panel.getByRole("checkbox", { name: "Blochează" }).check();
  await panel.getByRole("button", { name: "Adaugă pe 1 forum" }).click();
  await expect(panel).toHaveCount(0);
  const row = page.getByTestId("gcs-acp-moderator").filter({ hasText: `Paznic${id}` });
  await expect(row).toBeVisible();
  await expect(row).toContainText(`Categorie ${a.id}`);
  await expect(row).toContainText("Fixează");

  // Editarea: panoul precompletat; „Toate” → „Toate puterile” pe rând.
  await row.getByTestId("gcs-mod-edit-open").click();
  const edit = page.getByTestId("gcs-mod-edit");
  await expect(edit.getByRole("checkbox", { name: "Fixează" })).toBeChecked();
  await expect(edit.getByRole("checkbox", { name: "Editează" })).not.toBeChecked();
  await edit.getByTestId("gcs-mod-preset-all").click();
  await edit.getByRole("button", { name: "Salvează puterile" }).click();
  await expect(edit).toHaveCount(0);
  await expect(row).toContainText("Toate puterile");

  await mod.goto(inA.url);
  await expect(mod.getByText("Unelte de moderare")).toBeVisible();
  await mod.goto(inB.url);
  await expect(mod.getByText("Unelte de moderare")).toHaveCount(0);
  await mod.context().close();
});
