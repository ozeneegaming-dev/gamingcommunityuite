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
  // După reîncărcare, conexiunea live se refăce: fără așteptare, mesajul lui B poate sosi înainte să asculte.
  await expect(mod.locator("html")).toHaveAttribute("data-realtime", "on", { timeout: 20_000 });

  const text = `salut de la Bogdan ${id}`;
  await shout(b).getByTestId("gcs-chat-input").fill(text);
  await shout(b).getByRole("button", { name: "Trimite" }).click();
  const msgAtA = shout(a).getByTestId("gcs-chat-msg").filter({ hasText: text });
  await expect(msgAtA).toBeVisible({ timeout: 2_000 });

  const msgAtMod = shout(mod).getByTestId("gcs-chat-msg").filter({ hasText: text });
  await expect(msgAtMod).toBeVisible();
  // Meniul „⋯” al moderatorului: Mute ▸ 15 minute → dialogul (motivul, „Anunță în chat”) → confirmă; apoi „Șterge mesajul”.
  await msgAtMod.getByTestId("gcs-chat-more").click();
  // Meniul stă într-un portal (peste listă), deci se caută în pagină.
  await mod.getByTestId("gcs-chatmod-mute").hover();
  await mod.getByTestId("gcs-chatmod-mute-15").click();
  await mod.getByTestId("gcs-chatmod-dialog-mute").getByTestId("gcs-chatmod-confirm").click();
  await expect(mod.getByTestId("gcs-chatmod-dialog-mute")).toHaveCount(0);
  await msgAtMod.getByTestId("gcs-chat-more").click();
  await mod.getByTestId("gcs-chatpro-delete").click();
  await expect(msgAtA).toHaveCount(0, { timeout: 5_000 });

  await b.reload();
  await expect(shout(b).getByTestId("gcs-chat-input")).toBeDisabled();
  // Shoutbox-ul vine prin streaming: până la afișare, conținutul lui există și într-o copie ascunsă.
  await expect(shout(b).getByTestId("gcs-chat-muted").filter({ visible: true })).toBeVisible();
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

test("chat v2: camera privată cu invitat, mențiune, reacție, editare live și anunțul global; un străin primește 404", async ({ browser }) => {
  test.setTimeout(120_000);
  const id = uid();
  const vip = await memberPage(browser, `Vip${id}`, `chat-v-${id}@example.com`, "198.18.10", "vip_gold");
  const inv = await memberPage(browser, `Inv${id}`, `chat-i-${id}@example.com`, "198.18.11");
  const stranger = await memberPage(browser, `Str${id}`, `chat-s-${id}@example.com`, "198.18.12");
  const mod = await memberPage(browser, `Ann${id}`, `chat-n-${id}@example.com`, "198.18.13", "moderator");

  // VIP-ul creează o cameră privată și îl invită pe Inv.
  await vip.goto("/chat");
  await vip.getByTestId("gcs-chat-create").click();
  const form = vip.getByTestId("gcs-chat-create-form");
  await form.getByLabel("Numele camerei").fill(`Clan ${id}`);
  await form.getByLabel("Privată (doar invitații)").check();
  await form.getByLabel("Invitați", { exact: true }).fill(`Inv${id}`);
  await form.getByRole("button", { name: "Creează" }).click();
  await expect(vip).toHaveURL(/\/chat\?c=clan-/);
  const key = new URL(vip.url()).searchParams.get("c")!;
  await expect(vip.getByTestId("gcs-chat-members")).toContainText(`Inv${id}`);

  // Străinul nu vede camera și primește 404 pe link.
  await stranger.goto("/chat");
  await expect(stranger.getByRole("link", { name: `Clan ${id}` })).toHaveCount(0);
  const res = await stranger.goto(`/chat?c=${key}`);
  expect(res?.status()).toBe(404);

  // Invitatul intră; VIP-ul îl menționează; mesajul apare live.
  await inv.goto(`/chat?c=${key}`);
  const room = (p: Page) => p.getByTestId(`gcs-chat-${key}`);
  await expect(inv.locator("html")).toHaveAttribute("data-realtime", "on", { timeout: 20_000 });
  await expect(inv.getByTestId("gcs-chat-online")).toContainText(`Inv${id}`);
  await room(vip).getByTestId("gcs-chat-input").fill(`@Inv${id} intrăm la 9?`);
  await room(vip).getByTestId("gcs-chat-input").press("Enter");
  const msgAtInv = room(inv).getByTestId("gcs-chat-msg").filter({ hasText: "intrăm la 9?" });
  await expect(msgAtInv).toBeVisible({ timeout: 10_000 });
  const [inviteeId] = await sql<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [`chat-i-${id}@example.com`]);
  await expect.poll(async () => (await sql(`SELECT 1 FROM notifications WHERE "userId" = $1 AND type = 'chat.mention'`, [inviteeId!.id])).length).toBe(1);

  // Reacție de la invitat → contorul apare la VIP; editarea VIP-ului apare la invitat.
  await msgAtInv.getByRole("button", { name: "Reacție" }).click();
  await msgAtInv.getByRole("group", { name: "Reacție" }).getByRole("button").first().click();
  const msgAtVip = room(vip).getByTestId("gcs-chat-msg").filter({ hasText: "intrăm la 9?" });
  await expect(msgAtVip.getByTestId("gcs-chat-reactions")).toContainText("1", { timeout: 10_000 });
  await msgAtVip.getByTestId("gcs-chat-more").click();
  await vip.getByTestId("gcs-chatmod-edit").click();
  await room(vip).getByLabel("Editează mesajul").fill(`@Inv${id} intrăm la 10?`);
  await room(vip).getByRole("button", { name: "Salvează" }).click();
  await expect(room(inv).getByTestId("gcs-chat-msg").filter({ hasText: "intrăm la 10?" })).toContainText("editat", { timeout: 10_000 });

  // Anunțul global al staff-ului apare live și în camera privată.
  await mod.goto("/chat");
  const announce = mod.getByTestId("gcs-chat-announce");
  await announce.getByLabel("Textul anunțului").fill(`Turneu ${id} sâmbătă!`);
  await announce.getByLabel("Durata (ore, gol = până la ștergere)").fill("1");
  await announce.getByRole("button", { name: "Publică anunțul" }).click();
  await expect(room(inv).getByTestId("gcs-chat-announcement").filter({ hasText: `Turneu ${id} sâmbătă!` })).toBeVisible({ timeout: 10_000 });
});
