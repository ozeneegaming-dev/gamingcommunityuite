import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { fixture, forumTree, member, memberInNewContext, topicWithReplies, typeInEditor, uid } from "./forum-fixtures";
import { enterAcpAsRoot, sql, useFreshIp } from "./helpers";

/**
 * Forum v2: nodul „Pagină / Anunț” cu CTA, extensia demo a sloturilor (în formularul ACP și în rândul forumului), nota
 * topicurilor (sortarea și filtrul 4★+), blocurile sigure (pe temele închisă și luminoasă, HTML-ul refuzat membrilor),
 * arhivarea automată din ACP, mesajul moderatorului și răspunsul recomandat. Capturile ajung în `GCS_E2E_SHOTS` (implicit
 * folderul de capturi al etapei).
 */
const SHOTS = process.env.GCS_E2E_SHOTS ?? "D:/Desktop/RED-LINE FORUM PLATFORM/gcs-shots/forum-v2";
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

test.beforeEach(async ({ context }) => {
  await useFreshIp(context, "198.18.71");
});

async function useTheme(context: BrowserContext, mode: "light" | "dark") {
  const url = new URL(test.info().project.use.baseURL ?? "http://localhost:3100");
  await context.clearCookies({ name: "gcs-skin" });
  await context.addCookies([
    { name: "gcs-theme", value: mode, domain: url.hostname, path: "/" },
    ...(mode === "light" ? [{ name: "gcs-skin", value: "gcs-white", domain: url.hostname, path: "/" }] : []),
  ]);
}

test("ACP: un nod Pagină cu conținut și CTA; extensia demo a sloturilor în formular, în rând, pe pagină și în bara topicului", async ({ page, request }) => {
  const id = uid();
  const t = await forumTree(request);
  const pageNode = await fixture<{ id: number; slug: string }>(request, { action: "forum", parentId: t.category.id, type: "PAGE", name: `Anunț ${id}` });
  await enterAcpAsRoot(page, `Root${id}`, `root-v2-${id}@example.com`);

  // Tabul „Pagina”: conținutul bogat, butonul CTA și topicurile de dedesubt.
  await page.goto(`/admin/community/forums/${pageNode.id}`);
  await page.getByTestId("gcs-forum-tab-page").click();
  const form = page.getByTestId("gcs-forum-page-form");
  await typeInEditor(page, `Bine ați venit pe serverul ${id}!`, form.getByTestId("gcs-acp-doc-content"));
  await form.getByLabel("Textul butonului").fill("Înscrie-te acum");
  await form.getByLabel(/Linkul butonului/).fill("/register");
  await form.getByLabel("Topicuri sub pagină").check();
  await form.getByRole("button", { name: "Salvează forumul" }).click();
  await expect(form.getByRole("status")).toHaveText("Salvat");
  await shot(page, "acp-page-tab");

  await page.goto(`/forum/${pageNode.id}-${pageNode.slug}`);
  await expect(page.getByTestId("gcs-forum-page")).toContainText(`Bine ați venit pe serverul ${id}!`);
  await expect(page.getByTestId("gcs-forum-page-cta")).toHaveAttribute("href", "/register");
  await expect(page.getByRole("heading", { name: "Topicuri", exact: true })).toBeVisible();
  await shot(page, "page-node");

  // Rândul nodului Pagină din index: iconița de anunț și semnul „pagină”.
  await page.goto("/");
  const pageRow = page.getByTestId("gcs-forum-row").filter({ hasText: `Anunț ${id}` });
  await expect(pageRow).toHaveAttribute("data-forum-type", "PAGE");

  // Extensia demo (modulul de test): tabul ei în formularul forumului.
  await page.goto(`/admin/community/forums/${t.forum.id}`);
  await page.getByTestId("gcs-forum-tab-x:slotsdemo:demo").click();
  const demo = page.getByTestId("gcs-forum-ext-slotsdemo-demo");
  await expect(demo).toBeVisible();
  await demo.getByLabel("Arată demo-ul pe acest forum").check();
  await demo.getByLabel("Eticheta de lângă titlu").fill("Oficial");
  await demo.getByLabel("Rândul de sub descriere").fill(`Serverul comunității ${id}`);
  await demo.getByLabel("Titlul cu majuscule").check();
  await demo.getByRole("button", { name: "Salvează forumul" }).click();
  await expect(demo.getByRole("status")).toHaveText("Salvat");
  await shot(page, "acp-slot-demo-tab");

  // Validarea extensiei: demo pornit fără etichetă e refuzat cu mesajul câmpului.
  await demo.getByLabel("Eticheta de lângă titlu").fill("");
  await demo.getByRole("button", { name: "Salvează forumul" }).click();
  await expect(demo.getByRole("alert")).toBeVisible();

  // Rândul forumului (marcajul card-row): eticheta lângă titlu, rândul de sub descriere, statistica și stilul.
  const topic = await topicWithReplies(request, t.forum.id, `root-v2-${id}@example.com`, `Salut slot ${id}`);
  await page.goto("/");
  const row = page.getByTestId("gcs-forum-row").filter({ hasText: t.forumName });
  await expect(row.locator('[data-slot="forum.row.title"] [data-slot-item="badge"]')).toHaveText("Oficial");
  await expect(row.locator('[data-slot="forum.row.meta"] [data-slot-item="note"]')).toHaveText(`Serverul comunității ${id}`);
  await expect(row.locator('[data-slot-item="slotsdemo-count"]')).toContainText("1");
  await expect(row).toHaveClass(/gcs-forumRow--titleCaps/);
  await expect(row).toHaveClass(/gcsx-slotsdemo/);
  await row.scrollIntoViewIfNeeded();
  await shot(page, "forum-row-slots");

  // Pagina forumului (cardul de sus) și bara topicului.
  await page.goto(`/forum/${t.forum.id}-${t.forum.slug}`);
  await expect(page.locator('[data-slot="forum.page.top"]')).toContainText("Card demo");
  await page.goto(topic.url);
  await expect(page.locator('[data-slot="topic.bar"] [data-slot-item="slotsdemo-bar-text"]')).toContainText(`Bara demo a topicului #${topic.topicId}`);
  await shot(page, "topic-bar-slot");
});

test("nota topicurilor: pornită din ACP, membrul notează cu stele, sortarea „Cele mai bine notate” și filtrul 4★+", async ({ page, request, browser }) => {
  const id = uid();
  const t = await forumTree(request);
  const rootEmail = `root-rate-${id}@example.com`;
  await enterAcpAsRoot(page, `RootR${id}`, rootEmail);
  await page.goto(`/admin/community/forums/${t.forum.id}?tab=options`);
  await page.getByTestId("gcs-forum-rating-enabled").check();
  await page.getByTestId("gcs-forum-options").getByRole("button", { name: "Salvează forumul" }).click();
  await expect(page.getByTestId("gcs-forum-options").getByRole("status")).toHaveText("Salvat");

  const good = await topicWithReplies(request, t.forum.id, rootEmail, `Ghid excelent ${id}`);
  const weak = await topicWithReplies(request, t.forum.id, rootEmail, `Ghid slab ${id}`);

  const fan = await memberInNewContext(browser, `Fan${id}`, `fan-rate-${id}@example.com`, "198.18.72");
  await fan.goto(good.url);
  const rating = fan.getByTestId("gcs-topic-rating");
  await fan.getByTestId("gcs-rate-5").hover();
  await expect(rating).toContainText("Excelent");
  await fan.getByTestId("gcs-rate-5").click();
  await expect(fan.getByTestId("gcs-rating-mine")).toContainText("5★");
  await expect(rating).toContainText("5,0 din 5 · 1 vot");
  await shot(fan, "topic-rating");
  await fan.goto(weak.url);
  await fan.getByTestId("gcs-rate-2").click();
  await expect(fan.getByTestId("gcs-rating-mine")).toContainText("2★");

  // Lista: sortarea după notă și filtrul „Doar 4★+”, din formularul de filtre.
  await fan.goto(`/forum/${t.forum.id}-${t.forum.slug}`);
  const filters = fan.getByTestId("gcs-topic-filters");
  await filters.getByLabel("Sortează").selectOption("rating");
  await filters.getByRole("button", { name: "Filtrează" }).click();
  await expect(fan).toHaveURL(/sort=rating/);
  const rows = fan.getByTestId("gcs-topic-row");
  await expect(rows.first()).toContainText(`Ghid excelent ${id}`);
  await expect(rows.first().getByTestId("gcs-topic-rating-row")).toBeVisible();
  await filters.getByLabel("Doar 4★+").check();
  await filters.getByRole("button", { name: "Filtrează" }).click();
  await expect(fan).toHaveURL(/stars=4/);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(`Ghid excelent ${id}`);
  await shot(fan, "forum-rating-filter");

  // Vizitatorul vede nota, fără să poată vota.
  const guest = await browser.newContext();
  const g = await guest.newPage();
  await g.goto(good.url);
  await expect(g.getByTestId("gcs-topic-rating")).toContainText("Autentifică-te");
  await expect(g.getByTestId("gcs-rate-5")).toHaveCount(0);
  await guest.close();
  await fan.context().close();
});

test("blocurile sigure: caseta de atenționare a unui membru pe temele închisă și luminoasă; HTML-ul e refuzat membrilor", async ({ page, request, context }) => {
  const id = uid();
  const t = await forumTree(request);
  const email = `blocuri-${id}@example.com`;
  await member(page, `Bloc${id}`, email);

  await page.goto(`/forum/${t.forum.id}-${t.forum.slug}`);
  await page.getByRole("link", { name: "Topic nou" }).first().click();
  await page.getByLabel("Titlu").fill(`Reguli server ${id}`);
  const form = page.locator("form");
  await typeInEditor(page, "Citiți înainte să intrați.", form);
  await form.getByTestId("gcs-editor-blocks").click();
  // Membrii au blocurile structurate, dar nu și HTML-ul (doar Root Admin).
  await expect(form.getByTestId("gcs-editor-block-callout")).toBeVisible();
  await expect(form.getByTestId("gcs-editor-block-html")).toHaveCount(0);
  await form.getByTestId("gcs-editor-block-callout").click();
  await form.getByLabel("Tip").selectOption("warning");
  await form.getByLabel("Titlu", { exact: true }).last().fill("Atenție la reguli");
  await form.getByTestId("gcs-editor-block-apply").click();
  await form.locator('.gcs-editor__content [data-gcs-block="gcsCallout"] p').first().click();
  await page.keyboard.type("Fără cheaturi, fără reclame.");
  await page.getByRole("button", { name: "Publică topicul" }).click();

  await expect(page.getByRole("heading", { name: `Reguli server ${id}`, level: 1 })).toBeVisible();
  const callout = page.locator(".gcs-postBody .gcs-callout--warning").first();
  await expect(callout).toContainText("Atenție la reguli");
  await expect(callout).toContainText("Fără cheaturi, fără reclame.");
  const topicUrl = page.url();
  for (const mode of ["dark", "light"] as const) {
    await useTheme(context, mode);
    await page.goto(topicUrl);
    await expect(callout).toBeVisible();
    await callout.scrollIntoViewIfNeeded();
    await shot(page, `blocks-callout-${mode}`);
  }
  await useTheme(context, "dark");

  // Serverul refuză un bloc nepermis (HTML de la un membru), chiar trimis direct.
  const res = await request.post("/api/_test/forum", {
    data: { action: "topic", forumId: t.forum.id, title: `HTML interzis ${id}`, text: "", authorEmail: email, content: { type: "doc", content: [{ type: "gcsHtml", attrs: { html: "<b>x</b>" } }] } },
  });
  expect(res.status()).toBe(422);
  expect(await res.json()).toMatchObject({ fields: { content: "block_forbidden" } });
});

test("arhivarea automată din ACP: regula arhivează topicul vechi, topicul e doar de citit și se restaurează", async ({ page, request }) => {
  const id = uid();
  const t = await forumTree(request);
  const rootEmail = `root-arh-${id}@example.com`;
  await enterAcpAsRoot(page, `RootA${id}`, rootEmail);
  const old = await topicWithReplies(request, t.forum.id, rootEmail, `Topic uitat ${id}`);
  await sql(`UPDATE topics SET "lastPostAt" = now() - interval '200 days' WHERE id = $1`, [old.topicId]);

  await page.goto("/admin/community/archive");
  await page.getByTestId("gcs-archive-new").click();
  const form = page.getByTestId("gcs-archive-form");
  await form.getByLabel("Numele regulii").fill(`Vechi ${id}`);
  await form.getByLabel(/ultima postare mai veche/).fill("90");
  await form.getByRole("group", { name: "Forumuri" }).first().getByLabel(t.forumName, { exact: true }).check();
  await shot(page, "acp-archive-rule");
  await form.getByRole("button", { name: "Salvează regula" }).click();

  const rule = page.getByTestId("gcs-archive-rule").filter({ hasText: `Vechi ${id}` });
  await expect(rule).toContainText("acum ar arhiva 1 topic");
  await rule.getByRole("button", { name: "Rulează acum" }).click();
  await page.getByTestId("gcs-confirm-ok").click();
  await expect(rule).toContainText(/acum ar arhiva 0 (de )?topicuri/);

  await page.goto(old.url);
  await expect(page.getByTestId("gcs-topic-archived")).toBeVisible();
  await expect(page.getByTestId("gcs-reply-box")).toHaveCount(0);
  await shot(page, "topic-archived");
  await page.goto(`/forum/${t.forum.id}-${t.forum.slug}`);
  await expect(page.getByTestId("gcs-topic-row").filter({ hasText: `Topic uitat ${id}` })).toHaveClass(/gcs-topicRow--archived/);

  // Restaurarea din meniul de moderare al topicului.
  await page.goto(old.url);
  await page.getByText("Unelte de moderare").click();
  await page.getByTestId("gcs-mod-archive").click();
  await expect(page.getByTestId("gcs-topic-archived")).toHaveCount(0);
  await expect(page.getByTestId("gcs-reply-box")).toBeVisible();
});

test("moderatorul: „Adaugă mesaj” sus în topic și răspunsul „Recomandat”; istoricul moderării le arată", async ({ page, request, browser }) => {
  const id = uid();
  const t = await forumTree(request);
  const authorEmail = `autor-v2-${id}@example.com`;
  const author = await memberInNewContext(browser, `Autor${id}`, authorEmail, "198.18.73");
  const topic = await topicWithReplies(request, t.forum.id, authorEmail, `Topic de ajutor ${id}`, 2);

  await member(page, `Mod${id}`, `mod-v2-${id}@example.com`, "super_moderator");
  await page.goto(topic.url);
  await page.getByText("Unelte de moderare").click();
  await page.getByTestId("gcs-mod-notice").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Tonul mesajului").selectOption("warn");
  await typeInEditor(page, `Topicul e sub supraveghere ${id}.`, dialog);
  await dialog.getByTestId("gcs-notice-save").click();
  const notice = page.getByTestId("gcs-topic-notice");
  await expect(notice).toContainText(`Topicul e sub supraveghere ${id}.`);

  // „Recomandat”: al doilea răspuns, din meniul postării.
  const reply = page.getByTestId("gcs-post").filter({ hasText: "Răspunsul 2" });
  await reply.getByTestId("gcs-post-more").click();
  await page.getByTestId("gcs-post-recommend").click();
  await expect(page.getByTestId("gcs-recommended")).toContainText("Răspunsul 2");
  // Răspunsul apare de două ori: sus, în caseta „Recomandat”, și la locul lui (cu pastila).
  await expect(reply.last().getByTestId("gcs-post-pill-recommended")).toBeVisible();
  await shot(page, "topic-notice-recommended");

  // Membrul vede mesajul și răspunsul recomandat, fără uneltele de moderare.
  await author.goto(topic.url);
  await expect(author.getByTestId("gcs-topic-notice")).toContainText(`Topicul e sub supraveghere ${id}.`);
  await expect(author.getByTestId("gcs-recommended")).toContainText("Răspunsul 2");
  await expect(author.getByTestId("gcs-post-pill-author").first()).toBeVisible();
  await expect(author.getByTestId("gcs-mod-notice")).toHaveCount(0);
  await author.context().close();

  // Istoricul moderării al topicului (meniul de moderare a rămas deschis după acțiunile de mai sus).
  if (!(await page.locator("details.gcs-modMenu").evaluate((d) => (d as HTMLDetailsElement).open))) await page.getByText("Unelte de moderare").click();
  await page.getByTestId("gcs-mod-history").click();
  const history = page.getByTestId("gcs-mod-history-list");
  await expect(history.locator('[data-action="mod.topic.notice"]')).toHaveCount(1);
  await expect(history.locator('[data-action="mod.topic.recommend"]')).toHaveCount(1);
});

test("Q&A: membrii votează răspunsurile (scorul, anularea, votul negativ), autorul nu; forumurile în grilă, la alegerea membrului", async ({ page, request, browser }) => {
  const id = uid();
  const t = await forumTree(request, "QA");
  const authorEmail = `autor-qa-${id}@example.com`;
  const author = await memberInNewContext(browser, `AutorQa${id}`, authorEmail, "198.18.74");
  const topic = await topicWithReplies(request, t.forum.id, authorEmail, `Întrebare ${id}`, 1);

  await member(page, `Votant${id}`, `votant-${id}@example.com`);
  await page.goto(topic.url);
  const answer = page.getByTestId("gcs-post").filter({ hasText: "Răspunsul 1" });
  const up = answer.getByTestId("gcs-vote-up");
  const score = answer.getByTestId("gcs-vote-score");
  await expect(score).toHaveText("0");
  await up.click();
  await expect(score).toHaveText("1");
  await expect(up).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(score).toHaveText("1");
  await up.click();
  await expect(score).toHaveText("0");
  await answer.getByTestId("gcs-vote-down").click();
  await expect(score).toHaveText("-1");
  await expect(answer.getByTestId("gcs-vote-down")).toHaveAttribute("aria-pressed", "true");
  await shot(page, "qa-vote");

  // Autorul răspunsului vede scorul, dar nu-și poate vota postarea.
  await author.goto(topic.url);
  const own = author.getByTestId("gcs-post").filter({ hasText: "Răspunsul 1" });
  await expect(own.getByTestId("gcs-vote-score")).toHaveText("-1");
  await expect(own.getByTestId("gcs-vote-up")).toBeDisabled();
  await author.context().close();

  // Vederea forumurilor: grila, păstrată după reîncărcare, pe o coloană la 375 px fără scroll orizontal.
  await page.goto("/forum");
  const index = page.getByTestId("gcs-forum-index");
  await expect(index).toHaveAttribute("data-view", "rows");
  await page.getByTestId("gcs-view-grid").click();
  await expect(index).toHaveAttribute("data-view", "grid");
  await page.reload();
  await expect(index).toHaveAttribute("data-view", "grid");
  await expect(index.locator(".gcs-category__well").first()).toHaveCSS("display", "grid");
  await shot(page, "forum-index-grid");
  await page.setViewportSize({ width: 375, height: 800 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await shot(page, "forum-index-grid-375");
  await page.getByTestId("gcs-view-rows").click();
  await expect(index).toHaveAttribute("data-view", "rows");
});
