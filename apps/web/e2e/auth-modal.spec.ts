import { expect, test } from "@playwright/test";
import { forumTree, member, topicWithReplies, uid } from "./forum-fixtures";
import { logout, PASSWORD, useFreshIp } from "./helpers";

/** Login și înregistrare în popup (specul etapei 5): din header, URL-ul devine /login; deschis direct, pagina e completă. */
test("„Autentificare” deschide popup-ul; Escape îl închide și focusul revine pe buton", async ({ page, context }) => {
  await useFreshIp(context, "100.70.0");
  await page.goto("/");
  const login = page.getByTestId("gcs-header-login");
  await login.click();
  await expect(page).toHaveURL(/\/login$/);
  const dialog = page.getByRole("dialog", { name: "Autentificare" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/$/);
  await expect(login).toBeFocused();
});

test("login-ul din popup revine pe pagina de unde a fost deschis, autentificat", async ({ page, context, request }) => {
  await useFreshIp(context, "100.70.1");
  const id = uid();
  const email = `modal-${id}@example.com`;
  await member(page, `Modal${id}`, email);
  const { forum } = await forumTree(request);
  const topic = await topicWithReplies(request, forum.id, email, `Popup ${id}`);
  await logout(page);

  await page.goto(topic.url);
  await page.getByTestId("gcs-header-login").click();
  const dialog = page.getByRole("dialog", { name: "Autentificare" });
  await dialog.getByLabel("Email").fill(email);
  await dialog.getByLabel("Parolă").fill(PASSWORD);
  await dialog.getByRole("button", { name: "Intră în cont" }).click();
  await expect(page.getByTestId("gcs-header-user")).toHaveText(`Modal${id}`);
  await expect(page).toHaveURL(new RegExp(`/topic/${topic.topicId}-`));
});

test("/login deschis direct afișează pagina completă, fără popup", async ({ page, context }) => {
  await useFreshIp(context, "100.70.2");
  await page.goto("/login");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Intră în cont" })).toBeVisible();
});
