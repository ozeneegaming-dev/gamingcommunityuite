import { expect, test, type Browser, type Page } from "@playwright/test";
import { member, uid } from "./forum-fixtures";
import { enterAcpAsRoot, resetSetting, sql, useFreshIp, userId } from "./helpers";

/** ACP → Chat și notificările implicite (specul etapei 4 §9). */
test.beforeEach(async ({ context }) => {
  await useFreshIp(context, "100.67.0");
});

async function memberPage(browser: Browser, name: string, email: string, ip: string): Promise<Page> {
  const context = await browser.newContext();
  await useFreshIp(context, ip);
  const page = await context.newPage();
  await member(page, name, email);
  return page;
}

const chatBox = (page: Page, key: string) => page.getByTestId(`gcs-chat-${key}`);

test("un canal nou din ACP apare în /chat; slow mode-ul, filtrul și ridicarea mute-ului se aplică", async ({ page, browser }) => {
  const id = uid();
  const key = `turnee-${id}`;
  await enterAcpAsRoot(page, `RootC${id}`, `root-c${id}@example.com`);
  await page.goto("/admin/community/chat");
  const create = page.getByRole("region", { name: "Canal nou" });
  await create.getByLabel("Cheie").fill(key);
  await create.getByLabel("Nume").fill(`Turnee ${id}`);
  await create.getByLabel("Slow mode (s)").fill("30");
  await create.getByRole("button", { name: "Canal nou" }).click();
  await expect(page.getByTestId(`gcs-acp-chat-${key}`)).toBeVisible();

  // Filtrul de cuvinte.
  const word = `zz${id}`;
  await page.goto("/admin/community/chat/settings");
  await page.getByLabel(/Un cuvânt sau o expresie pe rând/).fill(word);
  await page.getByRole("button", { name: "Salvează" }).click();
  await expect(page.getByText("Salvat").first()).toBeVisible();

  const memberEmail = `chat-acp-${id}@example.com`;
  const m = await memberPage(browser, `Turnir${id}`, memberEmail, "100.67.1");
  await m.goto(`/chat?c=${key}`);
  await expect(m.getByRole("link", { name: `Turnee ${id}` })).toHaveAttribute("aria-current", "page");
  await expect(m.getByText("Slow mode: un mesaj la 30 s.")).toBeVisible();

  await chatBox(m, key).getByTestId("gcs-chat-input").fill(`ești ${word} rău`);
  await chatBox(m, key).getByRole("button", { name: "Trimite" }).click();
  await expect(chatBox(m, key).getByTestId("gcs-chat-msg").filter({ hasText: "ești *** rău" })).toBeVisible();

  // Peste pauza de flood (3 s), dar în slow mode (30 s): refuzat.
  await m.waitForTimeout(3_500);
  await chatBox(m, key).getByTestId("gcs-chat-input").fill("al doilea");
  await chatBox(m, key).getByRole("button", { name: "Trimite" }).click();
  await expect(chatBox(m, key).getByRole("alert")).toBeVisible();
  await expect(chatBox(m, key).getByTestId("gcs-chat-msg").filter({ hasText: "al doilea" })).toHaveCount(0);

  // Un mute global, ridicat din ACP.
  await sql(`INSERT INTO chat_mutes ("userId", "channelId", until, reason) VALUES ($1, NULL, NULL, 'test')`, [await userId(memberEmail)]);
  await m.goto("/chat");
  await expect(chatBox(m, "general").getByTestId("gcs-chat-input")).toBeDisabled();
  await page.goto("/admin/community/chat/settings");
  const mute = page.getByTestId("gcs-acp-mute").filter({ hasText: `Turnir${id}` });
  await mute.getByRole("button", { name: "Ridică" }).click();
  await expect(mute).toHaveCount(0);
  await m.reload();
  await expect(chatBox(m, "general").getByTestId("gcs-chat-input")).toBeEnabled();
  await m.context().close();

  await resetSetting("chat.word_filter");
});

test("valoarea implicită de email schimbată în ACP se vede în setările unui membru nou; widgetul online numără", async ({ page, browser }) => {
  const id = uid();
  await enterAcpAsRoot(page, `RootN${id}`, `root-n${id}@example.com`);
  await page.goto("/admin/members/settings/notifications");
  const row = page.getByTestId("gcs-acp-notif-profile.badge");
  await row.getByRole("combobox").selectOption("DIGEST");
  await page.getByRole("button", { name: "Salvează" }).click();
  await expect(page.getByText("Salvat").first()).toBeVisible();

  const m = await memberPage(browser, `Nou${id}`, `notif-def-${id}@example.com`, "100.67.2");
  await m.goto("/settings/notifications");
  await expect(m.getByTestId("gcs-pref-profile.badge").getByRole("combobox")).toHaveValue("DIGEST");
  await m.context().close();
  await sql(`UPDATE notification_defaults SET email = 'OFF' WHERE type = 'profile.badge'`);

  await page.goto("/admin");
  await expect.poll(async () => Number(await page.getByTestId("gcs-online-users-count").textContent())).toBeGreaterThanOrEqual(1);
});
