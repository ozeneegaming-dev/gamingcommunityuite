import { expect, test } from "@playwright/test";
import { fixture, forumTree, member, topicWithReplies, uid } from "./forum-fixtures";
import { useFreshIp } from "./helpers";

test.beforeEach(async ({ context }) => {
  await useFreshIp(context, "198.18.50");
});

test("căutarea fără diacritice, cu fragmente evidențiate și filtrul pe forum", async ({ page, request }) => {
  const t = await forumTree(request);
  const other = await forumTree(request);
  const id = uid();
  await member(page, `Ion${id}`, `ion-${id}@example.com`);
  const email = `ion-${id}@example.com`;
  const word = `Mașina${id}`;
  const a = await topicWithReplies(request, t.forum.id, email, `${word} cea nouă`);
  await topicWithReplies(request, other.forum.id, email, `${word} veche`);

  await page.goto(`/search?q=${encodeURIComponent(`masina${id}`)}`);
  const results = page.getByTestId("gcs-search-result");
  await expect(results).toHaveCount(2);
  await expect(results.first().locator("mark").first()).toBeVisible();

  await page.getByLabel("Forum", { exact: true }).selectOption({ label: t.forumName });
  await page.getByRole("main").getByRole("button", { name: "Caută", exact: true }).click();
  await expect(results).toHaveCount(1);
  await expect(results.first()).toContainText(`${word} cea nouă`);
  await results.first().getByRole("link", { name: `${word} cea nouă` }).click();
  await expect(page).toHaveURL(new RegExp(`/topic/${a.topicId}-`));
});

test("Review Focus #2: un topic dintr-un forum ascuns vizitatorilor lipsește din sitemap și din căutarea lor", async ({ page, request }) => {
  const t = await forumTree(request);
  const id = uid();
  await member(page, `Secret${id}`, `secret-${id}@example.com`);
  const hidden = await topicWithReplies(request, t.forum.id, `secret-${id}@example.com`, `Ascunzis${id} pentru membri`);
  const open = await forumTree(request);
  const visible = await topicWithReplies(request, open.forum.id, `secret-${id}@example.com`, `Public${id} pentru toți`);
  await fixture(request, { action: "permissions", forumId: t.forum.id, groupKey: "guest", actions: [] });

  // `/sitemap.xml` e indexul: adresele sunt în fișierele lui (`/sitemap/topics-1.xml`…).
  const index = await (await request.get("/sitemap.xml")).text();
  const files = [...index.matchAll(/<loc>[^<]*(\/sitemap\/[^<]+)<\/loc>/g)].map((m) => m[1]!);
  expect(files.length).toBeGreaterThan(0);
  let sitemap = "";
  for (const f of files) sitemap += await (await request.get(f)).text();
  expect(sitemap).toContain(`/topic/${visible.topicId}-`);
  expect(sitemap).not.toContain(`/topic/${hidden.topicId}-`);
  expect(sitemap).not.toContain(`/forum/${t.forum.id}-`);

  const guest = await page.context().browser()!.newContext();
  await useFreshIp(guest, "198.18.51");
  const guestPage = await guest.newPage();
  await guestPage.goto(`/search?q=ascunzis${id}`);
  await expect(guestPage.getByText(`Niciun rezultat pentru „ascunzis${id}”.`)).toBeVisible();
  await guest.close();
});

test("pagina de topic are canonical și OpenGraph; robots.txt blochează ACP-ul", async ({ page, request }) => {
  const t = await forumTree(request);
  const id = uid();
  await member(page, `Seo${id}`, `seo-${id}@example.com`);
  const topic = await topicWithReplies(request, t.forum.id, `seo-${id}@example.com`, "Ghid de configurare");

  await page.goto(topic.url);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/topic/${topic.topicId}-ghid-de-configurare$`));
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "Ghid de configurare");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", "Primul mesaj din Ghid de configurare");

  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /admin");
  expect(robots).toContain("Sitemap:");
});
