import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Browser, type Locator, type Page } from "@playwright/test";
import { forumTree, member, topicWithReplies, uid } from "./forum-fixtures";
import { useFreshIp } from "./helpers";

/**
 * Cardul de membru v3 (macheta aprobată pe 2026-11-03): coperta membrului sus, avatarul de 90 px cu rama VIP centrat
 * peste ea, numele, contoarele Postări / Reputație / Insigne, „Găsește conținutul lui” pe toată lățimea și săgeata spre
 * numele de sub mouse; nimic nu iese din card la 1440 px și la 375 px. Cu „reduced motion” cardul apare direct, fără
 * animații. Pe telefon (375 px, atingere), atingerea avatarului deschide cardul ca foaie de jos, întreagă pe ecran;
 * atingerea numelui merge la profil. Cu `GCS_E2E_SHOTS=<folder>`: `hovercard-v3-1440.png`, `hovercard-v3-375.png`.
 */

const SHOTS = process.env.GCS_E2E_SHOTS ?? "";

/** Datele de profil prin ruta de test (`/api/_test/profile`): VIP-ul și rama aleasă. */
async function profileFixture(request: APIRequestContext, data: Record<string, unknown>): Promise<void> {
  const res = await request.post("/api/_test/profile", { data });
  expect(res.ok(), await res.text()).toBe(true);
}

/** Un banner lat (PNG), desenat de browser: coperta încărcată de membru. */
async function bannerPng(page: Page): Promise<Buffer> {
  const canvas = await page.context().newPage();
  await canvas.setViewportSize({ width: 1200, height: 300 });
  await canvas.setContent(
    '<body style="margin:0;width:1200px;height:300px;display:grid;place-items:center;background:linear-gradient(120deg,#3a2a14,#7a4a12 60%,#f2b33d);font:800 64px sans-serif;color:#fff;letter-spacing:.12em">GCS</body>',
  );
  const png = await canvas.screenshot({ type: "png" });
  await canvas.close();
  return png;
}

/** Coperta membrului logat în `page`, cu poziția verticală dată (ca din Setări → Profil). */
async function uploadCover(page: Page, positionY: number): Promise<void> {
  const res = await page.request.post("/api/profile/images", {
    headers: { origin: new URL(page.url()).origin },
    multipart: { file: { name: "cover.png", mimeType: "image/png", buffer: await bannerPng(page) }, kind: "cover", positionY: String(positionY) },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

/** Un context nou (vizitator), cu opțiunile date. */
async function guestPage(browser: Browser, ip: string, options: Parameters<Browser["newContext"]>[0] = {}): Promise<Page> {
  const context = await browser.newContext(options);
  await useFreshIp(context, ip);
  return context.newPage();
}

/** Cardul deschis de pe nume (hover), după așezare și animația de apariție. */
async function openCard(page: Page, name: Locator): Promise<{ layer: Locator; card: Locator }> {
  await page.mouse.move(2, 2);
  await name.hover();
  const layer = page.locator(".gcs-hoverCardLayer");
  await expect(layer.getByTestId("gcs-hover-card")).toBeVisible({ timeout: 10_000 });
  await expect(layer).not.toHaveAttribute("data-side", "pending");
  await page.waitForTimeout(350);
  return { layer, card: layer.getByTestId("gcs-hover-card") };
}

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  expect(b).not.toBeNull();
  return b!;
}

/** Niciun buton din acțiuni nu iese din card și niciuna dintre etichete nu e tăiată. */
async function expectNothingOverflows(card: Locator, where: string): Promise<void> {
  const report = await card.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      left: r.left,
      right: r.right,
      buttons: [...el.querySelectorAll<HTMLElement>(".gcs-hoverCard__actions .gcs-btn")].map((b) => {
        const br = b.getBoundingClientRect();
        const label = b.querySelector<HTMLElement>(".gcs-hoverCard__label");
        return { id: b.dataset.testid ?? b.getAttribute("aria-label") ?? "", left: br.left, right: br.right, clipped: b.scrollWidth > b.clientWidth + 1 || (label !== null && label.scrollWidth > label.clientWidth + 1) };
      }),
      // Rândurile cardului (contoarele, „Alte grupuri”, rangul cu insignele) stau și ele în card.
      rows: [...el.querySelectorAll<HTMLElement>(".gcs-hoverCard__stats, .gcs-hoverCard__row")].map((row) => ({ cls: row.className, right: row.getBoundingClientRect().right, scroll: row.scrollWidth - row.clientWidth })),
    };
  });
  expect(report.buttons.length, where).toBeGreaterThan(0);
  for (const b of report.buttons) {
    expect(b.left, `${b.id} iese din stânga cardului (${where})`).toBeGreaterThanOrEqual(report.left - 0.5);
    expect(b.right, `${b.id} iese din dreapta cardului (${where})`).toBeLessThanOrEqual(report.right + 0.5);
    expect(b.clipped, `${b.id} are eticheta tăiată (${where})`).toBe(false);
  }
  for (const row of report.rows) {
    expect(row.right, `${row.cls} iese din card (${where})`).toBeLessThanOrEqual(report.right + 0.5);
    expect(row.scroll, `${row.cls} are conținut ieșit din rând (${where})`).toBeLessThanOrEqual(1);
  }
}

test.beforeEach(async ({ context }) => {
  await useFreshIp(context, "203.0.113");
});

test("cardul de membru v3: coperta, avatarul cu rama VIP, contoarele, acțiunile, săgeata; mișcarea redusă; foaia de jos pe telefon", async ({ browser, request }) => {
  test.setTimeout(180_000);
  const id = uid();
  const vipEmail = `hc3-vip-${id}@example.com`;
  const vipName = `Kartel${id}`;

  // Membrul VIP (VIP Gold, rama „gold”) cu coperta lui, autorul unui topic.
  const author = await guestPage(browser, "100.97.1");
  await member(author, vipName, vipEmail);
  await profileFixture(request, { action: "vip", email: vipEmail, groupKey: "vip_gold", days: 30 });
  await profileFixture(request, { action: "frame", email: vipEmail, frameKey: "gold" });
  await uploadCover(author, 40);
  await author.context().close();
  const { forum } = await forumTree(request);
  const topic = await topicWithReplies(request, forum.id, vipEmail, `Topic card v3 ${id}`);

  // Cititorul: un membru (vede Mesaj / Urmărește / Ignoră).
  const reader = await guestPage(browser, "100.97.2", { viewport: { width: 1440, height: 1000 } });
  await member(reader, `Cititor${id}`, `hc3-reader-${id}@example.com`);
  await reader.goto(topic.url);
  const name = reader.getByTestId("gcs-post").first().locator(".gcs-post__authorName a");

  await test.step("1440 px: coperta, avatarul de 90 px cu rama, numele, contoarele, „Găsește conținutul lui”", async () => {
    const { card } = await openCard(reader, name);
    await expect(card).toHaveClass(/gcs-hoverCard--v3/);
    // Coperta membrului (imaginea încărcată, cu poziția salvată), 75 px pe toată lățimea cardului.
    const cover = card.getByTestId("gcs-hover-cover");
    expect(await cover.evaluate((el) => ({ y: getComputedStyle(el).backgroundPositionY, image: getComputedStyle(el).backgroundImage }))).toMatchObject({
      y: "40%",
      image: expect.stringContaining("/files/"),
    });
    const coverBox = await box(cover);
    const cardBox = await box(card);
    expect(Math.round(coverBox.height)).toBe(75);
    expect(Math.abs(coverBox.width - (cardBox.width - 2))).toBeLessThanOrEqual(1);
    expect(Math.round(cardBox.width)).toBe(370);
    // Avatarul: 90 px, centrat, pe jumătate peste copertă, cu rama VIP desenată.
    const frame = card.locator(".gcs-hoverCard__avatar > .gcs-avatarFrame--gold");
    await expect(frame).toBeVisible();
    expect(await frame.evaluate((el) => getComputedStyle(el, "::before").backgroundImage)).toContain("conic-gradient");
    const avatar = await box(frame);
    expect(Math.round(avatar.width)).toBe(90);
    expect(Math.abs(avatar.x + avatar.width / 2 - (cardBox.x + cardBox.width / 2))).toBeLessThanOrEqual(1);
    expect(avatar.y).toBeLessThan(coverBox.y + coverBox.height);
    expect(avatar.y + avatar.height).toBeGreaterThan(coverBox.y + coverBox.height);
    // Identitatea, sub avatar: numele, grupul, data înregistrării.
    await expect(card.locator(".gcs-hoverCard__name")).toHaveText(vipName);
    expect((await box(card.locator(".gcs-hoverCard__name"))).y).toBeGreaterThanOrEqual(avatar.y + avatar.height - 1);
    // Rândul grupului (sau banner-ul VIP, când Studio VIP îl înlocuiește).
    await expect(card.locator(".gcs-hoverCard__meta")).toContainText("VIP Gold");
    await expect(card.getByTestId("gcs-hover-joined")).toContainText("Înregistrat pe");
    // Cutia contoarelor: Postări / Reputație / Insigne.
    await expect(card.getByTestId("gcs-hover-stats").locator(":scope > div")).toHaveCount(3);
    await expect(card.getByTestId("gcs-hover-stats").locator(":scope > div > span")).toHaveText(["Postări", "Reputație", "Insigne"]);
    // Acțiunile: Mesaj cu eticheta, iconițele, „Găsește conținutul lui” pe toată lățimea.
    await expect(card.getByTestId("gcs-hover-message")).toContainText("Mesaj");
    await expect(card.getByTestId("gcs-hover-follow")).toHaveAttribute("data-tip", "Urmărește");
    await expect(card.getByTestId("gcs-hover-content")).toBeVisible();
    await expect(card.getByTestId("gcs-hover-content")).toHaveText("Găsește conținutul lui");
    await expect(card.getByTestId("gcs-hover-content")).toHaveAttribute("href", /\?tab=activity$/);
    await expectNothingOverflows(card, "1440 px");
  });

  await test.step("1440 px: săgeata stă pe latura dinspre nume și arată spre el", async () => {
    const layer = reader.locator(".gcs-hoverCardLayer");
    const arrow = layer.getByTestId("gcs-hover-arrow");
    await expect(arrow).toHaveCount(1);
    const nameBox = await box(name);
    const layerBox = await box(layer);
    const arrowBox = await box(arrow);
    const side = await layer.getAttribute("data-side");
    const center = arrowBox.x + arrowBox.width / 2;
    expect(center, "săgeata e sub (sau deasupra) numelui").toBeGreaterThanOrEqual(nameBox.x);
    expect(center, "săgeata e sub (sau deasupra) numelui").toBeLessThanOrEqual(nameBox.x + nameBox.width);
    if (side === "below") {
      // Iese din marginea de sus a cardului, în spațiul dintre card și nume (vârful nu trece peste nume).
      expect(arrowBox.y).toBeLessThan(layerBox.y);
      expect(arrowBox.y).toBeGreaterThan(nameBox.y + nameBox.height / 2);
    } else {
      expect(side).toBe("above");
      expect(arrowBox.y + arrowBox.height).toBeGreaterThan(layerBox.y + layerBox.height);
      expect(arrowBox.y + arrowBox.height).toBeLessThan(nameBox.y + nameBox.height / 2);
    }
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      // Cardul în context: numele din postare, săgeata și cardul.
      const top = Math.max(0, Math.min(nameBox.y, layerBox.y) - 16);
      const bottom = Math.max(nameBox.y + nameBox.height, layerBox.y + layerBox.height) + 24;
      const left = Math.max(0, Math.min(nameBox.x, layerBox.x) - 24);
      await reader.screenshot({ path: path.join(SHOTS, "hovercard-v3-1440.png"), clip: { x: left, y: top, width: Math.min(1440 - left, layerBox.width + 48), height: bottom - top } });
    }
    // Tooltip-ul sistemului pe o iconiță; cardul rămâne deschis cât mouse-ul e pe el.
    await layer.getByTestId("gcs-hover-follow").hover();
    await expect(reader.getByTestId("gcs-auto-tooltip")).toHaveText("Urmărește");
    await reader.keyboard.press("Escape");
    await expect(layer).toHaveCount(0);
  });

  await test.step("375 px (mouse): cardul încape în ecran, nimic nu iese din el", async () => {
    await reader.setViewportSize({ width: 375, height: 812 });
    const { card } = await openCard(reader, name);
    const b = await box(card);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(375);
    await expect(card.getByTestId("gcs-hover-content")).toBeVisible();
    await expectNothingOverflows(card, "375 px");
    await reader.keyboard.press("Escape");
  });
  await reader.context().close();

  await test.step("„reduced motion”: cardul apare direct, fără nicio animație", async () => {
    const page = await guestPage(browser, "100.97.3", { viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    await page.goto(topic.url);
    await page.getByTestId("gcs-post").first().locator(".gcs-post__authorName a").hover();
    const layer = page.locator(".gcs-hoverCardLayer");
    await expect(layer.getByTestId("gcs-hover-card")).toBeVisible({ timeout: 10_000 });
    await expect(layer).not.toHaveAttribute("data-side", "pending");
    const motion = await layer.evaluate((el) => {
      const card = el.querySelector<HTMLElement>("[data-testid=gcs-hover-card]")!;
      const running = el
        .getAnimations({ subtree: true })
        .filter((a) => a.playState === "running")
        .map((a) => {
          const target = (a.effect as KeyframeEffect | null)?.target ?? null;
          return { name: (a as CSSAnimation).animationName ?? "", inName: target instanceof Element && target.closest(".gcs-name") !== null };
        })
        // Efectele numelui (stilul grupului) sunt ale numelui, nu ale cardului; restul trebuie să lipsească.
        .filter((a) => !a.inName)
        .map((a) => a.name);
      return { layer: getComputedStyle(el).animationName, card: getComputedStyle(card).animationName, opacity: getComputedStyle(el).opacity, running };
    });
    expect(motion).toEqual({ layer: "none", card: "none", opacity: "1", running: [] });
    await page.context().close();
  });

  await test.step("telefon (375 px, atingere): avatarul deschide foaia de jos, întreagă pe ecran; numele duce la profil", async () => {
    const phone = await guestPage(browser, "100.97.4", { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
    await phone.goto(topic.url);
    const post = phone.getByTestId("gcs-post").first();
    await post.locator(".gcs-postbit__avatar .gcs-avatar").tap();
    const sheet = phone.locator(".gcs-hoverCardLayer");
    await expect(sheet).toHaveAttribute("data-side", "sheet", { timeout: 10_000 });
    await expect(phone.getByTestId("gcs-hover-backdrop")).toBeVisible();
    await expect(sheet).toHaveAttribute("aria-modal", "true");
    // După animația de intrare (urcă de jos), foaia stă întreagă în ecran, lipită de marginea de jos.
    await phone.waitForTimeout(500);
    const s = await box(sheet);
    expect(s.x).toBeGreaterThanOrEqual(0);
    expect(s.y).toBeGreaterThanOrEqual(0);
    expect(s.x + s.width).toBeLessThanOrEqual(375.5);
    expect(Math.abs(s.y + s.height - 812)).toBeLessThanOrEqual(1);
    expect(Math.round(s.width)).toBe(375);
    const card = sheet.getByTestId("gcs-hover-card");
    await expect(card.getByTestId("gcs-hover-cover")).toBeVisible();
    await expect(card.locator(".gcs-hoverCard__avatar > .gcs-avatarFrame--gold")).toBeVisible();
    await expect(card.locator(".gcs-hoverCard__name")).toHaveText(vipName);
    await expect(card.getByTestId("gcs-hover-content")).toBeVisible();
    await expectNothingOverflows(card, "foaia de jos");
    // Focusul e în foaie.
    expect(await sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      await phone.screenshot({ path: path.join(SHOTS, "hovercard-v3-375.png") });
    }
    // Atingerea fundalului întunecat (deasupra foii) închide foaia.
    await phone.getByTestId("gcs-hover-backdrop").tap({ position: { x: 20, y: 20 } });
    await expect(sheet).toHaveCount(0);
    await expect(phone.getByTestId("gcs-hover-backdrop")).toHaveCount(0);
    // Escape închide și el foaia.
    await post.locator(".gcs-postbit__avatar .gcs-avatar").tap();
    await expect(sheet).toHaveAttribute("data-side", "sheet", { timeout: 10_000 });
    await phone.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    // Atingerea numelui merge tot la profil (fără card).
    await post.locator(".gcs-post__authorName a").tap();
    await expect(phone).toHaveURL(/\/members\//);
    await phone.context().close();
  });
});
