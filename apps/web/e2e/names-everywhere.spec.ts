import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { forumTree, memberInNewContext, topicWithReplies, uid } from "./forum-fixtures";
import { enterAcpAsRoot, sql, useFreshIp } from "./helpers";

/**
 * Nume stilizate peste tot (specul 2026-10-10-nume-mentiuni-grupuri-peste-tot): un membru VIP cu efectul lui din
 * Studio VIP și un Root Admin al cărui grup are un gradient animat trebuie să arate la fel în ultimul mesaj din index,
 * în widget-ul „Topicuri recente”, în postbit, în lista de membri, în chat și în meniul userului, pe tema închisă și
 * pe cea deschisă (stilul generat bate culorile linkurilor din temă). Cu `GCS_E2E_SHOTS=<folder>`, salvează și capturi
 * ale fiecărui loc (`<faza>-<loc>-<user>-<temă>.png`, faza din `GCS_E2E_SHOTS_PHASE`, implicit `after`).
 */
const SDK_DIR = path.resolve(__dirname, "../../../packages/plugin-sdk");
const KEY = "gcs.vip_studio";
const VERSION = (JSON.parse(readFileSync(path.join(SDK_DIR, "plugins/vip-studio/plugin.json"), "utf8")) as { version: string }).version;
const UNSIGNED = path.join(SDK_DIR, `plugins/vip-studio/dist/gcs.vip_studio-${VERSION}.zip`);
const SIGNED = path.join(__dirname, "../.e2e", "gcs.vip_studio-names.zip");
const SHOTS = process.env.GCS_E2E_SHOTS ?? "";
const PHASE = process.env.GCS_E2E_SHOTS_PHASE ?? "after";
const THEMES = ["dark", "light"] as const;
/** Linkul cu numele (nu cel al avatarului, care are și el numele, pentru cititoarele de ecran). */
const NAME_LINK = 'a[href^="/members/"]:not(:has(.gcs-avatar))';

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  mkdirSync(path.dirname(SIGNED), { recursive: true });
  execFileSync(process.execPath, ["--import", "tsx", "scripts/build-vip-studio.ts"], { cwd: SDK_DIR, stdio: "pipe" });
  execFileSync(process.execPath, ["--import", "tsx", "scripts/sign-plugin.ts", UNSIGNED, "--out", SIGNED], {
    cwd: SDK_DIR,
    stdio: "pipe",
    env: { ...process.env, GCS_PLUGIN_SIGNING_KEY: process.env.GCS_E2E_PLUGIN_KEY ?? "", GCS_PLUGIN_SIGNING_KEY_ID: "e2e" },
  });
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});

const id = uid();
const rootName = `Rad${id}`;
const vipName = `Vip${id}`;
const vipEmail = `names-vip-${id}@example.com`;
let rootPage: Page;
let vipPage: Page;
/** Forumul în care ultimul mesaj e al fiecăruia. */
const forumOf: Record<string, string> = {};
let topicUrl = "";

/** Ce a schimbat acest fișier la Studio VIP: la final, pluginul revine cum era (alte specuri îl instalează de la zero). */
let vipStudioChange: "installed" | "enabled" | null = null;

/** Studio VIP instalat și activ (încărcat din ACP, dacă nu e deja). */
async function ensureVipStudio(page: Page): Promise<void> {
  const [row] = await sql<{ enabled: boolean }>(`SELECT enabled FROM plugins WHERE key = $1`, [KEY]);
  if (row?.enabled) return;
  await page.goto("/admin/system/applications");
  if (row) {
    await page.getByTestId(`gcs-plugin-toggle-${KEY}`).click();
    await expect(page.getByTestId(`gcs-plugin-toggle-${KEY}`)).toBeChecked();
    vipStudioChange = "enabled";
    return;
  }
  vipStudioChange = "installed";
  await page.getByTestId("gcs-plugin-upload").locator('input[type="file"]').setInputFiles(SIGNED);
  await page.getByTestId("gcs-plugin-upload").getByRole("button", { name: "Încarcă și verifică" }).click();
  await expect(page).toHaveURL(/\/admin\/system\/applications\/install\/[a-z0-9]+$/);
  await page.getByRole("button", { name: "Instalează pluginul" }).click();
  await expect(page.getByTestId("gcs-plugin-header").getByTestId("gcs-plugin-status")).toHaveText("Activ");
}

test.afterAll(async () => {
  if (!vipStudioChange || !rootPage) return;
  if (vipStudioChange === "enabled") {
    await sql(`UPDATE plugins SET enabled = false WHERE key = $1`, [KEY]);
    return;
  }
  // Instalat aici: dezinstalarea completă din ACP (meniul „⋯” → Dezinstalează → cheia → confirmă).
  await rootPage.goto("/admin/system/applications");
  await rootPage.getByTestId(`gcs-app-menu-${KEY}`).click();
  await rootPage.getByTestId(`gcs-plugin-uninstall-${KEY}`).click();
  const dialog = rootPage.getByTestId("gcs-plugin-uninstall-dialog");
  // Fără „Păstrează datele” (bifat implicit): Studio VIP pornește apoi de la zero (fără loadout-urile de aici).
  await dialog.getByRole("switch").uncheck();
  await dialog.getByPlaceholder(KEY).fill(KEY);
  await dialog.getByTestId("gcs-plugin-uninstall-confirm").click();
  await expect.poll(async () => (await sql(`SELECT 1 FROM plugins WHERE key = $1`, [KEY])).length, { timeout: 20_000 }).toBe(0);
});

/** Aspectul calculat al unui nume: gradientul tăiat pe litere și animația. */
async function look(el: Locator) {
  return el.evaluate((node) => {
    const cs = getComputedStyle(node);
    return {
      cls: node.getAttribute("class") ?? "",
      userId: node.getAttribute("data-user-id") ?? node.getAttribute("data-name-user"),
      image: cs.backgroundImage,
      clip: cs.getPropertyValue("-webkit-background-clip") || cs.backgroundClip,
      fill: cs.getPropertyValue("-webkit-text-fill-color"),
      animation: cs.animationName,
    };
  });
}

async function shot(target: Locator, name: string): Promise<void> {
  if (!SHOTS) return;
  await target.screenshot({ path: path.join(SHOTS, `${PHASE}-${name}.png`), animations: "allow" }).catch(() => {});
}

async function setTheme(page: Page, theme: (typeof THEMES)[number]): Promise<void> {
  await page.context().addCookies([{ name: "gcs-theme", value: theme, url: page.url().startsWith("http") ? page.url() : "http://localhost:3100" }]);
}

/** Locurile verificate: elementul numelui și containerul pentru captură. */
type Place = { key: string; open: (page: Page) => Promise<void>; name: (page: Page, who: string) => Locator; frame: (page: Page, who: string) => Locator };

const PLACES: Place[] = [
  {
    key: "forum-last-post",
    open: async (page) => {
      await page.goto("/");
      await expect(page.getByTestId("gcs-forum-index")).toBeVisible();
    },
    name: (page, who) => page.getByTestId("gcs-forum-row").filter({ hasText: forumOf[who] }).locator(".gcs-forumRow__lastText").locator(NAME_LINK, { hasText: who }).first(),
    frame: (page, who) => page.getByTestId("gcs-forum-row").filter({ hasText: forumOf[who] }),
  },
  {
    key: "recent-topics",
    open: async (page) => {
      await page.goto("/");
      await expect(page.locator('[data-widget="forums.recentTopics"]').filter({ visible: true })).toBeVisible();
    },
    name: (page, who) => page.locator('[data-widget="forums.recentTopics"]').filter({ visible: true }).locator(NAME_LINK, { hasText: who }).first(),
    frame: (page) => page.locator('[data-widget="forums.recentTopics"]').filter({ visible: true }),
  },
  {
    key: "postbit",
    open: async (page) => {
      await page.goto(topicUrl);
      await expect(page.getByTestId("gcs-postbit").first()).toBeVisible();
    },
    name: (page, who) => page.getByTestId("gcs-postbit").locator(".gcs-post__authorName").locator(NAME_LINK, { hasText: who }).first(),
    frame: (page, who) => page.getByTestId("gcs-postbit").filter({ has: page.locator(".gcs-post__authorName", { hasText: who }) }).first(),
  },
  {
    key: "members-list",
    open: async (page) => {
      await page.goto(`/members?q=${id}`);
      await expect(page.getByTestId("gcs-member-grid")).toBeVisible();
    },
    name: (page, who) => page.getByTestId("gcs-member-card").filter({ hasText: who }).locator(NAME_LINK, { hasText: who }).first(),
    frame: (page, who) => page.getByTestId("gcs-member-card").filter({ hasText: who }),
  },
  {
    key: "chat",
    open: async (page) => {
      await page.goto("/chat");
      await expect(page.getByTestId("gcs-chat-msg").filter({ hasText: `salut ${id}` }).first()).toBeVisible();
    },
    name: (page, who) => page.getByTestId("gcs-chat-msg").filter({ hasText: `salut ${id} de la ${who}` }).getByTestId("gcs-chat-name").first(),
    frame: (page, who) => page.getByTestId("gcs-chat-msg").filter({ hasText: `salut ${id} de la ${who}` }).first(),
  },
];

test("pregătire: Root Admin cu gradient animat pe grup, membru VIP cu efect din Studio VIP, topic, chat", async ({ browser, request }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext();
  await useFreshIp(context, "100.75.0");
  rootPage = await context.newPage();
  await enterAcpAsRoot(rootPage, rootName, `names-root-${id}@example.com`);
  await ensureVipStudio(rootPage);

  // Grupul Root Admin cu un gradient roșu animat (ca pe site-ul proprietarului).
  const res = await request.post("/api/_test/profile", { data: { action: "groupStyle", groupKey: "root_admin", nameStyle: { gradient: ["#FF2E4D", "#FF8A3D", "#FF2E4D"], animated: true, bold: true } } });
  expect(res.ok(), await res.text()).toBe(true);

  // Membrul VIP își alege „Culori în mișcare” (gradient care curge) în studio.
  vipPage = await memberInNewContext(browser, vipName, vipEmail, "100.75.1");
  const vip = await request.post("/api/_test/profile", { data: { action: "vip", email: vipEmail, groupKey: "vip_gold", days: 30 } });
  expect(vip.ok(), await vip.text()).toBe(true);
  await vipPage.goto(`/p/${KEY}`);
  const studio = vipPage.locator("[data-gcsp-studio]");
  await expect(studio).toHaveClass(/gcsp-js/);
  const tile = studio.locator('label.gcsp-tile:has(input[name="nameStyle"][value="culori_in_miscare"])');
  await expect(async () => {
    if (!(await tile.isVisible())) await vipPage.mouse.wheel(0, 700);
    await expect(tile).toBeVisible({ timeout: 400 });
  }).toPass({ timeout: 20_000 });
  await tile.click();
  await studio.locator('label.gcsp-swatch:has(input[value="culori_in_miscare:pink"])').click();
  await studio.locator("[data-gcsp-save]").click();
  await expect(vipPage).toHaveURL(/saved=1/);

  // Primul forum: topicul Root Admin-ului cu răspunsul VIP-ului (ultimul mesaj e al VIP-ului); al doilea: un topic al
  // Root Admin-ului (ultimul mesaj e al lui).
  const vipForum = await forumTree(request);
  const rootForum = await forumTree(request);
  forumOf[vipName] = vipForum.forumName;
  forumOf[rootName] = rootForum.forumName;
  const topic = await topicWithReplies(request, vipForum.forum.id, `names-root-${id}@example.com`, `Nume peste tot ${id}`, 0);
  topicUrl = topic.url;
  const reply = await request.post("/api/_test/forum", { data: { action: "reply", topicId: topic.topicId, text: `Răspuns VIP ${id}`, authorEmail: vipEmail } });
  expect(reply.ok(), await reply.text()).toBe(true);
  await topicWithReplies(request, rootForum.forum.id, `names-root-${id}@example.com`, `Topic Root ${id}`, 0);

  // Chat: câte un mesaj de la fiecare.
  for (const [page, who] of [
    [rootPage, rootName],
    [vipPage, vipName],
  ] as const) {
    await page.goto("/chat");
    await page.getByTestId("gcs-chat-input").first().fill(`salut ${id} de la ${who}`);
    await page.getByTestId("gcs-chat-input").first().press("Enter");
    await expect(page.getByTestId("gcs-chat-msg").filter({ hasText: `salut ${id} de la ${who}` }).first()).toBeVisible();
  }
});

test("numele au stilul grupului și efectul VIP peste tot, pe tema închisă și pe cea deschisă", async () => {
  test.setTimeout(300_000);
  const failures: string[] = [];
  for (const theme of THEMES) {
    for (const page of [rootPage, vipPage]) await setTheme(page, theme);

    for (const place of PLACES) {
      await place.open(vipPage);
      for (const [who, kind] of [
        [rootName, "root"],
        [vipName, "vip"],
      ] as const) {
        const el = place.name(vipPage, who);
        await expect(el, `${place.key}/${kind}`).toBeVisible();
        await vipPage.waitForTimeout(150);
        await shot(place.frame(vipPage, who), `${place.key}-${kind}-${theme}`);
        const l = await look(el);
        const ok = kind === "root" ? /linear-gradient/.test(l.image) && l.clip === "text" && /gcs-name--root_admin/.test(l.cls) : /linear-gradient/.test(l.image) && l.clip === "text" && /gcsNfxFlow/.test(l.animation);
        if (!ok || !l.userId) failures.push(`${place.key}/${kind}/${theme}: ${JSON.stringify(l)}`);
      }
    }

    // Meniul userului: fiecare își vede numele stilizat în antet.
    for (const [page, kind] of [
      [rootPage, "root"],
      [vipPage, "vip"],
    ] as const) {
      await page.goto("/");
      const el = page.getByTestId("gcs-header-user");
      await expect(el).toBeVisible();
      await shot(page.getByTestId("gcs-user-menu").first(), `user-menu-${kind}-${theme}`);
      const l = await look(el);
      const ok = kind === "root" ? /linear-gradient/.test(l.image) && l.clip === "text" : /linear-gradient/.test(l.image) && l.clip === "text" && /gcsNfxFlow/.test(l.animation);
      if (!ok) failures.push(`user-menu/${kind}/${theme}: ${JSON.stringify(l)}`);
    }
  }
  expect(failures).toEqual([]);
});

test("butoanele Nova: stratul de sticlă (sweep) umple butonul la hover, pe cel plin și pe cel secundar", async () => {
  await rootPage.goto(topicUrl);
  // Caseta de răspuns (Forum v2) e pliată până la primul click: butoanele ei apar după deschidere.
  await rootPage.getByTestId("gcs-reply-box").click();
  await expect(rootPage.getByTestId("gcs-reply-box")).not.toHaveAttribute("data-collapsed", "");
  const cases: [string, Locator][] = [
    ["primary", rootPage.locator("#reply .gcs-btn--primary").first()],
    ["secondary", rootPage.locator(".gcs-btn--ghost:visible").first()],
  ];
  for (const [kind, btn] of cases) {
    await expect(btn, kind).toBeVisible();
    expect(await btn.evaluate((el) => getComputedStyle(el).backgroundSize), kind).toBe("0% 100%");
    await btn.hover();
    // Tranziția durează 1,2 s (cu un mic recul la intrare).
    await rootPage.waitForTimeout(1_400);
    const after = await btn.evaluate((el) => ({ size: getComputedStyle(el).backgroundSize, image: getComputedStyle(el).backgroundImage }));
    expect(after.size, kind).toBe("100% 100%");
    expect(after.image, kind).toMatch(/linear-gradient/);
    await shot(btn, `button-hover-${kind}`);
    await rootPage.mouse.move(0, 0);
  }
});
