import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { member, uid } from "./forum-fixtures";
import { enterAcpAsRoot, sql, totp, useFreshIp } from "./helpers";

/**
 * Botul comunității (bot-stiri): contul-bot trimite bun venitul membrilor noi; Root Admin vede pagina botului în ACP;
 * pluginul „Bot de știri” (instalat din ACP) publică un flux RSS (cu redirecționare, tradus automat) și o actualizare
 * Steam ca topicuri ale botului, cu pastila, eticheta, „Publicat automat” și caseta sursei; oprit, nu mai publică nimic.
 * Pluginul nu are bază proprie, deci rulează și pe MySQL (ediția Lite).
 */
const SDK_DIR = path.resolve(__dirname, "../../../packages/plugin-sdk");
const ZIP = path.join(SDK_DIR, "plugins/news-bot/dist/gcs.news_bot-1.0.0.zip");
const KEY = "gcs.news_bot";

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.GCS_E2E_SHOTS;
  if (dir) await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

/** Topicurile botului (titlurile), cele mai noi întâi. */
async function botTopics(): Promise<{ id: number; title: string }[]> {
  return sql<{ id: number; title: string }>(`SELECT t.id, t.title FROM topics t JOIN users u ON u.id = t."authorId" WHERE u."isBot" = true ORDER BY t.id DESC`);
}

test.beforeAll(() => {
  execFileSync(process.execPath, ["--import", "tsx", "scripts/build-news-bot.ts"], { cwd: SDK_DIR, stdio: "pipe" });
});

test.afterAll(async () => {
  await sql(`UPDATE plugins SET enabled = false WHERE key = $1`, [KEY]).catch(() => {});
});

test("bun venitul: un membru nou primește un mesaj privat de la botul comunității", async ({ page, context }) => {
  test.setTimeout(120_000);
  await useFreshIp(context, "100.76.0");
  const id = uid();
  const email = `bunvenit-${id}@example.com`;
  await member(page, `Nou${id}`, email);
  // Jobul de bun venit rulează în worker (în Lite, în coada din procesul web).
  await expect
    .poll(
      async () =>
        Number(
          (await sql<{ n: string }>(`SELECT count(*) AS n FROM conversation_participants cp JOIN users u ON u.id = cp."userId" WHERE u.email = $1`, [email]))[0]?.n ?? 0,
        ),
      { timeout: 90_000 },
    )
    .toBe(1);
  await page.goto("/messages");
  await page.getByText(/Bine ai venit pe/).first().click();
  await expect(page.getByText(`Salut, Nou${id}!`, { exact: false }).first()).toBeVisible();
  await shot(page, "bot-welcome");
});

test("ACP › Sistem › Botul comunității, apoi pluginul Bot de știri: RSS tradus + actualizare Steam ca topicuri ale botului", async ({ page, context }) => {
  test.setTimeout(300_000);
  const feeds = process.env.GCS_E2E_FEEDS_URL;
  expect(feeds, "runner-ul E2E pornește serverul cu fluxuri de test").toBeTruthy();
  await useFreshIp(context, "100.76.1");
  const id = uid();
  const secret = await enterAcpAsRoot(page, `BotAdm${id}`, `botadm-${id}@example.com`);

  // Pagina botului: contul, funcțiile (pornite implicit) și postările programate.
  await page.goto("/admin/system/bot");
  await expect(page.getByTestId("gcs-bot-name")).toBeVisible();
  await expect(page.getByTestId("gcs-bot-feature-welcome_pm").locator('[data-state="on"]')).toBeVisible();
  await expect(page.getByTestId("gcs-bot-scheduled")).toBeVisible();
  await shot(page, "bot-acp");

  // Instalarea pluginului (pachet nesemnat: codul 2FA și cheia tastată).
  await page.goto("/admin/system/applications");
  await page.getByTestId("gcs-plugin-upload").locator('input[type="file"]').setInputFiles(ZIP);
  await page.getByTestId("gcs-plugin-upload").getByRole("button", { name: "Încarcă și verifică" }).click();
  await expect(page).toHaveURL(/\/admin\/system\/applications\/install\/[a-z0-9]+$/);
  await expect(page.getByTestId("gcs-plugin-checks").locator('[data-level="error"]')).toHaveCount(0);
  const confirm = page.getByTestId("gcs-plugin-confirm");
  await confirm.getByLabel("Codul 2FA (din aplicația de autentificare)").fill(totp(secret));
  await confirm.getByLabel(`Scrie cheia pluginului (${KEY}) ca să confirmi`).fill(KEY);
  await confirm.getByRole("button", { name: "Instalează pluginul" }).click();
  await expect(confirm.getByRole("status").filter({ hasText: "Salvat" }).or(page.getByTestId("gcs-plugin-header")).first()).toBeVisible({ timeout: 30_000 });

  // Pluginul apare printre funcțiile botului (capabilitatea `bot.post`).
  await page.goto("/admin/system/bot");
  await expect(page.getByTestId(`gcs-bot-feature-plugin:${KEY}`)).toBeVisible();

  // Setările: un flux RSS (prin redirecționare, tradus) și știrile Steam, în primul forum; API-ul Steam = serverul de test.
  const [forum] = await sql<{ id: number }>(`SELECT id FROM forums WHERE type = 'FORUM' ORDER BY id LIMIT 1`);
  await page.goto(`/admin/system/applications/plugins/${KEY}`);
  await page.getByRole("tab", { name: "Fluxuri" }).click();
  await page.getByLabel("Fluxurile").fill(
    [`Fluxul de test | ${feeds}/moved.xml | ${forum!.id} | 5 | ȘTIRI | traduce`, `Counter-Strike 2 | steam:730 | ${forum!.id} | 5 | UPDATE CS2`].join("\n"),
  );
  await page.getByRole("tabpanel").getByRole("button", { name: "Salvează" }).click();
  await expect(page.getByRole("tabpanel").getByRole("status")).toBeVisible();
  await page.getByRole("tab", { name: "General" }).click();
  await page.getByLabel("Adresa API-ului Steam").fill(`${feeds}/steam`);
  await page.getByRole("tabpanel").getByRole("button", { name: "Salvează" }).click();
  await expect(page.getByRole("tabpanel").getByRole("status")).toBeVisible();

  // „Rulează acum” din pagina pluginului: fluxurile ajung în coadă și devin topicuri ale botului.
  await page.goto(`/admin/plugins/${KEY}`);
  await expect(page.getByTestId("gcsp-feeds").getByTestId("gcsp-feed-row")).toHaveCount(2);
  await page.getByTestId("gcsp-run-now").click();
  await expect(page.getByTestId("gcsp-ran")).toBeVisible();
  await expect.poll(async () => (await botTopics()).length, { timeout: 120_000 }).toBe(2);
  const topics = await botTopics();
  const news = topics.find((t) => t.title.includes("Turneul de toamnă"))!;
  const steam = topics.find((t) => t.title === "Counter-Strike 2 Update")!;
  // Traducătorul fals al testelor pune limba în față.
  expect(news.title).toBe("[ro] Turneul de toamnă începe sâmbătă");

  await page.goto(`/topic/${news.id}`);
  const post = page.getByTestId("gcs-post").first();
  await expect(post.getByTestId("gcs-post-bot-label")).toHaveText("ȘTIRI");
  await expect(post.getByTestId("gcs-post-bot-auto")).toHaveText("Publicat automat");
  await expect(post.getByTestId("gcs-post-bot-translated")).toContainText("Tradus automat din engleză");
  await expect(post.getByTestId("gcs-post-bot-source")).toContainText("Sursa: Fluxul de test");
  await expect(post.getByTestId("gcs-post-bot-source")).toContainText("import automat la fiecare 5 min");
  await expect(post.getByTestId("gcs-post-bot-read")).toHaveAttribute("href", "https://news.example.com/turneu");
  await expect(post.getByTestId("gcs-postbit")).toContainText("Botul comunității");
  await shot(page, "bot-news-topic");

  await page.goto(`/topic/${steam.id}`);
  const update = page.getByTestId("gcs-post").first();
  await expect(update.getByTestId("gcs-post-bot-label")).toHaveText("UPDATE CS2");
  await expect(update).toContainText("Agents now wear gloves in the buy menu.");
  await expect(update.getByTestId("gcs-post-bot-translated")).toHaveCount(0);
  await shot(page, "bot-steam-topic");

  // Rulat din nou: deduplicarea nu republică nimic.
  await page.goto(`/admin/plugins/${KEY}`);
  await page.getByTestId("gcsp-run-now").click();
  await expect(page.getByTestId("gcsp-ran")).toBeVisible();
  await page.waitForTimeout(8_000);
  expect(await botTopics()).toHaveLength(2);

  // Pluginul oprit: topicurile rămân, nimic nou nu se publică.
  await page.goto("/admin/system/applications");
  const toggle = page.getByTestId(`gcs-plugin-toggle-${KEY}`);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await page.goto(`/topic/${news.id}`);
  await expect(page.getByTestId("gcs-post").first().getByTestId("gcs-post-bot-label")).toHaveText("ȘTIRI");
  expect(await botTopics()).toHaveLength(2);
});
