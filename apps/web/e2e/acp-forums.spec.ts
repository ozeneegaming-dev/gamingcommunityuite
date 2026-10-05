import { expect, test } from "@playwright/test";
import { topicWithReplies, uid } from "./forum-fixtures";
import { enterAcpAsRoot, resetSetting, sql, useFreshIp } from "./helpers";

test.beforeEach(async ({ context }) => {
  await useFreshIp(context, "100.66.0");
});

test.afterEach(async () => {
  await resetSetting("forums.posts_per_page");
});

/** Rândul unui forum din arborele ACP (după nume exact). */
const row = (page: import("@playwright/test").Page, name: string) => page.locator(`[data-testid="gcs-acp-forum"][data-forum-name="${name}"]`);

const forumId = async (name: string) => (await sql<{ id: number; slug: string }>(`SELECT id, slug FROM forums WHERE name = $1`, [name]))[0]!;

test("admin-ul creează o categorie și un forum, apoi mută forumul în altă categorie", async ({ page, browser }) => {
  const id = uid();
  await enterAcpAsRoot(page, `RootF${id}`, `root-f${id}@example.com`);
  await page.goto("/admin/community/forums");

  for (const [name, type, parent] of [
    [`Categoria A ${id}`, "Categorie", null],
    [`Categoria B ${id}`, "Categorie", null],
    [`Forumul ${id}`, "Forum", `Categoria A ${id}`],
  ] as const) {
    await page.getByLabel("Nume", { exact: true }).fill(name);
    await page.getByLabel("Tip", { exact: true }).selectOption({ label: type });
    if (parent) await page.getByLabel("Părinte").selectOption({ label: parent });
    await page.getByRole("button", { name: "Creează", exact: true }).click();
    await expect(row(page, name)).toBeVisible();
  }

  // Forumul apare imediat pe site.
  const guest = await browser.newContext();
  const site = await guest.newPage();
  await site.goto("/");
  await expect(site.getByRole("link", { name: `Forumul ${id}`, exact: true })).toBeVisible();

  // Mutarea în altă categorie, din tastatură („Mută sub”).
  await page.getByLabel(`Mută Forumul ${id} sub`).selectOption({ label: `Categoria B ${id}` });
  await expect(page.getByText("Ordinea a fost salvată")).toBeVisible();
  const forum = await forumId(`Forumul ${id}`);
  const [parent] = await sql<{ name: string }>(`SELECT p.name FROM forums f JOIN forums p ON p.id = f."parentId" WHERE f.id = $1`, [forum.id]);
  expect(parent!.name).toBe(`Categoria B ${id}`);
  await guest.close();
});

test("scoaterea `forums.view` pentru Vizitator ascunde forumul vizitatorilor", async ({ page, browser }) => {
  const id = uid();
  await enterAcpAsRoot(page, `RootP${id}`, `root-p${id}@example.com`);
  await page.goto("/admin/community/forums");
  await page.getByLabel("Nume", { exact: true }).fill(`Cat ${id}`);
  await page.getByLabel("Tip", { exact: true }).selectOption({ label: "Categorie" });
  await page.getByRole("button", { name: "Creează", exact: true }).click();
  await expect(row(page, `Cat ${id}`)).toBeVisible();
  await page.getByLabel("Nume", { exact: true }).fill(`Privat ${id}`);
  await page.getByLabel("Tip", { exact: true }).selectOption({ label: "Forum" });
  await page.getByLabel("Părinte").selectOption({ label: `Cat ${id}` });
  await page.getByRole("button", { name: "Creează", exact: true }).click();
  await row(page, `Privat ${id}`).getByRole("link", { name: "Permisiuni" }).click();

  // Matricea pornește de la permisiunile moștenite; oprim moștenirea și scoatem doar ce vede vizitatorul.
  await page.getByLabel("Moștenește permisiunile părintelui").uncheck();
  await page.getByRole("checkbox", { name: "Vizitator: Vede forumul în listă" }).uncheck();
  await page.getByRole("checkbox", { name: "Vizitator: Citește topicurile" }).uncheck();
  await page.getByRole("button", { name: "Salvează permisiunile" }).click();
  await expect(page.getByRole("status")).toHaveText("Salvat");

  const guest = await browser.newContext();
  const site = await guest.newPage();
  await site.goto("/");
  await expect(site.getByRole("heading", { name: `Cat ${id}` })).toHaveCount(0);
  const forum = await forumId(`Privat ${id}`);
  expect((await site.goto(`/forum/${forum.id}-${forum.slug}`))?.status()).toBe(404);
  await guest.close();
});

test("prefix restrâns la un forum și „postări pe pagină” schimbat din setări", async ({ page }) => {
  const id = uid();
  await enterAcpAsRoot(page, `RootX${id}`, `root-x${id}@example.com`);

  await page.goto("/admin/community/prefixes");
  await page.getByLabel("Nume", { exact: true }).fill(`Anunț ${id}`);
  await page.getByRole("button", { name: "Adaugă prefixul" }).click();
  await expect(page.getByText(`Anunț ${id}`).first()).toBeVisible();

  await page.goto("/admin/community/forums");
  await page.getByLabel("Nume", { exact: true }).fill(`CatX ${id}`);
  await page.getByLabel("Tip", { exact: true }).selectOption({ label: "Categorie" });
  await page.getByRole("button", { name: "Creează", exact: true }).click();
  await expect(row(page, `CatX ${id}`)).toBeVisible();
  await page.getByLabel("Nume", { exact: true }).fill(`ForX ${id}`);
  await page.getByLabel("Tip", { exact: true }).selectOption({ label: "Forum" });
  await page.getByLabel("Părinte").selectOption({ label: `CatX ${id}` });
  await page.getByRole("button", { name: "Creează", exact: true }).click();
  await row(page, `ForX ${id}`).getByRole("link", { name: "Editează" }).click();
  await page.getByRole("checkbox", { name: `Anunț ${id}` }).check();
  await page.getByRole("button", { name: "Salvează prefixele" }).click();
  await expect(page.getByRole("status").last()).toHaveText("Salvat");
  const forum = await forumId(`ForX ${id}`);
  const allowed = await sql<{ name: string }>(
    `SELECT p.name FROM forum_prefixes fp JOIN topic_prefixes p ON p.id = fp."prefixId" WHERE fp."forumId" = $1`,
    [forum.id],
  );
  expect(allowed.map((r) => r.name)).toEqual([`Anunț ${id}`]);

  // Paginarea topicului urmează setarea „Postări pe pagină”.
  const topic = await topicWithReplies(page.request, forum.id, `root-x${id}@example.com`, "Topic paginat", 12);
  await page.goto("/admin/settings/posting");
  await page.getByLabel("Postări pe pagină").fill("10");
  await page.getByRole("button", { name: "Salvează setările" }).click();
  await expect(page.getByRole("status")).toHaveText("Salvat");
  await page.goto(topic.url);
  await expect(page.getByTestId("gcs-post")).toHaveCount(10);
  await expect(page.getByRole("link", { name: "Pagina 2" }).first()).toBeVisible();
});
