import { expect, test, type APIRequestContext } from "@playwright/test";
import { forumTree, member, memberInNewContext, topicWithReplies, uid } from "./forum-fixtures";
import { useFreshIp } from "./helpers";

/** Datele etapei 3 prin ruta de test (`/api/_test/profile`). */
async function profileFixture<T = unknown>(request: APIRequestContext, data: Record<string, unknown>): Promise<T> {
  const res = await request.post("/api/_test/profile", { data });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as T;
}

test.beforeEach(async ({ context }) => {
  await useFreshIp(context, "203.0.113");
});

test.describe("blocul autorului pe topic", () => {
  test("un VIP Gold are rama aleasă, insigna grupului și rangul sub nume", async ({ page, request, browser }) => {
    const id = uid();
    const { forum } = await forumTree(request);
    const viewer = await memberInNewContext(browser, `Viewer${id}`, `viewer-${id}@example.com`, "198.51.100");
    await viewer.close();
    await member(page, `Shadow${id}`, `shadow-${id}@example.com`);
    await profileFixture(request, { action: "vip", email: `shadow-${id}@example.com`, groupKey: "vip_gold", days: 30 });
    await profileFixture(request, { action: "frame", email: `shadow-${id}@example.com`, frameKey: "gold" });
    const topic = await topicWithReplies(request, forum.id, `shadow-${id}@example.com`, `Topic VIP ${id}`);
    await profileFixture(request, { action: "evaluate", email: `shadow-${id}@example.com` });

    await page.goto(topic.url);
    const author = page.getByTestId("gcs-post").first().locator(".gcs-post__author");
    await expect(author.locator(".gcs-avatarFrame--gold")).toBeVisible();
    await expect(author.getByText("VIP Gold")).toBeVisible();
    await expect(author.getByTestId("gcs-post-rank")).toHaveText("Recrut");
    await expect(author.locator(".gcs-name--vip_gold")).toHaveText(`Shadow${id}`);
  });
});

test.describe("ignorare și mesaje", () => {
  test("postarea unui user ignorat e pliată și se deschide la click; plicul arată conversația necitită", async ({ page, request, browser }) => {
    const id = uid();
    const { forum } = await forumTree(request);
    const author = await memberInNewContext(browser, `Spam${id}`, `spam-${id}@example.com`, "198.51.100");
    await author.close();
    await member(page, `Mara${id}`, `mara-${id}@example.com`);
    const topic = await topicWithReplies(request, forum.id, `spam-${id}@example.com`, `Topic ignorat ${id}`);
    await profileFixture(request, { action: "ignore", email: `mara-${id}@example.com`, ignoredEmail: `spam-${id}@example.com`, posts: true, messages: false });
    await profileFixture(request, { action: "conversation", fromEmail: `spam-${id}@example.com`, toEmails: [`mara-${id}@example.com`], title: "Salut", text: "Ce faci?" });

    await page.goto(topic.url);
    const folded = page.getByTestId("gcs-post-ignored");
    await expect(folded).toBeVisible();
    await expect(folded.getByText(`Primul mesaj din Topic ignorat ${id}`)).toBeHidden();
    await folded.locator("summary").click();
    await expect(folded.getByText(`Primul mesaj din Topic ignorat ${id}`)).toBeVisible();

    await expect(page.getByTestId("gcs-header-unread")).toHaveText("1");
  });
});
