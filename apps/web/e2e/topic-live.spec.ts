import { expect, test, type Browser, type Page } from "@playwright/test";
import { fixture, forumTree, member, topicWithReplies, typeInEditor, uid } from "./forum-fixtures";
import { setPrimaryGroup, useFreshIp } from "./helpers";

/** Topicul live (specul etapei 4 §8): „Citesc acum”, „scrie…” și bannerul postărilor noi. */
async function memberPage(browser: Browser, name: string, email: string, ip: string): Promise<Page> {
  const context = await browser.newContext();
  await useFreshIp(context, ip);
  const page = await context.newPage();
  await member(page, name, email);
  return page;
}

test("A vede cititorii, „B scrie…” și „1 postare nouă — arată”", async ({ browser, request }) => {
  const id = uid();
  const { forum } = await forumTree(request);
  const aEmail = `live-a-${id}@example.com`;
  const bEmail = `live-b-${id}@example.com`;
  const a = await memberPage(browser, `LiveA${id}`, aEmail, "198.19.1");
  const b = await memberPage(browser, `LiveB${id}`, bEmail, "198.19.2");
  const topic = await topicWithReplies(request, forum.id, aEmail, `Live ${id}`);

  await a.goto(topic.url);
  await expect(a.locator("html")).toHaveAttribute("data-realtime", "on", { timeout: 20_000 });
  await b.goto(topic.url);
  await expect(b.locator("html")).toHaveAttribute("data-realtime", "on", { timeout: 20_000 });
  await expect(a.getByTestId("gcs-topic-readers")).toContainText(`LiveB${id}`, { timeout: 10_000 });

  await typeInEditor(b, "Un răspuns");
  await expect(a.getByTestId("gcs-topic-typing")).toHaveText(`LiveB${id} scrie un răspuns…`, { timeout: 5_000 });

  await b.getByRole("button", { name: "Trimite răspunsul" }).click();
  const banner = a.getByTestId("gcs-topic-new-posts");
  await expect(banner).toContainText("1 postare nouă", { timeout: 10_000 });
  await banner.getByRole("link", { name: "arată" }).click();
  await expect(a.getByText("Un răspuns")).toBeVisible();

  // Un răspuns în așteptare (membru nou) nu produce bannerul.
  const newbie = `live-n-${id}@example.com`;
  const n = await memberPage(browser, `LiveN${id}`, newbie, "198.19.3");
  await setPrimaryGroup(newbie, "new_member");
  await a.goto(topic.url);
  await expect(a.locator("html")).toHaveAttribute("data-realtime", "on", { timeout: 20_000 });
  const pending = await fixture<{ pending: boolean }>(request, { action: "reply", topicId: topic.topicId, text: "În așteptare", authorEmail: newbie });
  expect(pending.pending).toBe(true);
  await a.waitForTimeout(2_000);
  await expect(a.getByTestId("gcs-topic-new-posts")).toHaveCount(0);
  for (const p of [a, b, n]) await p.context().close();
});
