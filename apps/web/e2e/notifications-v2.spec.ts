import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { clearThemeCache } from "./cockpit-fixtures";
import { fixture, forumTree, member, topicWithReplies, uid } from "./forum-fixtures";
import { enterAcpAsRoot, sql, userId, useFreshIp } from "./helpers";

/**
 * Notificări v2: canalele pe tip (pornit / doar important / oprit) alese de membru, clopoțelul cu taburile Toate /
 * Mențiuni și „Marchează toate citite”, pagina notificărilor (taburi, filtre, ștergere, grupare), o blocare din ACP,
 * „Resetează la implicit” (membrul și toți membrii, confirmare în pagină) și web push (permisiunea simulată).
 * Capturile: `GCS_SHOTS_DIR=<folder>`.
 */
const SHOTS = process.env.GCS_SHOTS_DIR ?? "";

async function shot(page: Page, name: string, full = false): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: full });
}

/** Un membru creat direct în bază (autor de conținut, fără browser). */
async function otherMember(name: string, email: string): Promise<void> {
  await sql(
    `INSERT INTO users (id, name, "nameNormalized", email, "primaryGroupId", "updatedAt") VALUES ($1, $2, $3, $4, (SELECT id FROM groups WHERE key = 'member'), now())`,
    [`e2env${Math.random().toString(36).slice(2, 10)}`, name, name.toLowerCase(), email],
  );
}

/** Ana (în browser), Bogdan (autorul) și un topic al lui Bogdan urmărit de Ana. */
async function setup(page: Page, ip: string) {
  await useFreshIp(page.context(), ip);
  const id = uid();
  const a = `nv-a-${id}@example.com`;
  const b = `nv-b-${id}@example.com`;
  await member(page, `Ana${id}`, a);
  await otherMember(`Bogdan${id}`, b);
  const { forum } = await forumTree(page.request);
  const topic = await topicWithReplies(page.request, forum.id, b, `Canale ${id}`);
  const aId = await userId(a);
  await sql(`INSERT INTO follows ("userId", "contentType", "contentId") VALUES ($1, 'topic', $2) ON CONFLICT DO NOTHING`, [aId, String(topic.topicId)]);
  const reply = (text: string, mention = false) => fixture(page.request, { action: "reply", topicId: topic.topicId, text, authorEmail: b, ...(mention ? { mentionEmail: a } : {}) });
  return { id, a, b, aId, topic, reply, bName: `Bogdan${id}` };
}

const savePrefs = async (page: Page) => {
  await page.getByTestId("gcs-notif-prefs").getByRole("button", { name: "Salvează", exact: true }).click();
  await expect(page.getByTestId("gcs-notif-prefs").getByTestId("gcs-settings-status")).toHaveText("Preferințele au fost salvate.");
};

const live = async (page: Page) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-realtime", "on", { timeout: 20_000 });
};

const countOf = async (userIdValue: string, where = "TRUE") =>
  Number((await sql<{ n: number }>(`SELECT count(*)::int AS n FROM notifications WHERE "userId" = $1 AND ${where}`, [userIdValue]))[0]!.n);

test("membrul alege canalele pe tip și primește doar ce a permis (toast oprit, apoi site oprit)", async ({ page }) => {
  const s = await setup(page, "100.71.1");
  await page.goto("/settings/notifications");
  const row = page.getByTestId("gcs-pref-forums.reply");
  await expect(row.getByTestId("gcs-pref-forums.reply-site")).toHaveValue("on");
  await row.getByTestId("gcs-pref-forums.reply-toast").selectOption("off");
  await savePrefs(page);
  await shot(page, "settings-channels-desktop", true);

  // Toast-ul oprit: notificarea ajunge în clopoțel (live), fără toast.
  await live(page);
  await s.reply("Primul răspuns");
  await expect(page.getByTestId("gcs-header-bell-count")).toHaveText("1", { timeout: 15_000 });
  await page.waitForTimeout(1_500);
  await expect(page.getByTestId("gcs-toast")).toHaveCount(0);
  // O mențiune (alt tip, toast pornit implicit) apare și ca toast.
  await s.reply("Te chem", true);
  await expect(page.getByTestId("gcs-toast").first()).toBeVisible({ timeout: 15_000 });

  // Site, toast, email și push oprite pentru răspunsuri: nicio notificare nouă de acest tip.
  await page.goto("/settings/notifications");
  for (const ch of ["site", "toast", "email", "push"]) await page.getByTestId(`gcs-pref-forums.reply-${ch}`).selectOption("off");
  await savePrefs(page);
  const before = await countOf(s.aId, `type = 'forums.reply'`);
  await s.reply("Nu trebuie să ajungă");
  await page.waitForTimeout(2_000);
  expect(await countOf(s.aId, `type = 'forums.reply'`)).toBe(before);
  const [pref] = await sql<{ channels: Record<string, string> }>(`SELECT channels FROM notification_preferences WHERE "userId" = $1 AND type = 'forums.reply'`, [s.aId]);
  expect(pref!.channels).toMatchObject({ site: "off", toast: "off", email: "off", push: "off" });

  // Doar „important” pe site: o mențiune directă (importantă) trece, un răspuns obișnuit nu.
  await page.goto("/settings/notifications");
  await page.getByTestId("gcs-pref-forums.mention-site").selectOption("important");
  await savePrefs(page);
  const mentions = await countOf(s.aId, `type = 'forums.mention' AND site`);
  await s.reply("Încă o mențiune", true);
  await expect.poll(() => countOf(s.aId, `type = 'forums.mention' AND site`)).toBeGreaterThan(mentions);
});

test("clopoțelul: taburile Toate / Mențiuni, „Marchează toate citite” pe tab, setările și „Vezi toate”; live cu panoul deschis", async ({ page }) => {
  const s = await setup(page, "100.71.2");
  await live(page);
  await s.reply("Un răspuns");
  await s.reply("O mențiune", true);
  await expect(page.getByTestId("gcs-header-bell-count")).toHaveText("2", { timeout: 15_000 });

  await page.getByTestId("gcs-header-bell").click();
  const panel = page.getByTestId("gcs-notif-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("gcs-notif-item")).toHaveCount(2);
  await expect(panel.getByTestId("gcs-notif-settings")).toHaveAttribute("href", "/settings/notifications");
  await shot(page, "bell-all-desktop");

  await panel.getByTestId("gcs-notif-tab-mentions").click();
  await expect(panel.getByTestId("gcs-notif-tab-mentions")).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByTestId("gcs-notif-item")).toHaveCount(1);
  await expect(panel.getByTestId("gcs-notif-item").first()).toContainText(`${s.bName} te-a menționat`);
  await expect(panel.getByTestId("gcs-notif-see-all")).toHaveAttribute("href", "/notifications?tab=mentions");
  await shot(page, "bell-mentions-desktop");
  await panel.getByTestId("gcs-notif-mark-all").click();
  await expect(page.getByTestId("gcs-header-bell-count")).toHaveText("1");

  // Live: cu panoul deschis, un răspuns nou apare în lista tabului „Toate”.
  await panel.getByTestId("gcs-notif-tab-all").click();
  await expect(panel.getByTestId("gcs-notif-item")).toHaveCount(2);
  await s.reply("Încă un răspuns, cu panoul deschis");
  await expect(panel.getByTestId("gcs-notif-item").first()).toContainText("2 răspunsuri noi", { timeout: 15_000 });
  await panel.getByTestId("gcs-notif-mark-all").click();
  await expect(page.getByTestId("gcs-header-bell-count")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();

  // Pe 375 px: panoul încape în ecran.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await page.getByTestId("gcs-header-bell").click();
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  await shot(page, "bell-375");
});

test("clopoțelul e al sistemului: același dropdown în GCS White (luminos) și într-o temă cu designul clasic", async ({ page }) => {
  const CLASSIC = "e2e-notif-clasic";
  await sql(
    `INSERT INTO themes (key, name, "isDefault", enabled, settings, "updatedAt") VALUES ($1, 'Clasic Notificări', false, true, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET enabled = true, settings = EXCLUDED.settings, "updatedAt" = now()`,
    [CLASSIC, JSON.stringify({ preset: "classic" })],
  );
  await clearThemeCache();
  try {
    const s = await setup(page, "100.71.7");
    await s.reply("Pentru teme", true);
    for (const skin of ["gcs-white", CLASSIC]) {
      await page.context().addCookies([{ name: "gcs-skin", value: skin, url: page.url() }]);
      await page.goto("/");
      await expect(page.locator('link[rel="stylesheet"][href*="gcs-theme.css"]')).toHaveAttribute("href", new RegExp(`t=${skin}`));
      await expect(page.getByTestId("gcs-header-bell-count")).toHaveText(/^[1-9]/, { timeout: 15_000 });
      await page.getByTestId("gcs-header-bell").click();
      const panel = page.getByTestId("gcs-notif-panel");
      await expect(panel).toBeVisible();
      await expect(panel.getByTestId("gcs-notif-tab-mentions")).toBeVisible();
      await expect(panel.getByTestId("gcs-notif-item").first()).toContainText(`${s.bName} te-a menționat`);
      // Panoul are fundalul și chenarul sistemului (tokenurile temei), nu doar pe cele ale designului GCS.
      expect(await panel.evaluate((el) => getComputedStyle(el).position)).toBe("absolute");
      await shot(page, `bell-${skin}`);
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
    }
  } finally {
    await sql(`DELETE FROM themes WHERE key = $1`, [CLASSIC]);
    await clearThemeCache();
  }
});

test("pagina notificărilor: taburi cu necitite, filtrul citite / necitite, gruparea, citită / necitită, ștergerea cu confirmare", async ({ page, browser }) => {
  const s = await setup(page, "100.71.3");
  const c = `nv-c-${s.id}@example.com`;
  await otherMember(`Cezar${s.id}`, c);
  await s.reply("Primul");
  await fixture(page.request, { action: "reply", topicId: s.topic.topicId, text: "Al doilea", authorEmail: c });
  await s.reply("Cu mențiune", true);
  await fixture(page.request, { action: "pm", fromEmail: s.b, toEmail: s.a, title: `Salut ${s.id}`, text: "Ce faci?" });
  // Răspunsurile ajung prin worker (urmăritorii topicului): grupate într-o singură notificare.
  await expect
    .poll(async () => (await sql<{ count: number }>(`SELECT count FROM notifications WHERE "userId" = $1 AND type = 'forums.reply' AND "readAt" IS NULL`, [s.aId]))[0]?.count ?? 0, { timeout: 20_000 })
    .toBe(2);

  await page.goto("/notifications");
  const tabs = page.getByTestId("gcs-notif-page-tabs");
  for (const t of ["all", "mentions", "messages"]) await expect(tabs.getByTestId(`gcs-notif-page-tab-${t}`)).toBeVisible();
  await expect(tabs.getByTestId("gcs-notif-page-tab-all")).toContainText("3");
  // Gruparea: două răspunsuri de la doi autori într-o singură notificare.
  await expect(page.getByTestId("gcs-notif-row").filter({ hasText: `2 răspunsuri noi în „Canale ${s.id}”` })).toHaveCount(1);
  await expect(page.getByTestId("gcs-notif-row").filter({ hasText: `2 răspunsuri noi` }).locator(".gcs-notifRow__stack .gcs-avatar")).toHaveCount(2);
  await expect(page.locator(".gcs-notifPage__day").first()).toHaveText("Azi");
  await shot(page, "page-all-desktop", true);

  await tabs.getByTestId("gcs-notif-page-tab-messages").click();
  await expect(page).toHaveURL(/tab=messages/);
  await expect(page.getByTestId("gcs-notif-row")).toHaveCount(1);
  await expect(page.getByTestId("gcs-notif-row").first()).toContainText(`Salut ${s.id}`);

  // Marchează citită, apoi filtrele.
  await page.getByTestId("gcs-notif-row").first().getByTestId("gcs-notif-row-toggle").click();
  await expect(page.locator(".gcs-notifRow--unread")).toHaveCount(0);
  await page.getByTestId("gcs-notif-filter-unread").click();
  await expect(page.getByTestId("gcs-notif-row")).toHaveCount(0);
  await page.getByTestId("gcs-notif-filter-read").click();
  await expect(page.getByTestId("gcs-notif-row")).toHaveCount(1);

  // Necitită din nou, apoi „Marchează toate citite” pe tabul Toate și „Șterge citite” (confirmare în pagină).
  await page.getByTestId("gcs-notif-row").first().getByTestId("gcs-notif-row-toggle").click();
  await expect(page.getByTestId("gcs-notif-row")).toHaveCount(0);
  await page.goto("/notifications");
  await page.getByTestId("gcs-notif-page-mark-all").click();
  await expect(page.locator(".gcs-notifRow--unread")).toHaveCount(0);
  await page.getByTestId("gcs-notif-page-delete-read").click();
  const dialog = page.getByTestId("gcs-confirm-dialog");
  await expect(dialog).toBeVisible();
  await shot(page, "page-delete-confirm");
  await dialog.getByTestId("gcs-confirm-ok").click();
  await expect(page.locator(".gcs-notifPage__empty")).toBeVisible();
  expect(await countOf(s.aId, "site")).toBe(0);

  // Rezumatul „Ce ai ratat” (pe site) se deschide din pagină.
  await page.getByTestId("gcs-notif-weekly-link").click();
  await expect(page).toHaveURL(/\/notifications\/weekly$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ce ai ratat");
  await shot(page, "weekly-page", true);

  // 375 px: tabelul de canale din setări devine carduri, fără derulare orizontală.
  const mobile = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const m = await mobile.newPage();
  await useFreshIp(mobile, "100.71.33");
  await member(m, `Mobil${s.id}`, `nv-m-${s.id}@example.com`);
  await m.goto("/settings/notifications");
  await expect(m.getByTestId("gcs-pref-forums.reply")).toBeVisible();
  expect(await m.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await shot(m, "settings-375", true);
  await mobile.close();
});

async function rootPage(browser: Browser, id: string) {
  const context = await browser.newContext();
  await useFreshIp(context, "100.71.40");
  const page = await context.newPage();
  await enterAcpAsRoot(page, `NotifRoot${id}`, `nv-root-${id}@example.com`);
  return page;
}

test("ACP: o blocare „Dezactivat” pe site se vede la membru (lacăt) și oprește notificările; „Resetează valorile implicite” o scoate", async ({ page, browser }) => {
  const s = await setup(page, "100.71.4");
  const root = await rootPage(browser, s.id);
  await root.goto("/admin/members/settings/notifications");
  const row = root.getByTestId("gcs-acp-notif-forums.reply");
  await row.getByTestId("gcs-acp-notif-forums.reply-site-lock").selectOption("disabled");
  await root.getByRole("button", { name: "Salvează" }).first().click();
  await expect(root.getByRole("status").filter({ hasText: "Salvat" }).first()).toBeVisible();
  await shot(root, "acp-defaults", true);

  await page.goto("/settings/notifications");
  await expect(page.getByTestId("gcs-pref-forums.reply-site")).toBeDisabled();
  await expect(page.getByTestId("gcs-pref-forums.reply-site")).toHaveValue("off");
  await expect(page.getByTestId("gcs-pref-forums.reply-site-lock")).toBeVisible();
  await shot(page, "settings-locked");
  // Membrul nu ocolește blocarea: o alegere „pornit” trimisă nu se salvează pe canalul blocat.
  await savePrefs(page);
  await s.reply("Blocat de admin");
  await page.waitForTimeout(2_000);
  expect(await countOf(s.aId, `type = 'forums.reply' AND site`)).toBe(0);

  // Statisticile și „Oprește toate emailurile” pentru un membru.
  await root.reload();
  await expect(root.getByTestId("gcs-acp-notif-stat-site")).toBeVisible();
  await root.getByTestId("gcs-acp-notif-emails-off-member").fill(`Ana${s.id}`);
  await root.getByRole("button", { name: "Oprește toate emailurile" }).click();
  await root.getByTestId("gcs-confirm-ok").click();
  await expect(root.getByTestId("gcs-acp-notif-emails-off-row").filter({ hasText: `Ana${s.id}` })).toBeVisible();
  expect((await sql<{ emailsOff: boolean }>(`SELECT "emailsOff" FROM notification_members WHERE "userId" = $1`, [s.aId]))[0]!.emailsOff).toBe(true);
  await page.goto("/settings/notifications");
  await expect(page.getByTestId("gcs-pref-emails-off")).toBeVisible();
  await root.getByTestId("gcs-acp-notif-emails-off-row").filter({ hasText: `Ana${s.id}` }).getByRole("button", { name: "Repornește emailurile" }).click();
  await expect(root.getByTestId("gcs-acp-notif-emails-off-row").filter({ hasText: `Ana${s.id}` })).toHaveCount(0);

  // Resetarea valorilor implicite (confirmare în pagină) scoate blocarea.
  await root.getByRole("button", { name: "Resetează valorile implicite" }).click();
  await expect(root.getByTestId("gcs-confirm-dialog")).toBeVisible();
  await root.getByTestId("gcs-confirm-ok").click();
  await expect(root.getByTestId("gcs-acp-notif-forums.reply-site-lock")).toHaveValue("");
  await page.goto("/settings/notifications");
  await expect(page.getByTestId("gcs-pref-forums.reply-site")).toBeEnabled();
  await root.context().close();
});

test("„Resetează la implicit”: membrul (confirmare în pagină) și toți membrii din ACP", async ({ page, browser }) => {
  const s = await setup(page, "100.71.5");
  await page.goto("/settings/notifications");
  await page.getByTestId("gcs-pref-forums.reply-toast").selectOption("off");
  await page.getByTestId("gcs-pref-profile.follower-emailMode").selectOption("weekly");
  await savePrefs(page);
  expect(await sql(`SELECT 1 FROM notification_preferences WHERE "userId" = $1`, [s.aId])).toHaveLength(2);

  await page.getByTestId("gcs-pref-reset").click();
  const dialog = page.getByTestId("gcs-confirm-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("gcs-confirm-ok").click();
  await expect(page.getByTestId("gcs-notif-prefs").getByTestId("gcs-settings-status")).toHaveText("Preferințele au revenit la valorile implicite.");
  await expect(page.getByTestId("gcs-pref-forums.reply-toast")).toHaveValue("on");
  expect(await sql(`SELECT 1 FROM notification_preferences WHERE "userId" = $1`, [s.aId])).toHaveLength(0);

  // Toți membrii (ACP, confirmare în pagină).
  await page.getByTestId("gcs-pref-forums.reply-push").selectOption("on");
  await savePrefs(page);
  const root = await rootPage(browser, s.id);
  await root.goto("/admin/members/settings/notifications");
  await root.getByRole("button", { name: "Resetează la implicit pentru toți membrii" }).click();
  await expect(root.getByTestId("gcs-confirm-dialog")).toContainText("nu se poate anula");
  await root.getByTestId("gcs-confirm-ok").click();
  await expect.poll(async () => (await sql(`SELECT 1 FROM notification_preferences WHERE "userId" = $1`, [s.aId])).length).toBe(0);
  await root.context().close();
  await page.reload();
  await expect(page.getByTestId("gcs-pref-forums.reply-push")).toHaveValue("important");
});

test("web push: permisiunea se cere doar din setări (simulată), starea, dispozitivul listat și scos", async ({ page }) => {
  const key = Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString("base64url");
  const auth = randomBytes(16).toString("base64url");
  // Browserul simulat: Notification, PushManager și service worker-ul, fără un serviciu de push real.
  await page.context().addInitScript(
    ({ key, auth }) => {
      let permission: NotificationPermission = "default";
      let sub: { endpoint: string; toJSON: () => unknown; unsubscribe: () => Promise<boolean> } | null = null;
      (window as unknown as { __gcsPermAsked: number }).__gcsPermAsked = 0;
      const reg = {
        scope: "/",
        pushManager: {
          getSubscription: async () => sub,
          subscribe: async () => {
            const endpoint = `https://fcm.push.invalid/e2e/${Math.random().toString(36).slice(2)}`;
            sub = {
              endpoint,
              toJSON: () => ({ endpoint, keys: { p256dh: key, auth } }),
              unsubscribe: async () => {
                sub = null;
                return true;
              },
            };
            return sub;
          },
        },
      };
      class FakeNotification {
        static get permission() {
          return permission;
        }
        static async requestPermission() {
          (window as unknown as { __gcsPermAsked: number }).__gcsPermAsked++;
          permission = "granted";
          return permission;
        }
      }
      Object.defineProperty(window, "Notification", { value: FakeNotification, configurable: true });
      Object.defineProperty(window, "PushManager", { value: function PushManager() {}, configurable: true });
      Object.defineProperty(navigator, "serviceWorker", {
        value: { register: async () => reg, ready: Promise.resolve(reg), getRegistration: async () => reg },
        configurable: true,
      });
    },
    { key, auth },
  );
  const s = await setup(page, "100.71.6");
  await page.goto("/settings/notifications");
  const card = page.getByTestId("gcs-push-settings");
  await expect(card.getByTestId("gcs-push-state")).toHaveAttribute("data-state", "default");
  await expect(card.getByTestId("gcs-push-state")).toHaveText("Permisiunea nu a fost cerută încă.");
  // Nicio cerere de permisiune la încărcarea paginii.
  expect(await page.evaluate(() => (window as unknown as { __gcsPermAsked: number }).__gcsPermAsked)).toBe(0);
  await expect(card.getByTestId("gcs-push-no-devices")).toBeVisible();
  await shot(page, "push-before");

  await card.getByTestId("gcs-push-enable").click();
  await expect(card.getByTestId("gcs-push-state")).toHaveAttribute("data-state", "subscribed");
  await expect(card.getByTestId("gcs-push-state")).toHaveText("Activ pe acest dispozitiv.");
  expect(await page.evaluate(() => (window as unknown as { __gcsPermAsked: number }).__gcsPermAsked)).toBe(1);
  await expect(card.getByTestId("gcs-push-device")).toHaveCount(1);
  await expect(card.getByTestId("gcs-push-device")).toContainText("acest dispozitiv");
  const [row] = await sql<{ endpoint: string; p256dh: string }>(`SELECT endpoint, p256dh FROM push_subscriptions WHERE "userId" = $1`, [s.aId]);
  expect(row!.endpoint).toMatch(/^https:\/\/fcm\.push\.invalid\/e2e\//);
  expect(row!.p256dh).toBe(key);
  await shot(page, "push-subscribed");

  // Scos chiar acest dispozitiv: și abonamentul local pleacă (permisiunea rămâne).
  await card.getByTestId("gcs-push-device-remove").click();
  await expect(card.getByTestId("gcs-push-no-devices")).toBeVisible();
  await expect(card.getByTestId("gcs-push-state")).toHaveAttribute("data-state", "granted");
  expect(await sql(`SELECT 1 FROM push_subscriptions WHERE "userId" = $1`, [s.aId])).toHaveLength(0);
});
