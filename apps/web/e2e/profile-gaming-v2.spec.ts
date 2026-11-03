import { e2eKv } from "./kv";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { fixture, forumTree, member, memberInNewContext, topicWithReplies, uid } from "./forum-fixtures";
import { resetSetting, setSetting, sql, useFreshIp, userId } from "./helpers";

/**
 * Profil gaming v2: hover card v2 (din mențiune, din nume și din pagina grupurilor; statusul, cipurile, nivelul, cele 4
 * contoare, insignele, acțiunile, slotul de extensie, avatarul pătrat), taburile aplicațiilor pe profil (Skins cu
 * aplicația Servere, Steam și FACEIT după chei / cont legat / date), „Editează profilul” pe grupuri cu handle-urile de
 * contact, dispozitivele și „Vizualizarea conținutului”. Cu `GCS_E2E_SHOTS=<folder>`, salvează capturi.
 */
const SHOTS = process.env.GCS_E2E_SHOTS ?? "";

async function shot(target: Page | Locator, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await target.screenshot({ path: path.join(SHOTS, `profile-${name}.png`) });
}

async function redisDel(keys: string[], pattern?: string): Promise<void> {
  const redis = await e2eKv();
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

async function setApp(key: string, enabled: boolean): Promise<void> {
  await sql(`INSERT INTO apps (key, enabled, "updatedAt") VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, "updatedAt" = now()`, [key, enabled]);
  await redisDel(["gcs:k:apps:enabled"], "gcs:k:groups-pro:*");
}

/** Cardul deschis, după animația de apariție. */
async function openCard(page: Page, anchor: Locator): Promise<Locator> {
  await anchor.hover();
  const layer = page.locator(".gcs-hoverCardLayer");
  await expect(layer.getByTestId("gcs-hover-card")).toBeVisible();
  await expect(layer).not.toHaveAttribute("data-side", "pending");
  await page.waitForTimeout(300);
  return layer;
}

/**
 * Ce trebuie să aibă orice card al membrului „star” (cardul v3): statusul, cipul VIP, rangul cu nivelul, cele 3
 * contoare (Postări / Reputație / Insigne), insignele și acțiunile.
 */
async function expectFullCard(layer: Locator, name: string): Promise<void> {
  const card = layer.getByTestId("gcs-hover-card");
  await expect(card).toHaveClass(/gcs-hoverCard--v3/);
  await expect(card.locator(".gcs-hoverCard__name")).toHaveText(name);
  await expect(card.getByTestId("gcs-hover-status")).toContainText("Online acum");
  await expect(card.getByTestId("gcs-hover-dot")).toBeVisible();
  await expect(card.getByTestId("gcs-hover-chip-vip")).toHaveText("VIP");
  await expect(card.getByTestId("gcs-hover-level")).toContainText("Nivel");
  await expect(card.getByTestId("gcs-hover-level").getByRole("progressbar")).toHaveAttribute("aria-valuenow", /\d+/);
  await expect(card.locator(".gcs-hoverCard__stats > div")).toHaveCount(3);
  await expect(card.getByTestId("gcs-hover-badge-count")).toHaveText(/^[1-9]\d*$/);
  await expect(card.getByTestId("gcs-hover-badges").locator(".gcs-badgeArt__item")).not.toHaveCount(0);
  await expect(card.getByTestId("gcs-hover-message")).toBeVisible();
  await expect(card.getByTestId("gcs-hover-follow")).toBeVisible();
  await expect(card.getByTestId("gcs-hover-content")).toHaveAttribute("href", /\?tab=activity$/);
  await expect(card.getByTestId("gcs-hover-ignore")).toHaveAttribute("aria-label", "Ignoră");
}

test.beforeEach(async ({ context }) => {
  await useFreshIp(context, "203.0.113");
});

test("hover card v2: din mențiune, din nume și din pagina grupurilor; Ignoră și avatarul pătrat", async ({ page, request, browser }) => {
  const id = uid();
  const starEmail = `star-${id}@example.com`;
  const star = await memberInNewContext(browser, `Star${id}`, starEmail, "198.51.100");
  await star.close();
  const starId = await userId(starEmail);
  // Online acum, VIP activ, 120 de postări (nivelul „Activ”) și o insignă.
  await sql(`UPDATE users SET "lastActiveAt" = now(), "postsCount" = 120, reputation = 7 WHERE id = $1`, [starId]);
  await sql(`INSERT INTO vip_subscriptions ("userId", "groupId", status, "madePrimary") VALUES ($1, (SELECT id FROM groups WHERE key = 'vip_gold'), 'ACTIVE', false)`, [starId]);
  await sql(`INSERT INTO user_badges ("userId", "badgeId") VALUES ($1, (SELECT id FROM badges ORDER BY position LIMIT 1)) ON CONFLICT DO NOTHING`, [starId]);
  await redisDel([], `gcs:k:profile:card:*`);

  const { forum } = await forumTree(request);
  const topic = await topicWithReplies(request, forum.id, starEmail, `Topic star ${id}`);
  await fixture(request, { action: "reply", topicId: topic.topicId, text: "salut", authorEmail: starEmail, mentionEmail: starEmail });
  await member(page, `Fan${id}`, `fan-${id}@example.com`);

  await test.step("din mențiune", async () => {
    await page.goto(topic.url);
    const layer = await openCard(page, page.getByTestId("gcs-post").last().locator("a.gcs-mention"));
    await expectFullCard(layer, `Star${id}`);
    await shot(layer, "hovercard-mention");
    await page.keyboard.press("Escape");
    await expect(layer).toHaveCount(0);
  });

  await test.step("din nume (postbit), cu tastatura: Tab intră în card, Escape revine pe nume", async () => {
    const name = page.getByTestId("gcs-post").first().locator(".gcs-post__authorName a");
    await name.focus();
    const layer = page.locator(".gcs-hoverCardLayer");
    await expect(layer.getByTestId("gcs-hover-card")).toBeVisible();
    await expectFullCard(layer, `Star${id}`);
    await page.keyboard.press("Tab");
    await expect(layer.locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(layer).toHaveCount(0);
    await expect(name).toBeFocused();
  });

  await test.step("Ignoră din card: butonul își schimbă starea", async () => {
    const layer = await openCard(page, page.getByTestId("gcs-post").first().locator(".gcs-post__authorName a"));
    await layer.getByTestId("gcs-hover-ignore").click();
    await expect(layer.getByTestId("gcs-hover-ignore")).toHaveAttribute("aria-pressed", "true");
    await expect(layer.getByTestId("gcs-hover-ignore")).toHaveAttribute("aria-label", "Nu mai ignora");
    const [row] = await sql<{ n: number }>(`SELECT count(*)::int AS n FROM user_ignores WHERE "ignoredId" = $1`, [starId]);
    expect(row!.n).toBe(1);
    await layer.getByTestId("gcs-hover-ignore").click();
    await expect(layer.getByTestId("gcs-hover-ignore")).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Escape");
  });

  await test.step("din pagina grupurilor (Grupuri Pro), cu avatarele pătrate ale temei", async () => {
    await setApp("groups_pro", true);
    try {
      await page.goto(`/members/groups?q=Star${id}`);
      // O temă cu avatare pătrate (tokenul `--gcs-avatar-radius`), peste orice valoare a temei curente.
      await page.addStyleTag({ content: "html, html body, html body * { --gcs-avatar-radius: 6px !important; }" });
      const name = page.getByTestId("gcs-groups-member").filter({ hasText: `Star${id}` }).first().locator("[data-user-id]").first();
      const layer = await openCard(page, name);
      await expectFullCard(layer, `Star${id}`);
      const ring = layer.locator(".gcs-hoverCard__avatar");
      expect(await ring.evaluate((el) => getComputedStyle(el).borderRadius)).toBe("6px");
      await expect(layer.getByTestId("gcs-hover-dot")).toBeVisible();
      await shot(layer, "hovercard-square");
    } finally {
      await setApp("groups_pro", false);
    }
  });
});

test("taburile profilului: Skins cu aplicația Servere; Steam cu cheia și contul legat; FACEIT ascuns fără cheie", async ({ page }) => {
  const id = uid();
  const email = `gamer-${id}@example.com`;
  await member(page, `Gamer${id}`, email);
  const uidOf = await userId(email);
  const [row] = await sql<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [uidOf]);
  const profile = `/members/${uidOf}-${row!.name.toLowerCase()}`;
  const tabs = page.getByTestId("gcs-profile-tabs");
  try {
    await test.step("Servere oprită: fără Skins; pornită: Skins apare și se deschide", async () => {
      await setApp("servers", false);
      await page.goto(profile);
      await expect(tabs.locator('[data-tab="activity"]')).toBeVisible();
      await expect(tabs.locator('[data-tab="articles"]')).toBeVisible();
      await expect(tabs.locator('[data-tab="skins"]')).toHaveCount(0);
      await setApp("servers", true);
      await page.goto(profile);
      await tabs.locator('[data-tab="skins"]').click();
      await expect(page.getByTestId("gcs-profile-skins")).toBeVisible();
    });

    await test.step("Steam: fără cheie sau fără cont legat nu apare; cu ambele apare cu datele din cache", async () => {
      await expect(tabs.locator('[data-tab="steam"]')).toHaveCount(0);
      await setSetting("auth.steam_api_key", "E2E-STEAM-KEY");
      await page.goto(profile);
      await expect(tabs.locator('[data-tab="steam"]')).toHaveCount(0);
      await sql(`INSERT INTO accounts (id, "userId", "accountId", "providerId", "createdAt", "updatedAt") VALUES ($1, $2, '76561197960287930', 'steam', now(), now())`, [`acc-${id}`, uidOf]);
      const steam = {
        steamId64: "76561197960287930",
        steamId: "STEAM_0:0:11101",
        steamId3: "[U:1:22202]",
        profileUrl: "https://steamcommunity.com/profiles/76561197960287930",
        name: `Gamer${id}`,
        public: true,
        status: "online",
        inGame: null,
        level: 42,
        createdAt: "2010-01-01T00:00:00.000Z",
        lastOnlineAt: null,
        bans: { vac: 0, game: 0, community: false, economy: false, daysSinceLast: null },
        games: {
          count: 12,
          totalHours: 2400,
          twoWeekHours: 10,
          recent: [{ appId: 730, name: "Counter-Strike 2", hours: 1500, twoWeekHours: 10 }],
          top: Array.from({ length: 12 }, (_, i) => ({ appId: i + 1, name: `Joc ${i + 1}`, hours: 200 - i, twoWeekHours: 0 })),
        },
      };
      await sql(`INSERT INTO external_profiles ("userId", provider, data, "fetchedAt") VALUES ($1, 'steam', $2::jsonb, now())`, [uidOf, JSON.stringify(steam)]);
      await page.goto(profile);
      await tabs.locator('[data-tab="steam"]').click();
      const tab = page.getByTestId("gcs-profile-steam");
      await expect(tab.getByTestId("gcs-steam-id64")).toHaveText("76561197960287930");
      await expect(tab).toContainText("[U:1:22202]");
      await expect(tab.getByTestId("gcs-steam-level")).toContainText("42");
      await expect(tab.getByTestId("gcs-steam-bans")).toContainText("Fără ban VAC");
      const games = tab.getByTestId("gcs-steam-games");
      await expect(games.locator("li:visible")).toHaveCount(8);
      await games.getByTestId("gcs-steam-games-more").click();
      await expect(games.locator("li:visible")).toHaveCount(12);
      await shot(page, "tab-steam");
    });

    await test.step("membrul poate ascunde tabul Steam din Setări → Steam", async () => {
      await page.goto("/settings/connections/steam");
      await page.getByTestId("gcs-pref-steamTab").uncheck();
      await expect(page.getByTestId("gcs-pref-steamTab")).not.toBeChecked();
      await expect(page.locator(".gcs-prefToggle [role=status]").first()).toBeVisible();
      await page.goto(profile);
      await expect(tabs.locator('[data-tab="steam"]')).toHaveCount(0);
    });

    await test.step("FACEIT: ascuns fără cheia adminului; cu cheia și datele, apare cu nivelul, ELO-ul și locul", async () => {
      await sql(`INSERT INTO external_profiles ("userId", provider, data, "fetchedAt") VALUES ($1, 'faceit', $2::jsonb, now())`, [
        uidOf,
        JSON.stringify({
          playerId: "f-1",
          nickname: `gamer${id}`,
          url: "https://www.faceit.com/en/players/x",
          level: 8,
          elo: 1820,
          stats: { matches: 412, winRate: 54, kd: 1.18, hs: 47, adr: 84.3, longestStreak: 9, currentStreak: 2, recent: ["W", "L", "W", "W", "L"] },
          history: [
            { at: "2026-10-01T00:00:00.000Z", elo: 1700 },
            { at: "2026-10-10T00:00:00.000Z", elo: 1820 },
          ],
          matches: [{ id: "m1", at: "2026-10-10T00:00:00.000Z", result: "W", score: "13–9" }],
        }),
      ]);
      await page.goto(profile);
      await expect(tabs.locator('[data-tab="faceit"]')).toHaveCount(0);
      await setSetting("profile.faceit_api_key", "E2E-FACEIT-KEY");
      await page.goto(profile);
      await tabs.locator('[data-tab="faceit"]').click();
      const tab = page.getByTestId("gcs-profile-faceit");
      await expect(tab.getByTestId("gcs-faceit-level")).toHaveText("8");
      await expect(tab.getByTestId("gcs-faceit-elo")).toHaveText("1820");
      await expect(tab.getByTestId("gcs-faceit-ranking")).toContainText("#1");
      await expect(tab.getByTestId("gcs-faceit-recent").locator("li")).toHaveCount(5);
      await expect(tab.getByTestId("gcs-faceit-chart")).toBeVisible();
      await shot(page, "tab-faceit");
    });
  } finally {
    await setApp("servers", true);
    await resetSetting("auth.steam_api_key");
    await resetSetting("profile.faceit_api_key");
  }
});

test("Editează profilul: grupurile din ACP cu textele de ajutor; contactul ca handle devine link pe profil", async ({ page }) => {
  const id = uid();
  const email = `edit-${id}@example.com`;
  await member(page, `Edit${id}`, email);
  await page.goto("/settings/profile");
  const groups = page.getByTestId("gcs-field-group");
  await expect(groups.locator("legend")).toContainText(["De bază", "Despre mine", "Echipamentul meu", "Descriere", "Contact"]);
  const gear = groups.filter({ has: page.locator("legend", { hasText: "Echipamentul meu" }) });
  await expect(gear.locator(".gcs-fieldGroup__helper")).toContainText("placă video");
  await expect(page.getByTestId("gcs-birthday-form")).toBeVisible();

  await page.getByLabel("Placă video").fill("RTX 4070");
  await page.getByTestId("gcs-handle-contact_tiktok").fill("@gamer.ro");
  await expect(page.getByTestId("gcs-handle-preview-contact_tiktok")).toHaveText("https://www.tiktok.com/@gamer.ro");
  await page.getByTestId("gcs-birthday-day").selectOption("3");
  await page.getByTestId("gcs-birthday-month").selectOption("5");
  await page.getByTestId("gcs-birthday-visible").check();
  await shot(page, "settings-edit-profile");
  await page.getByTestId("gcs-profile-save").click();
  await expect(page.getByTestId("gcs-profile-form").getByRole("status")).toBeVisible();

  const uidOf = await userId(email);
  const [row] = await sql<{ value: string }>(`SELECT v.value FROM profile_field_values v JOIN profile_fields f ON f.id = v."fieldId" WHERE v."userId" = $1 AND f.key = 'contact_tiktok'`, [uidOf]);
  expect(row?.value).toBe("gamer.ro");
  const [b] = await sql<{ d: string }>(`SELECT to_char(birthday, 'YYYY-MM-DD') AS d FROM users WHERE id = $1`, [uidOf]);
  expect(b?.d).toBe("1904-05-03");

  await page.goto(`/members/${uidOf}-edit${id}`);
  const about = page.getByTestId("gcs-profile-about");
  await expect(about.locator('[data-group="gear"]')).toContainText("RTX 4070");
  await expect(about.getByTestId("gcs-profile-contact-link")).toHaveAttribute("href", "https://www.tiktok.com/@gamer.ro");
  await expect(about.getByTestId("gcs-profile-birthday")).toContainText("3 mai");
  await expect(about.getByTestId("gcs-profile-birthday")).not.toContainText("1904");
  await shot(page, "profile-groups");
});

test("Setări: prezentarea generală, dispozitivele (cu autentificarea automată) și vizualizarea conținutului", async ({ page, request, browser }) => {
  const id = uid();
  const email = `dev-${id}@example.com`;
  await member(page, `Dev${id}`, email);

  await test.step("prezentarea generală: emailul, bara de completare, conturile legate", async () => {
    await page.goto("/settings");
    await expect(page.getByTestId("gcs-overview-email")).toContainText(email);
    await expect(page.getByTestId("gcs-completion-percent")).toHaveText(/\d+%/);
    await expect(page.getByTestId("gcs-connection-steam")).toHaveAttribute("data-linked", "false");
    await shot(page, "settings-overview");
  });

  await test.step("dispozitivele: cel curent apare; autentificarea automată se poate opri", async () => {
    await page.goto("/settings/devices");
    const devices = page.getByTestId("gcs-device");
    await expect(devices).toHaveCount(1);
    await expect(devices.first()).toHaveAttribute("data-current", "true");
    await expect(devices.first()).toContainText("Chrome");
    await expect(devices.first()).toContainText("Email și parolă");
    await devices.first().getByTestId("gcs-device-autologin").uncheck();
    await expect(page.getByTestId("gcs-devices").locator("..").getByRole("status")).toBeVisible();
    const [row] = await sql<{ autoLogin: boolean }>(`SELECT "autoLogin" FROM user_devices WHERE "userId" = $1`, [await userId(email)]);
    expect(row?.autoLogin).toBe(false);
    await shot(page, "settings-devices");
  });

  await test.step("vizualizarea conținutului: „la ultima postare” sare la ultimul răspuns", async () => {
    const { forum } = await forumTree(request);
    const author = await memberInNewContext(browser, `Autor${id}`, `autor-${id}@example.com`, "198.51.100");
    await author.close();
    const topic = await topicWithReplies(request, forum.id, `autor-${id}@example.com`, `Topic lung ${id}`, 3);
    await page.goto("/settings/content");
    await page.getByTestId("gcs-topic-open-last").check();
    await page.getByTestId("gcs-content-view-save").click();
    await expect(page.getByTestId("gcs-content-view-form").getByRole("status")).toBeVisible();
    await shot(page, "settings-content");
    // Din altă pagină (lista forumului), topicul se deschide la ultima postare.
    await page.goto(`/forum/${forum.id}-${forum.slug}`);
    await page.getByRole("link", { name: `Topic lung ${id}` }).first().click();
    await expect(page).toHaveURL(new RegExp(`#post-${topic.ids.at(-1)}$`));
    // Fragmentul rămâne și după o actualizare a routerului (în suita completă se pierdea la una ulterioară).
    const refreshed = page.waitForResponse((r) => r.request().headers()["rsc"] === "1");
    await page.evaluate(() => (window as unknown as { next: { router: { refresh(): void } } }).next.router.refresh());
    await refreshed;
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(new RegExp(`#post-${topic.ids.at(-1)}$`));
    // „La început”: rămâne pe topic, fără salt.
    await page.goto("/settings/content");
    await page.getByTestId("gcs-topic-open-start").check();
    await page.getByTestId("gcs-content-view-save").click();
    await expect(page.getByTestId("gcs-content-view-form").getByRole("status")).toBeVisible();
    await page.goto(`/forum/${forum.id}-${forum.slug}`);
    await page.getByRole("link", { name: `Topic lung ${id}` }).first().click();
    await expect(page).toHaveURL(new RegExp(`${topic.url}$`));
  });
});

test("la 375 px: profilul, setările și hover card-ul încap fără derulare orizontală; tema deschisă", async ({ page }) => {
  const id = uid();
  const email = `mob-${id}@example.com`;
  await member(page, `Mob${id}`, email);
  const uidOf = await userId(email);
  await page.setViewportSize({ width: 375, height: 812 });
  const noOverflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  for (const [url, name] of [
    [`/members/${uidOf}-mob${id}`, "mobile-profile"],
    ["/settings", "mobile-settings-overview"],
    ["/settings/profile", "mobile-settings-edit-profile"],
    ["/settings/devices", "mobile-settings-devices"],
  ] as const) {
    await page.goto(url);
    await noOverflow();
    await shot(page, name);
  }
  // Tema deschisă: aceleași componente pe tokenurile temei.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/members/${uidOf}-mob${id}`);
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await shot(page, "profile-light");
  await page.goto("/settings");
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await shot(page, "settings-overview-light");
});
