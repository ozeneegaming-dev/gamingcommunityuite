import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { register as registerOnly, setPrimaryGroup, useFreshIp } from "./helpers";

/** Datele forumului prin ruta de test (`/api/_test/forum`, doar cu `GCS_TEST_ROUTES=1`). */
async function fixture<T>(request: APIRequestContext, data: Record<string, unknown>): Promise<T> {
  const res = await request.post("/api/_test/forum", { data });
  expect(res.ok()).toBe(true);
  return (await res.json()) as T;
}

const uid = () => Math.random().toString(36).slice(2, 8);

/** Înregistrare + așteptarea contului (fixture-urile au nevoie de userul deja creat). */
async function register(page: Page, name: string, email: string) {
  await registerOnly(page, name, email);
  await expect(page.getByTestId("gcs-header-user")).toHaveText(name);
}

async function tree(request: APIRequestContext) {
  const id = uid();
  const category = await fixture<{ id: number; slug: string }>(request, { action: "forum", parentId: null, type: "CATEGORY", name: `Servere ${id}` });
  const forum = await fixture<{ id: number; slug: string }>(request, { action: "forum", parentId: category.id, type: "FORUM", name: `Counter-Strike ${id}` });
  return { id, category, forum, forumName: `Counter-Strike ${id}`, categoryName: `Servere ${id}` };
}

test.beforeEach(async ({ context }) => {
  await useFreshIp(context, "198.18.20");
});

test("vizitatorul vede categoriile și intră într-un forum", async ({ page, request }) => {
  const t = await tree(request);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: t.categoryName, level: 2 })).toBeVisible();
  await page.getByRole("link", { name: t.forumName, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/forum/${t.forum.id}-${t.forum.slug}$`));
  await expect(page.getByRole("heading", { name: t.forumName, level: 1 })).toBeVisible();
  await expect(page.getByText("Niciun topic încă")).toBeVisible();
  // Vizitatorul nu poate deschide topicuri.
  await expect(page.getByRole("link", { name: "Topic nou" })).toHaveCount(0);
});

test("un forum fără `forums.view` lipsește din listă, iar URL-ul lui dă 404", async ({ page, request }) => {
  const t = await tree(request);
  await fixture(request, { action: "permissions", forumId: t.forum.id, groupKey: "guest", actions: [] });
  await page.goto("/");
  await expect(page.getByRole("link", { name: t.forumName, exact: true })).toHaveCount(0);
  const res = await page.goto(`/forum/${t.forum.id}-${t.forum.slug}`);
  expect(res?.status()).toBe(404);
});

test("un slug greșit redirecționează la cel corect", async ({ page, request }) => {
  const t = await tree(request);
  await page.goto(`/forum/${t.forum.id}-slug-gresit`);
  await expect(page).toHaveURL(new RegExp(`/forum/${t.forum.id}-${t.forum.slug}$`));
});

test("paginarea topicurilor (25 pe pagină)", async ({ page, request }) => {
  const t = await tree(request);
  const email = `autor-${t.id}@example.com`;
  await register(page, `Autor${t.id}`, email);
  for (let i = 0; i < 26; i++) {
    await fixture(request, { action: "topic", forumId: t.forum.id, title: `Topicul numărul ${i}`, text: "conținut", authorEmail: email });
  }
  await page.goto(`/forum/${t.forum.id}-${t.forum.slug}`);
  await expect(page.getByTestId("gcs-topic-row")).toHaveCount(25);
  await page.getByRole("navigation", { name: "Pagini" }).getByRole("link", { name: "Pagina 2" }).click();
  await expect(page).toHaveURL(/\?page=2$/);
  await expect(page.getByTestId("gcs-topic-row")).toHaveCount(1);
  await expect(page.getByTestId("gcs-topic-row")).toContainText("Topicul numărul 0");
});

test("după „Marchează citit”, punctul de necitit dispare", async ({ page, browser, request }) => {
  const t = await tree(request);
  await register(page, `Cititor${t.id}`, `cititor-${t.id}@example.com`);

  const authorContext = await browser.newContext();
  await useFreshIp(authorContext, "198.18.21");
  const author = await authorContext.newPage();
  await register(author, `Scriitor${t.id}`, `scriitor-${t.id}@example.com`);
  // Un Membru nou ar trece prin aprobare (topicul nu ar fi vizibil); autorul e Membru.
  await setPrimaryGroup(`scriitor-${t.id}@example.com`, "member");
  await fixture(request, { action: "topic", forumId: t.forum.id, title: "Noutăți de azi", text: "salut", authorEmail: `scriitor-${t.id}@example.com` });
  await authorContext.close();

  await page.goto("/");
  const row = page.getByTestId("gcs-forum-row").filter({ hasText: t.forumName });
  await expect(row.getByTestId("gcs-unread-dot")).toBeVisible();
  await row.getByRole("link", { name: t.forumName, exact: true }).click();
  await expect(page.getByTestId("gcs-unread-link")).toBeVisible();
  await page.getByRole("button", { name: "Marchează citit" }).click();
  await expect(page.getByRole("button", { name: "Marcat ca citit" })).toBeVisible();

  await page.goto("/");
  await expect(page.getByTestId("gcs-forum-row").filter({ hasText: t.forumName }).getByTestId("gcs-unread-dot")).toHaveCount(0);
});
