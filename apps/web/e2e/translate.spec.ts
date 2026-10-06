import { expect, test } from "@playwright/test";
import { forumTree, member, topicWithReplies, uid } from "./forum-fixtures";
import { sql, useFreshIp } from "./helpers";

/** Cele 6 limbi și butonul „Traduce” (specul etapei 5 §1.3): în E2E, LibreTranslate e un server fals (`[de] …`). */
test("un vizitator cu limba germană vede interfața în germană", async ({ page, context, baseURL }) => {
  await useFreshIp(context, "100.68.0");
  await context.addCookies([{ name: "gcs-locale", value: "de", url: baseURL! }]);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.getByRole("link", { name: "Anmelden" })).toBeVisible();
});

test("butonul „Traduce” traduce o postare în limba membrului; originalul rămâne", async ({ page, context, request, baseURL }) => {
  await useFreshIp(context, "100.68.1");
  const id = uid();
  const { forum } = await forumTree(request);
  await member(page, `Trad${id}`, `trad-${id}@example.com`);
  await sql(
    `INSERT INTO users (id, name, "nameNormalized", email, "primaryGroupId", "updatedAt") VALUES ($1, $2, $3, $4, (SELECT id FROM groups WHERE key = 'member'), $5)`,
    [`e2etr${id}`, `Autor${id}`, `autor${id}`.toLowerCase(), `autor-${id}@example.com`, "2026-01-01T00:00:00Z"],
  );
  const topic = await topicWithReplies(request, forum.id, `autor-${id}@example.com`, `Salut ${id}`, 1);

  await context.addCookies([{ name: "gcs-locale", value: "de", url: baseURL! }]);
  await page.goto(topic.url);
  const post = page.getByTestId("gcs-post").filter({ hasText: "Răspunsul 1" });
  const translate = post.getByTestId("gcs-translate");
  await translate.getByRole("button").click();
  const result = translate.getByTestId("gcs-translate-result");
  await expect(result).toContainText("[de]");
  await expect(result).toContainText("Răspunsul 1");
  await expect(post.locator(".gcs-postBody").first()).toHaveText("Răspunsul 1");

  // A doua apăsare ascunde traducerea.
  await translate.getByRole("button").click();
  await expect(result).toHaveCount(0);
});
