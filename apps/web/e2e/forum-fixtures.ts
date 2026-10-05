import { expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { register, setPrimaryGroup, sql, useFreshIp } from "./helpers";

/** Datele forumului prin ruta de test (`/api/_test/forum`, doar cu `GCS_TEST_ROUTES=1`). */
export async function fixture<T>(request: APIRequestContext, data: Record<string, unknown>): Promise<T> {
  const res = await request.post("/api/_test/forum", { data });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as T;
}

export const uid = () => Math.random().toString(36).slice(2, 8);

/** O categorie cu un forum (nume unice, ca testele să nu se încurce între ele). */
export async function forumTree(request: APIRequestContext, type: "FORUM" | "QA" = "FORUM") {
  const id = uid();
  const category = await fixture<{ id: number; slug: string }>(request, { action: "forum", parentId: null, type: "CATEGORY", name: `Categorie ${id}` });
  const forum = await fixture<{ id: number; slug: string }>(request, { action: "forum", parentId: category.id, type, name: `Forum ${id}` });
  return { id, category, forum, forumName: `Forum ${id}` };
}

/** Un membru (grupul Membru, nu Membru nou) autentificat în pagina dată. */
export async function member(page: Page, name: string, email: string, group = "member"): Promise<void> {
  await register(page, name, email);
  await expect(page.getByTestId("gcs-header-user")).toHaveText(name);
  await setPrimaryGroup(email, group);
}

/** Un membru într-un context nou de browser (alt user în același test). */
export async function memberInNewContext(browser: Browser, name: string, email: string, ipPrefix: string): Promise<Page> {
  const context = await browser.newContext();
  await useFreshIp(context, ipPrefix);
  const page = await context.newPage();
  await member(page, name, email);
  return page;
}

/** Un topic creat prin servicii, cu `replies` răspunsuri ale aceluiași autor. Întoarce id-urile. */
export async function topicWithReplies(request: APIRequestContext, forumId: number, authorEmail: string, title: string, replies = 0) {
  const t = await fixture<{ topicId: number; postId: number }>(request, { action: "topic", forumId, title, text: `Primul mesaj din ${title}`, authorEmail });
  const ids = [t.postId];
  for (let i = 1; i <= replies; i++) {
    ids.push((await fixture<{ postId: number }>(request, { action: "reply", topicId: t.topicId, text: `Răspunsul ${i}`, authorEmail })).postId);
  }
  const [row] = await sql<{ slug: string }>(`SELECT slug FROM topics WHERE id = $1`, [t.topicId]);
  return { topicId: t.topicId, ids, url: `/topic/${t.topicId}-${row!.slug}` };
}

/** Scrie text în editorul (Tiptap) dintr-o zonă a paginii. */
export async function typeInEditor(page: Page, text: string, scope = page.locator("#reply")): Promise<void> {
  await scope.locator(".gcs-editor__content").click();
  await page.keyboard.type(text);
}
