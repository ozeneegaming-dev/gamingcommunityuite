import { expect, test, type Browser, type Page } from "@playwright/test";
import { member, uid } from "./forum-fixtures";
import { sql, useFreshIp } from "./helpers";

/** Shoutbox-ul, „Cine e online” și chat-ul (specul etapei 4 §1, §8). */
async function memberPage(browser: Browser, name: string, email: string, ip: string, group = "member"): Promise<Page> {
  const context = await browser.newContext();
  await useFreshIp(context, ip);
  const page = await context.newPage();
  await member(page, name, email, group);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-realtime", "on", { timeout: 20_000 });
  return page;
}

const shout = (page: Page) => page.getByTestId("gcs-shoutbox");

test("B scrie în shoutbox → apare la A; moderatorul șterge → dispare; mute → câmpul e dezactivat", async ({ browser }) => {
  const id = uid();
  const a = await memberPage(browser, `Ana${id}`, `chat-a-${id}@example.com`, "192.0.2");
  const b = await memberPage(browser, `Bogdan${id}`, `chat-b-${id}@example.com`, "198.18.0");
  const mod = await memberPage(browser, `Mod${id}`, `chat-m-${id}@example.com`, "198.18.1", "moderator");
  await mod.reload();

  const text = `salut de la Bogdan ${id}`;
  await shout(b).getByTestId("gcs-chat-input").fill(text);
  await shout(b).getByRole("button", { name: "Trimite" }).click();
  const msgAtA = shout(a).getByTestId("gcs-chat-msg").filter({ hasText: text });
  await expect(msgAtA).toBeVisible({ timeout: 2_000 });

  const msgAtMod = shout(mod).getByTestId("gcs-chat-msg").filter({ hasText: text });
  await expect(msgAtMod).toBeVisible();
  await msgAtMod.getByRole("button", { name: "Mute 10 min" }).click();
  await msgAtMod.getByRole("button", { name: "Șterge" }).click();
  await expect(msgAtA).toHaveCount(0, { timeout: 5_000 });

  await b.reload();
  await expect(shout(b).getByTestId("gcs-chat-input")).toBeDisabled();
  await expect(shout(b).getByTestId("gcs-chat-muted")).toBeVisible();
  for (const p of [a, b, mod]) await p.context().close();
});

test("vizitatorul nu vede shoutbox-ul", async ({ page, context }) => {
  await useFreshIp(context, "198.18.2");
  await page.goto("/");
  await expect(page.getByTestId("gcs-forum-index")).toBeVisible();
  await expect(page.getByTestId("gcs-shoutbox")).toHaveCount(0);
});

test("„Cine e online” îi arată pe A și pe B, dar nu pe C (status ascuns)", async ({ browser }) => {
  const id = uid();
  const a = await memberPage(browser, `OnA${id}`, `on-a-${id}@example.com`, "198.18.3");
  const b = await memberPage(browser, `OnB${id}`, `on-b-${id}@example.com`, "198.18.4");
  const cEmail = `on-c-${id}@example.com`;
  const c = await memberPage(browser, `OnC${id}`, cEmail, "198.18.5");
  await sql(`UPDATE users SET privacy = '{"showOnline": false}'::jsonb WHERE email = $1`, [cEmail]);
  await a.reload();
  const online = a.getByTestId("gcs-online-members");
  await expect(online).toContainText(`OnA${id}`);
  await expect(online).toContainText(`OnB${id}`);
  await expect(online).not.toContainText(`OnC${id}`);
  for (const p of [a, b, c]) await p.context().close();
});

test("fără realtime, un mesaj trimis apare după reîncărcare", async ({ browser }) => {
  const id = uid();
  const context = await browser.newContext();
  await useFreshIp(context, "198.18.6");
  await context.routeWebSocket(/socket\.io/, (ws) => ws.close());
  const page = await context.newPage();
  await member(page, `Off${id}`, `off-${id}@example.com`);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-realtime", "off", { timeout: 20_000 });
  const text = `fără live ${id}`;
  await shout(page).getByTestId("gcs-chat-input").fill(text);
  await shout(page).getByRole("button", { name: "Trimite" }).click();
  await page.reload();
  await expect(shout(page).getByTestId("gcs-chat-msg").filter({ hasText: text })).toBeVisible();
  await context.close();
});

test("/chat: canalul General, cu slow mode pentru moderatori", async ({ browser }) => {
  const id = uid();
  const mod = await memberPage(browser, `ModC${id}`, `chat-mc-${id}@example.com`, "198.18.7", "moderator");
  await mod.goto("/chat");
  await expect(mod.getByRole("link", { name: "General" })).toHaveAttribute("aria-current", "page");
  await expect(mod.getByTestId("gcs-chat-slowmode")).toBeVisible();
  await mod.context().close();
});
