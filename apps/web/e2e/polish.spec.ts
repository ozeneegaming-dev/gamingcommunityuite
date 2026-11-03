import { e2eKv } from "./kv";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { clearThemeCache } from "./cockpit-fixtures";
import { fixture, forumTree, member, topicWithReplies, uid } from "./forum-fixtures";
import { enterAcpAsRoot, resetSetting, sql, useFreshIp } from "./helpers";

/**
 * Pachetul de finisare (nova-polish), al SISTEMULUI, în orice temă: aspectul listelor (carduri separate / listă continuă),
 * statisticile forumurilor la hover, tooltip-ul sistemului (și în meniurile deschise), banda „Sus / Jos” și bara de
 * derulare, setarea „Stil loader” (cu previzualizarea live din editorul vizual), blocul pentru vizitatori și bara de anunț.
 * Temele de test: una cu designul GCS (carduri), una clasică (listă, statistici la hover, fără bandă). Capturile:
 * `GCS_E2E_SHOTS=<folder>` (întunecat + luminos, 1440 și 375).
 */
const SHOTS = process.env.GCS_E2E_SHOTS ?? "";
const CARDS = "e2e-pol-cards";
const LIST = "e2e-pol-list";

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

/** Un context (vizitator) cu tema aleasă prin cookie-ul temei. */
async function guest(browser: Browser, theme: string, ip: string, width = 1440) {
  const context = await browser.newContext();
  await useFreshIp(context, ip);
  const url = new URL(test.info().project.use.baseURL ?? "http://localhost:3100");
  await context.addCookies([{ name: "gcs-skin", value: theme, domain: url.hostname, path: "/" }]);
  const page = await context.newPage();
  await page.setViewportSize({ width, height: width < 400 ? 812 : 900 });
  return { context, page };
}

/** Stilul calculat al unui element (sau al unui pseudo-element). */
const style = (l: Locator, prop: string, pseudo?: string) =>
  l.evaluate((el, [p, ps]) => getComputedStyle(el, ps ?? null).getPropertyValue(p!), [prop, pseudo] as const);

let tree: Awaited<ReturnType<typeof forumTree>>;

test.beforeAll(async ({ request }) => {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  const themes: [string, string, Record<string, unknown>][] = [
    [CARDS, "Carduri E2E", { preset: "nova", lists: { layout: "cards", stats: "visible" }, loader: { style: "dots" } }],
    [LIST, "Listă E2E", { preset: "classic", lists: { layout: "list", stats: "hover" }, scroll: { rail: false, bar: true } }],
  ];
  for (const [key, name, settings] of themes) {
    await sql(
      `INSERT INTO themes (key, name, "isDefault", enabled, settings, "updatedAt") VALUES ($1, $2, false, true, $3::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET enabled = true, settings = EXCLUDED.settings, "updatedAt" = now()`,
      [key, name, JSON.stringify(settings)],
    );
  }
  await clearThemeCache();
  // Un forum cu subforumuri și un topic (contoarele din bulă), în categoria lui.
  tree = await forumTree(request);
  for (const n of ["Deathrun", "Zombie Plague", "Only Dust2"]) await fixture(request, { action: "forum", parentId: tree.forum.id, type: "FORUM", name: `${n} ${tree.id}` });
  const id = uid();
  await sql(
    `INSERT INTO users (id, name, "nameNormalized", email, "primaryGroupId", "updatedAt") VALUES ($1, $2, $3, $4, (SELECT id FROM groups WHERE key = 'member'), now())`,
    [`e2epol${id}`, `Autor${id}`, `autor${id}`, `pol-author-${id}@example.com`],
  );
  await topicWithReplies(request, tree.forum.id, `pol-author-${id}@example.com`, `Topic polish ${id}`, 2);
});

test.afterAll(async () => {
  await sql(`DELETE FROM themes WHERE key IN ($1, $2)`, [CARDS, LIST]);
  await clearThemeCache();
});

/** Categoria testului pe pagina principală și rândul forumului ei. */
function category(page: Page) {
  const box = page.locator(".gcs-category").filter({ has: page.getByRole("heading", { name: `Categorie ${tree.id}` }) });
  return { box, row: box.getByTestId("gcs-forum-row").first() };
}

test("aspectul listelor: carduri separate (designul GCS) și listă continuă (Clasic); bula statisticilor din butonul pătrat", async ({ browser }) => {
  test.setTimeout(120_000);
  const cards = await guest(browser, CARDS, "100.94.0");
  await cards.page.goto("/");
  await expect(cards.page.locator("html")).toHaveAttribute("data-gcs-lists", "cards");
  const c = category(cards.page);
  await expect(c.row).toBeVisible();
  const well = c.box.locator(".gcs-category__well");
  expect(await style(well, "row-gap")).toBe("8px");
  expect(await style(c.row, "border-top-left-radius")).toBe("4px");
  expect(await style(c.row, "border-top-width")).toBe("1px");
  // Bara mică în culoarea forumului: 3 × 26 px, 75%.
  expect(await style(c.row, "width", "::before")).toBe("3px");
  expect(await style(c.row, "height", "::before")).toBe("26px");
  expect(await style(c.row, "opacity", "::before")).toBe("0.75");
  // Hover-ul schimbă doar fundalul: fără ridicare.
  const before = await style(c.row, "background-color");
  await c.row.hover();
  await expect.poll(() => style(c.row, "background-color")).not.toBe(before);
  expect(await style(c.row, "transform")).toBe("none");
  // Subforumurile pe coloanele alese în ACP (setarea forumului), cu puncte.
  const subs = c.row.getByTestId("gcs-subforums");
  const columns = Number(await subs.getAttribute("data-columns"));
  expect((await style(subs, "grid-template-columns")).split(" ").length).toBe(columns);
  expect(await style(subs.getByRole("listitem").first(), "content", "::before")).toBe('""');
  // Butonul pătrat de 26 px deschide bula cu contoarele.
  const btn = c.row.getByTestId("gcs-forum-stats-btn");
  await expect(btn).toBeVisible();
  expect(await style(btn, "width")).toBe("26px");
  // Bula e un tooltip al sistemului, în `<body>` (nu o taie caseta categoriei).
  const bubble = cards.page.getByTestId("gcs-forum-bubble");
  await expect(bubble).toBeHidden();
  await btn.click();
  await expect(bubble).toBeVisible();
  await expect(bubble).toContainText(/[0-9]+ topic/);
  await expect(btn).toHaveAttribute("aria-expanded", "true");
  await cards.page.keyboard.press("Escape");
  await expect(bubble).toBeHidden();
  await c.box.scrollIntoViewIfNeeded();
  await shot(cards.page, "cards-dark-1440");
  await cards.page.setViewportSize({ width: 375, height: 812 });
  await c.box.scrollIntoViewIfNeeded();
  await shot(cards.page, "cards-dark-375");
  await cards.context.close();

  const list = await guest(browser, LIST, "100.94.1");
  await list.page.goto("/");
  await expect(list.page.locator("html")).toHaveAttribute("data-gcs-lists", "list");
  const l = category(list.page);
  await expect(l.row).toBeVisible();
  expect(await style(l.box.locator(".gcs-category__well"), "row-gap")).toMatch(/^(normal|0px)$/);
  expect(await style(l.row, "border-top-left-radius")).toBe("0px");
  expect(await style(l.row, "content", "::before")).toBe("none");
  await l.box.scrollIntoViewIfNeeded();
  await shot(list.page, "list-classic-1440");
  await list.context.close();

  // GCS White (luminoasă): tot carduri separate.
  const white = await guest(browser, "gcs-white", "100.94.2");
  await white.page.goto("/");
  await expect(white.page.locator("html")).toHaveAttribute("data-gcs-lists", "cards");
  await expect(white.page.locator("html")).toHaveAttribute("data-theme", "light");
  const w = category(white.page);
  await w.box.scrollIntoViewIfNeeded();
  await shot(white.page, "cards-light-1440");
  await white.page.setViewportSize({ width: 375, height: 812 });
  await w.box.scrollIntoViewIfNeeded();
  await shot(white.page, "cards-light-375");
  await white.context.close();
});

test("statistici forum „La hover”: contoarele ies din rând și apar în bulă la hover și la focus din tastatură", async ({ browser }) => {
  const { context, page } = await guest(browser, LIST, "100.94.3");
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-gcs-stats", "hover");
  const { row } = category(page);
  await expect(row).toBeVisible();
  await expect(row.locator(".gcs-forumRow__stats")).toBeHidden();
  const bubble = page.getByTestId("gcs-forum-bubble");
  await expect(bubble).toBeHidden();
  await row.hover();
  await expect(bubble).toBeVisible();
  await expect(bubble).toContainText(/[0-9]+ topic/);
  await expect(bubble).toContainText(/[0-9]+ (de )?răspuns/);
  await shot(page, "stats-hover-classic");
  await page.mouse.move(2, 2);
  await expect(bubble).toBeHidden();
  // Tastatura: focus pe numele forumului.
  await row.getByRole("link", { name: tree.forumName, exact: true }).focus();
  await expect(bubble).toBeVisible();
  await context.close();
});

test("tooltip-ul sistemului: butoanele doar cu iconiță și un element dintr-un meniu deschis (bula nu se pierde)", async ({ browser }) => {
  test.setTimeout(120_000);
  const id = uid();
  const context = await browser.newContext();
  await useFreshIp(context, "100.94.4");
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  const email = `pol-tip-${id}@example.com`;
  await member(page, `Tip${id}`, email);
  const other = `pol-tip-b-${id}@example.com`;
  await sql(
    `INSERT INTO users (id, name, "nameNormalized", email, "primaryGroupId", "updatedAt") VALUES ($1, $2, $3, $4, (SELECT id FROM groups WHERE key = 'member'), now())`,
    [`e2etip${id}`, `Bianca${id}`, `bianca${id}`, other],
  );
  await fixture(page.request, { action: "pm", fromEmail: other, toEmail: email, title: `Salut ${id}`, text: "Un mesaj pentru tooltip" });
  await page.goto("/");
  // Butonul doar cu iconiță: tooltip-ul automat (din `aria-label`).
  const trigger = page.getByTestId("gcs-header-messages");
  await trigger.hover();
  const tip = page.locator(".gcs-tooltip").filter({ visible: true }).first();
  await expect(tip).toContainText(/Mesaje|mesaj/);
  // În meniul deschis: data exactă a mesajului, în bula sistemului, peste panou.
  await trigger.click();
  const panel = page.getByTestId("gcs-messages-panel");
  await expect(panel).toBeVisible();
  const time = panel.getByTestId("gcs-messages-time").first();
  await time.hover();
  await expect(tip).toBeVisible();
  const title = await time.getAttribute("data-gcs-title");
  expect(title).toBeTruthy();
  await expect(tip).toHaveText(title!);
  expect(await tip.evaluate((el) => el.parentElement === document.body)).toBe(true);
  // Bula e în ecran și deasupra panoului (nu o taie panoul).
  const box = await tip.boundingBox();
  expect(box && box.y >= 0 && box.width > 0).toBeTruthy();
  const z = await tip.evaluate((el) => Number(getComputedStyle(el).zIndex));
  const panelZ = await panel.evaluate((el) => Number(getComputedStyle(el).zIndex) || 0);
  expect(z).toBeGreaterThan(panelZ);
  await expect(panel).toBeVisible();
  await shot(page, "tooltip-in-dropdown");
  await page.mouse.move(2, 2);
  await expect(time).toHaveAttribute("title", title!);
  await context.close();
});

test("banda „Sus / Jos”: iese după o mică derulare, duce sus / jos, se estompează la capete; setarea temei o ascunde", async ({ browser, request }) => {
  test.setTimeout(120_000);
  const id = uid();
  await sql(
    `INSERT INTO users (id, name, "nameNormalized", email, "primaryGroupId", "updatedAt") VALUES ($1, $2, $3, $4, (SELECT id FROM groups WHERE key = 'member'), now())`,
    [`e2erail${id}`, `Rail${id}`, `rail${id}`, `pol-rail-${id}@example.com`],
  );
  const topic = await topicWithReplies(request, tree.forum.id, `pol-rail-${id}@example.com`, `Topic lung ${id}`, 14);
  const { context, page } = await guest(browser, "gcs-dark", "100.94.5");
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.goto(topic.url);
  await expect(page.locator("html")).toHaveAttribute("data-gcs-scrollbar", "on");
  const rail = page.getByTestId("gcs-scroll-rail");
  await expect(rail).not.toHaveClass(/gcs-scrollRail--show/);
  await page.mouse.wheel(0, 700);
  await expect(rail).toHaveClass(/gcs-scrollRail--show/);
  await expect(rail).toBeVisible();
  // Lipită în stânga conținutului.
  const box = await rail.boundingBox();
  expect(box!.x).toBeLessThan(200);
  // Tooltip-ul „Jos”, apoi la finalul paginii.
  const down = page.getByTestId("gcs-scroll-down");
  await down.hover();
  await expect(page.locator(".gcs-tooltip").filter({ visible: true }).first()).toHaveText("Jos");
  await shot(page, "rail-dark-1440");
  await down.click();
  await expect.poll(() => page.evaluate(() => Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight - 4)).toBe(true);
  await expect(down).toHaveAttribute("data-end", "");
  const up = page.getByTestId("gcs-scroll-up");
  await up.click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(rail).not.toHaveClass(/gcs-scrollRail--show/);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.mouse.wheel(0, 900);
  await expect(rail).toHaveClass(/gcs-scrollRail--show/);
  await shot(page, "rail-dark-375");
  await context.close();

  // Tema cu banda oprită: nu apare deloc.
  const off = await guest(browser, LIST, "100.94.6");
  await off.page.goto(topic.url);
  await expect(off.page.locator("html")).toHaveAttribute("data-gcs-rail", "off");
  await off.page.mouse.wheel(0, 900);
  await expect(off.page.getByTestId("gcs-scroll-rail")).toBeHidden();
  await off.context.close();
});

test("„Stil loader”: loaderul urmează setarea temei; editorul vizual îl schimbă live în previzualizare", async ({ browser, page, context }) => {
  test.setTimeout(150_000);
  // Pe site: stilul temei (puncte) față de inelul implicit.
  const g = await guest(browser, CARDS, "100.94.7");
  await g.page.goto("/");
  await expect(g.page.locator("html")).toHaveAttribute("data-gcs-loader", "dots");
  const probe = (p: Page) =>
    p.evaluate(() => {
      const s = document.createElement("span");
      s.className = "gcs-spinner";
      s.innerHTML = '<span class="gcs-spinner__i"></span><span class="gcs-spinner__i"></span><span class="gcs-spinner__i"></span>';
      document.body.appendChild(s);
      const child = getComputedStyle(s.firstElementChild!);
      const ring = getComputedStyle(s, "::before");
      const out = { child: child.display, childAnim: child.animationName, ring: ring.animationName };
      s.remove();
      return out;
    });
  expect(await probe(g.page)).toMatchObject({ child: "block", childAnim: "gcs-ld-dot" });
  await g.context.close();
  const l = await guest(browser, LIST, "100.94.8");
  await l.page.goto("/");
  await expect(l.page.locator("html")).toHaveAttribute("data-gcs-loader", "ring");
  expect(await probe(l.page)).toMatchObject({ child: "none", ring: "gcs-ld-spin" });
  await l.context.close();

  // Editorul vizual: Global → Interfață → Stil loader; previzualizarea primește atributul live.
  await useFreshIp(context, "100.94.9");
  const id = uid();
  await enterAcpAsRoot(page, `Loader${id}`, `pol-loader-${id}@example.com`);
  await page.goto(`/admin/theme-editor/${CARDS}`);
  await expect(page.getByTestId("gcs-theme-studio")).toBeVisible();
  const frame = page.frameLocator('[data-testid="gcs-studio-preview"]');
  await expect(frame.locator("html")).toHaveAttribute("data-gcs-loader", "dots");
  await page.getByTestId("gcs-studio-nav-global").click();
  await page.getByTestId("gcs-studio-nav-interface").click();
  await page.getByTestId("gcs-studio-field-loader_style").getByRole("radio", { name: "Bare", exact: true }).click();
  await expect(frame.locator("html")).toHaveAttribute("data-gcs-loader", "bars");
  // Aspectul listelor, tot live.
  await page.getByTestId("gcs-studio-back").click();
  await page.getByTestId("gcs-studio-back").click();
  await page.getByTestId("gcs-studio-nav-layouts").click();
  await page.getByTestId("gcs-studio-field-lists_layout").getByRole("radio", { name: "Listă continuă" }).click();
  await expect(frame.locator("html")).toHaveAttribute("data-gcs-lists", "list");
  await shot(page, "studio-loader");
});

test("blocul pentru vizitatori: sub topic în locul formularului și ca widget; membrii nu-l văd", async ({ browser, request }) => {
  test.setTimeout(120_000);
  const id = uid();
  await sql(
    `INSERT INTO users (id, name, "nameNormalized", email, "primaryGroupId", "updatedAt") VALUES ($1, $2, $3, $4, (SELECT id FROM groups WHERE key = 'member'), now())`,
    [`e2ecta${id}`, `Cta${id}`, `cta${id}`, `pol-cta-${id}@example.com`],
  );
  const topic = await topicWithReplies(request, tree.forum.id, `pol-cta-${id}@example.com`, `Topic vizitatori ${id}`, 1);
  const g = await guest(browser, "gcs-dark", "100.94.10");
  await g.page.goto(topic.url);
  const cta = g.page.getByTestId("gcs-guest-cta");
  await expect(cta).toBeVisible();
  await expect(cta).toContainText("Creează un cont sau autentifică-te ca să comentezi");
  await expect(cta.getByTestId("gcs-guest-register")).toHaveAttribute("href", "/register");
  await expect(cta.getByTestId("gcs-guest-login")).toHaveAttribute("href", "/login");
  await expect(cta.getByTestId("gcs-guest-steam")).toHaveAttribute("href", /\/api\/auth\/steam\/sign-in\?callbackURL=%2Ftopic%2F/);
  await cta.scrollIntoViewIfNeeded();
  await shot(g.page, "guest-cta-dark-1440");
  await g.page.setViewportSize({ width: 375, height: 812 });
  await cta.scrollIntoViewIfNeeded();
  await shot(g.page, "guest-cta-dark-375");
  await g.context.close();

  // Widget-ul pe pagina principală (doar pentru vizitatori).
  await sql(`INSERT INTO widget_placements (page, zone, position, type, config, groups) VALUES ('index', 'sidebar', 0, 'core.guestCta', '{}', '[]')`);
  await clearWidgetCache();
  try {
    const w = await guest(browser, "gcs-white", "100.94.11");
    await w.page.goto("/");
    const widget = w.page.getByTestId("gcs-guest-cta").filter({ visible: true }).first();
    await expect(widget).toContainText("Alătură-te comunității");
    await widget.scrollIntoViewIfNeeded();
    await shot(w.page, "guest-cta-widget-light-1440");
    await w.context.close();

    const context = await browser.newContext();
    await useFreshIp(context, "100.94.12");
    const page = await context.newPage();
    await member(page, `Membru${id}`, `pol-cta-m-${id}@example.com`);
    await page.goto("/");
    await expect(page.getByTestId("gcs-forum-index")).toBeVisible();
    await expect(page.getByTestId("gcs-guest-cta")).toHaveCount(0);
    await page.goto(topic.url);
    await expect(page.getByTestId("gcs-guest-cta")).toHaveCount(0);
    await context.close();
  } finally {
    await sql(`DELETE FROM widget_placements WHERE type = 'core.guestCta'`);
    await clearWidgetCache();
  }
});

test("bara de anunț: ACP → Aspect → Conținut, vizibilă pe site în orice temă, închisă rămâne închisă (per vizitator)", async ({ browser, page, context }) => {
  test.setTimeout(150_000);
  await useFreshIp(context, "100.94.13");
  const id = uid();
  await enterAcpAsRoot(page, `Anunt${id}`, `pol-ann-${id}@example.com`);
  try {
    await page.goto("/admin/appearance/announcement-bar");
    await expect(page.getByTestId("gcs-ann-editor")).toBeVisible();
    await page.getByTestId("gcs-ann-add").click();
    const bar = page.getByTestId("gcs-ann-editor-bar").first();
    await bar.getByTestId("gcs-ann-label").fill("ANUNȚ");
    await bar.getByTestId("gcs-ann-text").fill(`Cupa de toamnă ${id}: înscrierile sunt deschise până vineri`);
    await bar.getByTestId("gcs-ann-cta-on").check();
    await bar.getByTestId("gcs-ann-cta-label").fill("Înscrie echipa");
    await bar.getByTestId("gcs-ann-cta-href").fill("/forum");
    await page.getByTestId("gcs-ann-save").click();
    await expect(page.getByTestId("gcs-ann-status")).toHaveText("Barele de anunț au fost salvate.");
    // Salvarea: setarea `announcement.bars` are bara (normalizată, cu versiunea 1).
    await expect
      .poll(async () => (await sql<{ value: { bars?: { text: string; version: number }[] } }>(`SELECT value FROM settings WHERE key = 'announcement.bars'`))[0]?.value.bars?.[0])
      .toMatchObject({ text: `Cupa de toamnă ${id}: înscrierile sunt deschise până vineri`, version: 1 });

    for (const [theme, ip, name] of [
      ["gcs-dark", "100.94.14", "dark"],
      [LIST, "100.94.15", "classic"],
      ["gcs-white", "100.94.16", "light"],
    ] as const) {
      const g = await guest(browser, theme, ip);
      await g.page.goto("/");
      const ann = g.page.getByTestId("gcs-ann-bar");
      await expect(ann).toContainText(`Cupa de toamnă ${id}`);
      await expect(ann.getByRole("link", { name: /Înscrie echipa/ })).toHaveAttribute("href", "/forum");
      await shot(g.page, `announcement-${name}-1440`);
      if (name === "dark") {
        await g.page.setViewportSize({ width: 375, height: 812 });
        await shot(g.page, "announcement-dark-375");
        // Închisă: dispare și nu mai revine la reîncărcare (cookie-ul vizitatorului).
        await ann.getByTestId("gcs-ann-dismiss").click();
        await expect(ann).toHaveCount(0);
        await g.page.reload();
        await expect(g.page.getByTestId("gcs-forum-index")).toBeVisible();
        await expect(g.page.getByTestId("gcs-ann-bar")).toHaveCount(0);
      }
      await g.context.close();
    }
  } finally {
    await resetSetting("announcement.bars");
  }
});

async function clearWidgetCache() {
  const r = await e2eKv();
  try {
    const keys = await r.keys("gcs:k:layout*");
    if (keys.length > 0) await r.del(...keys);
  } finally {
    r.disconnect();
  }
}
