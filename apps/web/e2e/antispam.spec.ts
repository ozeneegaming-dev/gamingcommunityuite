import { expect, test, type Page } from "@playwright/test";
import { forumTree, member, memberInNewContext, topicWithReplies, typeInEditor, uid } from "./forum-fixtures";
import { enterAcpAsRoot, formAlert, register, resetSetting, setSetting, sql, useFreshIp, userId } from "./helpers";

test.beforeEach(async ({ context }) => {
  await useFreshIp(context, "100.70.0");
});

const shout = (page: Page) => page.getByTestId("gcs-shoutbox");

async function sendInShoutbox(page: Page, text: string): Promise<void> {
  await page.goto("/");
  await shout(page).getByTestId("gcs-chat-input").fill(text);
  await shout(page).getByRole("button", { name: "Trimite" }).click();
}

async function replyInTopic(page: Page, url: string, text: string): Promise<void> {
  await page.goto(url);
  await typeInEditor(page, text);
  await page.locator(".gcs-replyBox__send").click();
}

test("înregistrarea: captcha-ul proof-of-work e cerut, iar întrebarea trebuie să aibă răspunsul corect", async ({ page, request }) => {
  const id = uid();
  const question = `Ce joc are comunitatea ${id}?`;
  // Fără soluția captcha-ului (un robot care trimite direct formularul) → refuz.
  const direct = await request.post("/api/auth/sign-up/email", {
    data: { name: `Robot${id}`, email: `robot-${id}@example.com`, password: "parola-sigura-123" },
    headers: { origin: new URL(test.info().project.use.baseURL ?? "http://localhost:3100").origin },
  });
  expect(direct.status()).toBe(403);
  expect(await direct.json()).toMatchObject({ code: "CAPTCHA_FAILED" });

  await sql(`INSERT INTO registration_questions (question, answers, enabled) VALUES ($1, $2::jsonb, true)`, [question, JSON.stringify(["Counter-Strike 2", "cs2"])]);
  try {
    const email = `qa-${id}@example.com`;
    await page.goto("/register");
    await page.getByLabel("Nume de utilizator").fill(`Qa${id}`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Parolă").fill("parola-sigura-123");
    await page.getByLabel(question).fill("minecraft");
    await page.getByRole("button", { name: "Creează cont" }).click();
    await expect(formAlert(page)).toHaveText("Răspunsul la întrebare nu e corect.");
    await page.getByLabel(question).fill("  COUNTER-strike 2 ");
    await page.getByRole("button", { name: "Creează cont" }).click();
    await expect(page.getByTestId("gcs-header-user")).toHaveText(`Qa${id}`);
    const logged = await sql<{ kind: string }>(`SELECT kind FROM spam_logs WHERE email = $1`, [email]);
    expect(logged.map((r) => r.kind)).toEqual(["qa_failed"]);
  } finally {
    await sql(`DELETE FROM registration_questions WHERE question = $1`, [question]);
  }
});

test("un IP din intervalul banat nu se poate înregistra (banul creat din ACP › Banuri)", async ({ page, browser }) => {
  const id = uid();
  await enterAcpAsRoot(page, `RootB${id}`, `root-b${id}@example.com`);
  await page.goto("/admin/members/settings/bans");
  const form = page.getByTestId("gcs-bans-new");
  await form.getByTestId("gcs-bans-type").selectOption("IP");
  await form.getByTestId("gcs-bans-value").fill("100.71.0.0/16");
  await form.getByTestId("gcs-bans-reason").fill(`roboți ${id}`);
  await form.getByRole("button", { name: "Banează" }).click();
  await expect(page.getByTestId("gcs-bans-row").filter({ hasText: `roboți ${id}` })).toBeVisible();

  const context = await browser.newContext();
  // Ca în spatele proxy-ului din producție: X-Real-IP e adresa clientului.
  await context.setExtraHTTPHeaders({ "x-forwarded-for": "100.71.3.4", "x-real-ip": "100.71.3.4" });
  const visitor = await context.newPage();
  try {
    await register(visitor, `Banat${id}`, `banat-${id}@example.com`);
    await expect(formAlert(visitor)).toContainText("Accesul tău pe acest site e restricționat");
  } finally {
    await context.close();
    await sql(`UPDATE bans SET "liftedAt" = now() WHERE value = '100.71.0.0/16'`);
  }
});

test("membrul nou: linkul trimite răspunsul în aprobare, iar în chat linkul e refuzat", async ({ page, request }) => {
  const id = uid();
  await setSetting("antispam.new_member_days", 7);
  try {
    const t = await forumTree(request);
    const email = `nou-${id}@example.com`;
    await member(page, `Nou${id}`, email);
    const topic = await topicWithReplies(request, t.forum.id, email, `Server ${id}`);
    await replyInTopic(page, topic.url, `intrați pe https://exemplu-${id}.test/server`);
    await expect(page.locator("#reply .gcs-notice")).toHaveText("Răspunsul tău așteaptă aprobarea unui moderator.");

    await sendInShoutbox(page, `vizitați www.exemplu-${id}.test`);
    await expect(shout(page).getByRole("alert").filter({ hasText: "Membrii noi nu pot posta linkuri externe" })).toBeVisible();
  } finally {
    await resetSetting("antispam.new_member_days");
  }
});

test("phishing: linkul e refuzat în postare și în chat; un link vechi duce pe pagina de avertizare", async ({ page, request }) => {
  const id = uid();
  const t = await forumTree(request);
  const email = `ph-${id}@example.com`;
  await member(page, `Ph${id}`, email);
  const topic = await topicWithReplies(request, t.forum.id, email, `Skinuri ${id}`);

  await replyInTopic(page, topic.url, "cadou gratuit: steamcornmunity.com/gift/7");
  await expect(page.locator("#reply [role=alert]")).toHaveText("Linkul duce spre un site de phishing și nu poate fi postat.");

  await sendInShoutbox(page, "trade rapid pe https://steamcommunity.com.trade-offer.ru/x");
  await expect(shout(page).getByRole("alert").filter({ hasText: "site de phishing" })).toBeVisible();

  // Un link pus înainte de actualizarea listei: click-ul ajunge întâi pe avertizare.
  await sql(`UPDATE posts SET "contentHtml" = $1 WHERE id = $2`, [`<p><a href="https://steamcornmunity.com/gift/7" rel="nofollow ugc noopener" target="_blank">cadou ${id}</a></p>`, topic.ids[0]]);
  await page.goto(topic.url);
  await page.getByRole("link", { name: `cadou ${id}` }).click();
  await expect(page).toHaveURL(/\/link\?u=/);
  await expect(page.getByTestId("gcs-link-page")).toHaveAttribute("data-danger", "1");
  await expect(page.getByTestId("gcs-link-page")).toContainText("steamcornmunity.com");
});

test("avertisment → confirmare → contestație acceptată din ACP (avertismentul se anulează)", async ({ page, browser }) => {
  const id = uid();
  const email = `warn-${id}@example.com`;
  const memberPage = await memberInNewContext(browser, `Avert${id}`, email, "100.70.1");
  const memberId = await userId(email);

  await enterAcpAsRoot(page, `RootW${id}`, `root-w${id}@example.com`);
  await page.goto(`/admin/members/${memberId}`);
  // Cardul Avertismente doar arată; „Avertizează” din titlul lui deschide popupul cu formularul.
  const card = page.getByTestId("gcs-member-card-warnings");
  await expect(card.locator("form")).toHaveCount(0);
  await card.getByTestId("gcs-member-card-warn").click();
  const dialog = page.getByRole("dialog", { name: "Avertizează membrul" });
  await dialog.getByLabel("Puncte").fill("1");
  await dialog.getByLabel("Motiv", { exact: true }).fill(`Limbaj ${id}`);
  await dialog.getByRole("button", { name: "Avertizează" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(card).toContainText(`Limbaj ${id}`);

  await memberPage.goto("/");
  await expect(memberPage.getByTestId("gcs-warning-banner")).toBeVisible();
  await memberPage.getByTestId("gcs-warning-banner").getByRole("link").click();
  await expect(memberPage).toHaveURL(/\/warnings$/);
  const warning = memberPage.getByTestId("gcs-warning").filter({ hasText: `Limbaj ${id}` });
  await warning.getByTestId("gcs-warning-ack").click();
  await expect(warning.getByTestId("gcs-warning-ack")).toHaveCount(0);
  await warning.getByTestId("gcs-warning-appeal-open").click();
  await warning.getByTestId("gcs-warning-appeal-text").fill("Mesajul era o glumă între prieteni, nu o jignire.");
  await warning.getByTestId("gcs-warning-appeal-send").click();
  await expect(warning.getByTestId("gcs-warning-appeal-state")).toHaveAttribute("data-state", "pending");
  await memberPage.goto("/");
  await expect(memberPage.getByTestId("gcs-warning-banner")).toHaveCount(0);

  await page.goto("/admin/members/moderation/warnings");
  const appeal = page.getByTestId("gcs-warnings-appeal").filter({ hasText: `Limbaj ${id}` });
  await appeal.getByLabel("Acceptă (avertismentul se anulează)").check();
  await appeal.getByRole("button", { name: "Trimite decizia" }).click();
  await expect(page.getByTestId("gcs-warnings-appeal").filter({ hasText: `Limbaj ${id}` })).toHaveCount(0);

  await memberPage.goto("/warnings");
  await expect(memberPage.getByTestId("gcs-warning").filter({ hasText: `Limbaj ${id}` })).toHaveAttribute("data-state", "revoked");
  await expect(memberPage.getByTestId("gcs-warning-appeal-state")).toHaveAttribute("data-state", "accepted");
  await memberPage.context().close();
});

test("„Marchează ca spammer” din fișa membrului: ban, IP, conținut ascuns, jurnal; uneltele IP îl găsesc", async ({ page, request }) => {
  const id = uid();
  const t = await forumTree(request);
  const email = `spam-${id}@example.com`;
  await sql(
    `INSERT INTO users (id, name, "nameNormalized", email, "primaryGroupId", "registrationIp", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, (SELECT id FROM groups WHERE key = 'member'), $5, timezone('UTC', now()), timezone('UTC', now()))`,
    [`spam${id}`, `Spam${id}`, `spam${id}`, email, "100.72.0.9"],
  );
  const topic = await topicWithReplies(request, t.forum.id, email, `Reclame ${id}`, 1);

  await enterAcpAsRoot(page, `RootS${id}`, `root-s${id}@example.com`);
  await page.goto(`/admin/members/ip-tools?ip=100.72.0.9`);
  await expect(page.getByTestId("gcs-iptools-account").filter({ hasText: `Spam${id}` })).toBeVisible();
  await page.goto(`/admin/members/ip-tools?member=Spam${id}`);
  await expect(page.getByTestId("gcs-iptools-member-ip").filter({ hasText: "100.72.0.9" })).toContainText("înregistrare");

  await page.goto(`/admin/members/spam${id}`);
  // „Mai multe” → „Marchează spammer”: popupul cu opțiunile acțiunii e și pasul de confirmare.
  await page.getByTestId("gcs-member-more").click();
  await page.getByTestId("gcs-member-spammer").click();
  await page.getByTestId("gcs-member-modal-spammer").getByRole("button", { name: "Marchează ca spammer" }).click();
  await expect(page.getByText("Spammer", { exact: true }).first()).toBeVisible();

  const [user] = await sql<{ isSpammer: boolean | number }>(`SELECT "isSpammer" FROM users WHERE id = $1`, [`spam${id}`]);
  expect(Boolean(user!.isSpammer)).toBe(true);
  const posts = await sql<{ visibility: string }>(`SELECT visibility FROM posts WHERE "topicId" = $1`, [topic.topicId]);
  expect(posts.map((p) => p.visibility)).toEqual(["HIDDEN", "HIDDEN"]);
  const bans = await sql<{ type: string }>(`SELECT type FROM bans WHERE ("userId" = $1 OR value = '100.72.0.9') AND "liftedAt" IS NULL ORDER BY type`, [`spam${id}`]);
  expect(bans.map((b) => b.type)).toEqual(["ACCOUNT", "IP"]);

  // Jurnalul apărării și jurnalul ACP filtrat pe țintă, cu exportul CSV.
  await page.goto("/admin/members/moderation/antispam?kind=spammer_marked");
  await expect(page.getByTestId("gcs-antispam-log-row").first()).toContainText(`Spam${id}`);
  await page.goto(`/admin/logs?target=Spam${id}`);
  await expect(page.locator("details[data-action='user.mark_spammer']")).toHaveCount(1);
  const csv = await page.request.get(await page.getByTestId("gcs-logs-csv").getAttribute("href").then((h) => h!));
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(await csv.text()).toContain("user.mark_spammer");
  await sql(`UPDATE bans SET "liftedAt" = now() WHERE value = '100.72.0.9'`);
});
