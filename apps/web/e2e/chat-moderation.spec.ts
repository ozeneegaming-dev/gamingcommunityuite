import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { member, uid } from "./forum-fixtures";
import { enterAcpAsRoot, resetSetting, sql, useFreshIp } from "./helpers";

/**
 * Moderarea chat-ului pentru staff (chat-ul standard; meniul e același în Chat Pro) și accesul de moderator în chat
 * (`/acces`), plus panoul de clasament și istoricul din Chat Pro: meniul după drepturi, ascunderea, avertismentul cu
 * dovada, mute-ul cu numărătoare și linia de sistem, kick / ban live, editarea și ștergerea în masă, ridicarea din ACP,
 * acțiunile rapide din cardul membrului, `/acces` → meniul live → expirarea → `/revoca`, podiumul și istoricul.
 */

async function setChatPro(enabled: boolean): Promise<void> {
  await sql(`INSERT INTO apps (key, enabled, "updatedAt") VALUES ('chat_pro', $1, now()) ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, "updatedAt" = now()`, [enabled]);
  await redisDel(["gcs:k:apps:enabled"], "gcs:k:chat_pro:*");
}

/** Șterge chei din Redis (cache-ul aplicațiilor, al clasamentului). */
async function redisDel(keys: string[], pattern?: string): Promise<void> {
  const { default: Redis } = await import("ioredis");
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  try {
    if (keys.length) await redis.del(...keys);
    if (pattern) {
      const found = await redis.keys(pattern);
      if (found.length) await redis.del(...found);
    }
  } finally {
    redis.disconnect();
  }
}

async function chatPage(browser: Browser, name: string, email: string, ip: string, group = "member"): Promise<Page> {
  const context = await browser.newContext();
  await useFreshIp(context, ip);
  const page = await context.newPage();
  await member(page, name, email, group);
  await page.goto("/chat");
  await expect(page.locator("html")).toHaveAttribute("data-realtime", "on", { timeout: 20_000 });
  return page;
}

/** Root Admin (cu ACP-ul deschis) în același context: apoi poate merge în chat. */
async function rootPage(browser: Browser, name: string, email: string, ip: string): Promise<Page> {
  const context = await browser.newContext();
  await useFreshIp(context, ip);
  const page = await context.newPage();
  await enterAcpAsRoot(page, name, email);
  return page;
}

const room = (page: Page) => page.getByTestId("gcs-chat-general");
const msg = (page: Page, text: string): Locator => room(page).getByTestId("gcs-chat-msg").filter({ hasText: text });

async function send(page: Page, text: string): Promise<void> {
  await room(page).getByTestId("gcs-chat-input").fill(text);
  await room(page).getByTestId("gcs-chat-input").press("Enter");
  await expect(msg(page, text).last()).toBeVisible();
  // Pauza de flood a grupului Membru (3 s).
  await page.waitForTimeout(3_200);
}

/** Deschide meniul „⋯” al unui mesaj (chat-ul standard sau Chat Pro). */
async function openMenu(m: Locator): Promise<Locator> {
  await m.hover();
  await m.locator('[data-testid="gcs-chat-more"], [data-testid="gcs-chatpro-more"]').first().click();
  const menu = m.page().getByTestId("gcs-chatmod-menu");
  await expect(menu).toBeVisible();
  return menu;
}

/** Mute / Kick / Ban ▸ durată → dialogul → motivul → confirmă. */
async function sanction(page: Page, m: Locator, kind: "mute" | "kick" | "ban", duration: string, reason: string): Promise<void> {
  const menu = await openMenu(m);
  await menu.getByTestId(`gcs-chatmod-${kind}`).hover();
  await menu.getByTestId(`gcs-chatmod-${kind}-${duration}`).click();
  const dialog = page.getByTestId(`gcs-chatmod-dialog-${kind}`);
  await dialog.getByTestId("gcs-chatmod-reason").fill(reason);
  await dialog.getByTestId("gcs-chatmod-confirm").click();
  await expect(dialog).toHaveCount(0);
}

test.afterAll(async () => {
  await setChatPro(false).catch(() => {});
  await resetSetting("chat.announce_grants").catch(() => {});
  await sql(`DELETE FROM chat_messages WHERE "authorId" IN (SELECT id FROM users WHERE email LIKE 'cm-%')`).catch(() => {});
  await sql(`DELETE FROM chat_pro_winners WHERE "periodStart" = '2099-01-01'`).catch(() => {});
  // Statisticile clasamentului ale acestui fișier nu rămân (alte specuri verifică podiumul).
  await sql(`DELETE FROM chat_pro_daily_stats WHERE "userId" IN (SELECT id FROM users WHERE email LIKE 'cm-%')`).catch(() => {});
  await redisDel([], "gcs:k:chat_pro:*").catch(() => {});
});

test("meniul după drepturi; ascunde, avertisment cu dovadă, mute cu numărătoare și linie de sistem, kick live; ridicat din ACP", async ({ browser }) => {
  test.setTimeout(240_000);
  const id = uid();
  const mem = await chatPage(browser, `CmMem${id}`, `cm-m-${id}@example.com`, "100.92.1");
  const mem2 = await chatPage(browser, `CmKick${id}`, `cm-k-${id}@example.com`, "100.92.2");
  const mod = await chatPage(browser, `CmMod${id}`, `cm-d-${id}@example.com`, "100.92.3", "moderator");

  await send(mod, `salut de la moderator ${id}`);
  await send(mem, `primul mesaj ${id}`);
  await send(mem, `reclamă la alt server ${id}`);
  await send(mem2, `flood ${id}`);

  // Un membru fără drepturi: Răspunde / Reacționează / Copiază / Ignoră / Raportează, nimic de moderare.
  const basic = await openMenu(msg(mem, `salut de la moderator ${id}`));
  await expect(basic.getByTestId("gcs-chatpro-report")).toBeVisible();
  await expect(basic.getByTestId("gcs-chatpro-ignore")).toBeVisible();
  await expect(basic.getByTestId("gcs-chatmod-mute")).toHaveCount(0);
  await expect(basic.getByTestId("gcs-chatmod-hide")).toHaveCount(0);
  await mem.keyboard.press("Escape");

  // Moderatorul: secțiunile Mesaj / Membru / Moderare, fără ban, editare, ștergere în masă și ban pe site.
  const modMenu = await openMenu(msg(mod, `primul mesaj ${id}`));
  for (const t of ["hide", "card", "warn", "mute", "kick", "slow"]) await expect(modMenu.getByTestId(`gcs-chatmod-${t}`)).toBeVisible();
  for (const t of ["ban", "edit", "purge", "siteban"]) await expect(modMenu.getByTestId(`gcs-chatmod-${t}`)).toHaveCount(0);
  // Ascunde: membrii nu-l mai văd (live), staff-ul îl vede marcat.
  await modMenu.getByTestId("gcs-chatmod-hide").click();
  await expect(msg(mem, `primul mesaj ${id}`)).toHaveCount(0, { timeout: 10_000 });
  await expect(msg(mod, `primul mesaj ${id}`).getByTestId("gcs-chat-hidden-tag")).toBeVisible();

  // Avertisment cu mesajul ca dovadă.
  const warnMenu = await openMenu(msg(mod, `reclamă la alt server ${id}`));
  await warnMenu.getByTestId("gcs-chatmod-warn").click();
  const warn = mod.getByTestId("gcs-chatmod-dialog-warn");
  await warn.getByRole("button", { name: "Reclamă" }).click();
  await warn.getByTestId("gcs-chatmod-confirm").click();
  await expect(warn).toHaveCount(0);
  const [w] = await sql<{ reason: string; evidence: { type: string; body: string } }>(`SELECT reason, evidence FROM warnings w JOIN users u ON u.id = w."userId" WHERE u.email = $1`, [`cm-m-${id}@example.com`]);
  expect(w).toMatchObject({ reason: "Reclamă", evidence: { type: "chat.message", body: `reclamă la alt server ${id}` } });

  // Mute 15 minute: linia de sistem în cameră, câmpul blocat live cu numărătoarea.
  await sanction(mod, msg(mod, `reclamă la alt server ${id}`), "mute", "15", "spam");
  await expect(room(mem).getByTestId("gcs-chat-sysline").filter({ hasText: "spam" })).toBeVisible({ timeout: 10_000 });
  await expect(room(mem).getByTestId("gcs-chat-muted")).toBeVisible({ timeout: 10_000 });
  await expect(room(mem).getByTestId("gcs-chat-mute-countdown")).toHaveText(/1[45]:\d\d/);
  await expect(room(mem).getByTestId("gcs-chat-input")).toBeDisabled();

  // Kick din cameră: membrul iese pe loc, rămâne afară și după reîncărcare.
  await sanction(mod, msg(mod, `flood ${id}`), "kick", "15", "flood");
  await expect(room(mem2).getByTestId("gcs-chat-blocked")).toBeVisible({ timeout: 10_000 });
  await expect(msg(mem2, `salut de la moderator ${id}`)).toHaveCount(0);
  await mem2.reload();
  await expect(room(mem2).getByTestId("gcs-chat-blocked")).toHaveAttribute("data-kind", "kick");

  // ACP → Chat → Moderare: jurnalul are acțiunile, „Ridică” mute-ul → membrul scrie din nou, live.
  const root = await rootPage(browser, `CmRoot${id}`, `cm-r-${id}@example.com`, "100.92.4");
  await root.goto("/admin/community/chat/moderation");
  await expect(root.getByTestId("gcs-acp-chat-log-row").filter({ hasText: `CmMod${id}` }).first()).toBeVisible();
  const row = root.getByTestId("gcs-acp-chat-sanction").filter({ hasText: `CmMem${id}` });
  await row.getByTestId("gcs-acp-chat-lift").click();
  await root.getByTestId("gcs-acp-confirm").click();
  await expect(row).toHaveCount(0);
  await expect(room(mem).getByTestId("gcs-chat-input")).toBeEnabled({ timeout: 10_000 });
  for (const p of [mem, mem2, mod, root]) await p.context().close();
});

test("Root: editează mesajul altuia, ban din chat (live), șterge mesajele membrului; „Ban pe site…” completat", async ({ browser }) => {
  test.setTimeout(180_000);
  const id = uid();
  const mem = await chatPage(browser, `CmBan${id}`, `cm-b-${id}@example.com`, "100.93.1");
  const root = await rootPage(browser, `CmRoot2${id}`, `cm-r2-${id}@example.com`, "100.93.2");
  await root.goto("/chat");
  await expect(root.locator("html")).toHaveAttribute("data-realtime", "on", { timeout: 20_000 });
  await send(mem, `gresit ${id}`);
  await send(mem, `al doilea ${id}`);

  const menu = await openMenu(msg(root, `gresit ${id}`));
  for (const t of ["edit", "ban", "purge", "siteban"]) await expect(menu.getByTestId(`gcs-chatmod-${t}`)).toBeVisible();
  await expect(menu.getByTestId("gcs-chatmod-siteban")).toHaveAttribute("href", new RegExp(`ban=1&reason=.*gresit`));
  await menu.getByTestId("gcs-chatmod-edit").click();
  await room(root).getByLabel("Editează mesajul").fill(`corectat ${id}`);
  await room(root).getByRole("button", { name: "Salvează" }).click();
  await expect(msg(mem, `corectat ${id}`)).toContainText("editat", { timeout: 10_000 });

  // Șterge mesajele lui ▸ Toate → dialogul → confirmă: dispar și la membru.
  const purgeMenu = await openMenu(msg(root, `al doilea ${id}`));
  await purgeMenu.getByTestId("gcs-chatmod-purge").hover();
  await purgeMenu.getByTestId("gcs-chatmod-purge-all").click();
  await root.getByTestId("gcs-chatmod-dialog-purge").getByTestId("gcs-chatmod-confirm").click();
  await expect(msg(mem, `al doilea ${id}`)).toHaveCount(0, { timeout: 10_000 });

  await send(mem, `revin ${id}`);
  await sanction(root, msg(root, `revin ${id}`), "ban", "forever", "reclame repetate");
  await expect(room(mem).getByTestId("gcs-chat-blocked")).toHaveAttribute("data-kind", "ban", { timeout: 10_000 });
  await expect(room(mem).getByTestId("gcs-chat-blocked")).toContainText("reclame repetate");
  for (const p of [mem, root]) await p.context().close();
});

test("cardul membrului deschis din chat: acțiunile rapide (doar staff)", async ({ browser }) => {
  const id = uid();
  const mem = await chatPage(browser, `CmCard${id}`, `cm-c-${id}@example.com`, "100.94.1");
  const mod = await chatPage(browser, `CmCardMod${id}`, `cm-cm-${id}@example.com`, "100.94.2", "moderator");
  await send(mem, `card ${id}`);
  await send(mod, `staff ${id}`);
  await msg(mod, `card ${id}`).getByTestId("gcs-chat-name").hover();
  const quick = mod.getByTestId("gcs-hover-chatmod");
  await expect(quick).toBeVisible({ timeout: 10_000 });
  await quick.getByTestId("gcs-hover-chatmod-warn").click();
  await expect(mod.getByTestId("gcs-chatmod-dialog-warn")).toBeVisible();
  await mod.keyboard.press("Escape");
  // Membrul fără drepturi nu are acțiunile rapide.
  await msg(mem, `staff ${id}`).getByTestId("gcs-chat-name").hover();
  await expect(mem.locator(".gcs-hoverCardLayer")).toBeVisible({ timeout: 10_000 });
  await expect(mem.getByTestId("gcs-hover-chatmod")).toHaveCount(0);
  for (const p of [mem, mod]) await p.context().close();
});

test("/acces: paleta „/”, rezultatul doar pentru autor, meniul live al moderatorului, expirarea (jobul), /revoca", async ({ browser }) => {
  test.setTimeout(240_000);
  const id = uid();
  const kaze = await chatPage(browser, `Kaze${id}`, `cm-z-${id}@example.com`, "100.95.1");
  const other = await chatPage(browser, `CmOther${id}`, `cm-o-${id}@example.com`, "100.95.2");
  const root = await rootPage(browser, `CmRoot3${id}`, `cm-r3-${id}@example.com`, "100.95.3");
  await root.goto("/chat");
  await expect(root.locator("html")).toHaveAttribute("data-realtime", "on", { timeout: 20_000 });
  await send(other, `mesajul lui ${id}`);

  // Paleta: „/” arată comenzile permise; după „/acces ” vin sugestiile pentru argumente.
  await room(root).getByTestId("gcs-chat-input").fill("/");
  await expect(room(root).getByTestId("gcs-chat-commands")).toBeVisible();
  await room(root).getByTestId("gcs-chat-command-acces").click();
  await expect(room(root).getByTestId("gcs-chat-input")).toHaveValue("/acces ");
  await expect(room(root).getByTestId("gcs-chat-commands")).toContainText("mute,kick");
  // Membrul nu are comanda în paletă.
  await room(kaze).getByTestId("gcs-chat-input").fill("/");
  await expect(room(kaze).getByTestId("gcs-chat-commands")).toHaveCount(0);
  await room(kaze).getByTestId("gcs-chat-input").fill("");

  // Înainte: Kaze nu are drepturi.
  const before = await openMenu(msg(kaze, `mesajul lui ${id}`));
  await expect(before.getByTestId("gcs-chatmod-mute")).toHaveCount(0);
  await kaze.keyboard.press("Escape");

  await room(root).getByTestId("gcs-chat-input").fill(`/acces @Kaze${id} mute,kick 7d`);
  await room(root).getByTestId("gcs-chat-input").press("Enter");
  await expect(room(root).getByTestId("gcs-chat-ephemeral")).toHaveAttribute("data-kind", "granted");
  await expect(room(other).getByTestId("gcs-chat-ephemeral")).toHaveCount(0);
  await expect(room(other).getByTestId("gcs-chat-sysline").filter({ hasText: `Kaze${id}` })).toBeVisible({ timeout: 10_000 });

  // Live: fără reîncărcare, meniul lui Kaze are acum mute și kick (nu și ban).
  await expect
    .poll(
      async () => {
        const m = await openMenu(msg(kaze, `mesajul lui ${id}`));
        const n = await m.getByTestId("gcs-chatmod-mute").count();
        await kaze.keyboard.press("Escape");
        return n;
      },
      { timeout: 15_000 },
    )
    .toBe(1);
  const granted = await openMenu(msg(kaze, `mesajul lui ${id}`));
  await expect(granted.getByTestId("gcs-chatmod-kick")).toBeVisible();
  await expect(granted.getByTestId("gcs-chatmod-ban")).toHaveCount(0);
  await kaze.keyboard.press("Escape");

  // Expirarea: jobul de moderare (la minut) șterge accesul și actualizează meniul live.
  await sql(`UPDATE chat_moderator_grants SET "expiresAt" = (now() AT TIME ZONE 'UTC') - interval '1 second' WHERE "userId" = (SELECT id FROM users WHERE email = $1)`, [`cm-z-${id}@example.com`]);
  await expect
    .poll(async () => (await sql(`SELECT 1 FROM chat_moderator_grants WHERE "userId" = (SELECT id FROM users WHERE email = $1)`, [`cm-z-${id}@example.com`])).length, { timeout: 100_000, intervals: [3_000] })
    .toBe(0);
  await expect
    .poll(
      async () => {
        const m = await openMenu(msg(kaze, `mesajul lui ${id}`));
        const n = await m.getByTestId("gcs-chatmod-mute").count();
        await kaze.keyboard.press("Escape");
        return n;
      },
      { timeout: 15_000 },
    )
    .toBe(0);

  // Din nou, apoi /revoca.
  await room(root).getByTestId("gcs-chat-input").fill(`/acces @Kaze${id} mute`);
  await room(root).getByTestId("gcs-chat-input").press("Enter");
  await room(root).getByTestId("gcs-chat-input").fill(`/revoca @Kaze${id}`);
  await room(root).getByTestId("gcs-chat-input").press("Enter");
  await expect(room(root).getByTestId("gcs-chat-ephemeral").last()).toHaveAttribute("data-kind", "revoked");
  expect(await sql(`SELECT 1 FROM chat_moderator_grants WHERE "userId" = (SELECT id FROM users WHERE email = $1)`, [`cm-z-${id}@example.com`])).toHaveLength(0);
  for (const p of [kaze, other, root]) await p.context().close();
});

test("clasamentul: podiumul, locul liber, ultimul câștigător cu insigna, statisticile; istoricul: salt la pagină, filtre, exportul doar pentru staff", async ({ browser }) => {
  test.setTimeout(180_000);
  await setChatPro(true);
  const id = uid();
  const a = await chatPage(browser, `CmTop${id}`, `cm-t-${id}@example.com`, "100.96.1", "vip_gold");
  const [aId] = await sql<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [`cm-t-${id}@example.com`]);
  // Mesajele de azi (ziua după fusul site-ului: poate fi ieri în UTC) și un câștigător „din viitor” (cel mai recent).
  await sql(`DELETE FROM chat_pro_daily_stats`);
  await sql(`INSERT INTO chat_pro_daily_stats ("userId", day, messages) VALUES ($1, to_char(now() AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD'), 42)`, [aId!.id]);
  await sql(`INSERT INTO chat_pro_winners ("periodStart", "periodEnd", "userId", messages) VALUES ('2099-01-01', '2099-01-31', $1, 1480) ON CONFLICT ("periodStart") DO NOTHING`, [aId!.id]);
  await redisDel([], "gcs:k:chat_pro:*");
  await a.reload();
  const panel = a.getByTestId("gcs-chatpro-ranking");
  await expect(panel.getByTestId("gcs-chatpro-podium-1")).toContainText(`CmTop${id}`);
  await expect(panel.getByTestId("gcs-chatpro-podium-empty-2")).toBeVisible();
  await expect(panel.getByTestId("gcs-chatpro-podium-empty-3")).toBeVisible();
  await expect(panel.getByTestId("gcs-chatpro-spammer")).toContainText("42");
  // „1.480” (formatul numerelor în română).
  await expect(panel.getByTestId("gcs-chatpro-last-winner")).toContainText(/1\D?480/);
  await expect(panel.getByTestId("gcs-chatpro-winner-badge")).toBeVisible();
  await expect(panel.getByTestId("gcs-chatpro-today")).toHaveText(/\d+/);
  // Click pe avatarul de pe podium → cardul membrului.
  await panel.getByTestId("gcs-chatpro-podium-1").locator(".gcs-cpRank__face").click();
  await expect(a.locator(".gcs-hoverCardLayer")).toBeVisible({ timeout: 10_000 });

  // Istoricul: 60 de mesaje → 3 pagini; „Sari la pagina”; membrul nu are exportul.
  await sql(
    `INSERT INTO chat_messages ("channelId", "authorId", body, "createdAt") SELECT c.id, $1, 'istoric ' || $2 || ' ' || g, now() - (g || ' minutes')::interval FROM chat_channels c, generate_series(1, 60) g WHERE c.key = 'general'`,
    [aId!.id, id],
  );
  await a.goto(`/chat/history?member=CmTop${id}`);
  await expect(a.getByTestId("gcs-chat-history-row")).toHaveCount(25);
  await expect(a.getByTestId("gcs-chat-history-export")).toHaveCount(0);
  await expect(a.getByTestId("gcs-chat-history-hidden")).toHaveCount(0);
  await a.getByTestId("gcs-chat-history-jump").click();
  await a.getByTestId("gcs-chat-history-jump-input").fill("3");
  await a.getByTestId("gcs-chat-history-jump-go").click();
  await expect(a).toHaveURL(/page=3/);
  await expect(a.getByTestId("gcs-chat-history-row")).toHaveCount(10);
  expect((await a.request.get(`/api/chat-pro/history/export?member=CmTop${id}`)).status()).toBe(404);

  const mod = await chatPage(browser, `CmHist${id}`, `cm-h-${id}@example.com`, "100.96.2", "moderator");
  await mod.goto(`/chat/history?member=CmTop${id}`);
  await expect(mod.getByTestId("gcs-chat-history-hidden")).toBeVisible();
  const href = await mod.getByTestId("gcs-chat-history-export").getAttribute("href");
  const res = await mod.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");
  expect(await res.text()).toContain(`istoric ${id} 1`);
  // „Vezi în chat”: camera se deschide la mesaj.
  const first = mod.getByTestId("gcs-chat-history-row").first();
  await first.hover();
  await first.getByTestId("gcs-chat-history-view").click();
  await expect(mod).toHaveURL(/\/chat\?c=general&m=\d+/);
  await expect(mod.locator(".gcs-chatPro__msg--focus")).toHaveCount(1);
  await setChatPro(false);
  for (const p of [a, mod]) await p.context().close();
});

/**
 * Capturile pentru proprietar (doar cu `GCS_SHOTS_DIR`): panoul de clasament, meniul de moderare cu submeniul, dialogul,
 * linia de sistem și mute-ul cu numărătoare, panoul de kick, paleta `/acces` și rezultatul, cardul cu acțiuni rapide,
 * ACP → Moderare / Moderatori și istoricul, în întunecat și luminos, desktop și 375 px.
 */
test("capturi moderare, clasament, istoric", async ({ browser }) => {
  const dir = process.env.GCS_SHOTS_DIR;
  test.skip(!dir, "doar cu GCS_SHOTS_DIR");
  test.setTimeout(420_000);
  const id = uid();
  const shot = async (page: Page, name: string, full = false) => {
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${dir}/cm-${name}.png`, fullPage: full });
  };
  // Calea „/”: cookie-ul pus de pe o pagină ACP ar avea altfel calea `/admin`.
  const theme = async (page: Page, t: "dark" | "light") => page.context().addCookies([{ name: "gcs-theme", value: t, domain: new URL(page.url()).hostname, path: "/" }]);

  const root = await rootPage(browser, `Owner${id}`, `cm-so-${id}@example.com`, "100.97.1");
  const kaze = await chatPage(browser, `Kaze${id}`, `cm-sk-${id}@example.com`, "100.97.2", "member");
  const krypt = await chatPage(browser, `Krypt${id}`, `cm-sc-${id}@example.com`, "100.97.3", "vip_gold");
  await root.goto("/chat");
  await expect(root.locator("html")).toHaveAttribute("data-realtime", "on", { timeout: 20_000 });
  await send(krypt, "Salut! Cine intră diseară pe serverul de CS2?");
  await send(kaze, "intrati pe serverul meu e mai bun, ip in profil");
  await send(root, "Turneul începe la 20:00, înscrierile pe forum.");

  // Chat-ul standard: meniul cu submeniul Mute deschis, apoi dialogul.
  await root.setViewportSize({ width: 1440, height: 1000 });
  const target = msg(root, "ip in profil");
  const menu = await openMenu(target);
  await menu.getByTestId("gcs-chatmod-mute").hover();
  await shot(root, "01-mod-menu-submenu-dark");
  await menu.getByTestId("gcs-chatmod-mute-15").click();
  await root.getByTestId("gcs-chatmod-dialog-mute").getByRole("button", { name: "Spam" }).click();
  await shot(root, "02-mod-dialog-mute-dark");
  await root.getByTestId("gcs-chatmod-dialog-mute").getByTestId("gcs-chatmod-confirm").click();
  await expect(room(kaze).getByTestId("gcs-chat-muted")).toBeVisible({ timeout: 10_000 });
  await kaze.setViewportSize({ width: 1440, height: 1000 });
  await shot(kaze, "03-system-line-muted-countdown-dark");
  await shot(root, "04-system-line-staff-dark");

  // Paleta „/acces” și rezultatul efemer.
  await room(root).getByTestId("gcs-chat-input").fill("/acces ");
  await shot(root, "05-acces-palette-dark");
  await room(root).getByTestId("gcs-chat-input").fill(`/acces @Krypt${id} mute,kick,warn 7d`);
  await room(root).getByTestId("gcs-chat-input").press("Enter");
  await expect(room(root).getByTestId("gcs-chat-ephemeral")).toBeVisible();
  await shot(root, "06-acces-ephemeral-dark");

  // Cardul membrului cu acțiunile rapide.
  await msg(root, "Cine intră diseară").getByTestId("gcs-chat-name").hover();
  await expect(root.getByTestId("gcs-hover-chatmod")).toBeVisible({ timeout: 10_000 });
  await shot(root, "07-hovercard-quick-actions-dark");
  await root.mouse.move(5, 5);

  // Kick: panoul membrului scos.
  await sanction(root, msg(root, "ip in profil"), "kick", "15", "flood");
  await expect(room(kaze).getByTestId("gcs-chat-blocked")).toBeVisible({ timeout: 10_000 });
  await shot(kaze, "08-kicked-panel-dark");

  // ACP.
  await root.goto("/admin/community/chat/moderation");
  await shot(root, "09-acp-moderation-dark", true);
  await root.goto("/admin/community/chat/moderators");
  await shot(root, "10-acp-moderators-dark", true);

  // Chat Pro: panoul de clasament și istoricul, întunecat / luminos, desktop / 375.
  await setChatPro(true);
  const [kr] = await sql<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [`cm-sc-${id}@example.com`]);
  const [ow] = await sql<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [`cm-so-${id}@example.com`]);
  await sql(`DELETE FROM chat_pro_daily_stats`);
  await sql(
    `INSERT INTO chat_pro_daily_stats ("userId", day, messages) VALUES ($1, to_char(now() AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD'), 1225), ($2, to_char(now() AT TIME ZONE 'Europe/Bucharest', 'YYYY-MM-DD'), 709)`,
    [ow!.id, kr!.id],
  );
  await sql(`INSERT INTO chat_pro_winners ("periodStart", "periodEnd", "userId", messages) VALUES ('2099-01-01', '2099-01-31', $1, 1480) ON CONFLICT ("periodStart") DO NOTHING`, [kr!.id]);
  await redisDel([], "gcs:k:chat_pro:*");
  for (const t of ["dark", "light"] as const) {
    await theme(root, t);
    await root.setViewportSize({ width: 1440, height: 1000 });
    await root.goto("/chat");
    await expect(root.getByTestId("gcs-chatpro-ranking")).toBeVisible();
    await root.waitForTimeout(1_200);
    await root.getByTestId("gcs-chatpro-ranking").screenshot({ path: `${dir}/cm-11-ranking-panel-${t}.png` });
    await shot(root, `12-chatpro-desktop-${t}`);
    const pm = await openMenu(msg(root, "Cine intră diseară"));
    await pm.getByTestId("gcs-chatmod-kick").hover();
    await shot(root, `13-chatpro-mod-menu-${t}`);
    await root.keyboard.press("Escape");
    await root.setViewportSize({ width: 375, height: 812 });
    await root.goto("/chat");
    await root.waitForTimeout(1_200);
    await shot(root, `14-chatpro-375-${t}`, true);
    await root.setViewportSize({ width: 1440, height: 1000 });
    await root.goto("/chat/history?hidden=1");
    await shot(root, `15-history-desktop-${t}`, true);
    await root.getByTestId("gcs-chat-history-row").first().hover();
    await shot(root, `16-history-row-hover-${t}`);
    await root.setViewportSize({ width: 375, height: 812 });
    await root.goto("/chat/history");
    await shot(root, `17-history-375-${t}`, true);
  }
  // Shoutbox-ul (pagina principală) cu clasamentul sub chat.
  await theme(root, "dark");
  await root.setViewportSize({ width: 1440, height: 1000 });
  await root.goto("/");
  await shot(root, "18-home-shoutbox-dark", true);
  await setChatPro(false);
  for (const p of [root, kaze, krypt]) await p.context().close();
});
