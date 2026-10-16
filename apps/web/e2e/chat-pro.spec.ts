import { expect, test, type Browser, type Page } from "@playwright/test";
import { fixture, forumTree, member, uid } from "./forum-fixtures";
import { enterAcpAsRoot, resetSetting, sql, useFreshIp } from "./helpers";

/**
 * Chat Pro (specul 2026-10-10-chat-pro), aplicația premium peste chat: pornirea din ACP, bara de anunțuri, emoticoanele
 * încărcate și folosite (cu completarea `:cod:`), comenzile botului, clasamentul, istoricul, setările membrului
 * (aranjamentele, culorile, porecla, oprirea chat-ului), răspunsurile citate, piatră-hârtie-foarfecă, raportarea,
 * „scrie…” și vizualizatorul de imagini. La final Chat Pro e oprit din nou (chat-ul standard rămâne cel implicit).
 */

/** O imagine PNG mică (120×40). */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAHgAAAAoCAYAAAA16j4lAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAA2klEQVR4nO2VwREDMRDCrhxa2P57oJ2kigxw0UN/D7Lsx7oP3Gs3eNIHgEMwl+AomEtwPNH+wy+BP1h5CQguGMqjULDyEhBcMJRHoWDlJSC4YCiPQsHKS0BwwVAehYKVl4DggqE8CgUrLwHBBUN5FApWXgKCC4byKBSsvAQEFwzlUShYeQkILhjKo1Cw8hIQXDCUR6Fg5SUguGAoj0LByktAcMFQHoWClZeA4IKhPAoFKy8BwQVDeRQKVl4CgguG8igUrLwEBBcM5VEoWHkJCC4YyqNQsPISfskXUMR26J4zmrwAAAAASUVORK5CYII=",
  "base64",
);

/** Pornește / oprește Chat Pro direct în baza E2E și golește cache-ul aplicațiilor (fără ACP). */
async function setChatPro(enabled: boolean): Promise<void> {
  await sql(`INSERT INTO apps (key, enabled, "updatedAt") VALUES ('chat_pro', $1, now()) ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, "updatedAt" = now()`, [enabled]);
  const { default: Redis } = await import("ioredis");
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  try {
    await redis.del("gcs:k:apps:enabled");
  } finally {
    redis.disconnect();
  }
}

async function chatPage(browser: Browser, name: string, email: string, ip: string, group = "vip_gold"): Promise<Page> {
  const context = await browser.newContext();
  await useFreshIp(context, ip);
  const page = await context.newPage();
  await member(page, name, email, group);
  await page.goto("/chat");
  await expect(page.locator("html")).toHaveAttribute("data-realtime", "on", { timeout: 20_000 });
  return page;
}

const room = (page: Page) => page.getByTestId("gcs-chat-general");

/** Trimite un mesaj și așteaptă să apară în listă (flood-ul VIP e de 1 s). */
async function send(page: Page, text: string, expected: string | RegExp = text): Promise<void> {
  await room(page).getByTestId("gcs-chat-input").fill(text);
  await room(page).getByRole("button", { name: "Trimite" }).click();
  await expect(room(page).getByTestId("gcs-chat-msg").filter({ hasText: expected }).last()).toBeVisible();
  await page.waitForTimeout(1_100);
}

test.afterAll(async () => {
  await setChatPro(false).catch(() => {});
  for (const key of ["chat_pro.vote_enabled", "chat_pro.vote_text", "chat_pro.vote_url", "chat_pro.count_cooldown"]) await resetSetting(key).catch(() => {});
  await sql(`DELETE FROM chat_pro_bar_items`).catch(() => {});
  await sql(`DELETE FROM chat_emote_packs`).catch(() => {});
  // Mesajele acestui fișier nu rămân în canalul General (alte specuri caută mesaje după text).
  await sql(
    `DELETE FROM chat_messages WHERE "authorId" IN (SELECT id FROM users WHERE email LIKE 'cp-%' OR email LIKE 'shot-%' OR email LIKE 'img-c-%' OR email LIKE 'cproot-%')`,
  ).catch(() => {});
});

test("ACP: pornirea, mementoul de vot, bara de anunțuri și emoticoanele; membrul le vede și le folosește, comenzile, clasamentul, istoricul", async ({ page, context, browser }) => {
  test.setTimeout(240_000);
  await useFreshIp(context, "100.90.0");
  const id = uid();
  await enterAcpAsRoot(page, `CpRoot${id}`, `cproot-${id}@example.com`);

  // Setări → General: pornirea aplicației (oprită implicit); Memento de vot.
  await page.goto("/admin/community/chat-pro");
  const settings = page.getByTestId("gcs-acp-chatpro-settings");
  const toggle = settings.getByRole("switch", { name: "Chat Pro pornit" });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await settings.getByRole("button", { name: "Salvează" }).click();
  await expect(settings.getByRole("status")).toHaveText("Salvat");
  await settings.getByRole("tab", { name: "Memento de vot" }).click();
  await settings.getByRole("switch", { name: "Mementoul de vot pornit" }).check();
  await settings.getByLabel("Textul mementoului").fill(`Votează serverele ${id}`);
  await settings.getByLabel("Linkul de vot").fill("/servers");
  await settings.getByRole("button", { name: "Salvează" }).click();
  await expect(settings.getByRole("status")).toHaveText("Salvat");

  // Bara de anunțuri: un element cu buton.
  await page.goto("/admin/community/chat-pro/bar");
  await page.getByTestId("gcs-acp-bar-add").click();
  const form = page.getByTestId("gcs-acp-bar-form");
  await form.getByLabel("Textul", { exact: true }).fill(`Turneul de vineri ${id}`);
  await form.getByLabel("Textul butonului (opțional)").fill("Înscrie-te");
  await form.getByLabel("Linkul butonului").fill("/clans");
  await page.getByTestId("gcs-acp-bar-save").click();
  await expect(page.getByTestId("gcs-acp-bar-item").filter({ hasText: `Turneul de vineri ${id}` })).toBeVisible();

  // Emoticoanele: un pachet și încărcarea în masă (codul din numele fișierului).
  await page.goto("/admin/community/chat-pro/emotes");
  await page.getByTestId("gcs-acp-pack-add").click();
  const newPack = page.getByTestId("gcs-acp-pack-new");
  await newPack.getByLabel("Numele pachetului").fill(`Gaming ${id}`);
  await newPack.getByRole("button", { name: "Creează pachetul" }).click();
  const pack = page.locator(`section[aria-label="Gaming ${id}"]`);
  await expect(pack).toBeVisible();
  await pack.getByTestId("gcs-acp-emote-files").setInputFiles([
    { name: `gg${id}.png`, mimeType: "image/png", buffer: PNG },
    { name: "nu-e-imagine.png", mimeType: "image/png", buffer: Buffer.from("text") },
  ]);
  await pack.getByTestId("gcs-acp-emote-upload").click();
  await expect(page.getByTestId("gcs-acp-emote-status")).toContainText("1 emoticon adăugat");
  await expect(pack.getByTestId("gcs-acp-emote")).toHaveCount(1);

  // Membrul: camera Chat Pro, bara, mementoul (privat), emoticonul cu completarea automată și „Primul mesaj”.
  const a = await chatPage(browser, `CpAna${id}`, `cp-a-${id}@example.com`, "100.90.1");
  await expect(room(a)).toHaveAttribute("data-chat-pro", "");
  await expect(a.getByTestId("gcs-chatpro-bar-text")).toHaveText(`Turneul de vineri ${id}`);
  await expect(a.getByTestId("gcs-chatpro-bar-cta")).toHaveAttribute("href", "/clans");
  await expect(a.getByTestId("gcs-chatpro-vote")).toContainText(`Votează serverele ${id}`);
  await a.getByTestId("gcs-chatpro-vote").getByRole("button", { name: "Ascunde" }).click();
  await expect(a.getByTestId("gcs-chatpro-vote")).toHaveCount(0);

  const input = room(a).getByTestId("gcs-chat-input");
  await input.fill(`salut :gg${id.slice(0, 3)}`);
  await expect(room(a).getByTestId("gcs-chat-suggest")).toContainText(`:gg${id}:`);
  await input.press("Enter");
  await expect(input).toHaveValue(`salut :gg${id}: `);
  await input.press("Enter");
  const first = room(a).getByTestId("gcs-chat-msg").filter({ hasText: "salut" }).last();
  await expect(first.locator("img.gcs-emote")).toHaveAttribute("alt", `:gg${id}:`);
  await expect(first.getByTestId("gcs-chatpro-first")).toHaveText("Primul mesaj");
  await a.waitForTimeout(1_100);

  // Selectorul de emoticoane: tab-ul pachetului, steaua (favorite), inserarea.
  await room(a).getByRole("button", { name: "Emoticoane" }).click();
  const picker = a.getByTestId("gcs-chatpro-emotes");
  await picker.getByRole("tab", { name: `Gaming ${id}` }).click();
  await picker.getByRole("button", { name: `Adaugă :gg${id}: la favorite` }).click();
  await picker.getByRole("tab", { name: "Favorite" }).click();
  await picker.getByTestId("gcs-chatpro-emote").click();
  await expect(input).toHaveValue(`:gg${id}: `);
  await input.fill("");

  // Comenzile botului: /roll și /iq (cardul botului), nu intră în clasament.
  await send(a, "/roll 6", /a dat cu zarul/);
  await expect(room(a).getByTestId("gcs-chatpro-bot").last()).toHaveAttribute("data-command", "roll");
  await send(a, "/iq", /IQ-ul lui/);

  // Clasamentul: membrul pe podium, „Mesaje azi” = 1 (comenzile nu se numără).
  await a.reload();
  await expect(a.getByTestId("gcs-chatpro-podium-1")).toContainText(`CpAna${id}`);
  await expect(a.getByTestId("gcs-chatpro-today")).toHaveText("1");
  await expect(a.getByTestId("gcs-chatpro-reset")).toContainText("până la resetare");

  // Istoricul: totalurile, căutarea după text.
  await a.getByTestId("gcs-chatpro-history").click();
  await expect(a).toHaveURL(/\/chat\/history$/);
  await expect(a.getByTestId("gcs-chat-history-messages")).toBeVisible();
  await a.getByTestId("gcs-chat-history-q").fill("salut");
  await a.getByTestId("gcs-chat-history-submit").click();
  await expect(a).toHaveURL(/q=salut/);
  await expect(a.getByTestId("gcs-chat-history-row").first()).toContainText("salut");
  await a.getByTestId("gcs-chat-history-member").fill(`cpana${id}`);
  await a.getByTestId("gcs-chat-history-submit").click();
  await expect(a.getByTestId("gcs-chat-history-row").first()).toContainText(`CpAna${id}`);
  await a.context().close();
});

test("setările membrului: căutarea, aranjamentele, culorile, porecla și oprirea chat-ului, salvate pe server", async ({ browser }) => {
  test.setTimeout(150_000);
  await setChatPro(true);
  const id = uid();
  const a = await chatPage(browser, `CpSet${id}`, `cp-set-${id}@example.com`, "100.90.2");
  await room(a).getByTestId("gcs-chat-settings").click();
  const dialog = a.getByRole("dialog", { name: "Setările chat-ului" });
  await expect(dialog).toBeVisible();

  // Căutarea filtrează rândurile din toate secțiunile.
  await dialog.getByTestId("gcs-chatpro-settings-search").fill("volum");
  await expect(dialog.getByTestId("gcs-chatpro-row-voiceVolume")).toBeVisible();
  await expect(dialog.getByTestId("gcs-chatpro-row-sound")).toHaveCount(0);
  await dialog.getByTestId("gcs-chatpro-settings-search").fill("");

  // Aranjamentul „Bule” se aplică pe loc; culoarea fundalului mesajelor, cu opacitate.
  await dialog.getByTestId("gcs-chatpro-settings-layout").click();
  await dialog.getByTestId("gcs-chatpro-layout-bubbles").click();
  await expect(room(a)).toHaveAttribute("data-layout", "bubbles");
  await dialog.getByTestId("gcs-chatpro-color-element").selectOption("messageBg");
  await dialog.getByTestId("gcs-color-hex").fill("#11223380");
  await expect.poll(async () => room(a).evaluate((el) => (el as HTMLElement).style.getPropertyValue("--cp-msg-bg"))).toBe("rgb(17 34 51 / 0.502)");

  // Porecla (Cont).
  await dialog.getByTestId("gcs-chatpro-settings-account").click();
  await dialog.getByTestId("gcs-chatpro-nickname").fill(`Nick${id}`);
  await dialog.getByRole("button", { name: "Salvează" }).click();
  await expect(dialog.getByText("Salvat.")).toBeVisible();
  await dialog.getByRole("button", { name: "Închide" }).click();
  await a.waitForTimeout(800);

  // Totul rămâne după reîncărcare (pe server); mesajul arată porecla.
  await a.reload();
  await expect(room(a)).toHaveAttribute("data-layout", "bubbles");
  await send(a, `cu poreclă ${id}`);
  await expect(room(a).getByTestId("gcs-chat-msg").filter({ hasText: `cu poreclă ${id}` }).getByTestId("gcs-chat-name")).toHaveText(`Nick${id}`);

  // Toate cele 7 aranjamente se pot alege.
  await room(a).getByTestId("gcs-chat-settings").click();
  await dialog.getByTestId("gcs-chatpro-settings-layout").click();
  for (const layout of ["cards", "stream", "columns", "bubbles", "timeline", "discord", "accent"]) {
    await dialog.getByTestId(`gcs-chatpro-layout-${layout}`).click();
    await expect(room(a)).toHaveAttribute("data-layout", layout);
  }

  // Oprirea chat-ului pentru membru și repornirea lui.
  await dialog.getByTestId("gcs-chatpro-settings-account").click();
  // Un click (nu `check`): comutatorul dispare odată cu chat-ul oprit.
  await dialog.getByTestId("gcs-chatpro-pref-disabled").click();
  await expect(a.getByTestId("gcs-chatpro-disabled")).toBeVisible();
  await a.getByRole("button", { name: "Pornește chat-ul" }).click();
  await expect(room(a).getByTestId("gcs-chat-input")).toBeVisible();
  await a.context().close();
});

test("doi membri: răspunsul citat și notificarea, piatră-hârtie-foarfecă, „scrie…”, raportarea", async ({ browser }) => {
  test.setTimeout(150_000);
  await setChatPro(true);
  const id = uid();
  const a = await chatPage(browser, `CpA${id}`, `cp-ra-${id}@example.com`, "100.90.3");
  const b = await chatPage(browser, `CpB${id}`, `cp-rb-${id}@example.com`, "100.90.4");

  await send(a, `întrebare ${id}`);
  const question = room(b).getByTestId("gcs-chat-msg").filter({ hasText: `întrebare ${id}` });
  await expect(question).toBeVisible({ timeout: 10_000 });

  // „scrie…” ajunge la celălalt (semnalul pleacă cel mult o dată la 3 s; ultimul a plecat la mesajul de mai sus).
  await a.waitForTimeout(3_200);
  await room(a).getByTestId("gcs-chat-input").fill("încep să scriu");
  await expect(b.getByTestId("gcs-chatpro-typing")).toHaveText(`CpA${id} scrie…`, { timeout: 10_000 });
  await room(a).getByTestId("gcs-chat-input").fill("");

  // Răspunsul citat: bara „Răspunzi lui…”, citatul la ambii, notificarea autorului.
  await question.hover();
  await question.getByTestId("gcs-chatpro-reply").click();
  await expect(b.getByTestId("gcs-chatpro-replybar")).toContainText(`Răspunzi lui CpA${id}`);
  await send(b, `răspuns ${id}`);
  const answer = room(a).getByTestId("gcs-chat-msg").filter({ hasText: `răspuns ${id}` });
  await expect(answer.getByTestId("gcs-chatpro-quote")).toContainText(`întrebare ${id}`, { timeout: 10_000 });
  await room(a).getByTestId("gcs-chatpro-notifications").click();
  await expect(a.getByTestId("gcs-chatpro-notifications-panel")).toContainText(`CpB${id} ți-a răspuns`);
  await a.keyboard.press("Escape");

  // Piatră-hârtie-foarfecă: provocarea, răspunsul adversarului, rezultatul la amândoi.
  await send(b, `/rps @CpA${id} piatra`, /îl provoacă pe/);
  const challenge = room(a).getByTestId("gcs-chatpro-bot").filter({ hasText: "îl provoacă pe" }).last();
  await challenge.getByTestId("gcs-chatpro-rps-paper").click();
  await expect(challenge.getByTestId("gcs-chatpro-rps-result")).toContainText(`câștigă CpA${id}`);
  await expect(room(b).getByTestId("gcs-chatpro-rps-result").last()).toContainText(`câștigă CpA${id}`, { timeout: 10_000 });

  // Raportarea unui mesaj (meniul „⋯”).
  const theirs = room(a).getByTestId("gcs-chat-msg").filter({ hasText: `răspuns ${id}` });
  await theirs.hover();
  await theirs.getByTestId("gcs-chatpro-more").click();
  // Meniul „⋯” stă într-un portal (peste listă): elementele lui se caută în pagină.
  await a.getByTestId("gcs-chatpro-report").click();
  const report = a.getByRole("dialog", { name: "Raportează mesajul" });
  await report.getByTestId("gcs-chatpro-report-reason").fill("Spam în chat");
  await report.getByTestId("gcs-chatpro-report-send").click();
  await expect(report.getByRole("status")).toHaveText("Mulțumim! Moderatorii au primit raportul.");
  const rows = await sql<{ n: number }>(`SELECT count(*)::int AS n FROM reports WHERE "contentType" = 'chat.message'`);
  expect(rows[0]!.n).toBeGreaterThan(0);
  await a.context().close();
  await b.context().close();
});

test("vizualizatorul de imagini: galeria topicului, legenda, mărirea, tastatura; imaginile din chat", async ({ page, context, request, browser }) => {
  test.setTimeout(120_000);
  await useFreshIp(context, "100.90.5");
  const id = uid();
  await member(page, `Img${id}`, `img-${id}@example.com`);
  const { forum } = await forumTree(request);
  const topic = await fixture<{ topicId: number; slug: string }>(request, { action: "topic", forumId: forum.id, title: `Galerie ${id}`, text: "Poze din meci", authorEmail: `img-${id}@example.com`, images: 2 });
  await page.goto(`/topic/${topic.topicId}`);
  const images = page.locator(".gcs-postBody img.gcs-postImage");
  await expect(images).toHaveCount(2);
  await expect(images.first()).toHaveAttribute("role", "button");
  await images.first().click();
  const viewer = page.getByTestId("gcs-image-viewer");
  await expect(viewer).toBeVisible();
  await expect(page.getByTestId("gcs-viewer-counter")).toHaveText("1 din 2");
  await expect(page.getByTestId("gcs-viewer-caption")).toContainText(`de Img${id}`);
  await expect(page.getByTestId("gcs-viewer-caption").getByRole("link", { name: "Vezi conținutul" })).toHaveAttribute("href", /^\/topic\/\d+\/post\/\d+$/);
  await expect(page.getByTestId("gcs-viewer-download")).toHaveAttribute("download", "");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("gcs-viewer-counter")).toHaveText("2 din 2");
  await viewer.getByRole("button", { name: "Mărește" }).click();
  await expect.poll(async () => Number(await page.getByTestId("gcs-viewer-image").getAttribute("data-scale"))).toBeGreaterThan(1);
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  // Tastatura: Enter pe imaginea focusată o deschide.
  await images.nth(1).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("gcs-viewer-counter")).toHaveText("2 din 2");
  await page.keyboard.press("Escape");

  // Imaginile din chat (Chat Pro): „Mărește media” deschide vizualizatorul cu imaginile mesajului.
  await setChatPro(true);
  const c = await chatPage(browser, `ImgC${id}`, `img-c-${id}@example.com`, "100.90.6");
  await room(c).getByTestId("gcs-chat-file").setInputFiles({ name: "captura.png", mimeType: "image/png", buffer: PNG });
  await room(c).getByRole("button", { name: "Trimite" }).click();
  const msg = room(c).getByTestId("gcs-chat-msg").filter({ has: c.getByTestId("gcs-chat-image") }).last();
  await expect(msg).toBeVisible();
  await msg.hover();
  await msg.getByTestId("gcs-chatpro-enlarge").click();
  await expect(c.getByTestId("gcs-image-viewer")).toBeVisible();
  await expect(c.getByTestId("gcs-viewer-caption")).toContainText(`de ImgC${id}`);
  await c.keyboard.press("Escape");
  await msg.getByTestId("gcs-chat-image").click();
  await expect(c.getByTestId("gcs-image-viewer")).toBeVisible();
  await c.context().close();
});

/**
 * Capturile pentru proprietar (doar cu `GCS_SHOTS_DIR`): Chat Pro întunecat și luminos, desktop și 375 px, setările,
 * istoricul, ACP-ul, vizualizatorul și tema Clasic.
 */
test("capturi Chat Pro", async ({ browser, request }) => {
  const dir = process.env.GCS_SHOTS_DIR;
  test.skip(!dir, "doar cu GCS_SHOTS_DIR");
  test.setTimeout(300_000);
  await setChatPro(true);
  const id = uid();
  await sql(`INSERT INTO chat_pro_bar_items (text, "ctaLabel", "ctaUrl", "updatedAt") VALUES ($1, 'Votează', '/servers', now())`, ["[SERVERE] Votează serverele comunității în fiecare zi!"]);
  const b = await chatPage(browser, `Krypt${id}`, `shot-b-${id}@example.com`, "100.91.1");
  await send(b, "Salut! Cine intră diseară pe serverul de CS2?");
  await send(b, "/roll 100", /a dat cu zarul/);
  const a = await chatPage(browser, `Nova${id}`, `shot-a-${id}@example.com`, "100.91.2", "admin");
  const q = room(a).getByTestId("gcs-chat-msg").filter({ hasText: "Cine intră diseară" });
  await q.hover();
  await q.getByTestId("gcs-chatpro-reply").click();
  await send(a, "Eu intru după 21:00, facem echipă? https://youtu.be/aqz-KE-bpKQ");
  await room(a).getByTestId("gcs-chat-file").setInputFiles({ name: "captura.png", mimeType: "image/png", buffer: PNG });
  await room(a).getByTestId("gcs-chat-input").fill("Captura de aseară 🎮");
  await room(a).getByRole("button", { name: "Trimite" }).click();
  await a.waitForTimeout(1_200);
  await send(b, `/rps @Nova${id}`, /îl provoacă pe/);
  await a.reload();
  await expect(a.getByTestId("gcs-chatpro-ranking")).toBeVisible();

  const shot = async (page: Page, name: string, full = false) => {
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/${name}.png`, fullPage: full });
  };
  const mode = async (page: Page, theme: "dark" | "light", skin?: string) => {
    await page.context().addCookies([
      { name: "gcs-theme", value: theme, url: page.url() },
      ...(skin ? [{ name: "gcs-skin", value: skin, url: page.url() }] : []),
    ]);
  };
  for (const theme of ["dark", "light"] as const) {
    await mode(a, theme);
    await a.setViewportSize({ width: 1440, height: 1000 });
    await a.goto("/chat");
    await expect(room(a)).toHaveAttribute("data-chat-pro", "");
    await shot(a, `01-chat-desktop-${theme}`);
    await a.setViewportSize({ width: 375, height: 812 });
    await a.goto("/chat");
    await shot(a, `02-chat-375-${theme}`, true);
    await a.setViewportSize({ width: 1440, height: 1000 });
    await a.goto("/");
    await shot(a, `03-home-shoutbox-desktop-${theme}`, true);
    await a.goto("/chat");
    await room(a).getByTestId("gcs-chat-settings").click();
    await a.getByTestId("gcs-chatpro-settings-layout").click();
    await shot(a, `04-settings-layout-desktop-${theme}`);
    await a.getByTestId("gcs-chatpro-settings-prefs").click();
    await shot(a, `05-settings-prefs-desktop-${theme}`);
    await a.keyboard.press("Escape");
    await a.goto("/chat/history");
    await shot(a, `06-history-desktop-${theme}`, true);
    await a.setViewportSize({ width: 375, height: 812 });
    await a.goto("/chat/history");
    await shot(a, `07-history-375-${theme}`, true);
    await a.goto("/chat");
    await room(a).getByTestId("gcs-chat-settings").click();
    await shot(a, `08-settings-375-${theme}`);
    await a.keyboard.press("Escape");
  }
  // Aranjamentele (întunecat, desktop).
  await mode(a, "dark");
  await a.setViewportSize({ width: 1440, height: 1000 });
  await a.goto("/chat");
  for (const layout of ["bubbles", "discord", "timeline", "stream"]) {
    await room(a).getByTestId("gcs-chat-settings").click();
    await a.getByTestId("gcs-chatpro-settings-layout").click();
    await a.getByTestId(`gcs-chatpro-layout-${layout}`).click();
    await a.keyboard.press("Escape");
    await shot(a, `09-layout-${layout}-dark`);
    await a.waitForTimeout(600);
  }
  await room(a).getByTestId("gcs-chat-settings").click();
  await a.getByTestId("gcs-chatpro-settings-layout").click();
  await a.getByTestId("gcs-chatpro-layout-cards").click();
  await a.keyboard.press("Escape");
  await a.waitForTimeout(1_000);
  // Tema Clasic (aspectul de până acum) rămâne folosibilă.
  await mode(a, "dark", "default");
  await a.goto("/chat");
  await shot(a, "10-chat-classic-dark");
  await mode(a, "light", "default");
  await a.goto("/chat");
  await shot(a, "10-chat-classic-light");
  await a.context().clearCookies({ name: "gcs-skin" });
  // Vizualizatorul de imagini (desktop și 375 px).
  await mode(a, "dark");
  await a.goto("/chat");
  await room(a).getByTestId("gcs-chat-image").last().click();
  await expect(a.getByTestId("gcs-image-viewer")).toBeVisible();
  await shot(a, "11-viewer-desktop");
  await a.keyboard.press("Escape");
  await a.setViewportSize({ width: 375, height: 812 });
  // Pe ecranele mici imaginile stau după „Arată media” (preferința implicită).
  await room(a).getByTestId("gcs-chat-media-toggle").last().click();
  await room(a).getByTestId("gcs-chat-image").last().click();
  await shot(a, "11-viewer-375");
  await a.keyboard.press("Escape");
  await a.context().close();
  await b.context().close();
  void request;

  // ACP: setările Chat Pro, bara și emoticoanele.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await useFreshIp(ctx, "100.91.3");
  const r = await ctx.newPage();
  await enterAcpAsRoot(r, `ShotRoot${id}`, `shot-root-${id}@example.com`);
  for (const [path, name] of [
    ["/admin/community/chat-pro", "12-acp-settings"],
    ["/admin/community/chat-pro/bar", "13-acp-bar"],
    ["/admin/community/chat-pro/emotes", "14-acp-emotes"],
    ["/admin/system/applications", "15-acp-applications"],
  ] as const) {
    await r.goto(path);
    await shot(r, name, true);
  }
  await ctx.close();
});
