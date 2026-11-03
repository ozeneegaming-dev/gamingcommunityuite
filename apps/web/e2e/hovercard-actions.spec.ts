import path from "node:path";
import { expect, test, type APIRequestContext, type Browser, type Locator, type Page } from "@playwright/test";
import { member, uid } from "./forum-fixtures";
import { useFreshIp } from "./helpers";

/**
 * Hover card-ul membrului, deschis de staff din chat (raportul proprietarului, 2026-11-03): avatarul are rama VIP a
 * membrului (ca în profil și în postbit), iar acțiunile încap în card la orice lățime — Mesaj cu eticheta, Urmărește /
 * Conținutul lui / Ignoră ca iconițe cu tooltip pe același rând, Mute / Kick / Avertisment ca iconițe pe rândul lor.
 * Niciun buton nu iese din card, nu e tăiat și nu rămâne singur pe un rând, la 1440 px și la 375 px.
 */

const MEMBER_ACTIONS = ["gcs-hover-message", "gcs-hover-follow", "gcs-hover-content", "gcs-hover-ignore"];
const STAFF_ACTIONS = ["gcs-hover-chatmod-mute", "gcs-hover-chatmod-kick", "gcs-hover-chatmod-warn"];

/** Datele de profil prin ruta de test (`/api/_test/profile`): VIP-ul și rama aleasă. */
async function profileFixture(request: APIRequestContext, data: Record<string, unknown>): Promise<void> {
  const res = await request.post("/api/_test/profile", { data });
  expect(res.ok(), await res.text()).toBe(true);
}

/** Un membru (din grupul dat) într-un context nou de browser. */
async function memberPage(browser: Browser, name: string, email: string, ip: string, group = "member"): Promise<Page> {
  const context = await browser.newContext();
  await useFreshIp(context, ip);
  const page = await context.newPage();
  await member(page, name, email, group);
  return page;
}

/** Chat-ul (camera generală), cu realtime pornit. */
async function openChat(page: Page): Promise<Locator> {
  await page.goto("/chat");
  await expect(page.locator("html")).toHaveAttribute("data-realtime", "on", { timeout: 20_000 });
  return page.getByTestId("gcs-chat-general");
}

/** Cardul deschis de pe numele din mesaj, după animația de apariție. */
async function openCard(page: Page, name: Locator): Promise<Locator> {
  await page.mouse.move(2, 2);
  await name.hover();
  const layer = page.locator(".gcs-hoverCardLayer");
  await expect(layer.getByTestId("gcs-hover-card")).toBeVisible({ timeout: 10_000 });
  await expect(layer).not.toHaveAttribute("data-side", "pending");
  await page.waitForTimeout(300);
  return layer.getByTestId("gcs-hover-card");
}

/** Toate butoanele din acțiunile cardului stau în lățimea lui, cu eticheta întreagă, pe rândurile lor. */
async function expectActionsFit(card: Locator, width: number): Promise<void> {
  const report = await card.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const buttons = [...el.querySelectorAll<HTMLElement>(".gcs-hoverCard__actions .gcs-btn")].map((b) => {
      const r = b.getBoundingClientRect();
      const label = b.querySelector<HTMLElement>(".gcs-hoverCard__label");
      return {
        id: b.dataset.testid ?? b.getAttribute("aria-label") ?? "",
        left: r.left,
        right: r.right,
        top: r.top,
        clipped: b.scrollWidth > b.clientWidth + 1 || (label !== null && label.scrollWidth > label.clientWidth + 1),
      };
    });
    return { left: box.left, right: box.right, buttons };
  });
  expect(report.buttons.map((b) => b.id).sort(), `la ${width}px`).toEqual([...MEMBER_ACTIONS, ...STAFF_ACTIONS].sort());
  for (const b of report.buttons) {
    expect(b.right, `${b.id} iese din dreapta cardului la ${width}px`).toBeLessThanOrEqual(report.right + 0.5);
    expect(b.left, `${b.id} iese din stânga cardului la ${width}px`).toBeGreaterThanOrEqual(report.left - 0.5);
    expect(b.clipped, `${b.id} are eticheta tăiată la ${width}px`).toBe(false);
  }
  // Un singur rând pentru acțiunile membrului și unul pentru moderare: niciun buton rămas singur pe rândul următor.
  const rows = (ids: string[]) => new Set(report.buttons.filter((b) => ids.includes(b.id)).map((b) => Math.round(b.top))).size;
  expect(rows(MEMBER_ACTIONS), `acțiunile membrului pe un rând la ${width}px`).toBe(1);
  expect(rows(STAFF_ACTIONS), `moderarea pe un rând la ${width}px`).toBe(1);
}

test.beforeEach(async ({ context }) => {
  await useFreshIp(context, "203.0.113");
});

test("hover card din chat (staff): rama VIP pe avatar; acțiunile încap în card la 1440 px și la 375 px", async ({ browser, request }) => {
  test.setTimeout(120_000);
  const id = uid();
  const vipEmail = `hc-vip-${id}@example.com`;

  // Membrul VIP cu rama „gold” (ACP → VIP → Rame), care scrie în chat.
  const vip = await memberPage(browser, `Rama${id}`, vipEmail, "100.99.1");
  await profileFixture(request, { action: "vip", email: vipEmail, groupKey: "vip_gold", days: 30 });
  await profileFixture(request, { action: "frame", email: vipEmail, frameKey: "gold" });
  const vipRoom = await openChat(vip);
  await vipRoom.getByTestId("gcs-chat-input").fill(`salut din chat ${id}`);
  await vipRoom.getByTestId("gcs-chat-input").press("Enter");
  await expect(vipRoom.getByTestId("gcs-chat-msg").filter({ hasText: `salut din chat ${id}` })).toBeVisible();

  // Un administrator (staff în chat: Mute / Kick / Avertisment) îi deschide cardul de pe nume.
  const admin = await memberPage(browser, `HcAdmin${id}`, `hc-admin-${id}@example.com`, "100.99.2", "admin");
  await admin.setViewportSize({ width: 1440, height: 1000 });
  const room = await openChat(admin);
  const name = room.getByTestId("gcs-chat-msg").filter({ hasText: `salut din chat ${id}` }).getByTestId("gcs-chat-name");

  await test.step("1440 px: rama VIP pe avatar, toate acțiunile, iconițele cu tooltip", async () => {
    const card = await openCard(admin, name);
    const frame = card.locator(".gcs-hoverCard__avatar .gcs-avatarFrame--gold");
    await expect(frame).toBeVisible();
    // Rama se desenează (regula generată din ACP, ca în postbit), nu doar clasa.
    expect(await frame.evaluate((el) => getComputedStyle(el, "::before").backgroundImage)).toContain("conic-gradient");
    await expect(card.getByTestId("gcs-hover-message")).toContainText("Mesaj");
    for (const t of [...MEMBER_ACTIONS.slice(1), ...STAFF_ACTIONS]) {
      const button = card.getByTestId(t);
      const label = await button.getAttribute("aria-label");
      expect(label, `${t} are aria-label`).toBeTruthy();
      await expect(button).toHaveAttribute("data-tip", label!);
      // Fără text vizibil: doar iconița (ascunsă cititoarelor de ecran), numele vine din `aria-label`.
      expect((await button.textContent())?.trim(), `${t} e doar iconiță`).toBe("");
    }
    await expectActionsFit(card, 1440);
    if (process.env.GCS_E2E_SHOTS) await card.screenshot({ path: path.join(process.env.GCS_E2E_SHOTS, "hovercard-1440.png") });
    // Tooltip-ul sistemului pe o iconiță (cardul rămâne deschis cât mouse-ul e pe el).
    await card.getByTestId("gcs-hover-follow").hover();
    await expect(admin.getByTestId("gcs-auto-tooltip")).toHaveText("Urmărește");
    await admin.keyboard.press("Escape");
    await expect(admin.locator(".gcs-hoverCardLayer")).toHaveCount(0);
  });

  await test.step("375 px: aceleași acțiuni, toate în lățimea cardului", async () => {
    await admin.setViewportSize({ width: 375, height: 812 });
    const card = await openCard(admin, name);
    await expect(card.locator(".gcs-hoverCard__avatar .gcs-avatarFrame--gold")).toBeVisible();
    await expectActionsFit(card, 375);
    if (process.env.GCS_E2E_SHOTS) await card.screenshot({ path: path.join(process.env.GCS_E2E_SHOTS, "hovercard-375.png") });
    const box = await card.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  });

  for (const p of [vip, admin]) await p.context().close();
});
